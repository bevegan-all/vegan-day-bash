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

// ---- Shark Tank: turn by turn
const shark = g("shark-tank");
await admin.req("/admin/settings", { shark_prep_seconds: 5, shark_pitch_seconds: 4, shark_vote_seconds: 30 }, "PUT");
r = await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 1], [2, 3]] });
ok(r.status === 400, "invalid matchups rejected");
r = await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 3], [2, 4]] });
ok(r.status === 200, "admin chooses Cow v Goat and Chicken v Pig");
r = await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 4], [2, 3]] });
ok(r.status === 200, "matchups can be changed before anything starts");
await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 3], [2, 4]] });
d = (await admin.req(`/admin/games/${shark.id}`)).j;
ok(d.matches.length === 2 && d.matches[0].teamA === 1 && d.matches[0].teamB === 3 && d.matches[1].teamA === 2 && d.matches[1].teamB === 4, "bracket has the chosen pairs");
ok(d.timers.prep === 5 && d.timers.vote === 30 && typeof d.serverNow === "number", "game detail has timers and the server clock");
const sm = d.matches[0]; // Cow v Goat
const cowU = users.filter((u) => u.team === 1), goatU = users.filter((u) => u.team === 3), chickU = users.filter((u) => u.team === 2), pigU = users.filter((u) => u.team === 4);

ok((await others0Pulse()).shark === null, "no Shark Tank turn is shown before a round starts");
async function others0Pulse() { return (await users[0].c.req("/pulse")).j; }

r = await admin.req(`/admin/matches/${sm.id}/start-round`, { firstTeam: 2 });
ok(r.status === 400, "first team must be in the match");
r = await admin.req(`/admin/matches/${sm.id}/start-round`, { firstTeam: 3 });
ok(r.status === 200, "round started with Goat pitching first");
r = await admin.req(`/admin/matches/${sm.id}/start-round`, { firstTeam: 3 });
ok(r.status === 409, "a round can only be started once");
r = await admin.req(`/admin/games/${shark.id}/bracket`, { pairs: [[1, 2], [3, 4]] });
ok(r.status === 409, "matchups locked once the round has started");
d = (await admin.req(`/admin/games/${shark.id}`)).j;
let pitches = d.matches[0].pitches;
const goatP = pitches.find((p) => p.teamId === 3), cowP = pitches.find((p) => p.teamId === 1);
ok(goatP.ord === 1 && cowP.ord === 2 && goatP.phase === "idle", "Goat is first, Cow second, both waiting");

// second team cannot start before the first has finished
r = await admin.req(`/admin/pitches/${cowP.id}/phase`, { phase: "prep" });
ok(r.status === 409, "the second team can't start before the first has finished");
// phases must go in order
r = await admin.req(`/admin/pitches/${goatP.id}/phase`, { phase: "voting" });
ok(r.status === 409, "can't skip straight to voting");

// what players see
let pl = (await goatU[0].c.req("/pulse")).j;
ok(pl.shark && pl.shark.teamId === 3 && pl.shark.phase === "idle" && pl.shark.youPitching === true, "pitching team sees it is their turn (waiting)");
r = await admin.req(`/admin/pitches/${goatP.id}/phase`, { phase: "prep" });
ok(r.status === 200 && r.j.endsAt > Date.now() + 3000, "preparation started with a server-side end time");
pl = (await cowU[0].c.req("/pulse")).j;
ok(pl.shark.phase === "prep" && pl.shark.youPitching === false && pl.shark.endsAt > pl.serverNow, "other team sees Goat is preparing, with a countdown");
r = await cowU[0].c.req(`/pitches/${goatP.id}/vote`, { rating: 9 });
ok(r.status === 409, "can't vote during preparation");
await admin.req(`/admin/pitches/${goatP.id}/phase`, { phase: "pitching" });
pl = (await chickU[0].c.req("/pulse")).j;
ok(pl.shark.phase === "pitching", "everyone sees the pitching phase");

// voting
r = await admin.req(`/admin/pitches/${goatP.id}/phase`, { phase: "voting" });
ok(r.status === 200, "voting opened");
let goatVotes = 0, others = [];
for (const u of users) {
  r = await u.c.req(`/pitches/${goatP.id}/vote`, { rating: u.team === 1 ? 8 : 6 });
  if (u.team === 3) { ok(r.status === 403, "Goat member blocked from rating the Goat pitch"); goatVotes++; }
  else others.push(u);
}
r = await others[0].c.req(`/pitches/${goatP.id}/vote`, { rating: 11 });
ok(r.status === 400, "rating 11 rejected");
await cowU[0].c.req(`/pitches/${goatP.id}/vote`, { rating: 10 }); // changes an earlier vote
pl = (await cowU[0].c.req("/pulse")).j;
ok(pl.shark.phase === "voting" && pl.shark.canVote === true && pl.shark.myRating === 10, "voter sees voting open with their own rating");
pl = (await goatU[0].c.req("/pulse")).j;
ok(pl.shark.phase === "voting" && pl.shark.canVote === false && pl.shark.youPitching === true, "pitching team sees voting but can't vote");
r = await admin.req(`/admin/pitches/${cowP.id}/phase`, { phase: "prep" });
ok(r.status === 409, "second team still blocked while the first is being rated");
r = await admin.req(`/admin/pitches/${goatP.id}/close`, {});
const eligible = others.length;
ok(r.status === 200 && r.j.votes === eligible && r.j.winner === null, `Goat saved with ${r.j.votes} votes; round waits for Cow`);
const goatAvg = r.j.avg;
console.log("Goat avg:", goatAvg);
r = await cowU[0].c.req(`/pitches/${goatP.id}/vote`, { rating: 5 });
ok(r.status === 409, "no voting after the result is saved");

// second pitch: Cow, with a short voting time to test the closing grace
pl = (await goatU[0].c.req("/pulse")).j;
ok(pl.shark.teamId === 1 && pl.shark.phase === "idle", "now it is Cow's turn (waiting)");
for (const ph of ["prep", "pitching", "voting"]) {
  r = await admin.req(`/admin/pitches/${cowP.id}/phase`, { phase: ph });
  if (r.status !== 200) ok(false, "cow phase " + ph);
}
for (const u of users) {
  if (u.team !== 1) await u.c.req(`/pitches/${cowP.id}/vote`, { rating: u.team === 3 ? 9 : 7 });
}
r = await cowU[0].c.req(`/pitches/${cowP.id}/vote`, { rating: 9 });
ok(r.status === 403, "Cow member blocked from rating the Cow pitch");
r = await admin.req(`/admin/pitches/${cowP.id}/close`, {});
ok(r.status === 200 && r.j.winner !== null, `round decided automatically (winner team ${r.j.winner})`);
const cowAvg = r.j.avg;
console.log("Cow avg:", cowAvg);
const expectedWinner = cowAvg > goatAvg ? 1 : 3;
ok(r.j.winner === expectedWinner, "the higher average advanced");
d = (await admin.req(`/admin/games/${shark.id}`)).j;
ok(d.matches[0].status === "done" && d.matches[0].winnerTeam === expectedWinner, "round marked done with the winner");
pl = (await goatU[0].c.req("/pulse")).j;
ok(pl.shark === null, "no turn in progress after the round");
tb = (await users[0].c.req("/leaderboard/teams")).j.teams;
ok(Math.abs(tb.find((t) => t.teamId === 1).total - (8 + Math.round(cowAvg * 10) / 10)) < 0.01, "Cow has meme points plus its Shark Tank score");

// restart a turn: reset the second round's first team after a mistake
const sm2 = d.matches[1]; // Chicken v Pig
await admin.req(`/admin/matches/${sm2.id}/start-round`, { firstTeam: 4 });
d = (await admin.req(`/admin/games/${shark.id}`)).j;
const pigP = d.matches[1].pitches.find((p) => p.teamId === 4);
await admin.req(`/admin/pitches/${pigP.id}/phase`, { phase: "prep" });
r = await admin.req(`/admin/pitches/${pigP.id}/reset`, {});
ok(r.status === 200, "a turn can be restarted");
d = (await admin.req(`/admin/games/${shark.id}`)).j;
ok(d.matches[1].pitches.find((p) => p.teamId === 4).phase === "idle", "restarted turn is waiting again");

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

// ---- one-time sign-in code (moves a sign-in into the installed app)
const hand = await users[3].c.req("/auth/handoff", {});
ok(hand.status === 200 && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(hand.j.code), "signed-in person can get a sign-in code");
const fresh = new Client();
r = await fresh.req("/auth/handoff/redeem", { code: hand.j.code.toLowerCase().replace("-", " ") });
ok(r.status === 200, "code works in a new browser (case and spacing ignored)");
const meNew = await fresh.req("/me");
ok(meNew.j.user && meNew.j.user.id === users[3].id, "the new browser is signed in as the same person");
r = await new Client().req("/auth/handoff/redeem", { code: hand.j.code });
ok(r.status === 404, "a code works only once");
r = await new Client().req("/auth/handoff/redeem", { code: "ZZZZ-ZZZZ" });
ok(r.status === 404, "a wrong code is rejected");
r = await new Client().req("/auth/handoff", {});
ok(r.status === 401, "signed-out people can't make codes");
const man = await fetch(B + "/manifest.webmanifest");
const mj = await man.json();
ok(man.ok && mj.display === "standalone" && mj.icons.length >= 3, "install manifest is served");
for (const ic of mj.icons) {
  const ir = await fetch(B + ic.src);
  ok(ir.ok && ir.headers.get("content-type").includes("png"), "icon loads: " + ic.src);
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
