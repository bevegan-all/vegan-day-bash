# Vegan Day Bash 2026: Games Platform Plan

Status: draft for review. Nothing is built yet.
Sources: handwritten plan (`VDB games.pdf`, the main one) and the older AI-generated plan (background only).
Anything marked **[from old plan]** was carried over and is not yet confirmed. Anything marked **[assumption]** is my guess and needs a yes or no.

---

## 1. Event facts

| Item | Value |
|---|---|
| Crowd | about 100 people (the old plan said 200) |
| Date | **1 November 2026** (8 days from 24 Oct, so the schedule is tight) |
| Teams | 4: Cow, Chicken, Goat, Pig. Handwritten G1 to G4 map to these. About 25 people each. |
| Venue | CSK, party on the terrace, stalls in the hall **[from old plan]**. Wi-Fi may be weak on the terrace. |
| Hosting | Cloudflare Workers |
| Devices | Phones (Android and iPhone) for everyone. Organisers also use phones. A projector or big screen is optional but strongly recommended. |

---

## 2. The final games

### 2.1 Team games (the 4 teams compete)

| # | Game | Format | App scoring |
|---|---|---|---|
| T1 | **Meme Charades** | Cow v Chicken and Goat v Pig, then the 2 winners in a final. 1 min to decide the meme, 1 min to act it out, 5 rounds. The team with the most correct guesses wins. | Organisers start the match and enter each team's correct-guess count per round. The winner is automatic, and a tie goes to a sudden-death round 6. Participants only watch the bracket and scores. |
| T2 | **Green Light – Red Light** | Everyone plays together, point A to B. The host faces away or back at random. Players move only when the host isn't facing them. Rounds until one winner. | Organisers run the game and, at the end, record who cleared and who won (scan the QR or pick the name). See 2.3. |
| T3 | **Shark Tank** (veggie/fruit) | 5 min to prep, 3 min to pitch. Matches are Cow v Chicken and Goat v Pig, then a final battle. | The audience votes on each pitch (section 5). The audience score becomes the team's marks. |
| T4 | **Act it Out** | A random movie scene is shown and players act it out as precisely as possible. | No winner, no points. The app only shows the scene, a timer and a random-person picker. |

Backup games, kept in the app as hidden or draft:
- Blindfold: find your animal team by sound.
- Random person, random activity (the app picks a checked-in person and an activity from a list).

### 2.2 Individual games

| # | Game | Result type | How a result is recorded |
|---|---|---|---|
| I1 | Paper cup flip – tic-tac-toe (1 v 1). A player only gets to place a mark after flipping the cup correctly. | Win/loss | Host scans both QR codes, then taps the winner. |
| I2 | Arm wrestling | Win/loss | Same as I1. |
| I3 | Colour blind ("do not touch the colour"). In the old plan: 3 chances, most correct taps wins. | Score (higher is better) | Host scans the player and enters the score. |
| I4 | Paper dance | Placement | Last pair or person standing. Host scans the top 3. |
| I5 | Stay in the square (paper, jog) | Time or survival | Host scans the player and enters seconds, or the placement. |
| I6 | Hook step challenge | Score or placement **[assumption: judged by the host]** | Host scans the player and enters a score. |

The app models these as 4 generic result types, so games are defined as data and can be added or changed from the admin screen on the day:
`match_win`, `score_high`, `time` (high or low is better), `placement`.

Confirmed: **organisers enter the result or score for every individual game**, including hook step, which has no fixed format. Participants never enter their own results. I'm treating these as open stations (anyone can play at any time, no brackets).

### 2.3 Green Light – Red Light

Confirmed: organisers run the game physically, and the app only keeps the record.
1. Organisers run the rounds on the field as in your plan, until one winner is left.
2. At the end, an organiser opens the game in the app and records **who cleared** (reached point B) and **who won**, by scanning each person's QR code or picking the name.
3. The winner gets individual credit and their team gets +10. Each person who cleared earns their team +1 (from the points table you approved).
4. The result shows on the big screen and the boards straight away.
5. Optional stretch: a host-phone "GREEN / RED" button with a random timer and sound.

---

## 3. Accounts, teams and entry flow

### 3.1 Roles
- **Participant**: sees their team and games, votes, and shows a QR code.
- **Organiser/scorer**: registers people, scans QR codes, enters scores and runs games.
- **Admin** (1 to 3 people): everything above, plus game setup, points settings and corrections.
- **Screen**: a read-only public page for the projector. No login, only a secret URL token.

### 3.2 Registration at the door
You create the accounts, so speed matters with 100 people.

1. An organiser opens **Register** and types the person's name. They are asked "how many came together?".
2. The app auto-generates a username (for example `riya07`) and a short random password, and picks the team that has the fewest members. People who arrive together are split across different teams.
3. The screen shows, in huge text, **"Give a COW sticker"**, plus the **sign-in QR code** (section 3.3). The sticker is the physical team marker.
4. The organiser can change the team before saving. Every assignment is logged.
5. The person scans the sign-in QR with their phone camera or Google Lens and is signed in. No typing. The username and password still exist as a fallback.

Confirmed: one account per person, and every account also belongs to one team, so a user carries both an individual identity and a team.

Rules (from both plans):
- The sticker goes on the hand, not on clothes **[from old plan]**.
- Don't explain what the sticker is for until games start, then announce "no swapping" **[from old plan]**.
- Organisers and hosts register and join a team like everyone else **[from old plan]**.

### 3.3 Sign-in QR (participant scans the organiser's screen)

There are two different QR codes in the app. The **sign-in QR** goes from the organiser's phone to the participant's phone and logs them in. The **identity QR** (3.4) goes the other way and lets organisers recognise a person.

How sign-in works:
1. After registration, the organiser's screen shows a QR code that encodes a link such as `https://<site>/s/<token>`.
2. The participant scans it with the native camera or Google Lens (both Android and iPhone work) and opens the link.
3. The page shows **"Sign in as Riya, Team Cow"** with one button. Tapping it exchanges the token for a session cookie and takes them home.
4. The organiser's screen flips to **"Signed in ✓"** so they know it worked and can move to the next person.

Design choices:
- **A confirm tap, not an automatic login.** Link previews, scanners and in-app browsers sometimes load a link before the person does. The button means a preview can't sign anyone in or use up the token, and the person sees whose account it is.
- **The token is random (128-bit), stored hashed in D1, reusable and valid until the end of event day.** If Lens opens an in-app browser and the person switches to Chrome or Safari, scanning again still works.
- **Organisers can revoke and regenerate it** from the person's profile (lost phone, wrong person scanned). They can also show the QR again at any time from People search.
- **The QR on the organiser screen hides after 60 seconds or once used**, so a bystander can't photograph it and sign in as someone else.
- **Username and password remain as a backup.** They are created behind the scenes and organisers can read them out if the camera route fails.

Known phone quirks to plan for:
- Google Lens may open links in the Google app's own browser, which has separate cookies from Chrome or Safari. The page shows a small "Open in your browser" hint after sign-in.
- On iPhone, an app added to the Home Screen keeps separate storage from Safari and would start signed out. So I will not push "install the app". People just keep using the browser tab, and an organiser can re-show their QR if they ever get signed out.

### 3.4 Identity QR (organisers scan participants)
- Every participant has a **My QR** button in their profile that opens a full-screen QR code.
- The QR code holds a signed token (HMAC) and not just a user id, so nobody can make a fake one.
- Organisers have a **Scan** screen. After a scan it shows a card with name, team, sticker and check-in state, plus actions for the current context:
  - register a result for a game
  - add the person to a match
  - check them in
  - open their history
- Camera scanning uses a JS library (`qr-scanner`), because iOS Safari lacks the BarcodeDetector API. It requires HTTPS, which Workers provides.
- Fallback when the camera fails: search by username.

---

## 4. Scoring and leaderboards

### 4.1 Three separate boards
1. **Team board (overall)**: the sum of points from team games.
2. **Individual board, per game**: ranked by that game's result type.
3. **Individual board (overall)**: the sum of rank points across individual games.

Individual game results **do not** feed the team board by default **[from old plan]**. It's one switch in settings if you want them to.

### 4.2 Top 10 and "your rank"
- Everyone sees the **top 10** on each individual board.
- Everyone else sees their own line, such as **"You: #23 of 87"**, without seeing the full list.
- Ties share a rank. The tie-break is the earlier time of achieving the score.
- The public display shows first name plus last initial, for privacy.

### 4.3 Suggested points (all editable in admin)
| Result | Points |
|---|---|
| Meme Charades semi-final win | 5 |
| Meme Charades final win (runner-up) | 10 (3) |
| Green Light – Red Light winner's team | 10 |
| Each Green Light – Red Light qualifier's team | 1 |
| Shark Tank | The team's audience score out of 10, per pitch (section 5) |
| Act it Out | none |

Individual rank points per game: 1st 10, 2nd 8, 3rd 6, ranks 4 to 10 get 4, anyone else who played gets 1. **[assumption]**

---

## 5. Shark Tank voting

### 5.1 Flow
1. Admin starts a match. Each team gets a random veggie or fruit from the app, shown on their phones and on the big screen.
2. A 5-minute prep timer runs on the screen. Then each team pitches for 3 minutes, one after the other.
3. After a pitch, the admin taps **Open voting**. Every eligible phone shows a rating screen.
4. After about 60 seconds the admin taps **Close voting**. The average appears on the screen.
5. The higher average advances. The 2 winners meet in the final.

### 5.2 Voting rules
- **Who can vote:** everyone logged in **except members of the pitching team**. That is exactly what you asked for.
- **Rating:** 1 to 10 stars, one rating per person per pitch, enforced in the database.
- **Marks:** audience average (0 to 10), shown to one decimal place.
- **Fairness switch (off by default):** also ignore the opposing team's votes in that match, so rivals can't sink each other. The setting is available for you to decide.
- **Anti-gaming:**
  - Results stay hidden until voting closes.
  - Admins can set a minimum number of votes (for example 20).
  - Votes can't be changed after closing.
  - Every vote is tied to a user id internally, but only the average is shown publicly.
- **Tie:** the match goes to a one-minute re-vote, or the judges decide.

Alternative (not chosen): a head-to-head "which pitch was better?" vote. It gives a simpler winner, but no marks.

---

## 6. Technical plan

### 6.1 Stack
| Layer | Choice | Why |
|---|---|---|
| Hosting | One Cloudflare Worker with static assets | One deploy, one URL |
| API | Hono + Zod | Small and fast, validates input |
| Database | D1 (SQLite) | Handles 100 users easily |
| Live updates | Phase 1: polling every 10 s, cached at the edge. Phase 2: Durable Object WebSockets | See 6.4 |
| Frontend | React + Vite + TypeScript + Tailwind | Mobile-first, PWA-installable |
| QR | `qrcode` (generate) + `qr-scanner` (scan) | Works on iOS and Android |
| Auth | Cookie sessions stored in D1 | Simple and revocable |

### 6.2 Data model (D1)
- `users`: id, username (unique), password_hash, salt, display_name, role, team_id, party_id, checked_in, qr_secret, created_at
- `teams`: id, animal, color
- `games`: id, slug, name, kind (team or individual), result_type, config JSON, status (draft, upcoming, live, closed), sort
- `matches`: id, game_id, stage (semi or final or heat), team_a, team_b, status, winner_team
- `score_events`: id, game_id, match_id, round, user_id or team_id, value, points, created_by, idempotency_key, voided_at (append-only, never edited)
- `pitches`: id, match_id, team_id, item, voting_state
- `pitch_votes`: pitch_id, voter_id, rating, with a UNIQUE (pitch_id, voter_id) constraint
- `login_tokens`: id, user_id, token_hash, expires_at, revoked_at, last_used_at
- `settings`: points table, switches
- `confessions`: id, text, created_at, skip_flag. This table has **no user id**, so confessions are truly anonymous.
- `audit_log`: who did what and when

Rankings use SQL `RANK() OVER (...)`. Corrections are a "void" plus a new event, so history is always preserved.

### 6.3 Security basics
- Passwords are hashed with PBKDF2-SHA256 (Workers allow at most 100,000 iterations) and a per-user salt.
- Session cookies are HttpOnly, Secure and SameSite=Lax.
- Login attempts are rate-limited.
- Every write endpoint checks the role on the server. Organiser actions are never trusted from the client.
- The QR secret and session key are Worker secrets, not in the code.
- Data collected is minimal (name and username only). Export and purge after the event.

### 6.4 Costs and reliability
- The Workers free tier has 100k requests per day. 100 phones polling every 10 s for 3 hours is about 108k requests, so use the **$5 Workers Paid plan for the event month** or add the WebSocket layer.
- **Weak Wi-Fi on the terrace** is the biggest real-world risk. Mitigations:
  - Organiser actions are queued on the phone and retried automatically, with idempotency keys so nothing is double-counted.
  - The `/screen` page and leaderboards tolerate stale data.
  - Keep a **paper backup scoresheet**, the same as your handwritten plan.
- Do a **load test with about 150 simulated users** before the event.

### 6.5 UI and mobile
- Mobile-first, with a bottom tab bar, tap targets of at least 44 px, safe-area padding for the iPhone notch, and dark mode.
- The team colours and the animal sticker appear on every screen so people feel part of a tribe.
- Test on at least one iPhone Safari, one Android Chrome and one small screen.

### 6.6 Screens
**Participant:** Login · Home (my team, live game, my ranks) · Games (rules and status) · Game detail (bracket and board) · Leaderboards (Team, Individual overall, per game; top 10 plus my rank) · Shark Tank vote · Profile with My QR.

**Organiser:** Dashboard · Register · People search · Scan · Game control (open or close, bracket, score entry) · Shark Tank control (item draw, timers, open or close voting) · Corrections (void) · Settings (points, switches) · Export CSV.

**Big screen (`/screen`):** now playing, countdowns, live bracket, team and individual boards, Shark Tank results, and the QR to open the site.

---

## 7. Event-day flow (proposal)

| Time (est.) | What |
|---|---|
| Arrival | Register and sticker, then phone login |
| 10 min | Anchor opens, tribes are announced, "no swapping" |
| about 35 min | Meme Charades (3 matches × 5 rounds of 2 min, plus changeovers) |
| about 15 min | Green Light – Red Light (heats and final) |
| about 30 min | Shark Tank (5 min prep together, then 6 pitches of about 4 min with voting) |
| about 10 min | Act it Out (fun break, no points) |
| Running through the event | Individual stations in the hall with their own hosts, during the gaps and stall time. The confession box is out all day. |
| End | Team and individual winners, prizes, confession reading |

**[assumption]** Group games run on the main stage one after another, while individual stations run in parallel. This was an open question in the old plan.

Roles to fill: registration team (2 to 4), a host for each team game, one host per individual station, an anchor, a scorekeeper, 2 to 3 Sharks for the pitches. These count the same whether or not you use the old plan's list.
Host rule **[from old plan]**: a host doesn't play the game they run, and if they play only part of a game their points don't count.

---

## 8. Confession box
Kept as an activity. **[assumption]** The physical box stays as the plan says, with a small panel reading at the end. If someone is named in a chit, the panel asks them first whether it can be read. An in-app anonymous version is possible later and is optional.

---

## 9. Build phases

Event is 1 Nov, so the days are tight. Proposed schedule, with a feature freeze on 29 Oct:

| Days | Work |
|---|---|
| 24 to 25 Oct | Project setup, database, auth, registration, sign-in QR |
| 26 to 27 Oct | Game engine, individual score entry, leaderboards, identity QR and scan |
| 28 to 29 Oct | Team games (Meme Charades, Green Light – Red Light, Shark Tank voting), `/screen` |
| 30 Oct | Mobile polish, load test with about 150 simulated users |
| 31 Oct | Rehearsal with about 10 volunteers, fixes, final deploy, print paper backup sheets |
| 1 Nov | Event |

**Phase 1: must have for the day**
1. Project setup, deploy to Workers, D1 schema
2. Auth, roles, registration with team balancing, sign-in QR, identity QR and scan
3. Game engine plus individual stations (score entry, per-game boards, top 10 plus my rank)
4. Team games: Meme Charades bracket and scoring, Green Light – Red Light finish scanning, Shark Tank voting
5. Team and individual overall boards, `/screen`, corrections and audit log
6. Mobile polish, load test, a rehearsal with about 10 volunteers

**Phase 2: if time allows**
Durable Object live updates, offline queue polish, CSV export, in-app confession box, host-phone Green/Red button.

**Phase 3: nice to have**
Random pickers and wheel, scene and meme decks, photo wall.

---

## 10. Decisions so far and what is still open

Confirmed by you:
- One account per person, and every account also belongs to a team.
- Account creation by organisers, with sign-in by scanning a QR (section 3.3).
- Organisers start and score every team game. For Meme Charades they enter the correct-guess counts per round.
- Green Light – Red Light: organisers run it and record who cleared and who won.
- Individual games, including hook step: organisers give the score.
- The points table in 4.3 is accepted.
- Event date is 1 November 2026.
- The confession box stays (physical).

Still open. I will use these defaults unless you say otherwise:
1. **Shark Tank voting:** only the pitching team is blocked, as you said, with a 1 to 10 star rating. The extra "also block the opponent" switch stays off.
2. **Network:** I assume mobile data works on the terrace, with a paper backup sheet as insurance.
3. **Budget:** the $5 Workers Paid plan for the event month.
4. **Address:** a free `*.workers.dev` URL is fine, unless you have a custom domain.
5. **Projector:** I assume there is a screen or TV for the `/screen` page. If not, it is skipped.
