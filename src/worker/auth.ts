import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import {
  HttpError,
  SESSION_TTL_MS,
  audit,
  hashPassword,
  now,
  qrCodeFor,
  randomToken,
  safeEqual,
  sha256,
  type AppEnv,
  type Ctx,
  type User,
} from "./lib";
import { createUser } from "./users";
import { computeIndividual, computeTeamBoard, publicBoard } from "./leaderboard";

export const authRoutes = new Hono<AppEnv>();

async function startSession(c: Ctx, userId: number) {
  const token = randomToken(32);
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, now() + SESSION_TTL_MS)
    .run();
  setCookie(c, "vdb_session", token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

// Best-effort throttle per isolate. Passwords are random, so this is a light extra guard.
const failures = new Map<string, { n: number; until: number }>();

authRoutes.get("/setup/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
  return c.json({ needsSetup: (row?.n ?? 0) === 0, testAccounts: c.env.TEST_ACCOUNTS === "1" });
});

authRoutes.post("/setup", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
  if ((row?.n ?? 0) > 0) throw new HttpError(403, "Setup already done");
  const body = await c.req.json<{ code?: string; name?: string; username?: string; password?: string }>();
  if (!c.env.SETUP_CODE || !safeEqual(String(body.code ?? ""), c.env.SETUP_CODE)) throw new HttpError(403, "Wrong setup code");
  const name = String(body.name ?? "").trim();
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!name || !/^[a-z0-9_.-]{3,30}$/.test(username) || password.length < 8) {
    throw new HttpError(400, "Need a name, a username (3+ letters/digits) and a password of 8+ characters");
  }
  const created = await createUser(c.env, { name, role: "admin", username, password });
  await startSession(c, created.user.id);
  await audit(c.env, created.user.id, "setup.admin", { username });
  return c.json({ ok: true });
});

authRoutes.post("/auth/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const f = failures.get(username);
  if (f && f.until > now() && f.n >= 8) throw new HttpError(429, "Too many attempts. Try again in a minute.");
  const row = await c.env.DB.prepare("SELECT id, pass_salt, pass_hash FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: number; pass_salt: string; pass_hash: string }>();
  const hash = await hashPassword(password, row?.pass_salt ?? "x", c.env.PEPPER);
  if (!row || !safeEqual(hash, row.pass_hash)) {
    failures.set(username, { n: (f && f.until > now() ? f.n : 0) + 1, until: now() + 60_000 });
    throw new HttpError(401, "Wrong username or password");
  }
  failures.delete(username);
  await startSession(c, row.id);
  return c.json({ ok: true });
});

authRoutes.post("/auth/logout", async (c) => {
  const cookie = c.req.header("Cookie")?.match(/vdb_session=([a-f0-9]+)/)?.[1];
  if (cookie) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(cookie)).run();
  deleteCookie(c, "vdb_session", { path: "/" });
  return c.json({ ok: true });
});

async function findLink(c: Ctx, token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  return c.env.DB.prepare(
    `SELECT t.id AS token_id, u.id, u.display_name, u.team_id, tm.name AS team_name, tm.emoji, tm.color
       FROM login_tokens t JOIN users u ON u.id = t.user_id LEFT JOIN teams tm ON tm.id = u.team_id
      WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<{ token_id: number; id: number; display_name: string; team_id: number | null; team_name: string | null; emoji: string | null; color: string | null }>();
}

// Read-only: shows who the link belongs to. Does NOT sign anyone in, so link previews are harmless.
authRoutes.get("/auth/link/:token", async (c) => {
  const row = await findLink(c, c.req.param("token"));
  if (!row) throw new HttpError(404, "This sign-in link is not valid any more. Ask an organiser for a new one.");
  return c.json({ name: row.display_name, team: row.team_name ? { name: row.team_name, emoji: row.emoji, color: row.color } : null });
});

authRoutes.post("/auth/link", async (c) => {
  const { token } = await c.req.json<{ token?: string }>();
  const row = await findLink(c, String(token ?? ""));
  if (!row) throw new HttpError(404, "This sign-in link is not valid any more. Ask an organiser for a new one.");
  await c.env.DB.prepare("UPDATE login_tokens SET last_used_at = ? WHERE id = ?").bind(now(), row.token_id).run();
  await startSession(c, row.id);
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: null });
  const team = user.team_id
    ? await c.env.DB.prepare("SELECT id, name, emoji, color FROM teams WHERE id = ?").bind(user.team_id).first()
    : null;
  return c.json({
    user: { id: user.id, name: user.display_name, username: user.username, role: user.role, team },
  });
});

authRoutes.get("/me/qr", async (c) => {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Not signed in");
  return c.json({ code: await qrCodeFor(c.env, user.id) });
});

// One cheap call that powers the Home screen and its polling
authRoutes.get("/home", async (c) => {
  const user = c.get("user") as User | null;
  if (!user) throw new HttpError(401, "Not signed in");
  const boards = await computeIndividual(c.env);
  const teams = await computeTeamBoard(c.env, boards);
  // Live games and any open pitch rating come from the lighter /pulse call
  return c.json({
    teams,
    myTeamRank: teams.find((t) => t.teamId === user.team_id)?.rank ?? null,
    individual: publicBoard(boards.overall, user.id, 0).me,
    individualCount: boards.overall.length,
  });
});
