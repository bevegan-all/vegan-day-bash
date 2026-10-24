import type { Context } from "hono";

export interface Env {
  DB: D1Database;
  QR_SECRET: string;
  PEPPER: string;
  SETUP_CODE: string;
  TEST_ACCOUNTS?: string;
}

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: "participant" | "organiser" | "admin";
  team_id: number | null;
  checked_in: number;
}

export type AppEnv = { Bindings: Env; Variables: { user: User | null } };
export type Ctx = Context<AppEnv>;

export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const now = () => Date.now();

const enc = new TextEncoder();

export const hex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export const randomToken = (bytes = 16) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

export async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Passwords here are random, system-generated and shown to the person once, so a light
// PBKDF2 round count is enough. It also keeps CPU time inside the Workers free-plan limit.
const PBKDF2_ITERATIONS = 5000;

export async function hashPassword(password: string, salt: string, pepper: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password + pepper), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return hex(bits);
}

const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function generatePassword(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}

export function slugifyName(name: string) {
  const first = name.trim().split(/\s+/)[0] ?? "user";
  const s = first.toLowerCase().replace(/[^a-z0-9]/g, "");
  return s || "user";
}

// "Riya Sharma" -> "Riya S."  (used on public boards)
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export async function qrCodeFor(env: Env, userId: number) {
  const sig = (await hmac(env.QR_SECRET, `id:${userId}`)).slice(0, 16);
  return `VDB1.${userId}.${sig}`;
}

export async function parseQrCode(env: Env, code: string): Promise<number | null> {
  const m = /^VDB1\.(\d+)\.([0-9a-f]{16})$/.exec(code.trim());
  if (!m) return null;
  const id = Number(m[1]);
  const sig = (await hmac(env.QR_SECRET, `id:${id}`)).slice(0, 16);
  return safeEqual(sig, m[2]) ? id : null;
}

export async function audit(env: Env, userId: number | null, action: string, detail?: unknown) {
  await env.DB.prepare("INSERT INTO audit_log (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)")
    .bind(userId, action, detail === undefined ? null : JSON.stringify(detail), now())
    .run();
}

export async function getSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 429, message: string) {
    super(message);
  }
}
