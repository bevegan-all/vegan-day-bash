import type { Env } from "./lib";
import { createUser } from "./users";

// Test-only accounts. They exist only while the TEST_ACCOUNTS variable is "1"
// (set in .dev.vars for local development). Never leave this on for the real event.
export const TEST_ACCOUNTS = [
  { name: "Test Admin", username: "admin", password: "admin123", role: "admin" as const },
  { name: "Test User", username: "user", password: "user123", role: "participant" as const },
];

let seeded = false;

export async function ensureTestAccounts(env: Env) {
  if (seeded || env.TEST_ACCOUNTS !== "1") return;
  for (const a of TEST_ACCOUNTS) {
    const row = await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(a.username).first();
    if (!row) await createUser(env, { name: a.name, username: a.username, password: a.password, role: a.role });
  }
  seeded = true;
}
