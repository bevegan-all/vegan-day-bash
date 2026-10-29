import { Hono } from "hono";
import {
  HttpError,
  audit,
  generatePassword,
  getSettings,
  hashPassword,
  now,
  parseQrCode,
  qrCodeFor,
  randomToken,
  type AppEnv,
  type Ctx,
  type Env,
  type User,
} from "./lib";
import { createUser, newLoginLink } from "./users";
import { actConfig, buildGameDetail, memeConfig, pitchTally, sharkTimers } from "./games";
import { parseTable, sharePoints, tieGroups } from "./scoring";
import { notifyRemoved, notifyRoundEntries } from "./notify";
import { hookAdminRoutes } from "./hookstep";
import { tttAdminRoutes } from "./knockout";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", async (c, next) => {
  const u = c.get("user");
  if (!u) throw new HttpError(401, "Not signed in");
  if (u.role === "participant") throw new HttpError(403, "Organisers only");
  await next();
});

adminRoutes.route("/", hookAdminRoutes);
adminRoutes.route("/", tttAdminRoutes);

const me = (c: Ctx) => c.get("user") as User;
const requireAdmin = (c: Ctx) => {
  if (me(c).role !== "admin") throw new HttpError(403, "Admins only");
};
const origin = (c: Ctx) => new URL(c.req.url).origin;
const round1 = (n: number) => Math.round(n * 10) / 10;

async function voidRef(env: Env, ref: string) {
  await env.DB.prepare("UPDATE team_points SET voided_at = ? WHERE ref = ? AND voided_at IS NULL").bind(now(), ref).run();
}

function addPoints(env: Env, gameId: number, teamId: number, points: number, reason: string, ref: string, by: number) {
  return env.DB.prepare(
    "INSERT INTO team_points (game_id, team_id, points, reason, ref, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(gameId, teamId, points, reason, ref, by, now());
}

// ---------- People ----------

adminRoutes.post("/users", async (c) => {
  const body = await c.req.json<{ name?: string; role?: User["role"]; partyId?: string; teamId?: number }>();
  const role = body.role ?? "participant";
  if (role !== "participant") requireAdmin(c);
  const created = await createUser(
    c.env,
    { name: String(body.name ?? ""), role, partyId: body.partyId ?? null, teamId: body.teamId ?? null },
    origin(c),
  );
  const team = await c.env.DB.prepare("SELECT id, name, emoji, color FROM teams WHERE id = ?").bind(created.user.team_id).first();
  await audit(c.env, me(c).id, "user.create", { id: created.user.id, name: created.user.display_name, team: created.user.team_id });
  return c.json({
    id: created.user.id,
    name: created.user.display_name,
    username: created.user.username,
    password: created.password,
    team,
    link: created.link,
  });
});

adminRoutes.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const team = Number(c.req.query("team") ?? 0);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q) {
    where.push("(lower(u.display_name) LIKE ? OR u.username LIKE ?)");
    args.push(`%${q}%`, `%${q}%`);
  }
  if (team) {
    where.push("u.team_id = ?");
    args.push(team);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name AS name, u.username, u.role, u.team_id AS teamId, u.checked_in AS checkedIn
       FROM users u ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY u.id DESC LIMIT 300`,
  )
    .bind(...args)
    .all();
  const stats = await c.env.DB.prepare(
    "SELECT team_id AS teamId, COUNT(*) AS members, SUM(checked_in) AS checkedIn FROM users GROUP BY team_id",
  ).all();
  return c.json({ users: results, stats: stats.results });
});

async function userCard(c: Ctx, id: number) {
  const u = await c.env.DB.prepare(
    `SELECT u.id, u.display_name AS name, u.username, u.role, u.team_id AS teamId, u.checked_in AS checkedIn,
            t.name AS teamName, t.emoji, t.color
       FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!u) throw new HttpError(404, "No such person");
  const { results: games } = await c.env.DB.prepare(
    `SELECT g.name, r.value, r.created_at AS at FROM results r JOIN games g ON g.id = r.game_id
      WHERE r.user_id = ? AND r.voided_at IS NULL ORDER BY r.created_at DESC LIMIT 20`,
  )
    .bind(id)
    .all();
  return { ...u, history: games };
}

adminRoutes.get("/users/:id", async (c) => c.json(await userCard(c, Number(c.req.param("id")))));

adminRoutes.get("/users/:id/qr", async (c) => {
  const id = Number(c.req.param("id"));
  return c.json({ code: await qrCodeFor(c.env, id) });
});

adminRoutes.get("/lookup", async (c) => {
  const id = await parseQrCode(c.env, c.req.query("code") ?? "");
  if (!id) throw new HttpError(404, "This QR code is not a valid Vegan Day Bash code");
  return c.json(await userCard(c, id));
});

adminRoutes.patch("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ teamId?: number; name?: string; checkedIn?: boolean; role?: User["role"] }>();
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (body.teamId !== undefined) {
    const t = await c.env.DB.prepare("SELECT id FROM teams WHERE id = ?").bind(body.teamId).first();
    if (!t) throw new HttpError(400, "No such team");
    sets.push("team_id = ?");
    args.push(body.teamId);
  }
  if (body.name !== undefined && body.name.trim()) {
    sets.push("display_name = ?");
    args.push(body.name.trim().slice(0, 60));
  }
  if (body.checkedIn !== undefined) {
    sets.push("checked_in = ?");
    args.push(body.checkedIn ? 1 : 0);
  }
  if (body.role !== undefined) {
    requireAdmin(c);
    sets.push("role = ?");
    args.push(body.role);
  }
  if (!sets.length) throw new HttpError(400, "Nothing to change");
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
  await audit(c.env, me(c).id, "user.update", { id, ...body });
  return c.json(await userCard(c, id));
});

adminRoutes.post("/users/:id/link", async (c) => {
  const id = Number(c.req.param("id"));
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!exists) throw new HttpError(404, "No such person");
  const link = await newLoginLink(c.env, id, origin(c));
  await audit(c.env, me(c).id, "user.relink", { id });
  return c.json({ link });
});

// Has the person scanned and used their current sign-in QR yet? (polled by the Register screen)
adminRoutes.get("/users/:id/linkstatus", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT last_used_at FROM login_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1",
  )
    .bind(Number(c.req.param("id")))
    .first<{ last_used_at: number | null }>();
  return c.json({ used: !!row?.last_used_at });
});

adminRoutes.post("/users/:id/password", async (c) => {
  const id = Number(c.req.param("id"));
  const password = generatePassword();
  const salt = randomToken(8);
  const hash = await hashPassword(password, salt, c.env.PEPPER);
  const res = await c.env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?").bind(salt, hash, id).run();
  if (!res.meta.changes) throw new HttpError(404, "No such person");
  await audit(c.env, me(c).id, "user.password_reset", { id });
  return c.json({ password });
});

adminRoutes.get("/audit", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.detail, a.created_at AS at, u.display_name AS by
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 100`,
  ).all();
  return c.json({ entries: results });
});

// ---------- Settings ----------

adminRoutes.get("/settings", async (c) => c.json({ settings: await getSettings(c.env) }));

adminRoutes.put("/settings", async (c) => {
  requireAdmin(c);
  const body = await c.req.json<Record<string, string | number | boolean>>();
  const current = await getSettings(c.env);
  const stmts = [];
  for (const [k, v] of Object.entries(body)) {
    if (!(k in current) || k === "screen_key") throw new HttpError(400, `Unknown setting ${k}`);
    const val = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
    if (k === "rank_points" || k === "team_rank_points") {
      const arr = JSON.parse(val);
      if (!Array.isArray(arr) || arr.some((n) => typeof n !== "number")) throw new HttpError(400, "rank_points must be a list of numbers");
    } else if (Number.isNaN(Number(val))) throw new HttpError(400, `${k} must be a number`);
    stmts.push(c.env.DB.prepare("UPDATE settings SET value = ? WHERE key = ?").bind(val, k));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env, me(c).id, "settings.update", body);
  return c.json({ settings: await getSettings(c.env) });
});

adminRoutes.get("/screen-key", async (c) => {
  requireAdmin(c);
  const s = await getSettings(c.env);
  let key = s.screen_key;
  if (!key) {
    key = randomToken(12);
    await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('screen_key', ?)").bind(key).run();
  }
  return c.json({ url: `${origin(c)}/screen?key=${key}` });
});

// ---------- Games ----------

const RESULT_TYPES = ["match_win", "score_high", "time_high", "time_low", "placement"];

adminRoutes.post("/games", async (c) => {
  requireAdmin(c);
  const b = await c.req.json<{ name?: string; resultType?: string; description?: string; rules?: string }>();
  const name = String(b.name ?? "").trim();
  if (!name || !RESULT_TYPES.includes(String(b.resultType))) throw new HttpError(400, "Need a name and a result type");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + randomToken(2);
  const max = await c.env.DB.prepare("SELECT COALESCE(MAX(sort), 100) AS m FROM games WHERE kind = 'individual'").first<{ m: number }>();
  const res = await c.env.DB.prepare(
    `INSERT INTO games (slug, name, kind, type, result_type, description, rules, status, sort)
     VALUES (?, ?, 'individual', 'individual', ?, ?, ?, 'upcoming', ?)`,
  )
    .bind(slug, name, b.resultType, b.description ?? "", b.rules ?? "", (max?.m ?? 100) + 10)
    .run();
  await audit(c.env, me(c).id, "game.create", { name });
  return c.json({ id: res.meta.last_row_id });
});

adminRoutes.patch("/games/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<{ status?: string; name?: string; description?: string; rules?: string; resultType?: string; location?: string }>();
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (b.status !== undefined) {
    if (!["draft", "upcoming", "live", "closed"].includes(b.status)) throw new HttpError(400, "Bad status");
    sets.push("status = ?");
    args.push(b.status);
  }
  if (b.name !== undefined || b.description !== undefined || b.rules !== undefined || b.resultType !== undefined || b.location !== undefined) requireAdmin(c);
  if (b.location !== undefined) {
    const loc = b.location.trim().slice(0, 40);
    if (!loc) throw new HttpError(400, "Location cannot be empty");
    sets.push("location = ?");
    args.push(loc);
  }
  if (b.name !== undefined) (sets.push("name = ?"), args.push(b.name));
  if (b.description !== undefined) (sets.push("description = ?"), args.push(b.description));
  if (b.rules !== undefined) (sets.push("rules = ?"), args.push(b.rules));
  if (b.resultType !== undefined) {
    if (!RESULT_TYPES.includes(b.resultType)) throw new HttpError(400, "Bad result type");
    sets.push("result_type = ?");
    args.push(b.resultType);
  }
  if (!sets.length) throw new HttpError(400, "Nothing to change");
  await c.env.DB.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
  await audit(c.env, me(c).id, "game.update", { id, ...b });
  return c.json({ ok: true });
});

// ---------- Individual results ----------

adminRoutes.post("/games/:id/results", async (c) => {
  const gameId = Number(c.req.param("id"));
  const game = await c.env.DB.prepare("SELECT id, type, result_type FROM games WHERE id = ?").bind(gameId).first<{ id: number; type: string; result_type: string | null }>();
  if (!game || game.type !== "individual") throw new HttpError(404, "No such individual game");
  const body = await c.req.json<{ userId?: number; value?: number; winnerId?: number; loserId?: number; idem?: string; note?: string }>();

  const userExists = async (id: number) => !!(await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first());

  if (game.result_type === "match_win") {
    const { winnerId, loserId } = body;
    if (!winnerId || !loserId || winnerId === loserId) throw new HttpError(400, "Pick a winner and a different loser");
    if (!(await userExists(winnerId)) || !(await userExists(loserId))) throw new HttpError(404, "No such person");
    const ref = body.idem ?? randomToken(6);
    const dup = await c.env.DB.prepare("SELECT 1 FROM results WHERE match_ref = ?").bind(ref).first();
    if (dup) return c.json({ ok: true, duplicate: true });
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO results (game_id, user_id, value, match_ref, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?)").bind(gameId, winnerId, ref, me(c).id, now()),
      c.env.DB.prepare("INSERT INTO results (game_id, user_id, value, match_ref, created_by, created_at) VALUES (?, ?, 0, ?, ?, ?)").bind(gameId, loserId, ref, me(c).id, now()),
    ]);
    await audit(c.env, me(c).id, "result.match", { gameId, winnerId, loserId });
    return c.json({ ok: true });
  }

  const value = Number(body.value);
  if (!body.userId || !Number.isFinite(value) || value < 0) throw new HttpError(400, "Pick a person and enter a valid number");
  if (game.result_type === "placement" && (!Number.isInteger(value) || value < 1)) throw new HttpError(400, "Placement must be 1, 2, 3...");
  if (!(await userExists(body.userId))) throw new HttpError(404, "No such person");
  try {
    await c.env.DB.prepare("INSERT INTO results (game_id, user_id, value, note, idem, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(gameId, body.userId, value, body.note ?? null, body.idem ?? null, me(c).id, now())
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) return c.json({ ok: true, duplicate: true });
    throw e;
  }
  await audit(c.env, me(c).id, "result.add", { gameId, userId: body.userId, value });
  return c.json({ ok: true });
});

adminRoutes.delete("/results/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(
    "SELECT r.id, r.match_ref, r.game_id, g.type FROM results r JOIN games g ON g.id = r.game_id WHERE r.id = ? AND r.voided_at IS NULL",
  )
    .bind(id)
    .first<{ id: number; match_ref: string | null; game_id: number; type: string }>();
  if (!row) throw new HttpError(404, "Result not found");
  if (row.match_ref) await c.env.DB.prepare("UPDATE results SET voided_at = ? WHERE match_ref = ?").bind(now(), row.match_ref).run();
  else await c.env.DB.prepare("UPDATE results SET voided_at = ? WHERE id = ?").bind(now(), id).run();
  await audit(c.env, me(c).id, "result.void", { id });
  return c.json({ ok: true });
});

// ---------- Green Light – Red Light: one round, or heats and a final ----------
// Times are recorded per round. Only the final (or the single round) counts for the leaderboard.

interface GrRound {
  id: number;
  game_id: number;
  ord: number;
  kind: string;
  status: string;
}

async function getGrRound(c: Ctx, id: number) {
  const r = await c.env.DB.prepare("SELECT id, game_id, ord, kind, status FROM gr_rounds WHERE id = ?").bind(id).first<GrRound>();
  if (!r) throw new HttpError(404, "No such round");
  return r;
}

async function grGame(env: Env, gameId: number) {
  const g = await env.DB.prepare("SELECT id, name, type, config FROM games WHERE id = ?").bind(gameId).first<{ id: number; name: string; type: string; config: string }>();
  if (!g || g.type !== "greenred") throw new HttpError(404, "Not a Green Light – Red Light game");
  const cfg = JSON.parse(g.config || "{}") as { mode?: string; heats?: number };
  return { ...g, mode: cfg.mode ?? null, heats: cfg.heats ?? 0 };
}

const grLabel = (r: GrRound, mode: string | null) => (r.kind === "heat" ? `Heat ${r.ord}` : mode === "single" ? "the race" : "the final");

async function writeFinalResult(env: Env, gameId: number, userId: number, seconds: number | null, by: number) {
  const stmts = [env.DB.prepare("UPDATE results SET voided_at = ? WHERE game_id = ? AND user_id = ? AND voided_at IS NULL").bind(now(), gameId, userId)];
  if (seconds != null) stmts.push(env.DB.prepare("INSERT INTO results (game_id, user_id, value, created_by, created_at) VALUES (?, ?, ?, ?, ?)").bind(gameId, userId, seconds, by, now()));
  await env.DB.batch(stmts);
}

// The top 3 of every finished heat go to the final. Re-run whenever a heat's times or status change.
async function syncFinalists(env: Env, gameId: number, by: number) {
  const g = await grGame(env, gameId);
  const { results: rounds } = await env.DB.prepare("SELECT id, game_id, ord, kind, status FROM gr_rounds WHERE game_id = ? ORDER BY ord").bind(gameId).all<GrRound>();
  const fin = rounds.find((r) => r.kind === "final");
  if (!fin || g.mode !== "multi") return;
  const desired = new Set<number>();
  for (const heat of rounds.filter((r) => r.kind === "heat" && r.status === "done")) {
    const { results } = await env.DB.prepare("SELECT user_id FROM gr_entries WHERE round_id = ? AND seconds IS NOT NULL ORDER BY seconds ASC, added_at ASC, user_id ASC LIMIT 3").bind(heat.id).all<{ user_id: number }>();
    results.forEach((x) => desired.add(x.user_id));
  }
  const { results: current } = await env.DB.prepare("SELECT user_id, via FROM gr_entries WHERE round_id = ?").bind(fin.id).all<{ user_id: number; via: string }>();
  const have = new Set(current.map((x) => x.user_id));
  const stmts = [];
  for (const x of current) {
    if (x.via === "qualified" && !desired.has(x.user_id)) {
      stmts.push(env.DB.prepare("DELETE FROM gr_entries WHERE round_id = ? AND user_id = ?").bind(fin.id, x.user_id));
      stmts.push(env.DB.prepare("UPDATE results SET voided_at = ? WHERE game_id = ? AND user_id = ? AND voided_at IS NULL").bind(now(), gameId, x.user_id));
    }
  }
  for (const id of desired) {
    if (!have.has(id)) stmts.push(env.DB.prepare("INSERT INTO gr_entries (round_id, user_id, added_by, added_at, via) VALUES (?, ?, ?, ?, 'qualified')").bind(fin.id, id, by, now()));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await notifyRoundEntries(env, gameId, fin.id, `You made the final: ${g.name}`, "You were in the top 3 of your heat.");
}

adminRoutes.post("/games/:id/greenred/setup", async (c) => {
  const g = await grGame(c.env, Number(c.req.param("id")));
  const has = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM gr_rounds WHERE game_id = ?").bind(g.id).first<{ n: number }>();
  if ((has?.n ?? 0) > 0) throw new HttpError(409, "The rounds are already set up");
  const body = await c.req.json<{ mode?: string; heats?: number }>();
  if (body.mode !== "single" && body.mode !== "multi") throw new HttpError(400, "Choose single round or multiple rounds");
  const heats = body.mode === "multi" ? Math.floor(Number(body.heats ?? 4)) : 0;
  if (body.mode === "multi" && !(heats >= 1 && heats <= 8)) throw new HttpError(400, "Pick between 1 and 8 heats");
  const stmts = [c.env.DB.prepare("UPDATE games SET config = ? WHERE id = ?").bind(JSON.stringify({ mode: body.mode, heats }), g.id)];
  if (body.mode === "single") stmts.push(c.env.DB.prepare("INSERT INTO gr_rounds (game_id, ord, kind) VALUES (?, 1, 'final')").bind(g.id));
  else {
    for (let i = 1; i <= heats; i++) stmts.push(c.env.DB.prepare("INSERT INTO gr_rounds (game_id, ord, kind) VALUES (?, ?, 'heat')").bind(g.id, i));
    stmts.push(c.env.DB.prepare("INSERT INTO gr_rounds (game_id, ord, kind) VALUES (?, ?, 'final')").bind(g.id, heats + 1));
  }
  await c.env.DB.batch(stmts);
  await audit(c.env, me(c).id, "greenred.setup", { gameId: g.id, mode: body.mode, heats });
  return c.json({ ok: true });
});

// Start the whole game over (admin): removes the rounds, the times and the leaderboard entries
adminRoutes.post("/games/:id/greenred/reset", async (c) => {
  requireAdmin(c);
  const g = await grGame(c.env, Number(c.req.param("id")));
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM gr_rounds WHERE game_id = ?").bind(g.id),
    c.env.DB.prepare("UPDATE games SET config = '{}' WHERE id = ?").bind(g.id),
    c.env.DB.prepare("UPDATE results SET voided_at = ? WHERE game_id = ? AND voided_at IS NULL").bind(now(), g.id),
  ]);
  await audit(c.env, me(c).id, "greenred.reset", { gameId: g.id });
  return c.json({ ok: true });
});

// Add people to a round. Several organisers can do this at once: each person is stored once.
adminRoutes.post("/gr-rounds/:id/players", async (c) => {
  const r = await getGrRound(c, Number(c.req.param("id")));
  const g = await grGame(c.env, r.game_id);
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
  // a person can be in only one heat
  const oneHeat = r.kind === "heat" ? " AND NOT EXISTS (SELECT 1 FROM gr_entries e2 JOIN gr_rounds r2 ON r2.id = e2.round_id WHERE r2.game_id = ? AND r2.kind = 'heat' AND e2.user_id = users.id)" : "";
  const res = await c.env.DB.prepare(`INSERT OR IGNORE INTO gr_entries (round_id, user_id, added_by, added_at) SELECT ?, id, ?, ? FROM users WHERE ${where}${oneHeat}`)
    .bind(r.id, me(c).id, now(), ...args, ...(r.kind === "heat" ? [r.game_id] : []))
    .run();
  await notifyRoundEntries(c.env, r.game_id, r.id, `You're in: ${g.name}`, `You have been added to ${grLabel(r, g.mode)}.`);
  await audit(c.env, me(c).id, "greenred.add", { roundId: r.id, added: res.meta.changes, scope: body.scope ?? "people" });
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM gr_entries WHERE round_id = ?").bind(r.id).first<{ n: number }>();
  return c.json({ added: res.meta.changes, total: total?.n ?? 0 });
});

adminRoutes.delete("/gr-rounds/:id/players/:userId", async (c) => {
  const r = await getGrRound(c, Number(c.req.param("id")));
  const userId = Number(c.req.param("userId"));
  const res = await c.env.DB.prepare("DELETE FROM gr_entries WHERE round_id = ? AND user_id = ?").bind(r.id, userId).run();
  if (res.meta.changes) {
    if (r.kind === "final") await writeFinalResult(c.env, r.game_id, userId, null, me(c).id);
    else await syncFinalists(c.env, r.game_id, me(c).id);
    await notifyRemoved(c.env, r.game_id, userId);
    await audit(c.env, me(c).id, "greenred.remove", { roundId: r.id, userId });
  }
  return c.json({ ok: true });
});

// Clear the whole list of a round (for a mistake). Nobody is told.
adminRoutes.delete("/gr-rounds/:id/players", async (c) => {
  const r = await getGrRound(c, Number(c.req.param("id")));
  const { results } = await c.env.DB.prepare("SELECT user_id FROM gr_entries WHERE round_id = ?").bind(r.id).all<{ user_id: number }>();
  await c.env.DB.prepare("DELETE FROM gr_entries WHERE round_id = ?").bind(r.id).run();
  if (r.kind === "final") for (const x of results) await writeFinalResult(c.env, r.game_id, x.user_id, null, me(c).id);
  else await syncFinalists(c.env, r.game_id, me(c).id);
  await audit(c.env, me(c).id, "greenred.clear", { roundId: r.id });
  return c.json({ ok: true });
});

// Record (or change) a finish time. A person who finishes is on the list even if they were not added first.
adminRoutes.post("/gr-rounds/:id/time", async (c) => {
  const r = await getGrRound(c, Number(c.req.param("id")));
  const body = await c.req.json<{ userId?: number; seconds?: number }>();
  const seconds = Math.round(Number(body.seconds) * 100) / 100;
  if (!body.userId || !Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new HttpError(400, "Pick a person and enter a time in seconds (for example 12.4)");
  const person = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(body.userId).first();
  if (!person) throw new HttpError(404, "No such person");
  if (r.kind === "heat") {
    const other = await c.env.DB.prepare("SELECT 1 FROM gr_entries e JOIN gr_rounds r2 ON r2.id = e.round_id WHERE r2.game_id = ? AND r2.kind = 'heat' AND r2.id != ? AND e.user_id = ?").bind(r.game_id, r.id, body.userId).first();
    if (other) throw new HttpError(409, "This person is in a different heat");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO gr_entries (round_id, user_id, added_by, added_at, notified) VALUES (?, ?, ?, ?, 1)").bind(r.id, body.userId, me(c).id, now()),
    c.env.DB.prepare("UPDATE gr_entries SET seconds = ? WHERE round_id = ? AND user_id = ?").bind(seconds, r.id, body.userId),
  ]);
  if (r.kind === "final") await writeFinalResult(c.env, r.game_id, body.userId, seconds, me(c).id);
  else if (r.status === "done") await syncFinalists(c.env, r.game_id, me(c).id);
  await audit(c.env, me(c).id, "greenred.time", { roundId: r.id, userId: body.userId, seconds });
  return c.json({ ok: true });
});

adminRoutes.delete("/gr-rounds/:id/time/:userId", async (c) => {
  const r = await getGrRound(c, Number(c.req.param("id")));
  const userId = Number(c.req.param("userId"));
  await c.env.DB.prepare("UPDATE gr_entries SET seconds = NULL WHERE round_id = ? AND user_id = ?").bind(r.id, userId).run();
  if (r.kind === "final") await writeFinalResult(c.env, r.game_id, userId, null, me(c).id);
  else if (r.status === "done") await syncFinalists(c.env, r.game_id, me(c).id);
  return c.json({ ok: true });
});

// Start a round, or finish it. Finishing a heat sends its top 3 to the final.
adminRoutes.post("/gr-rounds/:id/status", async (c) => {
  const r = await getGrRound(c, Number(c.req.param("id")));
  const { status } = await c.req.json<{ status?: string }>();
  if (status !== "idle" && status !== "live" && status !== "done") throw new HttpError(400, "Bad status");
  if (r.kind === "heat" && r.status === "done" && status !== "done") {
    const started = await c.env.DB.prepare(
      "SELECT 1 FROM gr_entries e JOIN gr_rounds f ON f.id = e.round_id WHERE f.game_id = ? AND f.kind = 'final' AND e.seconds IS NOT NULL LIMIT 1",
    ).bind(r.game_id).first();
    if (started) throw new HttpError(409, "The final already has times, so this heat can't be reopened");
  }
  await c.env.DB.prepare("UPDATE gr_rounds SET status = ? WHERE id = ?").bind(status, r.id).run();
  if (r.kind === "heat") await syncFinalists(c.env, r.game_id, me(c).id);
  await audit(c.env, me(c).id, "greenred.status", { roundId: r.id, status });
  return c.json({ ok: true });
});

// Multi-round mode: share everyone out across the heats at random, in one tap
adminRoutes.post("/games/:id/greenred/split", async (c) => {
  const g = await grGame(c.env, Number(c.req.param("id")));
  if (g.mode !== "multi") throw new HttpError(400, "This only works with multiple rounds");
  const { results: heats } = await c.env.DB.prepare("SELECT id, game_id, ord, kind, status FROM gr_rounds WHERE game_id = ? AND kind = 'heat' ORDER BY ord").bind(g.id).all<GrRound>();
  const used = await c.env.DB.prepare("SELECT 1 FROM gr_entries e JOIN gr_rounds r ON r.id = e.round_id WHERE r.game_id = ? AND r.kind = 'heat' LIMIT 1").bind(g.id).first();
  if (used) throw new HttpError(409, "Some heats already have players. Clear them first.");
  const { results: people } = await c.env.DB.prepare("SELECT id FROM users WHERE team_id IS NOT NULL").all<{ id: number }>();
  const shuffled = people.map((p) => p.id).sort(() => Math.random() - 0.5);
  const stmts = shuffled.map((id, i) => c.env.DB.prepare("INSERT INTO gr_entries (round_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)").bind(heats[i % heats.length].id, id, me(c).id, now()));
  if (stmts.length) await c.env.DB.batch(stmts);
  for (const h of heats) await notifyRoundEntries(c.env, g.id, h.id, `You're in: ${g.name}`, `You have been added to Heat ${h.ord}.`);
  await audit(c.env, me(c).id, "greenred.split", { gameId: g.id, people: shuffled.length });
  return c.json({ ok: true, people: shuffled.length, heats: heats.length });
});

// ---------- Brackets (Meme Charades and Shark Tank) ----------

async function bracketGame(c: Ctx, gameId: number) {
  const game = await c.env.DB.prepare("SELECT id, type FROM games WHERE id = ?").bind(gameId).first<{ id: number; type: string }>();
  if (!game || (game.type !== "meme" && game.type !== "shark")) throw new HttpError(404, "This game has no bracket");
  return game;
}

adminRoutes.post("/games/:id/bracket", async (c) => {
  const game = await bracketGame(c, Number(c.req.param("id")));
  // Who plays whom: two pairs that together use each of the four teams once.
  const body = await c.req.json<{ pairs?: number[][] }>().catch(() => ({} as { pairs?: number[][] }));
  const pairs = body.pairs ?? [[1, 2], [3, 4]];
  const flat = pairs.flat().map(Number);
  const valid = pairs.length === 2 && pairs.every((p) => p.length === 2) && flat.length === 4 && new Set(flat).size === 4 && flat.every((n) => n >= 1 && n <= 4);
  if (!valid) throw new HttpError(400, "Pick two matches that use each of the four teams once");

  // An existing bracket can be re-drawn only while nothing has started
  const started = await c.env.DB.prepare(
    `SELECT 1 FROM matches m WHERE m.game_id = ? AND (m.status != 'pending' OR m.stage = 'final'
       OR EXISTS (SELECT 1 FROM meme_turns r WHERE r.match_id = m.id) OR EXISTS (SELECT 1 FROM pitches p WHERE p.match_id = m.id)) LIMIT 1`,
  )
    .bind(game.id)
    .first();
  if (started) throw new HttpError(409, "This bracket has already started, so the matchups can't change. An admin can reset it.");

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM matches WHERE game_id = ?").bind(game.id),
    c.env.DB.prepare("INSERT INTO matches (game_id, stage, team_a, team_b) VALUES (?, 'semi1', ?, ?)").bind(game.id, Number(pairs[0][0]), Number(pairs[0][1])),
    c.env.DB.prepare("INSERT INTO matches (game_id, stage, team_a, team_b) VALUES (?, 'semi2', ?, ?)").bind(game.id, Number(pairs[1][0]), Number(pairs[1][1])),
  ]);
  await audit(c.env, me(c).id, "bracket.create", { gameId: game.id, pairs });
  return c.json({ ok: true });
});

adminRoutes.post("/games/:id/bracket/reset", async (c) => {
  requireAdmin(c);
  const game = await bracketGame(c, Number(c.req.param("id")));
  // foreign keys cascade to meme_turns, pitches and pitch_votes
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE team_points SET voided_at = ? WHERE game_id = ? AND voided_at IS NULL").bind(now(), game.id),
    c.env.DB.prepare("DELETE FROM matches WHERE game_id = ?").bind(game.id),
  ]);
  await audit(c.env, me(c).id, "bracket.reset", { gameId: game.id });
  return c.json({ ok: true });
});

interface MatchRow {
  id: number;
  game_id: number;
  stage: string;
  team_a: number;
  team_b: number | null;
  status: string;
  winner_team: number | null;
  type: string;
}

async function getMatch(c: Ctx, id: number) {
  const m = await c.env.DB.prepare(
    "SELECT m.*, g.type FROM matches m JOIN games g ON g.id = m.game_id WHERE m.id = ?",
  )
    .bind(id)
    .first<MatchRow>();
  if (!m) throw new HttpError(404, "No such match");
  return m;
}

adminRoutes.post("/matches/:id/status", async (c) => {
  const m = await getMatch(c, Number(c.req.param("id")));
  const { status } = await c.req.json<{ status?: string }>();
  if (status !== "pending" && status !== "live") throw new HttpError(400, "Bad status");
  if (m.status === "done") throw new HttpError(409, "Match is finished");
  await c.env.DB.prepare("UPDATE matches SET status = ? WHERE id = ?").bind(status, m.id).run();
  return c.json({ ok: true });
});

async function finishAndAdvance(c: Ctx, m: MatchRow, winner: number, loser: number | null) {
  const s = await getSettings(c.env);
  const ref = `match:${m.id}`;
  await voidRef(c.env, ref);
  const stmts = [c.env.DB.prepare("UPDATE matches SET status = 'done', winner_team = ? WHERE id = ?").bind(winner, m.id)];
  const gameName = m.type === "shark" ? "Shark Tank" : "Meme Charades";
  if (m.stage === "final") {
    if (Number(s.pts_final_win) > 0) stmts.push(addPoints(c.env, m.game_id, winner, Number(s.pts_final_win), `${gameName} final win`, ref, me(c).id));
    if (loser && Number(s.pts_final_runner_up) > 0) stmts.push(addPoints(c.env, m.game_id, loser, Number(s.pts_final_runner_up), `${gameName} final runner-up`, ref, me(c).id));
  } else if (Number(s.pts_semi_win) > 0) {
    stmts.push(addPoints(c.env, m.game_id, winner, Number(s.pts_semi_win), `${gameName} semi-final win`, ref, me(c).id));
  }
  await c.env.DB.batch(stmts);

  if (m.stage !== "final") {
    const { results: semis } = await c.env.DB.prepare("SELECT stage, winner_team, status FROM matches WHERE game_id = ? AND stage IN ('semi1','semi2')")
      .bind(m.game_id)
      .all<{ stage: string; winner_team: number | null; status: string }>();
    const s1 = semis.find((x) => x.stage === "semi1");
    const s2 = semis.find((x) => x.stage === "semi2");
    if (s1?.winner_team && s2?.winner_team && s1.status === "done" && s2.status === "done") {
      const fin = await c.env.DB.prepare("SELECT id, status FROM matches WHERE game_id = ? AND stage = 'final'").bind(m.game_id).first<{ id: number; status: string }>();
      if (!fin) {
        await c.env.DB.prepare("INSERT INTO matches (game_id, stage, team_a, team_b) VALUES (?, 'final', ?, ?)").bind(m.game_id, s1.winner_team, s2.winner_team).run();
      } else if (fin.status === "pending") {
        await c.env.DB.prepare("UPDATE matches SET team_a = ?, team_b = ? WHERE id = ?").bind(s1.winner_team, s2.winner_team, fin.id).run();
      } else {
        throw new HttpError(409, "The final already started. Reset the bracket to change a semi-final result.");
      }
    }
  }
  await audit(c.env, me(c).id, "match.finish", { matchId: m.id, winner });
}

adminRoutes.post("/matches/:id/finish", async (c) => {
  const m = await getMatch(c, Number(c.req.param("id")));
  if (m.team_b == null) throw new HttpError(400, "Match needs two teams");
  const body = await c.req.json<{ winnerTeam?: number }>().catch(() => ({} as { winnerTeam?: number }));
  let scoreA = 0;
  let scoreB = 0;
  if (m.type === "meme") {
    const turnCount = await c.env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN phase != 'done' THEN 1 ELSE 0 END) AS open FROM meme_turns WHERE match_id = ?")
      .bind(m.id)
      .first<{ total: number; open: number | null }>();
    if (!turnCount?.total || (turnCount.open ?? 0) > 0) throw new HttpError(409, "Finish all the turns first");
    const { results } = await c.env.DB.prepare("SELECT team_id, COUNT(*) AS n FROM meme_turns WHERE match_id = ? AND result = 'point' GROUP BY team_id").bind(m.id).all<{ team_id: number; n: number }>();
    scoreA = results.find((r) => r.team_id === m.team_a)?.n ?? 0;
    scoreB = results.find((r) => r.team_id === m.team_b)?.n ?? 0;
  } else {
    const { results } = await c.env.DB.prepare("SELECT team_id, state, avg FROM pitches WHERE match_id = ?").bind(m.id).all<{ team_id: number; state: string; avg: number | null }>();
    const pa = results.find((r) => r.team_id === m.team_a);
    const pb = results.find((r) => r.team_id === m.team_b);
    if (!pa || !pb || pa.state !== "closed" || pb.state !== "closed") throw new HttpError(409, "Both pitches must be rated and closed first");
    scoreA = pa.avg ?? 0;
    scoreB = pb.avg ?? 0;
  }
  let winner: number;
  if (scoreA !== scoreB) winner = scoreA > scoreB ? m.team_a : m.team_b;
  else if (body.winnerTeam === m.team_a || body.winnerTeam === m.team_b) winner = body.winnerTeam;
  else throw new HttpError(409, "It is a tie. Pick the winner.");
  const loser = winner === m.team_a ? m.team_b : m.team_a;
  await finishAndAdvance(c, m, winner, loser);
  return c.json({ ok: true, winner });
});

// ---------- Shark Tank: guided rounds ----------
// A round is two pitches, one after the other. Each pitch goes idle -> prep -> pitching -> voting -> done.

const ITEMS = [
  "Karela (bitter gourd)", "Lauki (bottle gourd)", "Tinda (apple gourd)", "Baingan (brinjal)", "Drumstick",
  "Beetroot", "Cauliflower", "Capsicum", "Raw banana", "Papaya", "Pineapple", "Watermelon", "Pomegranate", "Custard apple",
];

// The organiser picks which team pitches first. Items are drawn for both teams at the same time.
adminRoutes.post("/matches/:id/start-round", async (c) => {
  const m = await getMatch(c, Number(c.req.param("id")));
  if ((m.type !== "shark" && m.type !== "meme") || m.team_b == null) throw new HttpError(400, "This game has no rounds to start");
  const { firstTeam } = await c.req.json<{ firstTeam?: number }>();
  if (firstTeam !== m.team_a && firstTeam !== m.team_b) throw new HttpError(400, "Pick which team goes first");
  if (m.type === "meme") {
    const has = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM meme_turns WHERE match_id = ?").bind(m.id).first<{ n: number }>();
    if ((has?.n ?? 0) > 0) throw new HttpError(409, "This round has already started");
    const { perTeam } = await memeConfig(c.env);
    const other = firstTeam === m.team_a ? m.team_b : m.team_a;
    const stmts = [];
    for (let i = 0; i < perTeam * 2; i++) {
      stmts.push(c.env.DB.prepare("INSERT INTO meme_turns (match_id, ord, team_id) VALUES (?, ?, ?)").bind(m.id, i + 1, i % 2 === 0 ? firstTeam : other));
    }
    stmts.push(c.env.DB.prepare("UPDATE matches SET status = 'live' WHERE id = ?").bind(m.id));
    await c.env.DB.batch(stmts);
    await audit(c.env, me(c).id, "meme.start_round", { matchId: m.id, firstTeam, turns: perTeam * 2 });
    return c.json({ ok: true });
  }
  const existing = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM pitches WHERE match_id = ?").bind(m.id).first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) throw new HttpError(409, "This round has already started");
  const second = firstTeam === m.team_a ? m.team_b : m.team_a;
  const pool = [...ITEMS].sort(() => Math.random() - 0.5);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO pitches (match_id, team_id, item, ord) VALUES (?, ?, ?, 1)").bind(m.id, firstTeam, pool[0]),
    c.env.DB.prepare("INSERT INTO pitches (match_id, team_id, item, ord) VALUES (?, ?, ?, 2)").bind(m.id, second, pool[1]),
    c.env.DB.prepare("UPDATE matches SET status = 'live' WHERE id = ?").bind(m.id),
  ]);
  await audit(c.env, me(c).id, "shark.start_round", { matchId: m.id, firstTeam });
  return c.json({ ok: true });
});

adminRoutes.patch("/pitches/:id", async (c) => {
  const { item } = await c.req.json<{ item?: string }>();
  if (!item?.trim()) throw new HttpError(400, "Item is required");
  await c.env.DB.prepare("UPDATE pitches SET item = ? WHERE id = ?").bind(item.trim().slice(0, 60), Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

interface PitchRow {
  id: number;
  match_id: number;
  team_id: number;
  state: string;
  phase: string;
  ord: number;
  game_id: number;
  team_a: number;
  team_b: number;
  match_status: string;
}

async function getPitch(c: Ctx, id: number) {
  const p = await c.env.DB.prepare(
    `SELECT p.id, p.match_id, p.team_id, p.state, p.phase, p.ord, m.game_id, m.team_a, m.team_b, m.status AS match_status
       FROM pitches p JOIN matches m ON m.id = p.match_id WHERE p.id = ?`,
  )
    .bind(id)
    .first<PitchRow>();
  if (!p) throw new HttpError(404, "No such pitch");
  return p;
}

// Which phase each button moves from
const PHASE_FROM: Record<string, string> = { prep: "idle", pitching: "prep", voting: "pitching" };

adminRoutes.post("/pitches/:id/phase", async (c) => {
  const p = await getPitch(c, Number(c.req.param("id")));
  const { phase } = await c.req.json<{ phase?: string }>();
  if (!phase || !(phase in PHASE_FROM)) throw new HttpError(400, "Bad phase");
  if (p.match_status === "done") throw new HttpError(409, "This round is finished");
  if (p.phase !== PHASE_FROM[phase]) throw new HttpError(409, `This turn is at "${p.phase}", so it can't go to "${phase}" yet`);
  const earlier = await c.env.DB.prepare("SELECT 1 FROM pitches WHERE match_id = ? AND ord < ? AND phase != 'done'").bind(p.match_id, p.ord).first();
  if (earlier) throw new HttpError(409, "Finish the first team's turn before starting this one");
  if (phase === "voting") {
    const other = await c.env.DB.prepare("SELECT 1 FROM pitches WHERE phase = 'voting' AND id != ?").bind(p.id).first();
    if (other) throw new HttpError(409, "Another pitch is still being rated");
  }
  const timers = await sharkTimers(c.env);
  const seconds = phase === "prep" ? timers.prep : phase === "pitching" ? timers.pitch : timers.vote;
  const endsAt = now() + seconds * 1000;
  await c.env.DB.prepare("UPDATE pitches SET phase = ?, phase_ends_at = ?, state = ?, votes = 0, avg = NULL WHERE id = ?")
    .bind(phase, endsAt, phase === "voting" ? "voting" : "pending", p.id)
    .run();
  await audit(c.env, me(c).id, "shark.phase", { pitchId: p.id, phase });
  return c.json({ ok: true, endsAt });
});

// Start this team's turn over (for a mistake). Clears its votes and points.
adminRoutes.post("/pitches/:id/reset", async (c) => {
  const p = await getPitch(c, Number(c.req.param("id")));
  if (p.match_status === "done") throw new HttpError(409, "This round is finished. An admin can reset the bracket.");
  const later = await c.env.DB.prepare("SELECT 1 FROM pitches WHERE match_id = ? AND ord > ? AND phase != 'idle'").bind(p.match_id, p.ord).first();
  if (later) throw new HttpError(409, "Restart the second team's turn first");
  await voidRef(c.env, `pitch:${p.id}`);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM pitch_votes WHERE pitch_id = ?").bind(p.id),
    c.env.DB.prepare("UPDATE pitches SET phase = 'idle', phase_ends_at = NULL, state = 'pending', votes = 0, avg = NULL WHERE id = ?").bind(p.id),
  ]);
  await audit(c.env, me(c).id, "shark.reset", { pitchId: p.id });
  return c.json({ ok: true });
});

// Save the audience score. When both teams have pitched, the higher average advances on its own.
adminRoutes.post("/pitches/:id/close", async (c) => {
  const p = await getPitch(c, Number(c.req.param("id")));
  if (p.phase !== "voting") throw new HttpError(409, "Open voting for this pitch first");
  const body = await c.req.json<{ force?: boolean }>().catch(() => ({} as { force?: boolean }));
  const tally = await pitchTally(c.env, { id: p.id, team_id: p.team_id, team_a: p.team_a, team_b: p.team_b });
  if (tally.votes < tally.minVotes && !body.force) {
    throw new HttpError(409, `Only ${tally.votes} votes so far (minimum ${tally.minVotes}). Save anyway to force it.`);
  }
  const ref = `pitch:${p.id}`;
  await voidRef(c.env, ref);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE pitches SET phase = 'done', phase_ends_at = NULL, state = 'closed', votes = ?, avg = ? WHERE id = ?").bind(tally.votes, tally.avg, p.id),
  ]);
  await audit(c.env, me(c).id, "pitch.close", { id: p.id, ...tally });

  let winner: number | null = null;
  let tie = false;
  const { results: both } = await c.env.DB.prepare("SELECT team_id, phase, avg FROM pitches WHERE match_id = ?").bind(p.match_id).all<{ team_id: number; phase: string; avg: number | null }>();
  if (both.length === 2 && both.every((x) => x.phase === "done")) {
    if (both[0].avg === both[1].avg) tie = true;
    else {
      winner = (both[0].avg ?? 0) > (both[1].avg ?? 0) ? both[0].team_id : both[1].team_id;
      const loser = winner === both[0].team_id ? both[1].team_id : both[0].team_id;
      await finishAndAdvance(c, await getMatch(c, p.match_id), winner, loser);
    }
  }
  return c.json({ ok: true, ...tally, winner, tie });
});

// ---------- Meme Charades: turn by turn ----------
// Each team sends players to act a meme (shown on the projector, not in the app). Their own team guesses.
// The organiser starts the clock, then marks the turn as a point or a fail.

interface TurnRow {
  id: number;
  match_id: number;
  ord: number;
  team_id: number;
  phase: string;
  match_status: string;
}

async function getTurn(c: Ctx, id: number) {
  const row = await c.env.DB.prepare(
    `SELECT t.id, t.match_id, t.ord, t.team_id, t.phase, m.status AS match_status
       FROM meme_turns t JOIN matches m ON m.id = t.match_id WHERE t.id = ?`,
  )
    .bind(id)
    .first<TurnRow>();
  if (!row) throw new HttpError(404, "No such turn");
  return row;
}

const MAX_ACTING = 3;

// One atomic statement: add the person only if the turn still has room. Safe when several organisers add at once.
async function addTurnPlayer(env: Env, turnId: number, userId: number) {
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO meme_turn_players (turn_id, user_id, added_at)
     SELECT ?, id, ? FROM users WHERE id = ? AND (SELECT COUNT(*) FROM meme_turn_players WHERE turn_id = ?) < ${MAX_ACTING}`,
  )
    .bind(turnId, now(), userId, turnId)
    .run();
  return res.meta.changes > 0;
}

adminRoutes.post("/meme-turns/:id/players", async (c) => {
  const t = await getTurn(c, Number(c.req.param("id")));
  if (t.match_status === "done" || t.phase === "done") throw new HttpError(409, "This turn is finished");
  const { userId } = await c.req.json<{ userId?: number }>();
  const id = Number(userId);
  if (!Number.isInteger(id)) throw new HttpError(400, "Pick a person");
  const person = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!person) throw new HttpError(404, "No such person");
  const added = await addTurnPlayer(c.env, t.id, id);
  let duplicate = false;
  if (!added) {
    const there = await c.env.DB.prepare("SELECT 1 FROM meme_turn_players WHERE turn_id = ? AND user_id = ?").bind(t.id, id).first();
    if (!there) throw new HttpError(409, `This turn already has ${MAX_ACTING} players`);
    duplicate = true;
  }
  return c.json({ ok: true, duplicate });
});

adminRoutes.delete("/meme-turns/:id/players/:userId", async (c) => {
  const t = await getTurn(c, Number(c.req.param("id")));
  if (t.match_status === "done" || t.phase === "done") throw new HttpError(409, "This turn is finished");
  await c.env.DB.prepare("DELETE FROM meme_turn_players WHERE turn_id = ? AND user_id = ?").bind(t.id, Number(c.req.param("userId"))).run();
  return c.json({ ok: true });
});

adminRoutes.post("/meme-turns/:id/start", async (c) => {
  const t = await getTurn(c, Number(c.req.param("id")));
  if (t.match_status === "done") throw new HttpError(409, "This round is finished");
  if (t.phase !== "idle") throw new HttpError(409, "This turn has already started");
  const earlier = await c.env.DB.prepare("SELECT 1 FROM meme_turns WHERE match_id = ? AND ord < ? AND phase != 'done'").bind(t.match_id, t.ord).first();
  if (earlier) throw new HttpError(409, "Finish the previous turn first");
  const body = await c.req.json<{ meme?: string; playerIds?: number[] }>().catch(() => ({} as { meme?: string; playerIds?: number[] }));
  const meme = String(body.meme ?? "").trim().slice(0, 40) || null;
  const { act } = await memeConfig(c.env);
  const endsAt = now() + act * 1000;
  // only one organiser can start a turn, even if two press the button together
  const started = await c.env.DB.prepare("UPDATE meme_turns SET phase = 'acting', phase_ends_at = ?, meme = COALESCE(?, meme) WHERE id = ? AND phase = 'idle'")
    .bind(endsAt, meme, t.id)
    .run();
  if (!started.meta.changes) throw new HttpError(409, "This turn has already started");
  const ids = [...new Set((body.playerIds ?? []).map(Number))].filter((n) => Number.isInteger(n));
  for (const id of ids) await addTurnPlayer(c.env, t.id, id);
  await audit(c.env, me(c).id, "meme.start_turn", { turnId: t.id, meme });
  return c.json({ ok: true, endsAt });
});

adminRoutes.post("/meme-turns/:id/result", async (c) => {
  const t = await getTurn(c, Number(c.req.param("id")));
  const { result } = await c.req.json<{ result?: string }>();
  if (result !== "point" && result !== "fail") throw new HttpError(400, "Choose point or fail");
  if (t.phase !== "acting") throw new HttpError(409, "Start the turn first");
  // only the first tap counts if two organisers press Point and Fail together
  const scored = await c.env.DB.prepare("UPDATE meme_turns SET phase = 'done', phase_ends_at = NULL, result = ? WHERE id = ? AND phase = 'acting'").bind(result, t.id).run();
  if (!scored.meta.changes) throw new HttpError(409, "Another organiser already scored this turn");
  await audit(c.env, me(c).id, "meme.result", { turnId: t.id, result });

  // after the last turn the higher score moves on by itself; level scores wait for the organiser
  let winner: number | null = null;
  let tie = false;
  const { results: all } = await c.env.DB.prepare("SELECT team_id, phase, result FROM meme_turns WHERE match_id = ?").bind(t.match_id).all<{ team_id: number; phase: string; result: string | null }>();
  if (all.every((x) => x.phase === "done")) {
    const m = await getMatch(c, t.match_id);
    const a = all.filter((x) => x.team_id === m.team_a && x.result === "point").length;
    const b = all.filter((x) => x.team_id === m.team_b && x.result === "point").length;
    if (a === b) tie = true;
    else {
      winner = a > b ? m.team_a : (m.team_b as number);
      await finishAndAdvance(c, m, winner, winner === m.team_a ? m.team_b : m.team_a);
    }
  }
  return c.json({ ok: true, winner, tie });
});

// Take this turn back to "waiting" (for a mistake)
adminRoutes.post("/meme-turns/:id/reset", async (c) => {
  const t = await getTurn(c, Number(c.req.param("id")));
  if (t.match_status === "done") throw new HttpError(409, "This round is finished. An admin can reset the bracket.");
  const later = await c.env.DB.prepare("SELECT 1 FROM meme_turns WHERE match_id = ? AND ord > ? AND phase != 'idle'").bind(t.match_id, t.ord).first();
  if (later) throw new HttpError(409, "Restart the later turns first");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE meme_turns SET phase = 'idle', phase_ends_at = NULL, result = NULL, meme = NULL, players = NULL WHERE id = ?").bind(t.id),
    c.env.DB.prepare("DELETE FROM meme_turn_players WHERE turn_id = ?").bind(t.id),
  ]);
  await audit(c.env, me(c).id, "meme.reset_turn", { turnId: t.id });
  return c.json({ ok: true });
});

// ---------- Act It Out: rounds, turns and the public ranking ----------
// Each round, the four teams act one after another. Then everyone ranks the three other teams.

async function getActRound(c: Ctx, id: number) {
  const r = await c.env.DB.prepare("SELECT id, game_id, ord, phase, phase_ends_at FROM act_rounds WHERE id = ?").bind(id).first<{ id: number; game_id: number; ord: number; phase: string; phase_ends_at: number | null }>();
  if (!r) throw new HttpError(404, "No such round");
  return r;
}

async function getActTurn(c: Ctx, id: number) {
  const row = await c.env.DB.prepare(
    `SELECT t.id, t.round_id, t.ord, t.team_id, t.phase, r.phase AS round_phase, r.game_id, r.ord AS round_ord
       FROM act_turns t JOIN act_rounds r ON r.id = t.round_id WHERE t.id = ?`,
  )
    .bind(id)
    .first<{ id: number; round_id: number; ord: number; team_id: number; phase: string; round_phase: string; game_id: number; round_ord: number }>();
  if (!row) throw new HttpError(404, "No such turn");
  return row;
}

adminRoutes.post("/games/:id/actout/start", async (c) => {
  const gameId = Number(c.req.param("id"));
  const game = await c.env.DB.prepare("SELECT id, type FROM games WHERE id = ?").bind(gameId).first<{ id: number; type: string }>();
  if (!game || game.type !== "actout") throw new HttpError(404, "This is not the Act It Out game");
  const has = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM act_rounds WHERE game_id = ?").bind(gameId).first<{ n: number }>();
  if ((has?.n ?? 0) > 0) throw new HttpError(409, "The rounds have already been created");
  const cfg = await actConfig(c.env);
  const { results: teams } = await c.env.DB.prepare("SELECT id FROM teams ORDER BY id").all<{ id: number }>();
  const stmts = [];
  for (let r = 1; r <= cfg.rounds; r++) stmts.push(c.env.DB.prepare("INSERT INTO act_rounds (game_id, ord) VALUES (?, ?)").bind(gameId, r));
  // the order the teams perform in shifts by one each round, so the same team is not always first
  for (let r = 1; r <= cfg.rounds; r++) {
    for (let i = 0; i < teams.length; i++) {
      stmts.push(
        c.env.DB.prepare("INSERT INTO act_turns (round_id, ord, team_id) SELECT id, ?, ? FROM act_rounds WHERE game_id = ? AND ord = ?").bind(i + 1, teams[(i + r - 1) % teams.length].id, gameId, r),
      );
    }
  }
  await c.env.DB.batch(stmts);
  await audit(c.env, me(c).id, "actout.start", { gameId, rounds: cfg.rounds });
  return c.json({ ok: true });
});

adminRoutes.patch("/act-rounds/:id", async (c) => {
  const r = await getActRound(c, Number(c.req.param("id")));
  const { scene } = await c.req.json<{ scene?: string }>();
  await c.env.DB.prepare("UPDATE act_rounds SET scene = ? WHERE id = ?").bind(String(scene ?? "").trim().slice(0, 40) || null, r.id).run();
  return c.json({ ok: true });
});

adminRoutes.post("/act-turns/:id/start", async (c) => {
  const t = await getActTurn(c, Number(c.req.param("id")));
  if (t.phase !== "idle") throw new HttpError(409, "This team has already performed");
  if (t.round_phase !== "idle" && t.round_phase !== "performing") throw new HttpError(409, "This round is already at the voting stage");
  const earlierRound = await c.env.DB.prepare("SELECT 1 FROM act_rounds WHERE game_id = ? AND ord < ? AND phase != 'done'").bind(t.game_id, t.round_ord).first();
  if (earlierRound) throw new HttpError(409, "Finish the previous round first");
  const earlierTurn = await c.env.DB.prepare("SELECT 1 FROM act_turns WHERE round_id = ? AND ord < ? AND phase != 'done'").bind(t.round_id, t.ord).first();
  if (earlierTurn) throw new HttpError(409, "Finish the previous team first");
  const body = await c.req.json<{ scene?: string }>().catch(() => ({} as { scene?: string }));
  const cfg = await actConfig(c.env);
  const endsAt = now() + cfg.act * 1000;
  const started = await c.env.DB.prepare("UPDATE act_turns SET phase = 'acting', phase_ends_at = ? WHERE id = ? AND phase = 'idle'").bind(endsAt, t.id).run();
  if (!started.meta.changes) throw new HttpError(409, "This turn has already started");
  const scene = String(body.scene ?? "").trim().slice(0, 40);
  await c.env.DB.prepare("UPDATE act_rounds SET phase = 'performing', scene = COALESCE(?, scene) WHERE id = ? AND phase IN ('idle', 'performing')").bind(scene || null, t.round_id).run();
  await audit(c.env, me(c).id, "actout.start_turn", { turnId: t.id });
  return c.json({ ok: true, endsAt });
});

// The team has finished (early, or the minute ran out)
adminRoutes.post("/act-turns/:id/done", async (c) => {
  const t = await getActTurn(c, Number(c.req.param("id")));
  const res = await c.env.DB.prepare("UPDATE act_turns SET phase = 'done', phase_ends_at = NULL WHERE id = ? AND phase = 'acting'").bind(t.id).run();
  if (!res.meta.changes) throw new HttpError(409, "This team is not performing right now");
  await audit(c.env, me(c).id, "actout.turn_done", { turnId: t.id });
  return c.json({ ok: true });
});

adminRoutes.post("/act-turns/:id/reset", async (c) => {
  const t = await getActTurn(c, Number(c.req.param("id")));
  if (t.round_phase !== "idle" && t.round_phase !== "performing") throw new HttpError(409, "This round is already at the voting stage");
  const later = await c.env.DB.prepare("SELECT 1 FROM act_turns WHERE round_id = ? AND ord > ? AND phase != 'idle'").bind(t.round_id, t.ord).first();
  if (later) throw new HttpError(409, "Restart the later teams first");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE act_turns SET phase = 'idle', phase_ends_at = NULL WHERE id = ?").bind(t.id),
    c.env.DB.prepare("UPDATE act_rounds SET phase = 'idle' WHERE id = ? AND phase = 'performing' AND NOT EXISTS (SELECT 1 FROM act_turns WHERE round_id = ? AND phase != 'idle')").bind(t.round_id, t.round_id),
  ]);
  return c.json({ ok: true });
});

adminRoutes.post("/act-rounds/:id/open-voting", async (c) => {
  const r = await getActRound(c, Number(c.req.param("id")));
  if (r.phase !== "performing") throw new HttpError(409, r.phase === "voting" ? "Voting is already open" : "Let the teams perform first");
  const open = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM act_turns WHERE round_id = ? AND phase != 'done'").bind(r.id).first<{ n: number }>();
  if ((open?.n ?? 0) > 0) throw new HttpError(409, "Every team has to perform before voting opens");
  const cfg = await actConfig(c.env);
  const endsAt = now() + cfg.vote * 1000;
  const res = await c.env.DB.prepare("UPDATE act_rounds SET phase = 'voting', phase_ends_at = ? WHERE id = ? AND phase = 'performing'").bind(endsAt, r.id).run();
  if (!res.meta.changes) throw new HttpError(409, "Voting is already open");
  await audit(c.env, me(c).id, "actout.open_voting", { roundId: r.id });
  return c.json({ ok: true, endsAt });
});

// Rank the teams from the ballots. Each ballot gives 3, 2 and 1 points to the three teams it ranks.
// A team is scored by its average over the ballots that ranked it (so uneven team sizes do not matter).
async function scoreActRound(env: Env, roundId: number) {
  const { results: votes } = await env.DB.prepare("SELECT first_team AS a, second_team AS b, third_team AS c FROM act_votes WHERE round_id = ?").bind(roundId).all<{ a: number; b: number; c: number }>();
  const { results: teams } = await env.DB.prepare("SELECT id FROM teams ORDER BY id").all<{ id: number }>();
  const stats = new Map(teams.map((tm) => [tm.id, { id: tm.id, sum: 0, n: 0, firsts: 0 }]));
  for (const v of votes) {
    for (const [team, pts] of [[v.a, 3], [v.b, 2], [v.c, 1]] as const) {
      const s = stats.get(team);
      if (s) {
        s.sum += pts;
        s.n += 1;
        if (pts === 3) s.firsts += 1;
      }
    }
  }
  const rows = [...stats.values()].map((s) => ({ id: s.id, avg: s.n ? s.sum / s.n : 0, firsts: s.firsts, ballots: s.n }));
  rows.sort((a, b) => b.avg - a.avg || b.firsts - a.firsts || a.id - b.id);
  const s = await getSettings(env);
  const shares = sharePoints(tieGroups(rows, (x) => `${x.avg.toFixed(6)}:${x.firsts}`, (x) => x.id), parseTable(s.team_rank_points));
  return { ballots: votes.length, rows: rows.map((r) => ({ ...r, rank: shares.get(r.id)!.rank, points: shares.get(r.id)!.points })) };
}

adminRoutes.post("/act-rounds/:id/close", async (c) => {
  const r = await getActRound(c, Number(c.req.param("id")));
  if (r.phase !== "voting") throw new HttpError(409, "Open voting for this round first");
  const body = await c.req.json<{ force?: boolean }>().catch(() => ({} as { force?: boolean }));
  const scored = await scoreActRound(c.env, r.id);
  if (scored.ballots === 0 && !body.force) throw new HttpError(409, "No votes yet. Save anyway?");
  const res = await c.env.DB.prepare("UPDATE act_rounds SET phase = 'done', phase_ends_at = NULL WHERE id = ? AND phase = 'voting'").bind(r.id).run();
  if (!res.meta.changes) throw new HttpError(409, "This round was already saved");
  const ref = `act:${r.id}`;
  await voidRef(c.env, ref);
  const stmts = [c.env.DB.prepare("DELETE FROM act_results WHERE round_id = ?").bind(r.id)];
  for (const row of scored.rows) {
    stmts.push(
      c.env.DB.prepare("INSERT INTO act_results (round_id, team_id, avg, firsts, ballots, rank, points) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(r.id, row.id, row.avg, row.firsts, row.ballots, row.rank, row.points),
    );
    if (row.points > 0) stmts.push(addPoints(c.env, r.game_id, row.id, row.points, `Act It Out round ${r.ord}`, ref, me(c).id));
  }
  await c.env.DB.batch(stmts);
  await audit(c.env, me(c).id, "actout.close_round", { roundId: r.id, ballots: scored.ballots });
  return c.json({ ok: true, ballots: scored.ballots, results: scored.rows });
});

// Start a round over (for a mistake): clears its turns, votes and points
adminRoutes.post("/act-rounds/:id/reset", async (c) => {
  const r = await getActRound(c, Number(c.req.param("id")));
  const later = await c.env.DB.prepare("SELECT 1 FROM act_rounds WHERE game_id = ? AND ord > ? AND phase != 'idle'").bind(r.game_id, r.ord).first();
  if (later) throw new HttpError(409, "Restart the later rounds first");
  await voidRef(c.env, `act:${r.id}`);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM act_votes WHERE round_id = ?").bind(r.id),
    c.env.DB.prepare("DELETE FROM act_results WHERE round_id = ?").bind(r.id),
    c.env.DB.prepare("UPDATE act_turns SET phase = 'idle', phase_ends_at = NULL WHERE round_id = ?").bind(r.id),
    c.env.DB.prepare("UPDATE act_rounds SET phase = 'idle', phase_ends_at = NULL WHERE id = ?").bind(r.id),
  ]);
  await audit(c.env, me(c).id, "actout.reset_round", { roundId: r.id });
  return c.json({ ok: true });
});

// ---------- Manual team points and corrections ----------

adminRoutes.post("/team-points", async (c) => {
  const b = await c.req.json<{ teamId?: number; points?: number; reason?: string; gameId?: number | null }>();
  const points = Number(b.points);
  if (!b.teamId || !Number.isFinite(points) || !b.reason?.trim()) throw new HttpError(400, "Need a team, points and a reason");
  await c.env.DB.prepare("INSERT INTO team_points (game_id, team_id, points, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(b.gameId ?? null, b.teamId, points, b.reason.trim(), me(c).id, now())
    .run();
  await audit(c.env, me(c).id, "team_points.add", b);
  return c.json({ ok: true });
});

adminRoutes.get("/team-points", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT tp.id, tp.team_id AS teamId, tp.points, tp.reason, tp.created_at AS at, tp.voided_at AS voidedAt, g.name AS game
       FROM team_points tp LEFT JOIN games g ON g.id = tp.game_id ORDER BY tp.id DESC LIMIT 60`,
  ).all();
  return c.json({ entries: results });
});

adminRoutes.delete("/team-points/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("UPDATE team_points SET voided_at = ? WHERE id = ? AND voided_at IS NULL").bind(now(), id).run();
  await audit(c.env, me(c).id, "team_points.void", { id });
  return c.json({ ok: true });
});

// Full detail for organisers (same builder as the public one, but with extra controls data)
adminRoutes.get("/games/:id", async (c) => {
  return c.json(await buildGameDetail(c.env, Number(c.req.param("id")), me(c), true));
});
