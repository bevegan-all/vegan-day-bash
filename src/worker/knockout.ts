import { Hono } from "hono";
import { HttpError, audit, now, shortName, type AppEnv, type Ctx, type Env, type User } from "./lib";
import { notifyNewPlayers, notifyRemoved } from "./notify";

// ---------------------------------------------------------------------------
// Knockout tournament games (Paper Cup Flip Tic-Tac-Toe, Colour Blind).
//  1. Players join from the app while the game is live (organisers can add people too).
//  2. An organiser starts it: everyone is matched at random, and byes fill the first round up to a power of two.
//  3. Organisers pick the winner of each match. Winners move on until the final.
// ---------------------------------------------------------------------------

export interface TttMatch {
  id: number;
  game_id: number;
  round: number;
  slot: number;
  a_user: number | null;
  b_user: number | null;
  winner_id: number | null;
  status: "pending" | "live" | "done";
  bye: number;
  notified: number;
}

interface TttConfig {
  state: "registration" | "running";
  rounds: number;
}

const parseConfig = (raw: string | null): TttConfig => {
  try {
    const c = JSON.parse(raw || "{}") as { state?: string; rounds?: number };
    return { state: c.state === "running" ? "running" : "registration", rounds: c.rounds ?? 0 };
  } catch {
    return { state: "registration", rounds: 0 };
  }
};

export const roundName = (round: number, rounds: number) => (round === rounds ? "Final" : round === rounds - 1 ? "Semi-finals" : round === rounds - 2 ? "Quarter-finals" : `Round ${round}`);

export interface DrawnMatch {
  round: number;
  slot: number;
  a: number | null;
  b: number | null;
  winner: number | null;
  bye: boolean;
}

// Pure: draw a single-elimination bracket for these players. Byes go to the first round, spread out so no
// match is a bye against a bye, and the player who gets a bye moves straight into round 2.
export function drawBracket(ids: number[], random: () => number = Math.random): { rounds: number; matches: DrawnMatch[] } {
  const n = ids.length;
  let size = 2;
  while (size < n) size *= 2;
  const rounds = Math.log2(size);
  const queue = [...ids];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  const first = size / 2;
  const byes = size - n;
  const byeSlots = new Set(Array.from({ length: byes }, (_, i) => Math.floor((i * first) / byes)));
  const matches: DrawnMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (let slot = 0; slot < size / 2 ** round; slot++) matches.push({ round, slot, a: null, b: null, winner: null, bye: false });
  }
  const at = (round: number, slot: number) => matches.find((m) => m.round === round && m.slot === slot)!;
  for (let slot = 0; slot < first; slot++) {
    const m = at(1, slot);
    m.a = queue.shift() ?? null;
    if (byeSlots.has(slot)) {
      m.bye = true;
      m.winner = m.a;
    } else m.b = queue.shift() ?? null;
  }
  for (const m of matches.filter((x) => x.round === 1 && x.bye)) {
    const next = at(2, Math.floor(m.slot / 2));
    if (rounds >= 2) {
      if (m.slot % 2 === 0) next.a = m.winner;
      else next.b = m.winner;
    }
  }
  return { rounds, matches };
}

export async function loadTtt(env: Env, gameId: number) {
  const g = await env.DB.prepare("SELECT id, name, type, location, status, config FROM games WHERE id = ?").bind(gameId).first<{ id: number; name: string; type: string; location: string; status: string; config: string }>();
  if (!g || g.type !== "knockout") throw new HttpError(404, "Not a knockout tournament");
  const { results } = await env.DB.prepare("SELECT id, game_id, round, slot, a_user, b_user, winner_id, status, bye, notified FROM ttt_matches WHERE game_id = ? ORDER BY round, slot").bind(gameId).all<TttMatch>();
  return { game: g, config: parseConfig(g.config), matches: results };
}

type Person = { userId: number; name: string; teamId: number | null };

async function people(env: Env, ids: number[]) {
  if (!ids.length) return new Map<number, Person>();
  const { results } = await env.DB.prepare(`SELECT id AS userId, display_name AS name, team_id AS teamId FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<Person>();
  return new Map(results.map((p) => [p.userId, p]));
}

export function tttState(config: TttConfig, matches: TttMatch[]) {
  if (config.state === "registration") return "registration" as const;
  const final = matches.find((m) => m.round === config.rounds);
  return final?.winner_id ? ("done" as const) : ("running" as const);
}

// For the leaderboard: once the tournament is over, champion first, then the finalist, the semi-final losers (level), and so on
export async function rankKnockout(env: Env, gameId: number) {
  const d = await loadTtt(env, gameId);
  if (tttState(d.config, d.matches) !== "done") return [];
  const R = d.config.rounds;
  const score = new Map<number, number>();
  for (const m of d.matches) {
    for (const u of [m.a_user, m.b_user]) if (u != null && !score.has(u)) score.set(u, 0);
    if (m.status === "done" && !m.bye && m.winner_id != null) {
      const loser = m.winner_id === m.a_user ? m.b_user : m.a_user;
      if (loser != null) score.set(loser, Math.max(score.get(loser) ?? 0, m.round));
    }
  }
  const champ = d.matches.find((m) => m.round === R)!.winner_id!;
  score.set(champ, R + 1);
  const who = await people(env, [...score.keys()]);
  const ordered = [...score].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return ordered.map(([userId, s]) => ({
    userId,
    name: who.get(userId)?.name ?? "",
    teamId: who.get(userId)?.teamId ?? null,
    rank: 1 + ordered.filter(([, x]) => x > s).length,
    value: s,
    detail: s === R + 1 ? "Champion" : s === R ? "Runner-up" : `Out in the ${roundName(s, R).toLowerCase().replace(/s$/, "")}`,
  }));
}

export async function tttDetail(env: Env, gameId: number, viewer: User | null, organiser: boolean) {
  const d = await loadTtt(env, gameId);
  const { results: roster } = await env.DB.prepare("SELECT user_id AS userId FROM game_players WHERE game_id = ? ORDER BY added_at, user_id").bind(gameId).all<{ userId: number }>();
  const ids = [...new Set([...roster.map((r) => r.userId), ...d.matches.flatMap((m) => [m.a_user, m.b_user, m.winner_id]).filter((x): x is number => x != null)])];
  const who = await people(env, ids);
  const display = (n: string) => (organiser ? n : shortName(n));
  const p = (id: number | null) => (id == null ? null : { userId: id, name: display(who.get(id)?.name ?? ""), teamId: who.get(id)?.teamId ?? null });
  const state = tttState(d.config, d.matches);
  const R = d.config.rounds;
  const rounds = Array.from({ length: R }, (_, i) => i + 1).map((round) => ({
    round,
    name: roundName(round, R),
    matches: d.matches
      .filter((m) => m.round === round)
      .map((m) => ({ id: m.id, slot: m.slot, a: p(m.a_user), b: p(m.b_user), winnerId: m.winner_id, status: m.status, bye: !!m.bye, ready: m.a_user != null && m.b_user != null && !m.winner_id })),
  }));
  const champId = state === "done" ? d.matches.find((m) => m.round === R)!.winner_id : null;
  const mine = viewer ? d.matches.filter((m) => (m.a_user === viewer.id || m.b_user === viewer.id) && !m.bye) : [];
  const current = mine.find((m) => !m.winner_id);
  const lost = [...mine].reverse().find((m) => m.winner_id != null && m.winner_id !== viewer?.id);
  const opponentId = current && viewer ? (current.a_user === viewer.id ? current.b_user : current.a_user) : null;
  return {
    state,
    joinOpen: state === "registration" && d.game.status === "live",
    roundsCount: R,
    players: roster.length,
    mine: !!viewer && roster.some((r) => r.userId === viewer.id),
    roster: roster.map((r) => p(r.userId)!),
    rounds,
    champion: p(champId ?? null),
    you: viewer
      ? {
          inBracket: d.matches.some((m) => m.a_user === viewer.id || m.b_user === viewer.id),
          matchId: current?.id ?? null,
          round: current ? roundName(current.round, R) : null,
          status: current ? (current.status === "live" ? "live" : current.a_user != null && current.b_user != null ? "ready" : "waiting") : null,
          opponent: p(opponentId),
          outIn: !current && lost ? roundName(lost.round, R) : null,
          champion: champId === viewer.id,
        }
      : null,
  };
}

async function notifyReady(env: Env, gameId: number) {
  const g = await env.DB.prepare("SELECT name, location FROM games WHERE id = ?").bind(gameId).first<{ name: string; location: string }>();
  const { results } = await env.DB.prepare("SELECT id, round, a_user, b_user FROM ttt_matches WHERE game_id = ? AND notified = 0 AND winner_id IS NULL AND a_user IS NOT NULL AND b_user IS NOT NULL").bind(gameId).all<{ id: number; round: number; a_user: number; b_user: number }>();
  if (!results.length || !g) return;
  const d = await loadTtt(env, gameId);
  const who = await people(env, results.flatMap((m) => [m.a_user, m.b_user]));
  for (const m of results) {
    const claimed = await env.DB.prepare("UPDATE ttt_matches SET notified = 1 WHERE id = ? AND notified = 0").bind(m.id).run();
    if (!claimed.meta.changes) continue;
    const name = roundName(m.round, d.config.rounds);
    const stmts = [
      [m.a_user, m.b_user],
      [m.b_user, m.a_user],
    ].map(([me, other]) =>
      env.DB.prepare("INSERT INTO notifications (user_id, kind, title, body, game_id, created_at) VALUES (?, 'game_added', ?, ?, ?, ?)").bind(
        me,
        `Your match is ready: ${g.name}`,
        `${name}: you play ${who.get(other)?.name ?? "your opponent"}. Head to the ${g.location}.`,
        gameId,
        now(),
      ),
    );
    await env.DB.batch(stmts);
  }
}

// ---------- routes ----------
export const tttAdminRoutes = new Hono<AppEnv>();
export const tttPublicRoutes = new Hono<AppEnv>();
const me = (c: Ctx) => c.get("user") as User;

async function registration(env: Env, gameId: number) {
  const d = await loadTtt(env, gameId);
  if (d.config.state !== "registration") throw new HttpError(409, "The tournament has started, so the player list is closed");
  return d;
}

// A player joins or leaves themselves while registration is open
tttPublicRoutes.post("/games/:id/join", async (c) => {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Not signed in");
  const gameId = Number(c.req.param("id"));
  const d = await registration(c.env, gameId);
  if (d.game.status !== "live") throw new HttpError(409, "Joining opens when the organisers make the game live");
  await c.env.DB.prepare("INSERT OR IGNORE INTO game_players (game_id, user_id, added_by, added_at, notified) VALUES (?, ?, ?, ?, 1)").bind(gameId, user.id, user.id, now()).run();
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?").bind(gameId).first<{ n: number }>();
  return c.json({ ok: true, players: n?.n ?? 0 });
});

tttPublicRoutes.delete("/games/:id/join", async (c) => {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Not signed in");
  const gameId = Number(c.req.param("id"));
  await registration(c.env, gameId);
  await c.env.DB.prepare("DELETE FROM game_players WHERE game_id = ? AND user_id = ?").bind(gameId, user.id).run();
  return c.json({ ok: true });
});

// Organisers add people (for anyone without a phone, or to help)
tttAdminRoutes.post("/games/:id/knockout/players", async (c) => {
  const gameId = Number(c.req.param("id"));
  await registration(c.env, gameId);
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
  const res = await c.env.DB.prepare(`INSERT OR IGNORE INTO game_players (game_id, user_id, added_by, added_at) SELECT ?, id, ?, ? FROM users WHERE ${where}`).bind(gameId, me(c).id, now(), ...args).run();
  await notifyNewPlayers(c.env, gameId);
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?").bind(gameId).first<{ n: number }>();
  await audit(c.env, me(c).id, "knockout.add", { gameId, added: res.meta.changes });
  return c.json({ added: res.meta.changes, total: total?.n ?? 0 });
});

tttAdminRoutes.delete("/games/:id/knockout/players/:userId", async (c) => {
  const gameId = Number(c.req.param("id"));
  await registration(c.env, gameId);
  const userId = Number(c.req.param("userId"));
  const res = await c.env.DB.prepare("DELETE FROM game_players WHERE game_id = ? AND user_id = ?").bind(gameId, userId).run();
  if (res.meta.changes) await notifyRemoved(c.env, gameId, userId);
  return c.json({ ok: true });
});

// Close registration and draw the bracket
tttAdminRoutes.post("/games/:id/knockout/start", async (c) => {
  const gameId = Number(c.req.param("id"));
  const d = await registration(c.env, gameId);
  const { results: roster } = await c.env.DB.prepare("SELECT user_id AS id FROM game_players WHERE game_id = ?").bind(gameId).all<{ id: number }>();
  if (roster.length < 2) throw new HttpError(409, "At least 2 players are needed");
  const { rounds, matches } = drawBracket(roster.map((r) => r.id));
  const claimed = await c.env.DB.prepare(`UPDATE games SET config = ? WHERE id = ? AND config NOT LIKE '%"running"%'`).bind(JSON.stringify({ state: "running", rounds }), gameId).run();
  if (!claimed.meta.changes) throw new HttpError(409, "The tournament has already been started");
  const t = now();
  await c.env.DB.batch(
    matches.map((m) =>
      c.env.DB.prepare("INSERT INTO ttt_matches (game_id, round, slot, a_user, b_user, winner_id, status, bye, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(gameId, m.round, m.slot, m.a, m.b, m.winner, m.bye ? "done" : "pending", m.bye ? 1 : 0, m.bye ? t : null),
    ),
  );
  await notifyReady(c.env, gameId);
  await audit(c.env, me(c).id, "knockout.start", { gameId, players: roster.length, rounds });
  return c.json({ ok: true, players: roster.length, rounds, game: d.game.name });
});

// Start over: back to registration, keeping the players who joined (admin)
tttAdminRoutes.post("/games/:id/knockout/reset", async (c) => {
  if (me(c).role !== "admin") throw new HttpError(403, "Admins only");
  const gameId = Number(c.req.param("id"));
  await loadTtt(c.env, gameId);
  const { clearPlayers } = await c.req.json<{ clearPlayers?: boolean }>().catch(() => ({ clearPlayers: false }));
  const stmts = [c.env.DB.prepare("DELETE FROM ttt_matches WHERE game_id = ?").bind(gameId), c.env.DB.prepare(`UPDATE games SET config = '{"state":"registration"}' WHERE id = ?`).bind(gameId)];
  if (clearPlayers) stmts.push(c.env.DB.prepare("DELETE FROM game_players WHERE game_id = ?").bind(gameId));
  await c.env.DB.batch(stmts);
  await audit(c.env, me(c).id, "knockout.reset", { gameId });
  return c.json({ ok: true });
});

async function matchOf(c: Ctx) {
  const m = await c.env.DB.prepare("SELECT id, game_id, round, slot, a_user, b_user, winner_id, status, bye, notified FROM ttt_matches WHERE id = ?").bind(Number(c.req.param("id"))).first<TttMatch>();
  if (!m) throw new HttpError(404, "No such match");
  return m;
}

// Say that a match is being played now
tttAdminRoutes.post("/ttt-matches/:id/start", async (c) => {
  const m = await matchOf(c);
  const res = await c.env.DB.prepare("UPDATE ttt_matches SET status = 'live', started_at = ? WHERE id = ? AND status = 'pending' AND a_user IS NOT NULL AND b_user IS NOT NULL AND winner_id IS NULL").bind(now(), m.id).run();
  if (!res.meta.changes) throw new HttpError(409, "This match can't be started yet. It is waiting for its players, or is already decided.");
  const g = await c.env.DB.prepare("SELECT name, location FROM games WHERE id = ?").bind(m.game_id).first<{ name: string; location: string }>();
  await c.env.DB.batch(
    [m.a_user!, m.b_user!].map((u) => c.env.DB.prepare("INSERT INTO notifications (user_id, kind, title, body, game_id, created_at) VALUES (?, 'game_added', ?, ?, ?, ?)").bind(u, `You're on: ${g?.name}`, `Your match is starting now at the ${g?.location}.`, m.game_id, now())),
  );
  return c.json({ ok: true });
});

// Pick the winner. Winning moves the player into the next round. Picking the other player corrects it, as long as the next match hasn't started.
tttAdminRoutes.post("/ttt-matches/:id/winner", async (c) => {
  const m = await matchOf(c);
  const { userId } = await c.req.json<{ userId?: number | null }>();
  const winner = userId == null ? null : Number(userId);
  if (winner != null && winner !== m.a_user && winner !== m.b_user) throw new HttpError(400, "That player isn't in this match");
  if (m.bye) throw new HttpError(409, "This was a bye");
  if (winner === m.winner_id) return c.json({ ok: true, unchanged: true });
  if (winner != null && (m.a_user == null || m.b_user == null)) throw new HttpError(409, "This match is still waiting for its players");
  const d = await loadTtt(c.env, m.game_id);
  const next = d.matches.find((x) => x.round === m.round + 1 && x.slot === Math.floor(m.slot / 2));
  if (next && m.winner_id != null && (next.status !== "pending" || next.winner_id != null)) throw new HttpError(409, "The next match has already started, so this result can't be changed");
  const res = await c.env.DB.prepare("UPDATE ttt_matches SET winner_id = ?, status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND winner_id IS ?")
    .bind(winner, winner == null ? "pending" : "done", me(c).id, now(), m.id, m.winner_id)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "Someone else just decided this match. Refresh to see it.");
  if (next) {
    const col = m.slot % 2 === 0 ? "a_user" : "b_user";
    await c.env.DB.prepare(`UPDATE ttt_matches SET ${col} = ?, notified = 0 WHERE id = ?`).bind(winner, next.id).run();
    await notifyReady(c.env, m.game_id);
  }
  await audit(c.env, me(c).id, "knockout.winner", { matchId: m.id, winner });
  return c.json({ ok: true });
});
