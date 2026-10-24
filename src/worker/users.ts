import {
  HttpError,
  generatePassword,
  hashPassword,
  now,
  randomToken,
  sha256,
  slugifyName,
  type Env,
  type User,
} from "./lib";

const LINK_TTL_MS = 7 * 24 * 3600 * 1000;

// Pick the team with the fewest members. People from the same party avoid teams already used by that party.
export async function pickTeam(env: Env, partyId?: string | null): Promise<number> {
  const { results: counts } = await env.DB.prepare(
    `SELECT t.id, (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS n FROM teams t ORDER BY t.id`,
  ).all<{ id: number; n: number }>();
  let used = new Set<number>();
  if (partyId) {
    const { results } = await env.DB.prepare("SELECT DISTINCT team_id FROM users WHERE party_id = ? AND team_id IS NOT NULL")
      .bind(partyId)
      .all<{ team_id: number }>();
    used = new Set(results.map((r) => r.team_id));
  }
  let pool = counts.filter((t) => !used.has(t.id));
  if (pool.length === 0) pool = counts;
  pool.sort((a, b) => a.n - b.n || a.id - b.id);
  return pool[0].id;
}

export async function newLoginLink(env: Env, userId: number, origin: string) {
  await env.DB.prepare("UPDATE login_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(now(), userId)
    .run();
  const token = randomToken(16);
  await env.DB.prepare("INSERT INTO login_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(userId, await sha256(token), now() + LINK_TTL_MS, now())
    .run();
  return `${origin}/s/${token}`;
}

export interface NewUserInput {
  name: string;
  role?: User["role"];
  teamId?: number | null;
  partyId?: string | null;
  username?: string;
  password?: string;
}

export async function createUser(env: Env, input: NewUserInput, origin?: string) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new HttpError(400, "Name is required");
  const role = input.role ?? "participant";
  const teamId = input.teamId ?? (await pickTeam(env, input.partyId));
  const password = input.password ?? generatePassword();
  const salt = randomToken(8);
  const hash = await hashPassword(password, salt, env.PEPPER);

  let username = input.username ?? "";
  let id = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    if (!input.username) username = `${slugifyName(name)}${Math.floor(10 + Math.random() * 90 + attempt * 100)}`;
    try {
      const res = await env.DB.prepare(
        `INSERT INTO users (username, display_name, role, team_id, pass_salt, pass_hash, party_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(username, name, role, teamId, salt, hash, input.partyId ?? null, now())
        .run();
      id = res.meta.last_row_id as number;
      break;
    } catch (e) {
      if (input.username || !String(e).includes("UNIQUE")) throw new HttpError(409, "That username is taken");
    }
  }
  if (!id) throw new HttpError(409, "Could not create a unique username, try again");

  const link = origin ? await newLoginLink(env, id, origin) : null;
  const user: User = { id, username, display_name: name, role, team_id: teamId, checked_in: 0 };
  return { user, password, link };
}
