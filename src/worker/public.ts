import { Hono } from "hono";
import { HttpError, getSettings, now, type AppEnv, type User } from "./lib";
import { computeIndividual, computeTeamBoard, publicBoard } from "./leaderboard";
import { buildGameDetail } from "./games";

export const publicRoutes = new Hono<AppEnv>();

function requireUser(user: User | null): User {
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}

publicRoutes.get("/teams", async (c) => {
  requireUser(c.get("user"));
  const { results } = await c.env.DB.prepare("SELECT id, name, emoji, color FROM teams ORDER BY id").all();
  return c.json({ teams: results });
});

publicRoutes.get("/games", async (c) => {
  const user = requireUser(c.get("user"));
  const organiser = user.role !== "participant";
  const { results } = await c.env.DB.prepare(
    `SELECT id, slug, name, kind, type, result_type AS resultType, description, status, sort, location
       FROM games ${organiser ? "" : "WHERE status != 'draft'"} ORDER BY sort`,
  ).all<{ id: number }>();
  const mine = await c.env.DB.prepare(
    `SELECT game_id FROM game_players WHERE user_id = ?
     UNION SELECT r.game_id FROM gr_entries e JOIN gr_rounds r ON r.id = e.round_id WHERE e.user_id = ?`,
  )
    .bind(user.id, user.id)
    .all<{ game_id: number }>();
  const inGames = new Set(mine.results.map((r) => r.game_id));
  return c.json({ games: results.map((g) => ({ ...g, youIn: inGames.has(g.id) })) });
});

publicRoutes.get("/games/:id", async (c) => {
  const user = requireUser(c.get("user"));
  return c.json(await buildGameDetail(c.env, Number(c.req.param("id")), user, user.role !== "participant"));
});

publicRoutes.get("/leaderboard/teams", async (c) => {
  requireUser(c.get("user"));
  const { results: games } = await c.env.DB.prepare("SELECT id, name FROM games WHERE kind = 'team' AND status != 'draft' ORDER BY sort").all<{ id: number; name: string }>();
  return c.json({ teams: await computeTeamBoard(c.env), games });
});

publicRoutes.get("/leaderboard/individual", async (c) => {
  const user = requireUser(c.get("user"));
  const boards = await computeIndividual(c.env);
  const gameParam = c.req.query("game") ?? "all";
  const limit = user.role !== "participant" && c.req.query("full") ? 500 : 10;
  const { results: games } = await c.env.DB.prepare(
    "SELECT id, name FROM games WHERE (kind = 'individual' OR type = 'greenred') AND status != 'draft' ORDER BY sort",
  ).all<{ id: number; name: string }>();
  const list = gameParam === "all" ? boards.overall : (boards.perGame.get(Number(gameParam)) ?? []);
  return c.json({ games, ...publicBoard(list, user.id, limit) });
});

publicRoutes.post("/pitches/:id/vote", async (c) => {
  const user = requireUser(c.get("user"));
  const pitchId = Number(c.req.param("id"));
  const { rating } = await c.req.json<{ rating?: number }>();
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 10) throw new HttpError(400, "Rating must be 1 to 10");
  const p = await c.env.DB.prepare(
    "SELECT p.id, p.state, p.team_id, p.phase_ends_at, m.team_a, m.team_b FROM pitches p JOIN matches m ON m.id = p.match_id WHERE p.id = ?",
  )
    .bind(pitchId)
    .first<{ id: number; state: string; team_id: number; phase_ends_at: number | null; team_a: number; team_b: number }>();
  if (!p) throw new HttpError(404, "No such pitch");
  if (p.state !== "voting") throw new HttpError(409, "Rating is not open for this pitch");
  // a few seconds of grace for slow phones
  if (p.phase_ends_at && now() > p.phase_ends_at + 5000) throw new HttpError(409, "Voting time is up");
  if (user.team_id == null) throw new HttpError(403, "You are not on a team yet");
  if (user.team_id === p.team_id) throw new HttpError(403, "You can't rate your own team's pitch");
  const s = await getSettings(c.env);
  const opponent = p.team_id === p.team_a ? p.team_b : p.team_a;
  if (s.shark_block_opponent === "1" && user.team_id === opponent) throw new HttpError(403, "Teams in this match don't rate each other");
  await c.env.DB.prepare(
    `INSERT INTO pitch_votes (pitch_id, voter_id, rating, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (pitch_id, voter_id) DO UPDATE SET rating = excluded.rating`,
  )
    .bind(pitchId, user.id, r, now())
    .run();
  return c.json({ ok: true });
});

// Act It Out: rank the three other teams, best first. One ballot per person per round, changeable until voting closes.
publicRoutes.post("/act-rounds/:id/vote", async (c) => {
  const user = requireUser(c.get("user"));
  const roundId = Number(c.req.param("id"));
  const { ranking } = await c.req.json<{ ranking?: number[] }>();
  const r = await c.env.DB.prepare("SELECT id, phase, phase_ends_at FROM act_rounds WHERE id = ?").bind(roundId).first<{ id: number; phase: string; phase_ends_at: number | null }>();
  if (!r) throw new HttpError(404, "No such round");
  if (r.phase !== "voting") throw new HttpError(409, "Voting is not open for this round");
  if (r.phase_ends_at && now() > r.phase_ends_at + 5000) throw new HttpError(409, "Voting time is up");
  if (user.team_id == null) throw new HttpError(403, "You are not on a team yet");
  const picks = (ranking ?? []).map(Number);
  const { results: teams } = await c.env.DB.prepare("SELECT id FROM teams").all<{ id: number }>();
  const others = teams.map((x) => x.id).filter((id) => id !== user.team_id);
  const valid = picks.length === others.length && new Set(picks).size === picks.length && picks.every((p) => others.includes(p));
  if (!valid) throw new HttpError(400, "Rank each of the other teams once. You can't rank your own team.");
  await c.env.DB.prepare(
    `INSERT INTO act_votes (round_id, voter_id, first_team, second_team, third_team, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (round_id, voter_id) DO UPDATE SET first_team = excluded.first_team, second_team = excluded.second_team, third_team = excluded.third_team`,
  )
    .bind(roundId, user.id, picks[0], picks[1], picks[2], now())
    .run();
  return c.json({ ok: true });
});

// Public big-screen data. Protected by a secret key in the URL, no login.
publicRoutes.get("/screen", async (c) => {
  const s = await getSettings(c.env);
  const key = c.req.query("key") ?? "";
  if (!s.screen_key || key !== s.screen_key) throw new HttpError(403, "Bad screen key");
  const boards = await computeIndividual(c.env);
  const teams = await computeTeamBoard(c.env, boards);
  const { results: live } = await c.env.DB.prepare("SELECT id FROM games WHERE status = 'live' ORDER BY sort").all<{ id: number }>();
  const liveGames = [];
  for (const g of live) liveGames.push(await buildGameDetail(c.env, g.id, null, false));
  return c.json({
    teams,
    individual: publicBoard(boards.overall, null, 10),
    liveGames,
  });
});
