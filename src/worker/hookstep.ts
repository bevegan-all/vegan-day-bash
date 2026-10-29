import { Hono } from "hono";
import { HttpError, audit, now, shortName, type AppEnv, type Ctx, type Env, type User } from "./lib";
import { notifyNewPlayers, notifyRemoved } from "./notify";

// ---------------------------------------------------------------------------
// Hook Step Challenge. Each round a player does STEPS hook steps and an organiser marks every one pass or fail.
//  - After all the rounds, whoever has the most correct steps wins.
//  - Players level at the top go to a final round; anyone still level after it wins together.
// ---------------------------------------------------------------------------

export const DEFAULT_STEPS = 10;

export interface HsConfig {
  configured: boolean;
  rounds: number;
  cap: number;
  steps: number;
}

export interface HsRound {
  id: number;
  game_id: number;
  ord: number;
  kind: "round" | "final";
  status: "idle" | "live" | "done";
}

export interface HsTurn {
  round_id: number;
  user_id: number;
  status: "waiting" | "live" | "done";
  monitor_id: number | null;
  steps: string;
  score: number | null;
}

export const parseHsConfig = (raw: string | null): HsConfig => {
  try {
    const c = JSON.parse(raw || "{}") as { rounds?: number; cap?: number; steps?: number };
    if (c.rounds && c.cap) return { configured: true, rounds: c.rounds, cap: c.cap, steps: c.steps ?? DEFAULT_STEPS };
  } catch {
    /* not set up yet */
  }
  return { configured: false, rounds: 0, cap: 0, steps: DEFAULT_STEPS };
};

export interface Standing {
  userId: number;
  rank: number;
  total: number;
  finalScore: number | null;
  winner: boolean;
}

export interface Outcome {
  regularDone: boolean;
  leaders: number[];
  needFinal: boolean;
  finalDone: boolean;
  winners: number[];
  totals: Map<number, number>;
  ranking: Standing[];
}

// Pure: who is ahead, who needs a final, who has won, from the rounds and turns as they stand.
export function hookOutcome(rounds: HsRound[], turns: HsTurn[]): Outcome {
  const regular = rounds.filter((r) => r.kind === "round");
  const final = rounds.find((r) => r.kind === "final");
  const regularIds = new Set(regular.map((r) => r.id));
  const totals = new Map<number, number>();
  for (const t of turns) {
    if (t.status === "done" && regularIds.has(t.round_id)) totals.set(t.user_id, (totals.get(t.user_id) ?? 0) + (t.score ?? 0));
  }
  const regularDone = regular.length > 0 && regular.every((r) => r.status === "done");
  const best = Math.max(0, ...totals.values());
  const leaders = regularDone && best > 0 ? [...totals].filter(([, v]) => v === best).map(([id]) => id) : [];
  const needFinal = leaders.length > 1;
  const finalTurn = (u: number) => (final ? turns.find((t) => t.round_id === final.id && t.user_id === u) : undefined);
  const finalScore = (u: number) => {
    const t = finalTurn(u);
    return t && t.status === "done" ? (t.score ?? 0) : null;
  };
  const finalDone = needFinal && !!final && final.status === "done" && leaders.every((u) => finalScore(u) != null);
  let winners: number[] = [];
  if (regularDone && leaders.length === 1) winners = leaders;
  else if (finalDone) {
    const top = Math.max(...leaders.map((u) => finalScore(u) ?? 0));
    winners = leaders.filter((u) => (finalScore(u) ?? 0) === top);
  }
  const won = new Set(winners);

  // overall order: winners, then the other finalists by their final, then everyone else by total
  const everyone = [...totals.keys()];
  const key = (u: number): [number, number, number] =>
    won.has(u) ? [0, 0, 0] : finalDone && leaders.includes(u) ? [1, -(finalScore(u) ?? 0), 0] : [2, -(totals.get(u) ?? 0), 0];
  everyone.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a - b;
  });
  const ranking: Standing[] = [];
  everyone.forEach((u, i) => {
    const prev = ranking[i - 1];
    const same = prev && JSON.stringify(key(prev.userId)) === JSON.stringify(key(u)) && prev.total === (totals.get(u) ?? 0);
    ranking.push({ userId: u, rank: same ? prev.rank : i + 1, total: totals.get(u) ?? 0, finalScore: finalScore(u), winner: won.has(u) });
  });
  return { regularDone, leaders, needFinal, finalDone, winners, totals, ranking };
}

export interface HsData {
  game: { id: number; name: string; location: string; config: HsConfig };
  rounds: HsRound[];
  turns: HsTurn[];
}

export async function loadHook(env: Env, gameId: number): Promise<HsData> {
  const g = await env.DB.prepare("SELECT id, name, type, location, config FROM games WHERE id = ?").bind(gameId).first<{ id: number; name: string; type: string; location: string; config: string }>();
  if (!g || g.type !== "hookstep") throw new HttpError(404, "Not a Hook Step Challenge");
  const [rounds, turns] = await Promise.all([
    env.DB.prepare("SELECT id, game_id, ord, kind, status FROM hs_rounds WHERE game_id = ? ORDER BY ord").bind(gameId).all<HsRound>(),
    env.DB.prepare("SELECT t.round_id, t.user_id, t.status, t.monitor_id, t.steps, t.score FROM hs_turns t JOIN hs_rounds r ON r.id = t.round_id WHERE r.game_id = ?").bind(gameId).all<HsTurn>(),
  ]);
  return { game: { id: g.id, name: g.name, location: g.location, config: parseHsConfig(g.config) }, rounds: rounds.results, turns: turns.results };
}

// For the leaderboard: the overall order of everyone who has played
export async function rankHookstep(env: Env, gameId: number) {
  const d = await loadHook(env, gameId);
  const out = hookOutcome(d.rounds, d.turns);
  const max = d.game.config.steps * d.game.config.rounds;
  const { results: people } = await env.DB.prepare(
    "SELECT DISTINCT u.id, u.display_name AS name, u.team_id AS teamId FROM hs_turns t JOIN hs_rounds r ON r.id = t.round_id JOIN users u ON u.id = t.user_id WHERE r.game_id = ?",
  )
    .bind(gameId)
    .all<{ id: number; name: string; teamId: number | null }>();
  const who = new Map(people.map((p) => [p.id, p]));
  return out.ranking.map((s) => ({
    userId: s.userId,
    name: who.get(s.userId)?.name ?? "",
    teamId: who.get(s.userId)?.teamId ?? null,
    rank: s.rank,
    value: s.total,
    detail: `${s.total} of ${max}`,
  }));
}

// ---------- what players, the public screen and organisers see ----------
export async function hookDetail(env: Env, gameId: number, viewer: User | null, organiser: boolean) {
  const d = await loadHook(env, gameId);
  const cfg = d.game.config;
  const display = (n: string) => (organiser ? n : shortName(n));
  const [rosterRes, peopleRes, monitorRes] = await Promise.all([
    env.DB.prepare("SELECT u.id AS userId, u.display_name AS name, u.team_id AS teamId FROM game_players p JOIN users u ON u.id = p.user_id WHERE p.game_id = ? ORDER BY p.added_at, u.id").bind(gameId).all<{ userId: number; name: string; teamId: number | null }>(),
    env.DB.prepare("SELECT DISTINCT u.id AS userId, u.display_name AS name, u.team_id AS teamId FROM hs_turns t JOIN hs_rounds r ON r.id = t.round_id JOIN users u ON u.id = t.user_id WHERE r.game_id = ?").bind(gameId).all<{ userId: number; name: string; teamId: number | null }>(),
    env.DB.prepare("SELECT DISTINCT u.id, u.display_name AS name FROM hs_turns t JOIN hs_rounds r ON r.id = t.round_id JOIN users u ON u.id = t.monitor_id WHERE r.game_id = ?").bind(gameId).all<{ id: number; name: string }>(),
  ]);
  const roster = rosterRes.results;
  const who = new Map([...peopleRes.results, ...roster].map((p) => [p.userId, p]));
  const monitors = new Map(monitorRes.results.map((m) => [m.id, m.name]));
  const out = hookOutcome(d.rounds, d.turns);
  const regular = d.rounds.filter((r) => r.kind === "round");

  const phase = !cfg.configured ? "setup" : out.winners.length || (out.regularDone && out.leaders.length === 0) ? "done" : out.regularDone && out.needFinal ? "final" : "rounds";
  const final = d.rounds.find((r) => r.kind === "final");

  const standing = new Map(out.ranking.map((s) => [s.userId, s]));
  const standings = [...new Set([...roster.map((p) => p.userId), ...out.ranking.map((s) => s.userId)])].map((userId) => {
    const p = who.get(userId)!;
    const s = standing.get(userId);
    return {
      userId,
      name: display(p.name),
      teamId: p.teamId,
      rank: s?.rank ?? null,
      total: out.totals.get(userId) ?? 0,
      scores: regular.map((r) => {
        const t = d.turns.find((x) => x.round_id === r.id && x.user_id === userId);
        return t && t.status === "done" ? t.score : null;
      }),
      final: s?.finalScore ?? null,
      winner: !!s?.winner,
      finalist: out.needFinal && out.leaders.includes(userId),
    };
  });
  standings.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.name.localeCompare(b.name));

  return {
    configured: cfg.configured,
    roundsCount: cfg.rounds,
    cap: cfg.cap,
    steps: cfg.steps,
    phase,
    mine: !!viewer && roster.some((p) => p.userId === viewer.id),
    finalist: !!viewer && out.needFinal && out.leaders.includes(viewer.id),
    leaders: out.leaders,
    winners: out.winners,
    hasFinal: !!final,
    roster: roster.map((p) => ({ userId: p.userId, name: display(p.name), teamId: p.teamId })),
    rounds: d.rounds.map((r) => ({
      id: r.id,
      ord: r.ord,
      kind: r.kind,
      status: r.status,
      turns: d.turns
        .filter((t) => t.round_id === r.id)
        .map((t) => ({
          userId: t.user_id,
          name: display(who.get(t.user_id)?.name ?? ""),
          teamId: who.get(t.user_id)?.teamId ?? null,
          status: t.status,
          steps: t.steps,
          score: t.score,
          monitorId: t.monitor_id,
          monitorName: t.monitor_id ? shortName(monitors.get(t.monitor_id) ?? "") : null,
        })),
    })),
    standings,
  };
}

// ---------- organiser routes ----------
export const hookAdminRoutes = new Hono<AppEnv>();
const me = (c: Ctx) => c.get("user") as User;

async function hsRound(c: Ctx, id: number) {
  const r = await c.env.DB.prepare("SELECT id, game_id, ord, kind, status FROM hs_rounds WHERE id = ?").bind(id).first<HsRound>();
  if (!r) throw new HttpError(404, "No such round");
  return r;
}

async function turnOf(c: Ctx, roundId: number, userId: number) {
  return c.env.DB.prepare("SELECT round_id, user_id, status, monitor_id, steps, score FROM hs_turns WHERE round_id = ? AND user_id = ?").bind(roundId, userId).first<HsTurn>();
}

const finalStarted = async (env: Env, gameId: number) =>
  !!(await env.DB.prepare("SELECT 1 FROM hs_turns t JOIN hs_rounds r ON r.id = t.round_id WHERE r.game_id = ? AND r.kind = 'final' AND t.steps != '' LIMIT 1").bind(gameId).first());

// Make the final round match the standings: players level at the top go in; if nobody is level, there is no final.
export async function syncHook(env: Env, gameId: number) {
  const d = await loadHook(env, gameId);
  const out = hookOutcome(d.rounds, d.turns);
  const final = d.rounds.find((r) => r.kind === "final");
  if (!out.needFinal) {
    if (final && !(await finalStarted(env, gameId))) await env.DB.prepare("DELETE FROM hs_rounds WHERE id = ?").bind(final.id).run();
    return;
  }
  let finalId = final?.id;
  if (!finalId) {
    await env.DB.prepare("INSERT OR IGNORE INTO hs_rounds (game_id, ord, kind) VALUES (?, ?, 'final')").bind(gameId, d.game.config.rounds + 1).run();
    finalId = (await env.DB.prepare("SELECT id FROM hs_rounds WHERE game_id = ? AND kind = 'final'").bind(gameId).first<{ id: number }>())?.id;
  }
  if (!finalId) return;
  const have = new Set(d.turns.filter((t) => t.round_id === finalId).map((t) => t.user_id));
  const told: number[] = [];
  for (const u of out.leaders) {
    if (have.has(u)) continue;
    const res = await env.DB.prepare("INSERT OR IGNORE INTO hs_turns (round_id, user_id, status, updated_at) VALUES (?, ?, 'waiting', ?)").bind(finalId, u, now()).run();
    if (res.meta.changes) told.push(u);
  }
  // players who are no longer level, and have not started, come out of the final
  for (const t of d.turns.filter((t) => t.round_id === finalId && !out.leaders.includes(t.user_id) && t.steps === "")) {
    await env.DB.prepare("DELETE FROM hs_turns WHERE round_id = ? AND user_id = ? AND steps = ''").bind(finalId, t.user_id).run();
  }
  for (const u of told) {
    await env.DB.prepare("INSERT INTO notifications (user_id, kind, title, body, game_id, created_at) VALUES (?, 'game_added', ?, ?, ?, ?)")
      .bind(u, `You made the final: ${d.game.name}`, `You are level at the top. Head to the ${d.game.location}.`, gameId, now())
      .run();
  }
}

async function hsGame(env: Env, gameId: number) {
  const d = await loadHook(env, gameId);
  return d;
}

// Choose how many rounds and how many players can take part
hookAdminRoutes.post("/games/:id/hookstep/setup", async (c) => {
  const gameId = Number(c.req.param("id"));
  const d = await hsGame(c.env, gameId);
  const body = await c.req.json<{ rounds?: number; cap?: number }>();
  const rounds = Math.floor(Number(body.rounds));
  const cap = Math.floor(Number(body.cap));
  if (!(rounds >= 1 && rounds <= 10)) throw new HttpError(400, "Pick between 1 and 10 rounds");
  if (!(cap >= 2 && cap <= 300)) throw new HttpError(400, "Pick between 2 and 300 players");
  const started = d.rounds.some((r) => r.status !== "idle") || d.turns.length > 0;
  if (d.game.config.configured && started && rounds !== d.game.config.rounds) throw new HttpError(409, "The rounds can't change once the game has started");
  const taken = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?").bind(gameId).first<{ n: number }>();
  if (cap < (taken?.n ?? 0)) throw new HttpError(409, `${taken?.n} players are already on the list. Take some off first.`);
  const stmts = [c.env.DB.prepare("UPDATE games SET config = ? WHERE id = ?").bind(JSON.stringify({ rounds, cap, steps: DEFAULT_STEPS }), gameId)];
  if (!started) {
    stmts.push(c.env.DB.prepare("DELETE FROM hs_rounds WHERE game_id = ?").bind(gameId));
    for (let i = 1; i <= rounds; i++) stmts.push(c.env.DB.prepare("INSERT INTO hs_rounds (game_id, ord, kind) VALUES (?, ?, 'round')").bind(gameId, i));
  }
  await c.env.DB.batch(stmts);
  await audit(c.env, me(c).id, "hookstep.setup", { gameId, rounds, cap });
  return c.json({ ok: true });
});

// Start the game over (admin): rounds, scores and the player list
hookAdminRoutes.post("/games/:id/hookstep/reset", async (c) => {
  if (me(c).role !== "admin") throw new HttpError(403, "Admins only");
  const gameId = Number(c.req.param("id"));
  await hsGame(c.env, gameId);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM hs_rounds WHERE game_id = ?").bind(gameId),
    c.env.DB.prepare("DELETE FROM game_players WHERE game_id = ?").bind(gameId),
    c.env.DB.prepare("UPDATE games SET config = '{}' WHERE id = ?").bind(gameId),
  ]);
  await audit(c.env, me(c).id, "hookstep.reset", { gameId });
  return c.json({ ok: true });
});

// Add players. Several organisers can do this together; the cap is checked inside the same statement that adds them.
hookAdminRoutes.post("/games/:id/hookstep/players", async (c) => {
  const gameId = Number(c.req.param("id"));
  const d = await hsGame(c.env, gameId);
  if (!d.game.config.configured) throw new HttpError(409, "Set up the rounds and the number of players first");
  const body = await c.req.json<{ userIds?: number[]; scope?: "all" | "checked_in" | "team"; teamId?: number }>();
  let where = "";
  const args: number[] = [];
  if (body.userIds?.length) {
    const ids = [...new Set(body.userIds.map(Number))].filter((n) => Number.isInteger(n));
    if (!ids.length || ids.length > 300) throw new HttpError(400, "Pick between 1 and 300 people");
    where = `id IN (${ids.map(() => "?").join(",")})`;
    args.push(...ids);
  } else if (body.scope === "all") where = "team_id IS NOT NULL";
  else if (body.scope === "checked_in") where = "checked_in = 1";
  else if (body.scope === "team" && body.teamId) {
    where = "team_id = ?";
    args.push(Number(body.teamId));
  } else throw new HttpError(400, "Say who to add");
  const wanted = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${where} AND id NOT IN (SELECT user_id FROM game_players WHERE game_id = ?)`).bind(...args, gameId).first<{ n: number }>();
  const res = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO game_players (game_id, user_id, added_by, added_at)
     SELECT ?, id, ?, ? FROM users WHERE ${where} AND id NOT IN (SELECT user_id FROM game_players WHERE game_id = ?)
      ORDER BY id LIMIT MAX(0, ? - (SELECT COUNT(*) FROM game_players WHERE game_id = ?))`,
  )
    .bind(gameId, me(c).id, now(), ...args, gameId, d.game.config.cap, gameId)
    .run();
  await notifyNewPlayers(c.env, gameId);
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?").bind(gameId).first<{ n: number }>();
  await audit(c.env, me(c).id, "hookstep.add", { gameId, added: res.meta.changes });
  return c.json({ added: res.meta.changes, total: total?.n ?? 0, cap: d.game.config.cap, full: (wanted?.n ?? 0) > res.meta.changes });
});

hookAdminRoutes.delete("/games/:id/hookstep/players/:userId", async (c) => {
  const gameId = Number(c.req.param("id"));
  const userId = Number(c.req.param("userId"));
  await hsGame(c.env, gameId);
  const res = await c.env.DB.prepare("DELETE FROM game_players WHERE game_id = ? AND user_id = ?").bind(gameId, userId).run();
  if (res.meta.changes) {
    await c.env.DB.prepare("DELETE FROM hs_turns WHERE user_id = ? AND round_id IN (SELECT id FROM hs_rounds WHERE game_id = ?)").bind(userId, gameId).run();
    await syncHook(c.env, gameId);
    await notifyRemoved(c.env, gameId, userId);
    await audit(c.env, me(c).id, "hookstep.remove", { gameId, userId });
  }
  return c.json({ ok: true });
});

// Start or finish a round
hookAdminRoutes.post("/hs-rounds/:id/status", async (c) => {
  const r = await hsRound(c, Number(c.req.param("id")));
  const { status } = await c.req.json<{ status?: string }>();
  if (status !== "live" && status !== "done") throw new HttpError(400, "Bad status");
  const d = await loadHook(c.env, r.game_id);
  if (status === "live") {
    const other = d.rounds.find((x) => x.status === "live" && x.id !== r.id);
    if (other) throw new HttpError(409, `${other.kind === "final" ? "The final" : `Round ${other.ord}`} is still running. Finish it first.`);
    const before = d.rounds.find((x) => x.ord < r.ord && x.status !== "done");
    if (before) throw new HttpError(409, `Finish round ${before.ord} first`);
    if (r.status === "done") {
      if (r.kind === "round" && (await finalStarted(c.env, r.game_id))) throw new HttpError(409, "The final has already started, so this round can't be reopened");
    } else {
      const roster = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?").bind(r.game_id).first<{ n: number }>();
      if (r.kind === "round" && !(roster?.n ?? 0)) throw new HttpError(409, "Add players first");
    }
    await c.env.DB.prepare("UPDATE hs_rounds SET status = 'live' WHERE id = ?").bind(r.id).run();
    if (r.kind === "round") await syncHook(c.env, r.game_id);
  } else {
    const turns = d.turns.filter((t) => t.round_id === r.id);
    const mid = turns.filter((t) => t.status === "live").length;
    if (mid) throw new HttpError(409, `${mid} ${mid === 1 ? "player is" : "players are"} still being monitored. Finish or start over their turn first.`);
    if (r.kind === "final" && turns.some((t) => t.status !== "done")) throw new HttpError(409, "Every finalist has to do their turn first");
    await c.env.DB.prepare("UPDATE hs_rounds SET status = 'done' WHERE id = ?").bind(r.id).run();
    await syncHook(c.env, r.game_id);
  }
  await audit(c.env, me(c).id, "hookstep.status", { roundId: r.id, status });
  return c.json({ ok: true });
});

// Start monitoring a player. Only one organiser can have a player at a time.
hookAdminRoutes.post("/hs-rounds/:id/monitor", async (c) => {
  const r = await hsRound(c, Number(c.req.param("id")));
  const body = await c.req.json<{ userId?: number; takeover?: boolean }>();
  const userId = Number(body.userId);
  if (!userId) throw new HttpError(400, "Pick a player");
  if (r.status !== "live") throw new HttpError(409, "Start the round first");
  let turn = await turnOf(c, r.id, userId);
  if (!turn) {
    if (r.kind === "final") throw new HttpError(409, "This player isn't in the final");
    const onList = await c.env.DB.prepare("SELECT 1 FROM game_players WHERE game_id = ? AND user_id = ?").bind(r.game_id, userId).first();
    if (!onList) throw new HttpError(409, "This player isn't on the player list");
    await c.env.DB.prepare("INSERT OR IGNORE INTO hs_turns (round_id, user_id, status, monitor_id, started_at, updated_at) VALUES (?, ?, 'live', ?, ?, ?)").bind(r.id, userId, me(c).id, now(), now()).run();
    turn = await turnOf(c, r.id, userId);
  } else if (turn.status === "waiting") {
    await c.env.DB.prepare("UPDATE hs_turns SET status = 'live', monitor_id = ?, started_at = ?, updated_at = ? WHERE round_id = ? AND user_id = ? AND status = 'waiting'").bind(me(c).id, now(), now(), r.id, userId).run();
    turn = await turnOf(c, r.id, userId);
  }
  if (!turn) throw new HttpError(409, "Could not start, try again");
  if (turn.status === "done") throw new HttpError(409, "This turn is finished. Start it over to redo it.");
  if (turn.monitor_id !== me(c).id) {
    if (!body.takeover) {
      const other = turn.monitor_id ? await c.env.DB.prepare("SELECT display_name AS n FROM users WHERE id = ?").bind(turn.monitor_id).first<{ n: string }>() : null;
      throw new HttpError(409, `${other ? shortName(other.n) : "Another organiser"} is already monitoring this player`);
    }
    await c.env.DB.prepare("UPDATE hs_turns SET monitor_id = ?, updated_at = ? WHERE round_id = ? AND user_id = ? AND status = 'live'").bind(me(c).id, now(), r.id, userId).run();
    turn = await turnOf(c, r.id, userId);
  }
  return c.json({ turn });
});

// Mark the next step pass or fail. `index` is how many steps the organiser has already seen, so a double tap or
// two organisers tapping at once can never record the same step twice.
hookAdminRoutes.post("/hs-rounds/:id/step", async (c) => {
  const r = await hsRound(c, Number(c.req.param("id")));
  const body = await c.req.json<{ userId?: number; pass?: boolean; index?: number }>();
  const userId = Number(body.userId);
  const index = Number(body.index);
  const d = await loadHook(c.env, r.game_id);
  const S = d.game.config.steps;
  if (!userId || typeof body.pass !== "boolean" || !Number.isInteger(index) || index < 0 || index >= S) throw new HttpError(400, "Bad step");
  if (r.status !== "live") throw new HttpError(409, "The round isn't running");
  const ch = body.pass ? "P" : "F";
  const res = await c.env.DB.prepare(
    `UPDATE hs_turns SET steps = steps || ?,
        status = CASE WHEN length(steps) + 1 >= ? THEN 'done' ELSE 'live' END,
        score = CASE WHEN length(steps) + 1 >= ? THEN length(steps || ?) - length(replace(steps || ?, 'P', '')) ELSE NULL END,
        updated_at = ?
      WHERE round_id = ? AND user_id = ? AND status = 'live' AND length(steps) = ?`,
  )
    .bind(ch, S, S, ch, ch, now(), r.id, userId, index)
    .run();
  const turn = await turnOf(c, r.id, userId);
  if (!turn) throw new HttpError(409, "Start monitoring this player first");
  return c.json({ turn, recorded: res.meta.changes === 1 });
});

// Take back the last step
hookAdminRoutes.post("/hs-rounds/:id/undo", async (c) => {
  const r = await hsRound(c, Number(c.req.param("id")));
  const { userId, index } = await c.req.json<{ userId?: number; index?: number }>();
  if (r.status !== "live") throw new HttpError(409, "The round isn't running");
  const res = await c.env.DB.prepare(
    `UPDATE hs_turns SET steps = substr(steps, 1, length(steps) - 1), status = 'live', score = NULL, updated_at = ?
      WHERE round_id = ? AND user_id = ? AND length(steps) > 0 AND length(steps) = ?`,
  )
    .bind(now(), r.id, Number(userId), Number(index))
    .run();
  return c.json({ turn: await turnOf(c, r.id, Number(userId)), recorded: res.meta.changes === 1 });
});

// Start a player's turn over (a mistake, or a redo)
hookAdminRoutes.post("/hs-rounds/:id/reset-turn", async (c) => {
  const r = await hsRound(c, Number(c.req.param("id")));
  const { userId } = await c.req.json<{ userId?: number }>();
  if (r.status === "done") throw new HttpError(409, "Reopen the round first");
  if (r.kind === "final") await c.env.DB.prepare("UPDATE hs_turns SET status = 'waiting', steps = '', score = NULL, monitor_id = NULL, updated_at = ? WHERE round_id = ? AND user_id = ?").bind(now(), r.id, Number(userId)).run();
  else await c.env.DB.prepare("DELETE FROM hs_turns WHERE round_id = ? AND user_id = ?").bind(r.id, Number(userId)).run();
  await audit(c.env, me(c).id, "hookstep.reset-turn", { roundId: r.id, userId });
  return c.json({ ok: true });
});
