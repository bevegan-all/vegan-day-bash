import { Hono } from "hono";
import { HttpError, getSettings, now, type AppEnv, type Env, type User } from "./lib";

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
  const [notifs, live, mine, pitches, settings] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, kind, title, body, game_id AS gameId, created_at AS at FROM notifications
        WHERE user_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT 20`,
    )
      .bind(user.id)
      .all(),
    c.env.DB.prepare("SELECT id, slug, name, kind, type, location FROM games WHERE status = 'live' ORDER BY sort").all<{ id: number }>(),
    c.env.DB.prepare("SELECT game_id FROM game_players WHERE user_id = ?").bind(user.id).all<{ game_id: number }>(),
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
  return c.json({
    serverNow: now(),
    notifications: notifs.results,
    live: live.results.map((g) => ({ ...g, youIn: inGames.has(g.id) })),
    shark,
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
