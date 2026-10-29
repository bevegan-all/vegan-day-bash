import { Hono } from "hono";
import { HttpError, getSettings, now, shortName, type AppEnv, type Env, type User } from "./lib";

export const notifyRoutes = new Hono<AppEnv>();

function need(user: User | null): User {
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}

// Tell everyone newly added to a game's roster, once.
export async function notifyNewPlayers(env: Env, gameId: number) {
  const g = await env.DB.prepare("SELECT name, location FROM games WHERE id = ?").bind(gameId).first<{ name: string; location: string }>();
  if (!g) return;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO notifications (user_id, kind, title, body, game_id, created_at)
       SELECT user_id, 'game_added', ?, ?, ?, ? FROM game_players WHERE game_id = ? AND notified = 0`,
    ).bind(`You're in: ${g.name}`, `You have been added to the game. Head to the ${g.location}.`, gameId, now(), gameId),
    env.DB.prepare("UPDATE game_players SET notified = 1 WHERE game_id = ? AND notified = 0").bind(gameId),
  ]);
}

// Tell everyone newly added to a Green Light – Red Light round, once.
export async function notifyRoundEntries(env: Env, gameId: number, roundId: number, title: string, bodyStart: string) {
  const g = await env.DB.prepare("SELECT location FROM games WHERE id = ?").bind(gameId).first<{ location: string }>();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO notifications (user_id, kind, title, body, game_id, created_at)
       SELECT user_id, 'game_added', ?, ?, ?, ? FROM gr_entries WHERE round_id = ? AND notified = 0`,
    ).bind(title, `${bodyStart} Head to the ${g?.location ?? "Terrace"}.`, gameId, now(), roundId),
    env.DB.prepare("UPDATE gr_entries SET notified = 1 WHERE round_id = ? AND notified = 0").bind(roundId),
  ]);
}

export async function notifyRemoved(env: Env, gameId: number, userId: number) {
  const g = await env.DB.prepare("SELECT name FROM games WHERE id = ?").bind(gameId).first<{ name: string }>();
  if (!g) return;
  await env.DB.prepare("INSERT INTO notifications (user_id, kind, title, body, game_id, created_at) VALUES (?, 'game_removed', ?, ?, ?, ?)")
    .bind(userId, `Removed from ${g.name}`, "An organiser took you off this game's player list.", gameId, now())
    .run();
}

// One light call, polled for the whole app: new alerts, live games, and the Shark Tank turn in progress.
notifyRoutes.get("/pulse", async (c) => {
  const user = need(c.get("user"));
  const [notifs, live, mine, pitches, settings, memeRows, actRound] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, kind, title, body, game_id AS gameId, created_at AS at FROM notifications
        WHERE user_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT 20`,
    )
      .bind(user.id)
      .all(),
    c.env.DB.prepare("SELECT id, slug, name, kind, type, location, config FROM games WHERE status = 'live' ORDER BY sort").all<{ id: number; type: string; config: string }>(),
    c.env.DB.prepare(
      `SELECT game_id FROM game_players WHERE user_id = ?
       UNION SELECT r.game_id FROM gr_entries e JOIN gr_rounds r ON r.id = e.round_id WHERE e.user_id = ?`,
    ).bind(user.id, user.id).all<{ game_id: number }>(),
    c.env.DB.prepare(
      `SELECT p.id, p.match_id, p.team_id, p.item, p.ord, p.phase, p.phase_ends_at, m.stage, m.team_a, m.team_b, m.game_id, t.name AS team_name
         FROM pitches p JOIN matches m ON m.id = p.match_id JOIN teams t ON t.id = p.team_id
        WHERE m.status = 'live' ORDER BY m.id, p.ord`,
    ).all<{
      id: number;
      match_id: number;
      team_id: number;
      item: string;
      ord: number;
      phase: string;
      phase_ends_at: number | null;
      stage: string;
      team_a: number;
      team_b: number;
      game_id: number;
      team_name: string;
    }>(),
    getSettings(c.env),
    c.env.DB.prepare(
      `SELECT t.id, t.match_id, t.ord, t.team_id, t.phase, t.phase_ends_at, t.result, t.players, m.stage, m.team_a, m.team_b, m.game_id
         FROM meme_turns t JOIN matches m ON m.id = t.match_id WHERE m.status = 'live' ORDER BY m.id, t.ord`,
    ).all<{
      id: number;
      match_id: number;
      ord: number;
      team_id: number;
      phase: string;
      phase_ends_at: number | null;
      result: string | null;
      players: string | null;
      stage: string;
      team_a: number;
      team_b: number;
      game_id: number;
    }>(),
    c.env.DB.prepare("SELECT id, game_id, ord, scene, phase, phase_ends_at FROM act_rounds WHERE phase != 'done' ORDER BY game_id, ord LIMIT 1").first<{
      id: number;
      game_id: number;
      ord: number;
      scene: string | null;
      phase: string;
      phase_ends_at: number | null;
    }>(),
  ]);
  const inGames = new Set(mine.results.map((r) => r.game_id));

  // the turn in progress: the first pitch of a live round that is not finished
  const cur = pitches.results.find((p) => p.phase !== "done");
  let shark = null;
  if (cur) {
    const opponent = cur.team_id === cur.team_a ? cur.team_b : cur.team_a;
    let myRating: number | null = null;
    if (cur.phase === "voting") {
      const v = await c.env.DB.prepare("SELECT rating FROM pitch_votes WHERE pitch_id = ? AND voter_id = ?").bind(cur.id, user.id).first<{ rating: number }>();
      myRating = v?.rating ?? null;
    }
    shark = {
      gameId: cur.game_id,
      matchId: cur.match_id,
      stage: cur.stage,
      pitchId: cur.id,
      teamId: cur.team_id,
      teamName: cur.team_name,
      item: cur.item,
      ord: cur.ord,
      phase: cur.phase,
      endsAt: cur.phase_ends_at,
      youPitching: user.team_id === cur.team_id,
      canVote: user.team_id != null && user.team_id !== cur.team_id && !(settings.shark_block_opponent === "1" && user.team_id === opponent),
      myRating,
    };
  }

  // Meme Charades: the turn in progress, the score and the last result
  let meme = null;
  const curTurn = memeRows.results.find((r) => r.phase !== "done");
  if (curTurn) {
    const turns = memeRows.results.filter((r) => r.match_id === curTurn.match_id);
    const scores: Record<number, number> = { [curTurn.team_a]: 0, [curTurn.team_b]: 0 };
    for (const r of turns) if (r.result === "point") scores[r.team_id] += 1;
    const lastDone = [...turns].reverse().find((r) => r.phase === "done");
    const { results: names } = await c.env.DB.prepare(
      "SELECT u.display_name AS name FROM meme_turn_players p JOIN users u ON u.id = p.user_id WHERE p.turn_id = ? ORDER BY p.added_at, u.id",
    )
      .bind(curTurn.id)
      .all<{ name: string }>();
    meme = {
      gameId: curTurn.game_id,
      matchId: curTurn.match_id,
      stage: curTurn.stage,
      turnId: curTurn.id,
      ord: curTurn.ord,
      total: turns.length,
      teamId: curTurn.team_id,
      teamA: curTurn.team_a,
      teamB: curTurn.team_b,
      phase: curTurn.phase,
      endsAt: curTurn.phase_ends_at,
      players: names.map((p) => shortName(p.name)),
      youActing: user.team_id === curTurn.team_id,
      scores,
      last: lastDone ? { teamId: lastDone.team_id, result: lastDone.result, ord: lastDone.ord } : null,
    };
  }

  // Act It Out: the round in progress, the order the teams perform in, and (while voting) this person's ballot
  let actout = null;
  if (actRound) {
    const [turns, total, vote, lastRound] = await Promise.all([
      c.env.DB.prepare("SELECT team_id, phase, phase_ends_at, ord FROM act_turns WHERE round_id = ? ORDER BY ord").bind(actRound.id).all<{ team_id: number; phase: string; phase_ends_at: number | null; ord: number }>(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM act_rounds WHERE game_id = ?").bind(actRound.game_id).first<{ n: number }>(),
      actRound.phase === "voting"
        ? c.env.DB.prepare("SELECT first_team AS a, second_team AS b, third_team AS c FROM act_votes WHERE round_id = ? AND voter_id = ?").bind(actRound.id, user.id).first<{ a: number; b: number; c: number }>()
        : Promise.resolve(null),
      c.env.DB.prepare("SELECT id, ord FROM act_rounds WHERE game_id = ? AND phase = 'done' ORDER BY ord DESC LIMIT 1").bind(actRound.game_id).first<{ id: number; ord: number }>(),
    ]);
    const lastResults = lastRound
      ? (await c.env.DB.prepare("SELECT team_id AS teamId, rank, points FROM act_results WHERE round_id = ? ORDER BY rank, team_id").bind(lastRound.id).all<{ teamId: number; rank: number; points: number }>()).results
      : [];
    const cur = actRound.phase === "voting" ? null : turns.results.find((x) => x.phase !== "done");
    actout = {
      gameId: actRound.game_id,
      roundId: actRound.id,
      ord: actRound.ord,
      total: total?.n ?? 0,
      scene: actRound.scene,
      phase: actRound.phase,
      endsAt: actRound.phase_ends_at,
      turns: turns.results.map((x) => ({ teamId: x.team_id, phase: x.phase, endsAt: x.phase_ends_at })),
      current: cur ? { teamId: cur.team_id, phase: cur.phase, endsAt: cur.phase_ends_at } : null,
      canVote: user.team_id != null,
      eligible: turns.results.map((x) => x.team_id).filter((id) => id !== user.team_id),
      myRanking: vote ? [vote.a, vote.b, vote.c] : null,
      last: lastRound ? { ord: lastRound.ord, results: lastResults } : null,
    };
  }
  return c.json({
    serverNow: now(),
    notifications: notifs.results,
    live: live.results.map(({ config, ...g }) => ({ ...g, youIn: inGames.has(g.id), joinOpen: g.type === "tictactoe" && !config.includes("running") })),
    shark,
    meme,
    actout,
  });
});

notifyRoutes.get("/notifications", async (c) => {
  const user = need(c.get("user"));
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, title, body, game_id AS gameId, created_at AS at, read_at AS readAt FROM notifications
      WHERE user_id = ? ORDER BY id DESC LIMIT 40`,
  )
    .bind(user.id)
    .all();
  return c.json({ notifications: results });
});

notifyRoutes.post("/notifications/read", async (c) => {
  const user = need(c.get("user"));
  await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now(), user.id).run();
  return c.json({ ok: true });
});
