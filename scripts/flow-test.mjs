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

// ---- Meme Charades: turn by turn
const meme = g("meme-charades");
const turnApi = (id, action, body) => admin.req(`/admin/meme-turns/${id}/${action}`, body ?? {});
const P = "point", F = "fail";
const detailOf = async (matchId) => (await admin.req(`/admin/games/${meme.id}`)).j.matches.find((x) => x.id === matchId);
// plays every turn of a match that is not finished yet, in order; returns the last result response
async function playOut(matchId, outcomes) {
  let last;
  const m = await detailOf(matchId);
  for (const [i, turn] of m.turns.entries()) {
    if (turn.phase === "done") continue;
    if (turn.phase === "idle") await turnApi(turn.id, "start");
    last = await turnApi(turn.id, "result", { result: outcomes[i] });
  }
  return last;
}

r = await admin.req(`/admin/games/${meme.id}/bracket`, {});
ok(r.status === 200, "meme bracket created");
let d = (await admin.req(`/admin/games/${meme.id}`)).j;
const [s1, s2] = d.matches;
ok(s1.teamA === 1 && s1.teamB === 2 && s2.teamA === 3 && s2.teamB === 4, "semis are Cow v Chicken, Goat v Pig");
ok(d.meme.act === 60 && d.meme.perTeam === 5 && d.meme.count === 16, "game detail has the meme settings");

r = await admin.req(`/admin/matches/${s1.id}/start-round`, { firstTeam: 3 });
ok(r.status === 400, "first team must be in the match");
r = await admin.req(`/admin/matches/${s1.id}/start-round`, { firstTeam: 1 });
ok(r.status === 200, "round started with Cow going first");
r = await admin.req(`/admin/matches/${s1.id}/start-round`, { firstTeam: 1 });
ok(r.status === 409, "a round can only be started once");
r = await admin.req(`/admin/games/${meme.id}/bracket`, { pairs: [[1, 3], [2, 4]] });
ok(r.status === 409, "matchups locked once a round has started");

let m1 = await detailOf(s1.id);
ok(m1.turns.length === 10 && m1.turns.every((x, i) => x.ord === i + 1 && x.teamId === (i % 2 === 0 ? 1 : 2)), "10 turns, 5 each, taken alternately starting with Cow");
let pu = (await users[0].c.req("/pulse")).j;
ok(pu.meme && pu.meme.phase === "idle" && pu.meme.teamId === 1 && pu.meme.ord === 1 && pu.meme.total === 10, "players see Cow is up next (turn 1 of 10)");

// turn order is enforced
r = await turnApi(m1.turns[1].id, "start");
ok(r.status === 409, "turn 2 can't start before turn 1 is done");
r = await turnApi(m1.turns[0].id, "result", { result: P });
ok(r.status === 409, "can't give a result before the turn has started");

// start turn 1 with a meme number and an acting player
const actor = users.find((u) => u.team === 1);
r = await turnApi(m1.turns[0].id, "start", { meme: "7", playerIds: [actor.id] });
ok(r.status === 200 && r.j.endsAt > Date.now() + 50000, "turn started with a 60 second server clock");
pu = (await users[1].c.req("/pulse")).j;
ok(pu.meme.phase === "acting" && pu.meme.endsAt > pu.serverNow && pu.meme.players.length === 1, "everyone sees the turn is being acted, with the clock and the acting player");
ok(pu.meme.youActing === (users[1].team === 1), "players know whether it's their team's turn");
ok(!JSON.stringify(pu).includes('"7"') && !JSON.stringify(pu).includes("meme\":\"7"), "the meme number is not in what players receive");
const playerView = (await users[1].c.req(`/games/${meme.id}`)).j;
ok(!JSON.stringify(playerView).includes('"meme":"7"'), "the meme number is not in the game page for players");
const organiserView = await detailOf(s1.id);
ok(organiserView.turns[0].meme === "7", "organisers can see the meme number");
r = await turnApi(m1.turns[0].id, "result", { result: "maybe" });
ok(r.status === 400, "a result must be point or fail");

// a turn can be restarted
r = await turnApi(m1.turns[0].id, "reset");
ok(r.status === 200, "an acting turn can be restarted");
m1 = await detailOf(s1.id);
ok(m1.turns[0].phase === "idle" && m1.turns[0].meme === null, "restarted turn is waiting again");

// ---- several organisers working on the same turn at the same time
{
  const mkOrg = async (name) => {
    const made = await admin.req("/admin/users", { name, role: "organiser" });
    const cl = new Client();
    await cl.req("/auth/login", { username: made.j.username, password: made.j.password });
    return cl;
  };
  const [orgA, orgB, orgC] = [await mkOrg("Organiser A"), await mkOrg("Organiser B"), await mkOrg("Organiser C")];
  const turnId = m1.turns[0].id;
  const add = (org, u) => org.req(`/admin/meme-turns/${turnId}/players`, { userId: u.id });
  const seen = async (org) => (await org.req(`/admin/games/${meme.id}`)).j.matches.find((x) => x.id === s1.id).turns[0].players.length;

  let rs = await Promise.all([add(orgA, users[0]), add(orgB, users[1]), add(orgC, users[2])]);
  ok(rs.every((x) => x.status === 200), "3 organisers add 3 different players at the same moment: all 3 saved");
  const counts = await Promise.all([orgA, orgB, orgC, admin].map(seen));
  ok(counts.every((n) => n === 3), "every organiser sees all 3 players (" + counts.join(", ") + ")");
  const watcher = (await users[5].c.req("/pulse")).j;
  ok(watcher.meme && watcher.meme.players.length === 3, "players' phones show the 3 acting players before the turn even starts");

  rs = await Promise.all([add(orgA, users[0]), add(orgB, users[0]), add(orgC, users[0])]);
  ok(rs.every((x) => x.status === 200) && (await seen(admin)) === 3, "the same player added by 3 organisers at once is stored once");
  r = await add(orgA, users[3]);
  ok(r.status === 409, "a 4th player is refused (3 is the limit)");

  r = await orgB.req(`/admin/meme-turns/${turnId}/players/${users[1].id}`, undefined, "DELETE");
  ok(r.status === 200 && (await seen(orgC)) === 2, "one organiser removes a player and the others see 2");

  // 4 organisers race for the one free place
  rs = await Promise.all([add(orgA, users[3]), add(orgB, users[4]), add(orgC, users[5]), add(admin, users[6])]);
  const won = rs.filter((x) => x.status === 200).length, refused = rs.filter((x) => x.status === 409).length;
  ok(won === 1 && refused === 3 && (await seen(admin)) === 3, `4 organisers race for 1 free place: ${won} got it, ${refused} were told it is full`);

  // starting without any extra input works, the clock is 1 minute, and the players stay on the turn
  const startedAt = Date.now();
  r = await turnApi(turnId, "start");
  ok(r.status === 200 && Math.abs(r.j.endsAt - startedAt - 60000) < 3000, `the acting clock is 1 minute (ends in ${Math.round((r.j.endsAt - startedAt) / 1000)}s)`);
  r = await turnApi(turnId, "start");
  ok(r.status === 409, "pressing Start twice only starts the turn once");
  ok((await seen(admin)) === 3, "the players are kept when the turn starts");

  // two organisers tap Point and Fail together: only the first counts
  rs = await Promise.all([orgA.req(`/admin/meme-turns/${turnId}/result`, { result: "point" }), orgB.req(`/admin/meme-turns/${turnId}/result`, { result: "fail" })]);
  const okCount = rs.filter((x) => x.status === 200).length;
  ok(okCount === 1 && rs.filter((x) => x.status === 409).length === 1, "Point and Fail pressed together by two organisers: exactly one is counted");
  r = await turnApi(turnId, "reset");
  ok(r.status === 200 && (await seen(admin)) === 0, "restarting a turn also clears its players");

  // a turn with no players at all is fine
  r = await turnApi(turnId, "start", { meme: "2" });
  ok(r.status === 200 && (await seen(admin)) === 0, "adding players is optional: a turn starts with none");
  r = await turnApi(turnId, "reset");
}

// play the whole match: Cow scores 4, Chicken 2
r = await playOut(s1.id, [P, F, P, P, P, F, F, P, P, F]);
ok(r.status === 200 && r.j.winner === 1, "Cow wins semi 1 automatically (4 to 2)");
m1 = await detailOf(s1.id);
ok(m1.status === "done" && m1.totals[1] === 4 && m1.totals[2] === 2, "scores are 4 to 2");
r = await turnApi(m1.turns[0].id, "reset");
ok(r.status === 409, "a finished round can't be changed");

// semi 2 ends level: the organiser chooses who moves forward
r = await admin.req(`/admin/matches/${s2.id}/start-round`, { firstTeam: 3 });
r = await playOut(s2.id, [P, P, P, P, P, P, F, F, F, F]);
ok(r.status === 200 && r.j.tie === true && r.j.winner === null, "level scores: no winner is chosen automatically");
r = await admin.req(`/admin/matches/${s2.id}/finish`, {});
ok(r.status === 409 && /tie/i.test(r.j.error), "finishing a tied match without choosing is refused");
r = await users[0].c.req(`/admin/matches/${s2.id}/finish`, { winnerTeam: 4 });
ok(r.status === 403, "players can't choose the winner");
r = await admin.req(`/admin/matches/${s2.id}/finish`, { winnerTeam: 1 });
ok(r.status === 409, "the winner must be one of the two teams");
r = await admin.req(`/admin/matches/${s2.id}/finish`, { winnerTeam: 4 });
ok(r.status === 200 && r.j.winner === 4, "organiser chose Pig to move forward");

// the final works the same way
d = (await admin.req(`/admin/games/${meme.id}`)).j;
const fin = d.matches.find((m) => m.stage === "final");
ok(fin && fin.teamA === 1 && fin.teamB === 4, "final auto-created Cow v Pig");
r = await admin.req(`/admin/matches/${fin.id}/start-round`, { firstTeam: 4 });
r = await playOut(fin.id, [P, P, P, F, P, P, P, F, F, F]);
ok(r.status === 200 && r.j.winner === 4, "Pig wins the final (4 to 2)");
let tb = (await users[0].c.req("/leaderboard/teams")).j.teams;
const pts = Object.fromEntries(tb.map((t) => [t.teamId, t.total]));
console.log("points after meme:", pts);
ok(pts[1] === 1 && pts[4] === 2 && pts[2] === 0 && pts[3] === 0, "meme points: Cow 1 (semi win), Pig 2 (semi win + final win)");
pu = (await users[0].c.req("/pulse")).j;
ok(pu.meme === null, "no turn in progress after the final");
r = await admin.req(`/admin/matches/${fin.id}/finish`, {});
tb = (await users[0].c.req("/leaderboard/teams")).j.teams;
ok(tb.find((t) => t.teamId === 4).total === 2, "re-finishing does not double points");

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
ok(tb.find((t) => t.teamId === 1).total === 1 + (expectedWinner === 1 ? 1 : 0), "Shark Tank: the round winner gets 1 point, the audience score adds none");

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

// a tie in the second round is decided by the organiser
{
  const m2 = (await admin.req(`/admin/games/${shark.id}`)).j.matches[1]; // Chicken v Pig
  const pigT = m2.pitches.find((p) => p.teamId === 4), chickT = m2.pitches.find((p) => p.teamId === 2);
  for (const pt of [pigT, chickT]) {
    for (const ph of ["prep", "pitching", "voting"]) await admin.req(`/admin/pitches/${pt.id}/phase`, { phase: ph });
    for (const u of users) if (u.team !== pt.teamId) await u.c.req(`/pitches/${pt.id}/vote`, { rating: 7 });
    r = await admin.req(`/admin/pitches/${pt.id}/close`, {});
  }
  ok(r.status === 200 && r.j.tie === true && r.j.winner === null, "equal averages are a tie: no winner is chosen automatically");
  r = await admin.req(`/admin/matches/${m2.id}/finish`, {});
  ok(r.status === 409 && /tie/i.test(r.j.error), "finishing a tied round without choosing is refused");
  if (process.env.STOP_AT_TIE) { console.log("stopped at the tie for a manual look"); process.exit(0); }
  r = await users[0].c.req(`/admin/matches/${m2.id}/finish`, { winnerTeam: 2 });
  ok(r.status === 403, "players can't choose the winner");
  r = await admin.req(`/admin/matches/${m2.id}/finish`, { winnerTeam: 1 });
  ok(r.status === 409, "the winner must be one of the two teams");
  r = await admin.req(`/admin/matches/${m2.id}/finish`, { winnerTeam: 2 });
  ok(r.status === 200 && r.j.winner === 2, "organiser chose Chicken to move forward");
  const dd = (await admin.req(`/admin/games/${shark.id}`)).j;
  const fin2 = dd.matches.find((x) => x.stage === "final");
  ok(fin2 && [fin2.teamA, fin2.teamB].includes(2), "the final is created with the team the organiser chose");
}

// ---- individual games
const cup = g("arm-wrestling");
r = await admin.req(`/admin/games/${cup.id}/results`, { winnerId: users[0].id, loserId: users[1].id, idem: "m1" });
ok(r.status === 200, "match recorded");
r = await admin.req(`/admin/games/${cup.id}/results`, { winnerId: users[0].id, loserId: users[1].id, idem: "m1" });
ok(r.j.duplicate === true, "duplicate match (same idem) ignored");
await admin.req(`/admin/games/${cup.id}/results`, { winnerId: users[0].id, loserId: users[2].id });
await admin.req(`/admin/games/${cup.id}/results`, { winnerId: users[2].id, loserId: users[1].id });
const scoreGame = (await admin.req("/admin/games", { name: "Test score game", resultType: "score_high" })).j;
for (let i = 0; i < 12; i++) await admin.req(`/admin/games/${scoreGame.id}/results`, { userId: users[i].id, value: i % 5 });
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

// ---- Green Light – Red Light: an individual game with one round, or heats and a final
{
const gr = g("green-light-red-light");
ok(gr.kind === "individual" && gr.type === "greenred", "Green Light – Red Light is in the individual games");
ok(gr.location === "Terrace", "default location is Terrace");
r = await admin.req(`/admin/games/${gr.id}`, { location: "Hall" }, "PATCH");
ok(r.status === 200, "admin can change location");
r = await users[0].c.req(`/admin/games/${gr.id}`, { location: "Roof" }, "PATCH");
ok(r.status === 403, "participant cannot change location");
await admin.req(`/admin/games/${gr.id}`, { location: "Terrace" }, "PATCH");

const teamsBeforeGr = Object.fromEntries((await users[0].c.req("/leaderboard/teams")).j.teams.map((x) => [x.teamId, x.total]));
const overall = async () => Object.fromEntries((await admin.req("/leaderboard/individual?game=all&full=1")).j.top.map((x) => [x.userId, x.value]));
const overallBefore = await overall();

const mkOrg2 = async (name) => {
  const made = await admin.req("/admin/users", { name, role: "organiser" });
  const cl = new Client();
  await cl.req("/auth/login", { username: made.j.username, password: made.j.password });
  return cl;
};
const [oA, oB, oC] = [await mkOrg2("Race Organiser A"), await mkOrg2("Race Organiser B"), await mkOrg2("Race Organiser C")];
const grDetail = async (who = admin) => (await who.req(`/admin/games/${gr.id}`)).j.greenred;

r = await admin.req(`/admin/games/${gr.id}/greenred/setup`, { mode: "weird" });
ok(r.status === 400, "the mode must be single or multiple rounds");
r = await users[0].c.req(`/admin/games/${gr.id}/greenred/setup`, { mode: "single" });
ok(r.status === 403, "players can't set the game up");
r = await admin.req(`/admin/games/${gr.id}/greenred/setup`, { mode: "multi", heats: 9 });
ok(r.status === 400, "at most 8 heats");
r = await admin.req(`/admin/games/${gr.id}/greenred/setup`, { mode: "multi", heats: 4 });
ok(r.status === 200, "multiple rounds chosen with 4 heats");
r = await admin.req(`/admin/games/${gr.id}/greenred/setup`, { mode: "single" });
ok(r.status === 409, "the mode can't be changed once it is set up");
let gd = await grDetail();
ok(gd.mode === "multi" && gd.heats === 4 && gd.rounds.length === 5 && gd.rounds.filter((x) => x.kind === "heat").length === 4 && gd.rounds[4].kind === "final", "4 heats and a final");
ok(JSON.stringify(gd.points) === "[3,2,1]", "the final pays 3, 2 and 1 points");
const [h1, h2, h3, h4, grFin] = gd.rounds.map((x) => x.id);
const addTo = (org, round, ids) => org.req(`/admin/gr-rounds/${round}/players`, { userIds: ids.map((i) => users[i].id) });
const inRound = async (who, round) => (await grDetail(who)).rounds.find((x) => x.id === round).entries.length;

// three organisers add players at the same moment
let rs = await Promise.all([addTo(oA, h1, [0]), addTo(oB, h1, [1]), addTo(oC, h1, [2])]);
ok(rs.every((x) => x.status === 200), "3 organisers add 3 players to Heat 1 at the same moment: all saved");
const counts = await Promise.all([oA, oB, oC, admin].map((who) => inRound(who, h1)));
ok(counts.every((n) => n === 3), "every organiser sees all 3 players (" + counts.join(", ") + ")");
rs = await Promise.all([addTo(oA, h1, [0]), addTo(oB, h1, [0]), addTo(oC, h1, [0])]);
ok(rs.every((x) => x.status === 200) && (await inRound(admin, h1)) === 3, "the same player added by 3 organisers at once is stored once");
r = await addTo(oA, h2, [0]);
ok(r.j.added === 0 && (await inRound(admin, h2)) === 0, "a player can be in only one heat");
let pl = (await users[0].c.req("/pulse")).j;
ok(pl.notifications.some((n) => /You're in/.test(n.title) && /Heat 1/.test(n.body) && /Terrace/.test(n.body)), "a player is alerted that they are in Heat 1, and where to go");
ok(pl.live.every((x) => x.id !== gr.id || x.youIn === true) && (await users[0].c.req("/games")).j.games.find((x) => x.id === gr.id).youIn === true, "the game card shows 'you're in'");

// the rest of the people, three organisers adding to different heats at once
rs = await Promise.all([addTo(oA, h1, [3]), addTo(oB, h2, [4, 5, 6]), addTo(oC, h3, [7, 8, 9]), addTo(admin, h4, [10, 11])]);
ok(rs.every((x) => x.status === 200), "organisers fill the other heats at the same time");
const sizes = await Promise.all([h1, h2, h3, h4].map((x) => inRound(admin, x)));
ok(JSON.stringify(sizes) === "[4,3,3,2]", "the heats hold 4, 3, 3 and 2 players (" + sizes.join(", ") + ")");

// times in the heats
const timeIn = (org, round, i, s) => org.req(`/admin/gr-rounds/${round}/time`, { userId: users[i].id, seconds: s });
r = await timeIn(admin, h1, 5, 10);
ok(r.status === 409, "someone from another heat can't be timed here");
for (const [round, list] of [[h1, [[0, 14.2], [1, 11.5], [2, 12.8], [3, 20]]], [h2, [[4, 10.1], [5, 9.9], [6, 15]]], [h3, [[7, 13], [8, 12.5], [9, 12]]], [h4, [[10, 18], [11, 17]]]]) {
  const org = [oA, oB, oC][round % 3];
  for (const [i, sec] of list) await timeIn(org, round, i, sec);
}
r = await admin.req(`/admin/gr-rounds/${h1}/time`, { userId: users[0].id, seconds: 0 });
ok(r.status === 400, "zero time rejected");
ok((await admin.req(`/leaderboard/individual?game=${gr.id}`)).j.count === 0, "heat times don't count for the leaderboard");
gd = await grDetail();
ok(gd.rounds[4].entries.length === 0, "nobody is in the final until heats are finished");

// finishing a heat sends its top 3 to the final
r = await admin.req(`/admin/gr-rounds/${h1}/status`, { status: "done" });
gd = await grDetail();
ok(JSON.stringify(gd.rounds[4].entries.map((x) => x.userId).sort()) === JSON.stringify([users[0].id, users[1].id, users[2].id].sort()), "Heat 1 finished: its top 3 move to the final (the 4th doesn't)");
pl = (await users[1].c.req("/pulse")).j;
ok(pl.notifications.some((n) => /made the final/.test(n.title)), "a finalist is told they made the final");
for (const h of [h2, h3, h4]) await admin.req(`/admin/gr-rounds/${h}/status`, { status: "done" });
gd = await grDetail();
ok(gd.rounds[4].entries.length === 11, "after all heats: 3 + 3 + 3 + 2 = 11 finalists");

// a corrected heat time changes who qualifies
await timeIn(admin, h1, 3, 9.0);
gd = await grDetail();
const finalIds = gd.rounds[4].entries.map((x) => x.userId);
ok(finalIds.includes(users[3].id) && !finalIds.includes(users[0].id) && finalIds.length === 11, "a corrected time moves the right people in and out of the final");

// the final: times decide the leaderboard
const finalTimes = [[5, 8.9], [3, 9.0], [9, 9.4], [1, 9.8], [4, 10], [8, 10.2], [2, 10.5], [6, 11], [7, 11.5], [11, 12], [10, 13]];
for (const [i, sec] of finalTimes) await timeIn([oA, oB, oC][i % 3], grFin, i, sec);
gd = await grDetail();
const podium = gd.rounds[4].entries.filter((x) => x.rank && x.rank <= 3).map((x) => x.userId);
ok(JSON.stringify(podium) === JSON.stringify([users[5].id, users[3].id, users[9].id]), "final podium: 1st, 2nd and 3rd are the three fastest");
let board = (await users[0].c.req(`/leaderboard/individual?game=${gr.id}`)).j;
ok(board.count === 11 && board.top[0].rank === 1 && board.top[0].value === 8.9, "the leaderboard uses the final only (11 finalists, winner 8.9 s)");
const overallAfter = await overall();
const dlt = (i) => (overallAfter[users[i].id] ?? 0) - (overallBefore[users[i].id] ?? 0);
ok(dlt(5) === 3 && dlt(3) === 2 && dlt(9) === 1 && dlt(1) === 0 && dlt(4) === 0, "points: 1st gets 3, 2nd gets 2, 3rd gets 1, everyone else 0");
r = await admin.req(`/admin/gr-rounds/${h1}/status`, { status: "live" });
ok(r.status === 409, "a heat can't be reopened once the final has times");
r = await admin.req(`/admin/gr-rounds/${grFin}/players/${users[10].id}`, undefined, "DELETE");
board = (await users[0].c.req(`/leaderboard/individual?game=${gr.id}`)).j;
ok(r.status === 200 && board.count === 10, "removing a finalist takes them off the leaderboard");

// what players see
const pv = (await users[2].c.req(`/games/${gr.id}`)).j.greenred;
ok(pv.mine.includes(h1) && pv.mine.includes(grFin) && !JSON.stringify(pv).includes("Tester1 Person"), "players see their own rounds, and short names only");
const tbAfter = Object.fromEntries((await users[0].c.req("/leaderboard/teams")).j.teams.map((x) => [x.teamId, x.total]));
ok([1, 2, 3, 4].every((id) => tbAfter[id] === teamsBeforeGr[id]), "this game gives no team points any more");

// split everyone across heats in one tap
r = await users[0].c.req(`/admin/games/${gr.id}/greenred/split`, {});
ok(r.status === 403, "players can't split");
r = await oA.req(`/admin/games/${gr.id}/greenred/reset`, {});
ok(r.status === 403, "only admins can start the game over");
r = await admin.req(`/admin/games/${gr.id}/greenred/reset`, {});
ok(r.status === 200 && (await grDetail()).rounds.length === 0, "starting over clears the rounds");
board = (await users[0].c.req(`/leaderboard/individual?game=${gr.id}`)).j;
ok(board.count === 0, "...and the leaderboard entries");
await admin.req(`/admin/games/${gr.id}/greenred/setup`, { mode: "multi", heats: 3 });
r = await admin.req(`/admin/games/${gr.id}/greenred/split`, {});
gd = await grDetail();
const heatSizes = gd.rounds.filter((x) => x.kind === "heat").map((x) => x.entries.length);
ok(r.status === 200 && heatSizes.reduce((a, b) => a + b, 0) === r.j.people && Math.max(...heatSizes) - Math.min(...heatSizes) <= 1, "everyone is shared evenly across the heats (" + heatSizes.join(", ") + ")");
r = await admin.req(`/admin/games/${gr.id}/greenred/split`, {});
ok(r.status === 409, "splitting again is refused while heats have players");

// single round mode
await admin.req(`/admin/games/${gr.id}/greenred/reset`, {});
r = await admin.req(`/admin/games/${gr.id}/greenred/setup`, { mode: "single" });
ok(r.status === 200, "single round chosen");
gd = await grDetail();
ok(gd.mode === "single" && gd.rounds.length === 1 && gd.rounds[0].kind === "final", "single mode is one round");
const one = gd.rounds[0].id;
rs = await Promise.all([addTo(oA, one, [0]), addTo(oB, one, [1]), addTo(oC, one, [2])]);
ok(rs.every((x) => x.status === 200) && (await inRound(oC, one)) === 3, "3 organisers add players to the single round at once");
await timeIn(oA, one, 0, 15);
await timeIn(oB, one, 1, 11);
await timeIn(oC, one, 2, 13);
board = (await users[0].c.req(`/leaderboard/individual?game=${gr.id}`)).j;
ok(board.count === 3 && board.top[0].value === 11 && board.top[1].value === 13 && board.top[2].value === 15, "single round: only the times are kept, fastest first");
}

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

// ---- Act It Out: rounds, a turn for every team, and a public ranking
{
  const actG = g("act-it-out");
  ok(actG.type === "actout", "Act It Out is its own game type");
  await admin.req("/admin/settings", { actout_act_seconds: 60, actout_vote_seconds: 30 }, "PUT");
  const totalsNow = async () => Object.fromEntries((await users[0].c.req("/leaderboard/teams")).j.teams.map((x) => [x.teamId, x.total]));
  const before = await totalsNow();
  const actDetail = async () => (await admin.req(`/admin/games/${actG.id}`)).j;
  const cowU2 = users.filter((u) => u.team === 1), chickU2 = users.filter((u) => u.team === 2), goatU2 = users.filter((u) => u.team === 3), pigU2 = users.filter((u) => u.team === 4);

  r = await admin.req(`/admin/games/${actG.id}/actout/start`, {});
  ok(r.status === 200, "Act It Out rounds created");
  r = await admin.req(`/admin/games/${actG.id}/actout/start`, {});
  ok(r.status === 409, "the rounds can only be created once");
  let ad = await actDetail();
  ok(ad.rounds.length === 5 && ad.rounds.every((x) => x.turns.length === 4), "5 rounds, 4 teams in each");
  ok(JSON.stringify(ad.rounds[0].turns.map((x) => x.teamId)) === "[1,2,3,4]" && JSON.stringify(ad.rounds[1].turns.map((x) => x.teamId)) === "[2,3,4,1]", "the order shifts by one team each round");
  ok(ad.actout.act === 60 && ad.actout.rounds === 5, "1 minute per team, 5 rounds");

  let pz = (await users[0].c.req("/pulse")).j;
  ok(pz.actout && pz.actout.ord === 1 && pz.actout.total === 5 && pz.actout.phase === "idle" && pz.actout.current.teamId === 1 && pz.actout.current.phase === "idle", "players see round 1 of 5, Cow is up next");

  const rd1 = ad.rounds[0];
  r = await admin.req(`/admin/act-turns/${rd1.turns[1].id}/start`, {});
  ok(r.status === 409, "the second team can't start before the first has finished");
  const t0 = Date.now();
  r = await admin.req(`/admin/act-turns/${rd1.turns[0].id}/start`, { scene: "Titanic" });
  ok(r.status === 200 && Math.abs(r.j.endsAt - t0 - 60000) < 3000, "each team gets a 1 minute clock");
  r = await admin.req(`/admin/act-turns/${rd1.turns[0].id}/start`, {});
  ok(r.status === 409, "pressing Start twice only starts the team once");
  pz = (await users[1].c.req("/pulse")).j;
  ok(pz.actout.phase === "performing" && pz.actout.current.phase === "acting" && pz.actout.scene === "Titanic" && pz.actout.current.endsAt > pz.serverNow, "everyone sees Cow performing, the scene and the clock");
  r = await admin.req(`/admin/act-rounds/${rd1.id}/open-voting`, {});
  ok(r.status === 409, "voting can't open before every team has performed");
  r = await admin.req(`/admin/act-turns/${rd1.turns[0].id}/done`, {});
  ok(r.status === 200, "organiser marks Cow as done");
  r = await admin.req(`/admin/act-turns/${rd1.turns[0].id}/done`, {});
  ok(r.status === 409, "a team can only be marked done once");
  pz = (await users[1].c.req("/pulse")).j;
  ok(pz.actout.current.teamId === 2 && pz.actout.current.phase === "idle", "the next team's start button comes up (Chicken)");
  for (const turn of rd1.turns.slice(1)) {
    await admin.req(`/admin/act-turns/${turn.id}/start`, {});
    await admin.req(`/admin/act-turns/${turn.id}/done`, {});
  }
  r = await users[0].c.req(`/admin/act-rounds/${rd1.id}/open-voting`, {});
  ok(r.status === 403, "players can't open voting");
  r = await admin.req(`/admin/act-rounds/${rd1.id}/open-voting`, {});
  ok(r.status === 200 && Math.abs(r.j.endsAt - Date.now() - 30000) < 3000, "voting opened (30 second window)");

  pz = (await cowU2[0].c.req("/pulse")).j;
  ok(pz.actout.phase === "voting" && pz.actout.canVote && JSON.stringify(pz.actout.eligible) === "[2,3,4]" && pz.actout.myRanking === null, "a Cow voter is offered the other three teams");
  r = await cowU2[0].c.req(`/act-rounds/${rd1.id}/vote`, { ranking: [1, 2, 3] });
  ok(r.status === 400, "you can't rank your own team");
  r = await cowU2[0].c.req(`/act-rounds/${rd1.id}/vote`, { ranking: [2, 2, 3] });
  ok(r.status === 400, "each team can be ranked only once");
  r = await cowU2[0].c.req(`/act-rounds/${rd1.id}/vote`, { ranking: [2, 3] });
  ok(r.status === 400, "all three other teams must be ranked");
  r = await new Client().req(`/act-rounds/${rd1.id}/vote`, { ranking: [2, 3, 4] });
  ok(r.status === 401, "signed-out people can't vote");

  // the crowd's order of merit: Goat, Pig, Cow, Chicken
  const merit = [3, 4, 1, 2];
  const ballot = (team) => merit.filter((x) => x !== team);
  await cowU2[0].c.req(`/act-rounds/${rd1.id}/vote`, { ranking: [4, 3, 2] }); // changes their mind below
  for (const [team, list] of [[1, cowU2], [2, chickU2], [3, goatU2], [4, pigU2]]) {
    for (const u of list) {
      r = await u.c.req(`/act-rounds/${rd1.id}/vote`, { ranking: ballot(team) });
      if (r.status !== 200) ok(false, "vote from team " + team);
    }
  }
  pz = (await cowU2[0].c.req("/pulse")).j;
  ok(JSON.stringify(pz.actout.myRanking) === JSON.stringify(ballot(1)), "a voter's last ballot is the one that counts");
  ad = await actDetail();
  ok(ad.rounds[0].votes === 12, "12 people voted, one ballot each (changing your mind doesn't add one)");

  r = await admin.req(`/admin/act-rounds/${rd1.id}/close`, {});
  ok(r.status === 200 && r.j.ballots === 12, "round 1 saved");
  const byTeam = Object.fromEntries(r.j.results.map((x) => [x.id, x]));
  ok(byTeam[3].rank === 1 && byTeam[3].points === 2 && byTeam[4].rank === 2 && byTeam[4].points === 1 && byTeam[1].rank === 3 && byTeam[1].points === 1 && byTeam[2].rank === 4 && byTeam[2].points === 0, "positions pay 2 / 1 / 1 / 0 (Goat, Pig, Cow, Chicken)");
  const after1 = await totalsNow();
  ok(after1[3] - before[3] === 2 && after1[4] - before[4] === 1 && after1[1] - before[1] === 1 && after1[2] - before[2] === 0, "team points were added to the leaderboard");
  r = await cowU2[0].c.req(`/act-rounds/${rd1.id}/vote`, { ranking: ballot(1) });
  ok(r.status === 409, "no voting after the round is saved");
  r = await admin.req(`/admin/act-rounds/${rd1.id}/close`, {});
  ok(r.status === 409, "a round can only be saved once");

  // round 2 is next, and players can see how round 1 ended
  pz = (await users[0].c.req("/pulse")).j;
  ok(pz.actout.ord === 2 && pz.actout.current.teamId === 2 && pz.actout.last.ord === 1 && pz.actout.last.results[0].teamId === 3, "round 2 starts with Chicken; players see round 1's result");
  ad = await actDetail();
  const rd2 = ad.rounds[1];
  r = await admin.req(`/admin/act-turns/${rd2.turns[0].id}/start`, {});
  ok(r.status === 200, "round 2 can begin");
  await admin.req(`/admin/act-turns/${rd2.turns[0].id}/done`, {});
  for (const turn of rd2.turns.slice(1)) {
    await admin.req(`/admin/act-turns/${turn.id}/start`, {});
    await admin.req(`/admin/act-turns/${turn.id}/done`, {});
  }
  await admin.req(`/admin/act-rounds/${rd2.id}/open-voting`, {});
  r = await admin.req(`/admin/act-rounds/${rd2.id}/close`, {});
  ok(r.status === 409 && /vote/i.test(r.j.error), "a round with no votes isn't saved by accident");
  r = await admin.req(`/admin/act-rounds/${rd2.id}/close`, { force: true });
  ok(r.status === 200 && r.j.results.every((x) => x.points === 1), "if it is saved anyway, four equal teams share the points (1 each)");
  const after2 = await totalsNow();
  ok([1, 2, 3, 4].every((id) => Math.abs(after2[id] - after1[id] - 1) < 0.01), "each team got 1 point for the level round");

  // restarting a round clears its votes and points
  r = await admin.req(`/admin/act-rounds/${rd2.id}/reset`, {});
  ok(r.status === 200, "the latest round can be restarted");
  const after3 = await totalsNow();
  ok([1, 2, 3, 4].every((id) => Math.abs(after3[id] - after1[id]) < 0.01), "restarting a round takes its points back");
  r = await admin.req(`/admin/act-rounds/${rd2.id}/open-voting`, {});
  ok(r.status === 409, "a restarted round must be performed again before voting");
  await admin.req(`/admin/act-turns/${rd2.turns[0].id}/start`, {});
  r = await admin.req(`/admin/act-rounds/${rd1.id}/reset`, {});
  ok(r.status === 409, "an earlier round can't be restarted once a later round has begun");
  await admin.req(`/admin/act-turns/${rd2.turns[0].id}/reset`, {});
  r = await admin.req(`/admin/act-rounds/${rd1.id}/reset`, {});
  ok(r.status === 200, "an earlier round can be restarted when the later ones are untouched");
  const after4 = await totalsNow();
  ok([1, 2, 3, 4].every((id) => Math.abs(after4[id] - before[id]) < 0.01), "restarting round 1 takes its points back too");
  ad = await actDetail();
  ok(ad.rounds[0].phase === "idle" && ad.rounds[0].votes === 0 && ad.rounds[0].results.length === 0, "round 1 is back to the start with no votes or results");
}

// ---- Hook Step Challenge: rounds of 10 steps marked pass or fail, a cap on players, a final for ties
{
  const hk = g("hook-step-challenge");
  const mkO = async (name) => {
    const made = await admin.req("/admin/users", { name, role: "organiser" });
    const cl = new Client();
    await cl.req("/auth/login", { username: made.j.username, password: made.j.password });
    return cl;
  };
  const [oA, oB, oC] = [await mkO("Hook Organiser A"), await mkO("Hook Organiser B"), await mkO("Hook Organiser C")];
  ok(hk.type === "hookstep" && hk.kind === "individual", "Hook Step Challenge is an individual game of its own type");
  const hd = async (who = admin) => (await who.req(`/admin/games/${hk.id}`)).j.hookstep;
  const rid = async (ord) => (await hd()).rounds.find((x) => x.ord === ord).id;
  const play = async (who, roundId, user, pattern) => {
    const m = await who.req(`/admin/hs-rounds/${roundId}/monitor`, { userId: user.id });
    if (m.status !== 200) return m;
    let last;
    for (let i = 0; i < pattern.length; i++) last = await who.req(`/admin/hs-rounds/${roundId}/step`, { userId: user.id, pass: pattern[i] === "P", index: i });
    return last;
  };
  const P = "PPPPPPPPPP";
  const ovBefore = Object.fromEntries((await admin.req("/leaderboard/individual?full=1")).j.top.map((x) => [x.userId, x.value]));
  const pat = (n) => P.slice(0, n) + "F".repeat(10 - n); // n correct steps

  r = await admin.req(`/admin/games/${hk.id}/hookstep/players`, { userIds: [users[0].id] });
  ok(r.status === 409, "players can't be added before the rounds are set up");
  r = await users[0].c.req(`/admin/games/${hk.id}/hookstep/setup`, { rounds: 3, cap: 6 });
  ok(r.status === 403, "a player can't set the game up");
  r = await admin.req(`/admin/games/${hk.id}/hookstep/setup`, { rounds: 0, cap: 6 });
  ok(r.status === 400, "0 rounds is rejected");
  r = await admin.req(`/admin/games/${hk.id}/hookstep/setup`, { rounds: 3, cap: 1 });
  ok(r.status === 400, "fewer than 2 players is rejected");
  r = await admin.req(`/admin/games/${hk.id}/hookstep/setup`, { rounds: 3, cap: 6 });
  ok(r.status === 200, "organiser chooses 3 rounds and up to 6 players");
  let h = await hd();
  ok(h.configured && h.roundsCount === 3 && h.cap === 6 && h.steps === 10 && h.rounds.length === 3 && h.phase === "rounds", "3 rounds are made, 10 steps each");

  // three organisers add players at the same time; the list never goes past the cap
  const rs = await Promise.all([
    oA.req(`/admin/games/${hk.id}/hookstep/players`, { userIds: [0, 1, 2, 3].map((i) => users[i].id) }),
    oB.req(`/admin/games/${hk.id}/hookstep/players`, { userIds: [2, 3, 4, 5, 6].map((i) => users[i].id) }),
    oC.req(`/admin/games/${hk.id}/hookstep/players`, { userIds: [4, 5, 6, 7, 8, 9].map((i) => users[i].id) }),
  ]);
  ok(rs.every((x) => x.status === 200), "three organisers add players together");
  h = await hd();
  ok(h.roster.length === 6, "the list stops at the cap of 6 even with three organisers adding at once (" + h.roster.length + ")");
  ok(rs.some((x) => x.j.full), "an organiser is told when the list is full");
  r = await admin.req(`/admin/games/${hk.id}/hookstep/players`, { userIds: [users[11].id] });
  ok(r.status === 200 && r.j.added === 0 && r.j.full === true && (await hd()).roster.length === 6, "nobody can be added past the cap");
  r = await admin.req(`/admin/games/${hk.id}/hookstep/setup`, { rounds: 3, cap: 4 });
  ok(r.status === 409, "the cap can't go below the players already on the list");
  const play6 = (await hd()).roster.map((p) => users.find((u) => u.id === p.userId));
  const [p1, p2, p3, p4, p5, p6] = play6;
  let pulse = (await p1.c.req("/pulse")).j;
  ok(pulse.notifications.some((n) => n.title.includes("You're in")), "added players get an alert");

  // round 1
  const r1 = await rid(1), r2 = await rid(2), r3 = await rid(3);
  r = await admin.req(`/admin/hs-rounds/${r2}/status`, { status: "live" });
  ok(r.status === 409, "round 2 can't start before round 1 is done");
  r = await admin.req(`/admin/hs-rounds/${r1}/monitor`, { userId: p1.id });
  ok(r.status === 409, "monitoring needs the round to be started");
  r = await admin.req(`/admin/hs-rounds/${r1}/status`, { status: "live" });
  ok(r.status === 200, "round 1 starts");
  r = await admin.req(`/admin/hs-rounds/${r3}/status`, { status: "live" });
  ok(r.status === 409, "only one round runs at a time");
  r = await admin.req(`/admin/hs-rounds/${r1}/monitor`, { userId: users[11].id });
  ok(r.status === 409, "someone who is not on the list can't be monitored");

  // two organisers each monitor a different player at the same time
  const both = await Promise.all([play(oA, r1, p1, P), play(oB, r1, p2, pat(7))]);
  ok(both[0].j.turn.status === "done" && both[0].j.turn.score === 10, "organiser A: 10 passes make a score of 10");
  ok(both[1].j.turn.status === "done" && both[1].j.turn.score === 7, "organiser B, at the same time: 7 passes and 3 fails make 7");
  r = await oB.req(`/admin/hs-rounds/${r1}/step`, { userId: p1.id, pass: true, index: 9 });
  ok(r.j.recorded === false && r.j.turn.steps.length === 10, "a finished turn takes no more steps");

  // one player, two organisers
  r = await oA.req(`/admin/hs-rounds/${r1}/monitor`, { userId: p3.id });
  ok(r.status === 200 && r.j.turn.status === "live", "an organiser starts monitoring a player");
  r = await oB.req(`/admin/hs-rounds/${r1}/monitor`, { userId: p3.id });
  ok(r.status === 409 && /already monitoring/.test(r.j.error ?? ""), "another organiser is told the player is taken");
  const taps = await Promise.all([oA.req(`/admin/hs-rounds/${r1}/step`, { userId: p3.id, pass: true, index: 0 }), oA.req(`/admin/hs-rounds/${r1}/step`, { userId: p3.id, pass: true, index: 0 }), oB.req(`/admin/hs-rounds/${r1}/step`, { userId: p3.id, pass: false, index: 0 })]);
  ok(taps.filter((x) => x.j.recorded).length === 1, "three taps for the same step record exactly one");
  const st = (await hd()).rounds[0].turns.find((x) => x.userId === p3.id);
  ok(st.steps.length === 1 && st.status === "live", "the player is on step 2");
  r = await oA.req(`/admin/hs-rounds/${r1}/undo`, { userId: p3.id, index: 1 });
  ok(r.j.turn.steps === "", "the last step can be taken back");
  r = await admin.req(`/admin/hs-rounds/${r1}/status`, { status: "done" });
  ok(r.status === 409, "a round can't finish while a player is mid-turn");
  r = await oB.req(`/admin/hs-rounds/${r1}/monitor`, { userId: p3.id, takeover: true });
  ok(r.status === 200, "another organiser can take a player over");
  for (let i = 0; i < 10; i++) await oB.req(`/admin/hs-rounds/${r1}/step`, { userId: p3.id, pass: true, index: i });
  await Promise.all([play(oA, r1, p4, pat(5)), play(oB, r1, p5, pat(9)), play(oC, r1, p6, P)]);
  r = await admin.req(`/admin/hs-rounds/${r1}/status`, { status: "done" });
  ok(r.status === 200, "round 1 finishes once every turn is done");

  // rounds 2 and 3: p1 and p6 stay perfect
  const scores2 = [10, 10, 9, 10, 10, 10], scores3 = [10, 10, 9, 10, 10, 10];
  for (const [rnd, sc] of [[r2, scores2], [r3, scores3]]) {
    await admin.req(`/admin/hs-rounds/${rnd}/status`, { status: "live" });
    await Promise.all(play6.map((u, i) => play([oA, oB, oC][i % 3], rnd, u, pat(sc[i]))));
    r = await admin.req(`/admin/hs-rounds/${rnd}/status`, { status: "done" });
    ok(r.status === 200, "round finished");
  }
  h = await hd();
  const tot = (u) => h.standings.find((s) => s.userId === u.id).total;
  ok(tot(p1) === 30 && tot(p2) === 7 + 10 + 10 && tot(p3) === 10 + 9 + 9 && tot(p5) === 29 && tot(p6) === 30, "totals add up over the rounds");
  ok(h.leaders.length === 2 && h.leaders.includes(p1.id) && h.leaders.includes(p6.id), "two players are level on a perfect 30");
  ok(h.hasFinal && h.rounds.length === 4 && h.rounds[3].kind === "final" && h.rounds[3].turns.length === 2, "a final is made for the players who are level");
  ok(h.phase === "final" && h.winners.length === 0, "nobody has won yet");
  pulse = (await p6.c.req("/pulse")).j;
  ok(pulse.notifications.some((n) => n.title.includes("made the final")), "finalists get an alert");
  const fin = h.rounds[3].id;
  r = await admin.req(`/admin/hs-rounds/${fin}/monitor`, { userId: p4.id });
  ok(r.status === 409, "only the players who are level are in the final");

  // reopening round 3 takes the final away until it is finished again
  r = await admin.req(`/admin/hs-rounds/${r3}/status`, { status: "live" });
  ok(r.status === 200 && (await hd()).rounds.length === 3, "reopening the last round removes the unplayed final");
  r = await admin.req(`/admin/hs-rounds/${r3}/status`, { status: "done" });
  ok((await hd()).rounds.length === 4, "finishing it again brings the final back");

  // the final: a tie for the win means everyone tied wins
  const fin2 = (await hd()).rounds[3].id;
  r = await admin.req(`/admin/hs-rounds/${fin2}/status`, { status: "done" });
  ok(r.status === 409, "the final can't finish before the finalists have played");
  await admin.req(`/admin/hs-rounds/${fin2}/status`, { status: "live" });
  await Promise.all([play(oA, fin2, p1, P), play(oB, fin2, p6, P)]);
  r = await oA.req(`/admin/hs-rounds/${r3}/status`, { status: "live" });
  ok(r.status === 409, "a round can't be reopened once the final has started");
  r = await admin.req(`/admin/hs-rounds/${fin2}/status`, { status: "done" });
  ok(r.status === 200, "the final finishes");
  h = await hd();
  ok(h.phase === "done" && h.winners.length === 2 && h.winners.includes(p1.id) && h.winners.includes(p6.id), "both players who tied in the final win");
  const ranks = Object.fromEntries(h.standings.map((s) => [s.userId, s.rank]));
  ok(ranks[p1.id] === 1 && ranks[p6.id] === 1 && ranks[p5.id] === 3, "tied winners share 1st and the next player is 3rd");
  const lb = (await admin.req(`/leaderboard/individual?game=${hk.id}`)).j;
  ok(lb.top.filter((x) => x.rank === 1).length === 2, "the game's leaderboard shows both winners in 1st");
  const ov = (await admin.req("/leaderboard/individual?full=1")).j.top;
  const ovOf = (u) => ov.find((x) => x.userId === u.id)?.value ?? 0;
  ok(ovOf(p1) - ovBefore[p1.id] === 10 && ovOf(p6) - ovBefore[p6.id] === 10, "both winners get the full 1st place points (10 each)");
  ok(ovOf(p5) - ovBefore[p5.id] === 6, "the next player is 3rd and gets the 3rd place points");

  // a lone leader wins straight away, with no final
  r = await admin.req(`/admin/games/${hk.id}/hookstep/reset`, {});
  ok(r.status === 200 && !(await hd()).configured && (await hd()).roster.length === 0, "the game can be started over");
  await admin.req(`/admin/games/${hk.id}/hookstep/setup`, { rounds: 4, cap: 10 });
  await admin.req(`/admin/games/${hk.id}/hookstep/players`, { userIds: [0, 1, 2].map((i) => users[i].id) });
  for (let n = 1; n <= 4; n++) {
    const id = await rid(n);
    await admin.req(`/admin/hs-rounds/${id}/status`, { status: "live" });
    await Promise.all([play(oA, id, users[0], P), play(oB, id, users[1], n === 4 ? pat(9) : P), play(oC, id, users[2], pat(8))]);
    await admin.req(`/admin/hs-rounds/${id}/status`, { status: "done" });
  }
  h = await hd();
  ok(h.phase === "done" && !h.hasFinal && h.winners.length === 1 && h.winners[0] === users[0].id, "one player ahead after 4 rounds wins with no final");
}

// ---- Paper Cup Flip Tic-Tac-Toe: join, auto-drawn knockout bracket, winners move on
{
  const tg = g("cup-flip-tic-tac-toe");
  ok(tg.type === "knockout" && tg.kind === "individual", "Paper cup flip tic-tac-toe is a tournament game of its own type");
  const mkO = async (name) => {
    const made = await admin.req("/admin/users", { name, role: "organiser" });
    const cl = new Client();
    await cl.req("/auth/login", { username: made.j.username, password: made.j.password });
    return cl;
  };
  const [oA, oB, oC] = [await mkO("Bracket Organiser A"), await mkO("Bracket Organiser B"), await mkO("Bracket Organiser C")];
  const td = async () => (await admin.req(`/admin/games/${tg.id}`)).j.knockout;
  const ovBefore = Object.fromEntries((await admin.req("/leaderboard/individual?full=1")).j.top.map((x) => [x.userId, x.value]));

  r = await users[0].c.req(`/games/${tg.id}/join`, {});
  ok(r.status === 409, "joining is only open while the game is live");
  await admin.req(`/admin/games/${tg.id}`, { status: "live" }, "PATCH");
  let t = await td();
  ok(t.state === "registration" && t.joinOpen && t.players === 0, "registration is open once the game is live");
  r = await admin.req(`/admin/games/${tg.id}/knockout/start`, {});
  ok(r.status === 409, "a tournament needs at least 2 players");

  // six players join themselves, five more are added by organisers
  const self = users.slice(0, 6), added = users.slice(6, 11);
  const joins = await Promise.all(self.map((u) => u.c.req(`/games/${tg.id}/join`, {})));
  ok(joins.every((x) => x.status === 200), "players join from their own phone");
  await users[0].c.req(`/games/${tg.id}/join`, {});
  t = await td();
  ok(t.players === 6, "joining twice counts once");
  r = await users[5].c.req(`/games/${tg.id}/join`, undefined, "DELETE");
  ok(r.status === 200 && (await td()).players === 5, "a player can leave before it starts");
  await users[5].c.req(`/games/${tg.id}/join`, {});
  r = await users[0].c.req(`/admin/games/${tg.id}/knockout/players`, { userIds: [users[6].id] });
  ok(r.status === 403, "players can't add other people");
  await Promise.all([oA.req(`/admin/games/${tg.id}/knockout/players`, { userIds: added.slice(0, 3).map((u) => u.id) }), oB.req(`/admin/games/${tg.id}/knockout/players`, { userIds: added.slice(2).map((u) => u.id) })]);
  t = await td();
  ok(t.players === 11, "organisers add the rest, together, with no duplicates (11 players)");

  // start: 11 players need a 16 bracket, so 5 byes and 4 rounds
  const started = await Promise.all([oA.req(`/admin/games/${tg.id}/knockout/start`, {}), oB.req(`/admin/games/${tg.id}/knockout/start`, {})]);
  ok(started.filter((x) => x.status === 200).length === 1, "if two organisers press start together, the bracket is drawn once");
  t = await td();
  ok(t.state === "running" && t.roundsCount === 4 && t.rounds.length === 4, "the bracket has 4 rounds");
  ok(t.rounds.map((x) => x.name).join(",") === "Round 1,Quarter-finals,Semi-finals,Final", "rounds are named round 1, quarter-finals, semi-finals, final");
  ok(t.rounds.map((x) => x.matches.length).join(",") === "8,4,2,1", "8, 4, 2 and 1 matches");
  const byes = t.rounds[0].matches.filter((m) => m.bye);
  ok(byes.length === 5 && byes.every((m) => m.a && !m.b && m.winnerId === m.a.userId && m.status === "done"), "5 players get a bye and go straight through");
  const placed = new Set(t.rounds[0].matches.flatMap((m) => [m.a?.userId, m.b?.userId].filter(Boolean)));
  ok(placed.size === 11, "every player is in the first round exactly once");
  r = await users[10].c.req(`/games/${tg.id}/join`, {});
  ok(r.status === 409, "nobody can join after the start");
  r = await admin.req(`/admin/games/${tg.id}/knockout/players`, { userIds: [users[11].id] });
  ok(r.status === 409, "organisers can't add people after the start either");
  let pz = (await users[0].c.req("/pulse")).j;
  ok(pz.live.some((x) => x.slug === "cup-flip-tic-tac-toe" && x.youIn && x.joinOpen === false), "players see the game is theirs and joining is closed");

  const find = (u, tt) => tt.rounds.flatMap((x) => x.matches).filter((m) => m.a?.userId === u.id || m.b?.userId === u.id);
  const pairs = t.rounds[0].matches.filter((m) => !m.bye);
  const idOf = (uid) => users.find((u) => u.id === uid);
  // players get an alert when their match is ready
  const first = pairs[0];
  pz = (await idOf(first.a.userId).c.req("/pulse")).j;
  ok(pz.notifications.some((n) => n.title.includes("Your match is ready")), "players are told when their match is ready");

  // start one match, then pick winners of all round 1 matches with three organisers at once
  r = await oA.req(`/admin/ttt-matches/${pairs[0].id}/start`, {});
  ok(r.status === 200 && (await td()).rounds[0].matches.find((m) => m.id === pairs[0].id).status === "live", "an organiser starts a match: it shows as playing");
  r = await oA.req(`/admin/ttt-matches/${t.rounds[2].matches[0].id}/start`, {});
  ok(r.status === 409, "a match can't start before its players are known");
  r = await oA.req(`/admin/ttt-matches/${pairs[0].id}/winner`, { userId: users[11].id });
  ok(r.status === 400, "the winner has to be one of the two players");
  const orgs = [oA, oB, oC];
  const picks = await Promise.all(pairs.map((m, i) => orgs[i % 3].req(`/admin/ttt-matches/${m.id}/winner`, { userId: m.a.userId })));
  ok(picks.every((x) => x.status === 200), "three organisers pick winners at the same time");
  const race = await Promise.all([oA.req(`/admin/ttt-matches/${pairs[0].id}/winner`, { userId: pairs[0].b.userId }), oB.req(`/admin/ttt-matches/${pairs[0].id}/winner`, { userId: pairs[0].b.userId })]);
  ok(race.filter((x) => x.status === 200).length >= 1, "changing a winner works while the next match hasn't started");
  t = await td();
  ok(t.rounds[0].matches.find((m) => m.id === pairs[0].id).winnerId === pairs[0].b.userId, "the corrected winner is saved");
  const r2 = t.rounds[1].matches;
  ok(r2.every((m) => m.a && m.b), "every quarter-final now has both players");
  const slot0 = r2.find((m) => m.slot === Math.floor(pairs[0].slot / 2));
  ok([slot0.a?.userId, slot0.b?.userId].includes(pairs[0].b.userId) && ![slot0.a?.userId, slot0.b?.userId].includes(pairs[0].a.userId), "the corrected winner, not the old one, is in the next round");

  // play the rest: always the player on side a
  let guard = 0;
  while ((t = await td()).state === "running" && guard++ < 10) {
    const ready = t.rounds.flatMap((x) => x.matches).filter((m) => m.ready && !m.winnerId);
    if (!ready.length) break;
    const out = await Promise.all(ready.map((m, i) => orgs[i % 3].req(`/admin/ttt-matches/${m.id}/winner`, { userId: m.a.userId })));
    ok(out.every((x) => x.status === 200), "round of winners picked");
    if (guard === 2) {
      // a result can't be changed once the next match has been decided
      const semi = t.rounds[1].matches[0];
      r = await oA.req(`/admin/ttt-matches/${semi.id}/winner`, { userId: semi.b.userId });
      ok(r.status === 409, "a result is locked once the next match is decided");
    }
  }
  t = await td();
  ok(t.state === "done" && t.champion && t.rounds[3].matches[0].winnerId === t.champion.userId, "the final decides the champion");
  const champ = idOf(t.champion.userId);
  ok((await champ.c.req(`/games/${tg.id}`)).j.knockout.you.champion === true, "the champion sees that they won");

  // standings: champion, runner-up, then the two semi-final losers level on 3rd
  const lb = (await admin.req(`/leaderboard/individual?game=${tg.id}`)).j.top;
  ok(lb[0].userId === champ.id && lb[0].rank === 1 && lb[0].detail === "Champion", "the champion is 1st");
  ok(lb[1].rank === 2 && lb[1].detail === "Runner-up", "the final's loser is 2nd");
  ok(lb.filter((x) => x.rank === 3).length === 2, "the two semi-final losers share 3rd");
  const ov = (await admin.req("/leaderboard/individual?full=1")).j.top;
  const gain = (uid) => (ov.find((x) => x.userId === uid)?.value ?? 0) - (ovBefore[uid] ?? 0);
  ok(gain(lb[0].userId) === 10 && gain(lb[1].userId) === 8 && gain(lb[2].userId) === 6 && gain(lb[3].userId) === 6, "points: champion 10, runner-up 8, both semi-final losers 6");

  // start over: back to registration with the players kept
  r = await oA.req(`/admin/games/${tg.id}/knockout/reset`, {});
  ok(r.status === 403, "only an admin can start the tournament over");
  r = await admin.req(`/admin/games/${tg.id}/knockout/reset`, {});
  t = await td();
  ok(r.status === 200 && t.state === "registration" && t.players === 11 && t.rounds.length === 0, "starting over reopens registration and keeps the players");
  // a small one: 3 players, one bye
  await admin.req(`/admin/games/${tg.id}/knockout/reset`, { clearPlayers: true });
  await admin.req(`/admin/games/${tg.id}/knockout/players`, { userIds: users.slice(0, 3).map((u) => u.id) });
  r = await admin.req(`/admin/games/${tg.id}/knockout/start`, {});
  t = await td();
  ok(r.status === 200 && t.roundsCount === 2 && t.rounds[0].matches.filter((m) => m.bye).length === 1 && t.rounds[1].matches[0].a && !t.rounds[1].matches[0].ready, "3 players: one bye, then a final waiting for the other match");
  const real = t.rounds[0].matches.find((m) => !m.bye);
  await oA.req(`/admin/ttt-matches/${real.id}/winner`, { userId: real.b.userId });
  t = await td();
  ok(t.rounds[1].matches[0].ready, "the final is ready once both players are known");
  await admin.req(`/admin/ttt-matches/${t.rounds[1].matches[0].id}/winner`, { userId: t.rounds[1].matches[0].b.userId });
  t = await td();
  ok(t.state === "done" && t.rounds.length === 2, "a 3 player tournament finishes");
  await admin.req(`/admin/games/${tg.id}/knockout/reset`, { clearPlayers: true });
  await admin.req(`/admin/games/${tg.id}`, { status: "upcoming" }, "PATCH");
}

// ---- Colour Blind runs on the same tournament system, independently of the tic-tac-toe one
{
  const cb = g("colour-blind"), cupG = g("cup-flip-tic-tac-toe");
  ok(cb.type === "knockout" && cb.kind === "individual" && cupG.type === "knockout", "Colour Blind and Paper Cup Flip both use the tournament system");
  const kd = async (game) => (await admin.req(`/admin/games/${game.id}`)).j.knockout;
  await admin.req(`/admin/games/${cb.id}`, { status: "live" }, "PATCH");
  const four = users.slice(0, 4);
  const joined = await Promise.all(four.map((u) => u.c.req(`/games/${cb.id}/join`, {})));
  ok(joined.every((x) => x.status === 200), "players register for Colour Blind from their phone");
  let k = await kd(cb);
  ok(k.state === "registration" && k.players === 4 && (await kd(cupG)).players === 0, "the two tournaments keep their own player lists");
  r = await admin.req(`/admin/games/${cb.id}/knockout/start`, {});
  k = await kd(cb);
  ok(r.status === 200 && k.roundsCount === 2 && k.rounds[0].matches.length === 2 && k.rounds[1].matches.length === 1 && !k.rounds[0].matches.some((m) => m.bye), "4 players: two semi-finals and a final, no byes");
  ok((await kd(cupG)).state === "registration", "starting Colour Blind doesn't start the other tournament");
  for (const m of k.rounds[0].matches) await admin.req(`/admin/ttt-matches/${m.id}/winner`, { userId: m.a.userId });
  k = await kd(cb);
  ok(k.rounds[1].matches[0].ready, "both semi-final winners are in the final");
  await admin.req(`/admin/ttt-matches/${k.rounds[1].matches[0].id}/winner`, { userId: k.rounds[1].matches[0].b.userId });
  k = await kd(cb);
  ok(k.state === "done" && k.champion.userId === k.rounds[1].matches[0].b.userId, "the final decides the Colour Blind champion");
  const cbLb = (await admin.req(`/leaderboard/individual?game=${cb.id}`)).j.top;
  ok(cbLb.length === 4 && cbLb[0].detail === "Champion" && cbLb[1].detail === "Runner-up" && cbLb.filter((x) => x.rank === 3).length === 2, "Colour Blind standings: champion, runner-up, two level 3rd");
  await admin.req(`/admin/games/${cb.id}/knockout/reset`, { clearPlayers: true });
  await admin.req(`/admin/games/${cb.id}`, { status: "upcoming" }, "PATCH");
}

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
