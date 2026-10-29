# Vegan Day Bash: games platform

One site for the whole event on 1 Nov 2026: organisers register people, people sign in by scanning a QR, teams and solo players earn points, and everyone sees live leaderboards. See [PLAN.md](PLAN.md) for the design.

Runs entirely on Cloudflare's **free** plan: one Worker (Hono API + React app as static assets) and one D1 database.

## Run it on your laptop

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173 (if that port is busy, the terminal shows the one it picked).

### Test accounts

While `TEST_ACCOUNTS=1` is set in `.dev.vars` (it is, for local development), two accounts are created automatically on the first request, and the sign-in page shows quick buttons for them:

| Account | Username | Password | What it is |
|---|---|---|---|
| Test admin | `admin` | `admin123` | Full organiser and admin tools |
| Test user | `user` | `user123` | An ordinary participant |

These are for testing only. They are **off** on a deployed site unless you add `TEST_ACCOUNTS` there yourself, and you should not leave them on for the real event. Without test mode, you create the first admin at **/setup** using the `SETUP_CODE` secret.

### Light and dark mode

The app follows the phone's setting by default. The sun/moon button in the top bar switches it, and **Profile > Appearance** has Auto, Light and Dark. The big-screen page is always dark.

### Game locations, player lists and alerts

- Every game has a **location**, `Terrace` by default. An admin changes it on the game's control screen (Terrace, Hall, or any text). Players see it on the game cards and pages.
- On **Green Light – Red Light**, organisers build a player list: add everyone, everyone checked in, a whole team, or individual people by scanning or searching. Each person added gets an alert saying they are in and where to go. Removing someone also alerts them.
- Organisers then record each finisher's **time in seconds**. The fastest time wins, the top three show on a podium, and team points follow the times (winner's team +10, each other finisher's team +1 by default).
- Alerts show as a bell in the app and as a phone notification **while the app is open** (including in the background). A phone where the browser is completely closed will not get them, because that needs a push service, which is a bigger add-on.

### Meme Charades, turn by turn

The memes themselves are shown on the projector, not in the app. The app runs the turns and the score.

1. On the Meme Charades control screen, pick who plays whom (two matches), then start a match and choose **which team goes first**.
2. Each team gets 5 turns (10 in all), one team after the other. For each turn the organiser can pick a **meme number** (numbers already used are crossed out) and add the **acting players** (up to 3). The meme number is only for organisers and is never sent to players' phones.
3. Press **Start acting** for a 1 minute clock. When the turn ends, tap **Point** (their team guessed it) or **Fail**.
4. After the last turn the higher score wins and moves on automatically. If the scores are level, the organiser chooses who moves forward. The final works the same way.

Players see whose turn it is, who is acting, the clock, the live score and whether the last turn scored. The acting time, turns per team and number of memes are in **Settings**.

### Shark Tank, turn by turn

1. On the Shark Tank control screen, pick who plays whom (two rounds). Matchups can be changed until a round starts.
2. Open a round and choose **which team pitches first**. A veggie or fruit is drawn for each team.
3. For each team in turn, the organiser presses one button at a time: **Start preparation** (5 min), **Start pitch** (3 min), **Open voting** (1 min), then **Save result**.
4. Everyone except the pitching team rates the pitch from 1 to 10 on their phone while voting is open. The average is saved as the team's score.
5. When both teams have pitched, the higher average wins and moves to the final automatically (a tie asks the organiser to pick).

Players see whose turn it is, the phase and a live countdown on Home and on the game page. The countdowns come from the server clock, so every phone shows the same time. The three durations are in **Settings** (set them to a few seconds to rehearse).

### Checks

`npm run typecheck` checks all the code. `scripts/flow-test.mjs` is an end-to-end API test. It needs a throwaway database, so run it like this and your own local data stays untouched:

```bash
npm run db:migrate:test
npm run dev:test
```

then, in another terminal: `BASE=http://127.0.0.1:5180 node scripts/flow-test.mjs`. To reset the throwaway database, stop that server and delete `.wrangler/test-state`.

## Put it online (free)

1. Sign in to Cloudflare from the terminal:
   ```bash
   npx wrangler login
   ```
2. Create the database, and copy the `database_id` it prints into [wrangler.jsonc](wrangler.jsonc):
   ```bash
   npx wrangler d1 create vdb
   ```
3. Create the tables:
   ```bash
   npm run db:migrate:remote
   ```
4. Build and deploy. It prints your address, something like `https://vegan-day-bash.<your-name>.workers.dev`:
   ```bash
   npm run deploy
   ```
5. Set the three secrets. Use a long random value for each (you can make one with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`). Remember the setup code, you need it once:
   ```bash
   npx wrangler secret put QR_SECRET
   npx wrangler secret put PEPPER
   npx wrangler secret put SETUP_CODE
   ```
6. Open `https://<your address>/setup`, enter the setup code, and create your admin account. Setup only works while there is no admin.

   To try the deployed site without making your own account first, you can turn the test accounts on there by adding `"vars": { "TEST_ACCOUNTS": "1" }` to [wrangler.jsonc](wrangler.jsonc) and deploying again. Anyone who finds the site could then sign in as the test admin, so take it out again before sharing the link.
7. In **Organiser tools > Settings & points > Rules**, tap **Show big-screen link** for the projector page.

Do not change `QR_SECRET` or `PEPPER` after people have registered: it would invalidate every identity QR and password.

## On the day

- **Registering:** Organiser tools > Register person. Type a name, show the QR, they scan it with the phone camera or Google Lens and tap **Sign in**. The screen says "Give a sticker" with the team.
- **Friends arriving together:** tick "Arrived with friends" so they land on different teams.
- **If the camera route fails:** tap "Show username and password" on the same screen.
- **Running a game:** Organiser tools > pick the game > set it **live**, then use its control screen.
- **Mistakes:** every score can be removed (✕ next to it). Team points can be cancelled under Settings > Points. Settings > Log shows who did what.

## Free-plan limits to know about

- Workers Free allows 100,000 API requests a day and 10 ms of CPU per request. Static files (the app itself) are not counted.
- The app refreshes live pages every 15 to 30 seconds, and only while the page is on screen, to stay well inside that limit. Even 100 people watching at once should use far less than the cap.
- Password hashing is deliberately light (passwords are random and system-generated) so it fits the 10 ms CPU limit.
- D1 Free allows 5 million reads and 100,000 writes a day. Event use is a tiny fraction.

Please do a rehearsal on the deployed site a few days before the event, and glance at the Workers dashboard for errors.

## What has not been tested

- QR **scanning with a camera** (the organiser's scan screen) could only be checked in code, not on a real phone. Test it on an Android phone and an iPhone before the event. The camera needs the HTTPS address, which Cloudflare gives you.
- Live behaviour on the real Cloudflare free plan (CPU time, request counts).
