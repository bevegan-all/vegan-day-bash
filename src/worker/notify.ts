import { Hono } from "hono";
import { HttpError, now, type AppEnv, type Env, type User } from "./lib";

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

// One light call, polled for the whole app: new alerts, live games, and any pitch being rated.
notifyRoutes.get("/pulse", async (c) => {
  const user = need(c.get("user"));
  const [notifs, live, mine, voting] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, kind, title, body, game_id AS gameId, created_at AS at FROM notifications
        WHERE user_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT 20`,
    )
      .bind(user.id)
      .all(),
    c.env.DB.prepare("SELECT id, slug, name, kind, type, location FROM games WHERE status = 'live' ORDER BY sort").all<{ id: number }>(),
    c.env.DB.prepare("SELECT game_id FROM game_players WHERE user_id = ?").bind(user.id).all<{ game_id: number }>(),
    c.env.DB.prepare(
      `SELECT p.id, p.item, p.team_id, t.name AS team_name, m.game_id,
              (SELECT rating FROM pitch_votes v WHERE v.pitch_id = p.id AND v.voter_id = ?) AS my_rating
         FROM pitches p JOIN teams t ON t.id = p.team_id JOIN matches m ON m.id = p.match_id
        WHERE p.state = 'voting' LIMIT 1`,
    )
      .bind(user.id)
      .first<{ id: number; item: string; team_id: number; team_name: string; game_id: number; my_rating: number | null }>(),
  ]);
  const inGames = new Set(mine.results.map((r) => r.game_id));
  return c.json({
    notifications: notifs.results,
    live: live.results.map((g) => ({ ...g, youIn: inGames.has(g.id) })),
    voting: voting ? { ...voting, canVote: voting.team_id !== user.team_id, voted: voting.my_rating != null } : null,
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
