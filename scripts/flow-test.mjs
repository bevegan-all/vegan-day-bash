const B = process.env.BASE ?? "http://127.0.0.1:5173";
let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

class Client {
  cookie = "";
  async req(path, body, method) {
    const res = await fetch(B + "/api" + path, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const j = await res.json().catch(() => ({}));
    return { status: res.status, j };
  }
}

const admin = new Client();
let r = await admin.req("/auth/login", { username: "admin", password: "admin123" });
ok(r.status === 200, "admin login");

// 12 participants
const users = [];
for (let i = 1; i <= 12; i++) {
  const c = await admin.req("/admin/users", { name: `Tester${i} Person` });
  const tok = c.j.link.split("/s/")[1];
  const pc = new Client();
  const info = await pc.req(`/auth/link/${tok}`);
  ok(info.status === 200, `link info ${i}`);
  const used = await pc.req("/auth/link", { token: tok });
  if (used.status !== 200) ok(false, "link sign-in " + i);
  const me = await pc.req("/me");
  users.push({ id: c.j.id, team: c.j.team.id, c: pc, me: me.j.user });
}
ok(users.every((u) => u.me?.team?.id === u.team), "all participants signed in via link with right team");
const counts = [1, 2, 3, 4].map((t) => users.filter((u) => u.team === t).length);
console.log("team counts (12 testers):", counts);

const bad = await new Client().req("/auth/link/00000000000000000000000000000000");
ok(bad.status === 404, "invalid link rejected");
r = await users[0].c.req("/admin/users");
ok(r.status === 403, "participant blocked from admin API");
r = await users[0].c.req("/admin/users", { name: "x" });
ok(r.status === 403, "participant blocked from creating users");

const games = (await admin.req("/games")).j.games;
const g = (slug) => games.find((x) => x.slug === slug);

// ---- Meme Charades
const meme = g("meme-charades");
r = await admin.req(`/admin/games/${meme.id}/bracket`, {});
ok(r.status === 200, "meme bracket created");
let d = (await admin.req(`/admin/games/${meme.id}`)).j;
const [s1, s2] = d.matches;
ok(s1.teamA === 1 && s1.teamB === 2 && s2.teamA === 3 && s2.teamB === 4, "semis are Cow v Chicken, Goat v Pig");
for (let round = 1; round <= 5; round++) {
  await admin.req(`/admin/matches/${s1.id}/rounds`, { round, scores: { 1: 2, 2: 1 } });
  await admin.req(`/admin/matches/${s2.id}/rounds`, { round, scores: { 3: 1, 4: 1 } });
}
r = await admin.req(`/admin/matches/${s2.id}/finish`, {});
ok(r.status === 409 && /tie/i.test(r.j.error), "tie blocks finish");
await admin.req(`/admin/matches/${s2.id}/rounds`, { round: 6, scores: { 3: 0, 4: 1 } });
r = await admin.req(`/admin/matches/${s1.id}/finish`, {});
ok(r.status === 200 && r.j.winner === 1, "semi1 won by Cow");
r = await admin.req(`/admin/matches/${s2.id}/finish`, {});
ok(r.status === 200 && r.j.winner === 4, "semi2 won by Pig after sudden death");
d = (await admin.req(`/admin/games/${meme.id}`)).j;
const fin = d.matches.find((m) => m.stage === "final");
ok(fin && fin.teamA === 1 && fin.teamB === 4, "final auto-created Cow v Pig");
await admin.req(`/admin/matches/${fin.id}/rounds`, { round: 1, scores: { 1: 3, 4: 5 } });
r = await admin.req(`/admin/matches/${fin.id}/finish`, {});
ok(r.j.winner === 4, "final won by Pig");
let tb = (await users[0].c.req("/leaderboard/teams")).j.teams;
const pts = Object.fromEntries(tb.map((t) => [t.teamId, t.total]));
console.log("points after meme:", pts);
ok(pts[1] === 8 && pts[4] === 15 && pts[2] === 0 && pts[3] === 0, "meme points: Cow 5+3, Pig 5+10");
// idempotent re-finish
await admin.req(`/admin/matches/${fin.id}/finish`, {});
tb = (await users[0].c.req("/leaderboard/teams")).j.teams;
ok(tb.find((t) => t.teamId === 4).total === 15, "re-finishing does not double points");

// ---- Shark Tank
const shark = g("shark-tank");
r = await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 1], [2, 3]] });
ok(r.status === 400, "invalid matchups rejected");
r = await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 3], [2, 4]] });
ok(r.status === 200, "admin chooses Cow v Goat and Chicken v Pig");
r = await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 4], [2, 3]] });
ok(r.status === 200, "matchups can be changed before anything starts");
r = await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 3], [2, 4]] });
d = (await admin.req(`/admin/games/${shark.id}`)).j;
ok(d.matches.length === 2 && d.matches[0].teamA === 1 && d.matches[0].teamB === 3 && d.matches[1].teamA === 2 && d.matches[1].teamB === 4, "bracket has the chosen pairs");
const sm = d.matches[0]; // Cow v Goat
r = await admin.req(`/admin/matches/${sm.id}/pitches`, {});
ok(r.status === 200, "shark items drawn");
r = await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 2], [3, 4]] });
ok(r.status === 409, "matchups locked once pitches are drawn");
d = (await admin.req(`/admin/games/${shark.id}`)).j;
const pitch = d.matches[0].pitches.find((p) => p.teamId === 1); // Cow pitching
r = await users[0].c.req(`/pitches/${pitch.id}/vote`, { rating: 8 });
ok(r.status === 409, "can't vote before voting opens");
await admin.req(`/admin/pitches/${pitch.id}/open`, {});
let cowVotes = 0, others = [];
for (const u of users) {
  r = await u.c.req(`/pitches/${pitch.id}/vote`, { rating: u.team === 2 ? 10 : 6 });
  if (u.team === 1) { ok(r.status === 403, "Cow member blocked from rating Cow pitch"); cowVotes++; }
  else others.push(u);
}
r = await others[0].c.req(`/pitches/${pitch.id}/vote`, { rating: 11 });
ok(r.status === 400, "rating 11 rejected");
// change a vote
const chick = users.find((u) => u.team === 2);
await chick.c.req(`/pitches/${pitch.id}/vote`, { rating: 4 });
const h = await others[0].c.req("/pulse");
ok(h.j.voting && h.j.voting.id === pitch.id && h.j.voting.canVote === true, "pulse shows the open rating");
r = await admin.req(`/admin/pitches/${pitch.id}/close`, {});
const expectVotes = others.length;
ok(r.status === 200 && r.j.votes === expectVotes, `closed with ${r.j.votes} eligible votes (expected ${expectVotes})`);
console.log("avg:", r.j.avg);
r = await users[0].c.req(`/pitches/${pitch.id}/vote`, { rating: 5 });
ok(r.status === 409 || r.status === 403, "no voting after close");

// ---- individual games
const cup = g("cup-flip-tic-tac-toe");
r = await admin.req(`/admin/games/${cup.id}/results`, { winnerId: users[0].id, loserId: users[1].id, idem: "m1" });
ok(r.status === 200, "match recorded");
r = await admin.req(`/admin/games/${cup.id}/results`, { winnerId: users[0].id, loserId: users[1].id, idem: "m1" });
ok(r.j.duplicate === true, "duplicate match (same idem) ignored");
await admin.req(`/admin/games/${cup.id}/results`, { winnerId: users[0].id, loserId: users[2].id });
await admin.req(`/admin/games/${cup.id}/results`, { winnerId: users[2].id, loserId: users[1].id });
const colour = g("colour-blind");
for (let i = 0; i < 12; i++) await admin.req(`/admin/games/${colour.id}/results`, { userId: users[i].id, value: i % 5 });
const sq = g("stay-in-the-square");
await admin.req(`/admin/games/${sq.id}/results`, { userId: users[3].id, value: 41.5 });
const pd = g("paper-dance");
await admin.req(`/admin/games/${pd.id}/results`, { userId: users[5].id, value: 1 });
await admin.req(`/admin/games/${pd.id}/results`, { userId: users[6].id, value: 2 });
r = await admin.req(`/admin/games/${pd.id}/results`, { userId: users[6].id, value: 0 });
ok(r.status === 400, "placement 0 rejected");

let lb = (await users[0].c.req(`/leaderboard/individual?game=${cup.id}`)).j;
console.log("cup board:", lb.top.map((x) => `${x.rank}.${x.name} ${x.detail}`).join(" | "));
ok(lb.top[0].name.startsWith("Tester1 P") && lb.top[0].detail === "2W 0L", "cup flip leader is user 1 with 2W");
ok(lb.me && lb.me.rank === 1, "me rank shown for leader");
lb = (await users[1].c.req(`/leaderboard/individual?game=${cup.id}`)).j;
ok(lb.me && lb.me.rank === 3, "user 2 sees own rank 3 (0W 2L)");
const all = (await users[11].c.req("/leaderboard/individual?game=all")).j;
ok(all.top.length === 10 && all.count >= 11, `overall board caps at 10 (count ${all.count})`);
ok(all.me && typeof all.me.rank === "number", `participant outside top 10 sees own rank (#${all.me?.rank})`);
console.log("overall:", all.top.slice(0, 4).map((x) => `${x.rank}.${x.name} ${x.value}pts`).join(" | "));

// void a result
const rec = (await admin.req(`/admin/games/${cup.id}`)).j.recent;
await admin.req(`/admin/results/${rec[0].id}`, undefined, "DELETE");
const rec2 = (await admin.req(`/admin/games/${cup.id}`)).j.recent;
ok(rec2.length === rec.length - 2, "voiding a match removes both sides");

// ---- Green Light Red Light: location, roster, alerts, finish times
const gr = g("green-light-red-light");
ok(gr.location === "Terrace", "default location is Terrace");
r = await admin.req(`/admin/games/${gr.id}`, { location: "Hall" }, "PATCH");
ok(r.status === 200, "admin can change location");
r = await users[0].c.req(`/admin/games/${gr.id}`, { location: "Roof" }, "PATCH");
ok(r.status === 403, "participant cannot change location");
r = await admin.req(`/admin/games/${gr.id}`, { location: "Terrace" }, "PATCH");

const teamsBefore = Object.fromEntries((await users[0].c.req("/leaderboard/teams")).j.teams.map((t) => [t.teamId, t.total]));
r = await admin.req(`/admin/games/${gr.id}/players`, { scope: "all" });
ok(r.status === 200 && r.j.added > 0 && r.j.added === r.j.total, `added everyone to the roster (${r.j.added})`);
const addedAll = r.j.added;
r = await admin.req(`/admin/games/${gr.id}/players`, { scope: "all" });
ok(r.j.added === 0, "adding everyone again adds nobody");
let pulse = (await users[0].c.req("/pulse")).j;
ok(pulse.notifications.length === 1 && /in:/i.test(pulse.notifications[0].title) && /Terrace/.test(pulse.notifications[0].body), "player got exactly one 'you are in' alert mentioning the location");
let det = (await users[0].c.req(`/games/${gr.id}`)).j;
ok(det.greenred.youIn === true && det.greenred.count === addedAll, "player sees they are in the game");
ok(!/Tester1 Person/.test(JSON.stringify(det.greenred.roster)) && /Tester1 P\./.test(JSON.stringify(det.greenred.roster)), "participants see short names only");
const list = (await users[0].c.req("/games")).j.games.find((x) => x.id === gr.id);
ok(list.youIn === true && list.location === "Terrace", "games list shows youIn and location");

// remove one player
r = await admin.req(`/admin/games/${gr.id}/players/${users[11].id}`, undefined, "DELETE");
ok(r.status === 200, "player removed");
pulse = (await users[11].c.req("/pulse")).j;
ok(pulse.notifications.some((n) => /Removed/.test(n.title)), "removed player got an alert");
det = (await users[11].c.req(`/games/${gr.id}`)).j;
ok(det.greenred.youIn === false, "removed player no longer 'in'");

// alerts can be marked read
await users[0].c.req("/notifications/read", {});
pulse = (await users[0].c.req("/pulse")).j;
ok(pulse.notifications.length === 0, "alerts marked read");
const hist = (await users[0].c.req("/notifications")).j.notifications;
ok(hist.length === 1 && hist[0].readAt, "alert history kept");

// finish times
const times = [[users[0], 14.2], [users[1], 11.5], [users[2], 12.8], [users[3], 13.1], [users[4], 20]];
for (const [u, s] of times) {
  r = await admin.req(`/admin/games/${gr.id}/finish`, { userId: u.id, seconds: s });
  if (r.status !== 200) ok(false, "finish " + s);
}
r = await admin.req(`/admin/games/${gr.id}/finish`, { userId: users[5].id, seconds: 0 });
ok(r.status === 400, "zero time rejected");
r = await admin.req(`/admin/games/${gr.id}/finish`, { userId: users[5].id, seconds: "abc" });
ok(r.status === 400, "non-number time rejected");
det = (await admin.req(`/admin/games/${gr.id}`)).j;
const order = det.greenred.finishers.map((f) => f.userId);
ok(JSON.stringify(order) === JSON.stringify([users[1].id, users[2].id, users[3].id, users[0].id, users[4].id]), "finishers ordered fastest first (podium = top 3)");
ok(det.greenred.finishers[0].seconds === 11.5 && det.greenred.finishers[0].rank === 1, "winner has the fastest time");

const expectDelta = (finishers) => {
  const d = {};
  finishers.forEach((f, i) => { d[f.team] = (d[f.team] ?? 0) + (i === 0 ? 10 : 1); });
  return d;
};
const teamOf = (id) => users.find((u) => u.id === id).team;
const checkPoints = async (finishers, label) => {
  const now = Object.fromEntries((await users[0].c.req("/leaderboard/teams")).j.teams.map((t) => [t.teamId, t.total]));
  const exp = expectDelta(finishers);
  const good = [1, 2, 3, 4].every((t) => Math.abs((now[t] - teamsBefore[t]) - (exp[t] ?? 0)) < 0.01);
  ok(good, label);
};
await checkPoints(det.greenred.finishers.map((f) => ({ team: teamOf(f.userId) })), "team points: winner team +10, other finishers +1 each");

// re-record the winner with a slower time: someone else wins, no double counting
await admin.req(`/admin/games/${gr.id}/finish`, { userId: users[1].id, seconds: 15 });
det = (await admin.req(`/admin/games/${gr.id}`)).j;
ok(det.greenred.finishers[0].userId === users[2].id && det.greenred.finishers.length === 5, "re-recording replaces the time and changes the winner");
await checkPoints(det.greenred.finishers.map((f) => ({ team: teamOf(f.userId) })), "points recomputed after re-recording");

// void the winner's time
r = await admin.req(`/admin/results/${det.greenred.finishers[0].resultId}`, undefined, "DELETE");
det = (await admin.req(`/admin/games/${gr.id}`)).j;
ok(det.greenred.finishers.length === 4, "removing a time works");
await checkPoints(det.greenred.finishers.map((f) => ({ team: teamOf(f.userId) })), "points recomputed after removing a time");

// someone who finishes without being added is added silently
const before = (await users[11].c.req("/pulse")).j.notifications.length;
await admin.req(`/admin/games/${gr.id}/finish`, { userId: users[11].id, seconds: 30 });
const after = (await users[11].c.req("/pulse")).j.notifications.length;
ok(after === before, "finisher added to roster without a new alert");

const gl = (await users[0].c.req("/pulse")).j;
ok(Array.isArray(gl.live), "pulse works");

// ---- screen
const key = (await admin.req("/admin/screen-key")).j.url.split("key=")[1];
r = await new Client().req(`/screen?key=${key}`);
ok(r.status === 200 && r.j.teams.length === 4, "public screen works with key");
r = await new Client().req(`/screen?key=wrong`);
ok(r.status === 403, "screen rejects wrong key");

// origin check
const res = await fetch(B + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
ok(res.status === 403, "cross-origin POST blocked");

// QR identity
const q = await users[0].c.req("/me/qr");
const look = await admin.req(`/admin/lookup?code=${encodeURIComponent(q.j.code)}`);
ok(look.status === 200 && look.j.id === users[0].id, "identity QR lookup works");
const forged = await admin.req(`/admin/lookup?code=${encodeURIComponent("VDB1." + users[0].id + ".0000000000000000")}`);
ok(forged.status === 404, "forged QR rejected");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
