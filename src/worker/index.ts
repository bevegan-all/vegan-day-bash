import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { HttpError, sha256, now, type AppEnv, type User } from "./lib";
import { authRoutes } from "./auth";
import { adminRoutes } from "./admin";
import { publicRoutes } from "./public";
import { ensureTestAccounts } from "./seed";
import { notifyRoutes } from "./notify";
import { tttPublicRoutes } from "./tictactoe";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

// CSRF guard: browsers always send Origin on cross-site POSTs. Reject mismatches.
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) throw new HttpError(403, "Bad origin");
  }
  await next();
});

// Load the signed-in user, if any
app.use("/api/*", async (c, next) => {
  c.set("user", null);
  await ensureTestAccounts(c.env);
  const cookie = getCookie(c, "vdb_session");
  if (cookie) {
    const id = await sha256(cookie);
    const user = await c.env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.team_id, u.checked_in
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ?`,
    )
      .bind(id, now())
      .first<User>();
    if (user) c.set("user", user);
  }
  c.header("Cache-Control", "no-store");
  await next();
});

app.route("/api", authRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api", publicRoutes);
app.route("/api", notifyRoutes);
app.route("/api", tttPublicRoutes);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default app;
