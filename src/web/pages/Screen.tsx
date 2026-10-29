import { useSearchParams } from "react-router-dom";
import { Crown } from "lucide-react";
import { teamById } from "../../shared/teams";
import { usePoll, stageLabel, toFinishers, fmtTime, type ActRound, type Board, type GameDetail, type GrRound, type Match, type Pitch, type TeamRow } from "../api";
import { ActTimer, TurnTracker } from "../meme";
import { TeamOrder } from "../actout";
import { PhaseChip, PhaseTimer, useClock } from "../shark";
import { TeamIcon } from "../art";
import { StepDots, passes } from "../hookstep";
import { Podium } from "../components";
import { CelebrationOverlay, CountUp, ScoreBar, Stage, VoteMeter, useCelebrations, type Celebration, type Step, type StageView } from "../stage";
import { Logo, RankBadge, StatusPill, TeamName } from "../ui";
import { hsLabel } from "../api";

interface ScreenData {
  teams: TeamRow[];
  individual: Board;
  liveGames: GameDetail[];
}

const offsetOf = (g: GameDetail) => (g.serverNow ?? Date.now()) - Date.now();
const teamName = (id: number | null | undefined) => teamById(id)?.name ?? "A team";

// ---------------------------------------------------------------------------
// The big screen. Every live game is drawn with the same Stage template (see ../stage.tsx).
// The projector page is always dark, whatever the phone theme is: it reads best in a dim room.
// ---------------------------------------------------------------------------
export function Screen() {
  const [params] = useSearchParams();
  const key = params.get("key") ?? "";
  const { data, error } = usePoll<ScreenData>(`/screen?key=${encodeURIComponent(key)}`, 4000);
  const celebration = useCelebrations((data?.liveGames ?? []).flatMap(celebrationsOf));

  if (error && !data) {
    return <div className="dark flex min-h-dvh items-center justify-center bg-bg p-8 text-center text-2xl text-fg">{error.message}</div>;
  }
  if (!data) return <div className="dark min-h-dvh bg-bg" />;

  const max = Math.max(1, ...data.teams.map((t) => t.total));
  return (
    <div className="dark min-h-dvh bg-bg p-6 text-fg md:p-10">
      <CelebrationOverlay c={celebration.current} onClose={celebration.dismiss} />
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Logo size={48} />
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Vegan Day Bash</h1>
        </div>
        <StatusPill status="live" />
      </header>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-6 lg:col-span-3">
          {data.liveGames.length === 0 && (
            <div className="rounded-2xl border border-line bg-surface p-12 text-center">
              <div className="text-sm font-semibold uppercase tracking-widest text-subtle">Up next</div>
              <div className="mt-2 text-4xl font-semibold tracking-tight">The next game is starting soon</div>
            </div>
          )}
          {data.liveGames.map((g) => (
            <LiveGame key={g.id} game={g} />
          ))}
        </section>

        <aside className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="mb-5 text-xs font-semibold uppercase tracking-widest text-subtle">Team standings</h2>
            <ul className="space-y-5">
              {data.teams.map((t) => (
                <li key={t.teamId}>
                  <div className="mb-2 flex items-center gap-3 text-2xl font-semibold">
                    <RankBadge rank={t.rank} plain={data.teams.every((x) => x.total === 0)} />
                    <TeamName teamId={t.teamId} size={34} className="flex-1" />
                    <CountUp value={t.total} />
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${(t.total / max) * 100}%`, background: t.color }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">Top 10 players</h2>
            {data.individual.top.length === 0 ? (
              <p className="text-muted">Solo games are about to begin.</p>
            ) : (
              <ol className="space-y-2 text-xl">
                {data.individual.top.map((r) => (
                  <li key={r.userId} className="flex items-center gap-3">
                    <RankBadge rank={r.rank} />
                    <span className="flex-1 truncate font-medium">{r.name}</span>
                    <TeamIcon teamId={r.teamId} size={26} />
                    <span className="w-12 text-right font-semibold tabular-nums">{r.value}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------- which moments get a full-screen celebration ----------
function celebrationsOf(g: GameDetail): Celebration[] {
  const out: Celebration[] = [];
  for (const m of g.matches ?? []) {
    if (!m.winnerTeam) continue;
    const final = m.stage === "final";
    const sub =
      g.type === "shark"
        ? (m.pitches ?? []).filter((p) => p.avg != null).map((p) => `${teamName(p.teamId)} ${p.avg!.toFixed(1)}`).join("  ·  ")
        : [m.teamA, m.teamB].filter((t): t is number => t != null).map((t) => `${teamName(t)} ${m.totals?.[t] ?? 0}`).join("  ·  ");
    out.push({
      id: `m${m.id}:${m.winnerTeam}`,
      teamId: m.winnerTeam,
      kicker: `${g.name} · ${stageLabel(m.stage)}`,
      title: final ? `${teamName(m.winnerTeam)} wins the final!` : `${teamName(m.winnerTeam)} moves on to the final`,
      sub,
    });
  }
  for (const r of g.rounds ?? []) {
    if (r.phase !== "done" || r.results.length === 0) continue;
    const firsts = r.results.filter((x) => x.rank === 1);
    out.push({
      id: `a${r.id}:${firsts.map((x) => x.teamId).join(",")}`,
      teamId: firsts.length === 1 ? firsts[0].teamId : null,
      kicker: `${g.name} · Round ${r.ord} result`,
      title: firsts.length === 1 ? `${teamName(firsts[0].teamId)} wins the round` : "Round result",
      rows: r.results.slice(0, 4).map((x) => ({ rank: x.rank, name: teamName(x.teamId), teamId: x.teamId, value: `+${x.points}` })),
    });
  }
  const tt = g.tictactoe;
  if (tt && tt.state !== "registration") {
    const R = tt.roundsCount;
    for (const r of tt.rounds) {
      const real = r.matches.filter((m) => !m.bye);
      if (!real.length || !real.every((m) => m.winnerId)) continue;
      const winners = r.matches.map((m) => (m.winnerId === m.a?.userId ? m.a : m.b)).filter((p): p is NonNullable<typeof p> => !!p && r.matches.some((m) => m.winnerId === p.userId));
      if (r.round === R) {
        const champ = tt.champion;
        if (champ) out.push({ id: `tc${g.id}:${champ.userId}`, teamId: champ.teamId, kicker: `${g.name} · Champion`, title: `${champ.name} wins the tournament!`, sub: "Paper cup flip champion" });
      } else if (r.round >= R - 2 && winners.length <= 4) {
        const next = tt.rounds[r.round];
        out.push({
          id: `tr${g.id}:${r.round}:${winners.map((w) => w.userId).join(",")}`,
          kicker: `${g.name} · ${next.name}`,
          title: winners.length === 2 ? "The final is set" : `${winners.length} players are through`,
          sub: winners.length === 2 ? `${winners[0].name} vs ${winners[1].name}` : `Into the ${next.name.toLowerCase()}`,
          rows: winners.map((w) => ({ rank: 1, name: w.name, teamId: w.teamId, value: "" })),
        });
      }
    }
  }
  const hs = g.hookstep;
  if (hs?.configured) {
    const lead = hs.standings.filter((s) => hs.leaders.includes(s.userId));
    if (hs.hasFinal && lead.length > 1) {
      out.push({
        id: `hf${g.id}:${hs.leaders.join(",")}`,
        kicker: `${g.name} · Final`,
        title: `${lead.length} players are level and go to the final`,
        sub: `Each has ${lead[0].total} of ${hs.steps * hs.roundsCount}`,
        rows: lead.slice(0, 5).map((s) => ({ rank: 1, name: s.name, teamId: s.teamId, value: `${s.total}` })),
      });
    }
    const won = hs.standings.filter((s) => s.winner);
    if (won.length) {
      out.push({
        id: `hw${g.id}:${won.map((s) => s.userId).join(",")}`,
        teamId: won.length === 1 ? won[0].teamId : null,
        kicker: `${g.name} · ${won.length === 1 ? "Winner" : "Winners"}`,
        title: won.length === 1 ? `${won[0].name} wins!` : `${won.length} players win together`,
        sub: won.length === 1 ? `${won[0].total} of ${hs.steps * hs.roundsCount} steps correct` : "Level at the top, so they all win",
        rows: won.length > 1 ? won.slice(0, 5).map((s) => ({ rank: 1, name: s.name, teamId: s.teamId, value: `${s.final ?? s.total}` })) : undefined,
      });
    }
  }
  const gr = g.greenred;
  if (gr?.mode) {
    for (const r of gr.rounds) {
      const timed = r.entries.filter((e) => e.seconds != null);
      if (r.status !== "done" || timed.length === 0) continue;
      const isFinal = r.kind === "final";
      out.push({
        id: `g${r.id}:${timed.slice(0, 3).map((e) => e.userId).join(",")}`,
        teamId: isFinal ? timed[0].teamId : null,
        kicker: `${g.name} · ${grName(r, gr.mode)}`,
        title: isFinal ? `${timed[0].name} wins!` : `${grName(r, gr.mode)} results`,
        sub: isFinal ? undefined : "The top 3 go to the final",
        rows: timed.slice(0, 3).map((e) => ({ rank: e.rank ?? 0, name: e.name, teamId: e.teamId, value: fmtTime(e.seconds!) })),
      });
    }
  }
  return out;
}

const grName = (r: GrRound, mode: string | null) => (r.kind === "heat" ? `Heat ${r.ord}` : mode === "single" ? "The race" : "The final");

// ---------- one stage per kind of game ----------
function LiveGame({ game }: { game: GameDetail }) {
  switch (game.type) {
    case "shark":
      return <SharkStage game={game} />;
    case "meme":
      return <MemeStage game={game} />;
    case "actout":
      return <ActStage game={game} />;
    case "greenred":
      return <RaceStage game={game} />;
    case "hookstep":
      return <HookStage game={game} />;
    case "tictactoe":
      return <TttStage game={game} />;
    case "individual":
      return <BoardStage game={game} />;
    default:
      return <Stage game={game} view={{ kicker: "Activity", tone: "live", title: game.description }} />;
  }
}

// the match to show: the one being played, else the last one finished, else the next
function pickMatch(matches: Match[]) {
  return matches.find((m) => m.status === "live") ?? [...matches].reverse().find((m) => m.status === "done") ?? matches[0];
}

function matchSteps(matches: Match[]): Step[] {
  const steps: Step[] = matches.map((m) => ({ label: stageLabel(m.stage), state: m.status === "done" ? "done" : m.status === "live" ? "live" : "next", teamId: m.winnerTeam }));
  if (!matches.some((m) => m.stage === "final")) steps.push({ label: "Final", state: "next" });
  return steps;
}

function SharkStage({ game }: { game: GameDetail }) {
  const now = useClock(offsetOf(game));
  const matches = game.matches ?? [];
  const m = pickMatch(matches);
  if (!m) return <Stage game={game} view={{ kicker: "Shark Tank", tone: "wait", title: "The pitches start soon" }} />;
  const pitches = m.pitches ?? [];
  const active = pitches.find((p) => p.phase === "prep" || p.phase === "pitching" || p.phase === "voting");
  const done = pitches.filter((p) => p.phase === "done");
  const waiting = pitches.find((p) => p.phase === "idle");
  const tie = m.status !== "done" && done.length === 2 && !m.winnerTeam;

  let view: StageView;
  if (active) {
    const who = teamName(active.teamId);
    view =
      active.phase === "voting"
        ? { kicker: stageLabel(m.stage), tone: "vote", title: `Vote for ${who}`, sub: `Everyone except ${who} rates the pitch from 1 to 10 on their phone`, clock: <PhaseTimer phase="voting" endsAt={active.phaseEndsAt} now={now} big /> }
        : { kicker: stageLabel(m.stage), tone: "live", title: active.phase === "prep" ? `${who} is preparing` : `${who} is pitching`, sub: active.item, clock: <PhaseTimer phase={active.phase} endsAt={active.phaseEndsAt} now={now} big /> };
  } else if (m.winnerTeam) {
    const final = m.stage === "final";
    view = { kicker: stageLabel(m.stage), tone: "done", title: final ? `${teamName(m.winnerTeam)} wins Shark Tank` : `${teamName(m.winnerTeam)} moves on to the final`, sub: done.map((p) => `${teamName(p.teamId)} ${p.avg?.toFixed(1)}`).join("  ·  ") };
  } else if (tie) {
    view = { kicker: stageLabel(m.stage), tone: "vote", title: "It's a tie", sub: "The organisers decide who moves on" };
  } else if (done.length === 1 && waiting) {
    view = { kicker: stageLabel(m.stage), tone: "wait", title: `${teamName(waiting.teamId)} pitches next`, sub: `${teamName(done[0].teamId)} scored ${done[0].avg?.toFixed(1)}` };
  } else {
    view = { kicker: stageLabel(m.stage), tone: "wait", title: `${teamName(m.teamA)} vs ${teamName(m.teamB)}`, sub: "Up next" };
  }
  view.steps = matchSteps(matches);
  view.body = (
    <div className="space-y-3">
      {active?.phase === "voting" && <VoteMeter count={active.votes} />}
      {pitches.length > 0
        ? pitches.map((p) => <PitchRow key={p.id} pitch={p} winner={m.winnerTeam === p.teamId} />)
        : [m.teamA, m.teamB].map((t, i) => t && <ScoreBar key={i} teamId={t} value={0} max={10} suffix="/10" caption="Waiting to pitch" />)}
    </div>
  );
  return <Stage game={game} view={view} />;
}

function PitchRow({ pitch, winner }: { pitch: Pitch; winner: boolean }) {
  if (pitch.phase === "done" && pitch.avg != null) {
    return <ScoreBar teamId={pitch.teamId} value={pitch.avg} max={10} decimals={1} suffix="/10" winner={winner} caption={`${pitch.item}  ·  ${pitch.votes} votes`} />;
  }
  return (
    <div className={`flex items-center gap-4 rounded-xl border p-4 ${pitch.phase === "idle" ? "border-line opacity-70" : "border-accent/60"}`}>
      <TeamName teamId={pitch.teamId} size={44} className="text-3xl font-semibold" />
      <span className="flex-1 truncate text-lg text-muted">{pitch.item}</span>
      <PhaseChip phase={pitch.phase} />
    </div>
  );
}

function MemeStage({ game }: { game: GameDetail }) {
  const now = useClock(offsetOf(game));
  const matches = game.matches ?? [];
  const m = pickMatch(matches);
  if (!m) return <Stage game={game} view={{ kicker: "Meme Charades", tone: "wait", title: "Meme Charades starts soon" }} />;
  const turns = m.turns ?? [];
  const active = turns.find((t) => t.phase !== "done");
  const acting = active?.phase === "acting";
  const totals = m.totals ?? {};

  let view: StageView;
  if (m.winnerTeam) {
    view = { kicker: stageLabel(m.stage), tone: "done", title: m.stage === "final" ? `${teamName(m.winnerTeam)} wins Meme Charades` : `${teamName(m.winnerTeam)} moves on to the final`, sub: [m.teamA, m.teamB].map((t) => `${teamName(t)} ${totals[t ?? 0] ?? 0}`).join("  ·  ") };
  } else if (active) {
    view = {
      kicker: `${stageLabel(m.stage)} · Turn ${active.ord} of ${turns.length}`,
      tone: acting ? "live" : "wait",
      title: acting ? `${teamName(active.teamId)} is acting` : `${teamName(active.teamId)} acts next`,
      sub: active.players.length ? active.players.map((p) => p.name).join(" · ") : "Guess the meme",
      clock: <ActTimer endsAt={active.phaseEndsAt} now={now} active={acting} big />,
    };
  } else if (turns.length > 0) {
    view = { kicker: stageLabel(m.stage), tone: "vote", title: "All turns are done", sub: "The organisers are counting the score" };
  } else {
    view = { kicker: stageLabel(m.stage), tone: "wait", title: `${teamName(m.teamA)} vs ${teamName(m.teamB)}`, sub: "Up next" };
  }
  view.steps = matchSteps(matches);
  view.body = (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 text-center">
        {[m.teamA, m.teamB].map((t, i) => (
          <div key={i} className={`rounded-xl border p-4 transition-colors ${m.winnerTeam && m.winnerTeam === t ? "border-warn bg-warn-soft" : "border-line"}`}>
            <TeamName teamId={t} size={38} className="justify-center text-2xl font-semibold" />
            <div className="text-8xl font-semibold tracking-tight">{t ? <CountUp value={totals[t] ?? 0} ms={700} /> : "–"}</div>
            {m.winnerTeam === t && (
              <div className="inline-flex items-center gap-1 text-lg font-semibold text-warn">
                <Crown size={20} /> {m.stage === "final" ? "Champion" : "Moves on"}
              </div>
            )}
          </div>
        ))}
      </div>
      {turns.length > 0 && <TurnTracker teamA={m.teamA} teamB={m.teamB} turns={turns} totals={totals} big />}
    </div>
  );
  return <Stage game={game} view={view} />;
}

function ActStage({ game }: { game: GameDetail }) {
  const now = useClock(offsetOf(game));
  const rounds = game.rounds ?? [];
  const active: ActRound | undefined = rounds.find((r) => r.phase !== "done");
  const lastDone = [...rounds].reverse().find((r) => r.phase === "done");
  const steps: Step[] = rounds.map((r) => ({ label: `Round ${r.ord}`, state: r.phase === "done" ? "done" : r.phase === "idle" ? "next" : "live", teamId: r.phase === "done" ? r.results.find((x) => x.rank === 1)?.teamId : null }));
  const voting = active?.phase === "voting";
  const cur = active && !voting ? active.turns.find((x) => x.phase !== "done") : null;
  const acting = cur?.phase === "acting";

  let view: StageView;
  if (!rounds.length) view = { kicker: "Act It Out", tone: "wait", title: "Act It Out starts soon" };
  else if (!active) view = { kicker: "Act It Out", tone: "done", title: "That's all the rounds", sub: "Thanks for playing!" };
  else if (voting) {
    view = { kicker: `Round ${active.ord} of ${rounds.length}`, tone: "vote", title: "Rank the other teams on your phone", sub: active.scene ? `Scene: ${active.scene}` : undefined, clock: <ActTimer endsAt={active.phaseEndsAt} now={now} active big label="voting time left" /> };
  } else if (cur) {
    view = { kicker: `Round ${active.ord} of ${rounds.length}`, tone: acting ? "live" : "wait", title: acting ? `${teamName(cur.teamId)} is acting the scene` : `${teamName(cur.teamId)} performs next`, sub: active.scene ? `Scene: ${active.scene}` : undefined, clock: <ActTimer endsAt={cur.phaseEndsAt} now={now} active={acting} big /> };
  } else {
    view = { kicker: `Round ${active.ord} of ${rounds.length}`, tone: "wait", title: active.phase === "idle" ? `Round ${active.ord} is about to start` : "Every team has performed", sub: active.phase === "idle" ? undefined : "Voting opens soon" };
  }
  view.steps = steps;
  view.body = (
    <div className="space-y-5">
      {active && <TeamOrder big turns={active.turns} />}
      {voting && active && <VoteMeter count={active.votes} />}
      {lastDone && !voting && (
        <div className="space-y-3">
          <div className="text-sm font-semibold uppercase tracking-widest text-subtle">Round {lastDone.ord} result</div>
          {lastDone.results.map((r) => (
            <ScoreBar key={r.teamId} teamId={r.teamId} rank={r.rank} value={r.avg} max={3} decimals={2} winner={r.rank === 1} caption={<span className="font-semibold text-accent">+{r.points} team points</span>} />
          ))}
        </div>
      )}
    </div>
  );
  return <Stage game={game} view={view} />;
}

function RaceStage({ game }: { game: GameDetail }) {
  const g = game.greenred;
  if (!g?.mode || g.rounds.length === 0) return <Stage game={game} view={{ kicker: "Individual game", tone: "wait", title: "Green light, red light", sub: "The race starts soon" }} />;
  const multi = g.mode === "multi";
  const rounds = [...g.rounds].sort((a, b) => a.ord - b.ord);
  const final = rounds.find((r) => r.kind === "final")!;
  const timedOf = (r: GrRound) => r.entries.filter((e) => e.seconds != null);
  // the round to show: the one racing, else the final once it has results, else the heat finished last
  const shown = rounds.find((r) => r.status === "live") ?? (timedOf(final).length ? final : ([...rounds].reverse().find((r) => r.status === "done") ?? rounds.find((r) => r.entries.length) ?? final));
  const timed = timedOf(shown);
  const racing = shown.entries.filter((e) => e.seconds == null);
  const name = grName(shown, g.mode);
  const winner = timed[0];

  let view: StageView;
  if (shown.status === "live") {
    view = { kicker: multi ? "Heats and final" : "One round", tone: "live", title: shown.kind === "final" && !multi ? "The race is on" : `${name} is racing`, sub: `${shown.entries.length} players  ·  ${timed.length} finished` };
  } else if (shown.status === "done" && timed.length) {
    view =
      shown.kind === "final"
        ? { kicker: multi ? "Final result" : "Result", tone: "done", title: `${winner.name} wins`, sub: `${fmtTime(winner.seconds!)}  ·  points ${g.points.slice(0, 3).join(" / ")} for the top 3` }
        : { kicker: "Heat result", tone: "done", title: `${name} is finished`, sub: "The top 3 go to the final" };
  } else {
    view = { kicker: multi ? "Heats and final" : "One round", tone: "wait", title: `${name} is up next`, sub: `${shown.entries.length} ${shown.entries.length === 1 ? "player" : "players"} ready` };
  }
  view.steps = multi ? rounds.map((r) => ({ label: grName(r, g.mode), state: r.status === "done" ? "done" : r.status === "live" ? "live" : "next" })) : undefined;
  view.body = (
    <div className="space-y-4">
      {timed.length > 0 && <Podium finishers={toFinishers(shown.entries)} big />}
      {timed.length > 3 && (
        <ul className="divide-y divide-line border-t border-line">
          {timed.slice(3, 8).map((e) => (
            <li key={e.userId} className="flex items-center gap-3 py-2 text-2xl">
              <RankBadge rank={e.rank!} />
              <span className="flex-1 truncate font-medium">{e.name}</span>
              <TeamIcon teamId={e.teamId} size={30} />
              <span className="w-28 text-right font-semibold tabular-nums">{fmtTime(e.seconds!)}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.status === "live" && racing.length > 0 && (
        <div className="rounded-xl bg-sunken p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-subtle">
            <span className="h-2 w-2 animate-pulse rounded-full bg-live" /> Still on the course
          </div>
          <div className="flex flex-wrap gap-2">
            {racing.slice(0, 12).map((e) => (
              <span key={e.userId} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1.5 pr-3 text-xl">
                <TeamIcon teamId={e.teamId} size={26} /> {e.name}
              </span>
            ))}
            {racing.length > 12 && <span className="px-2 text-xl text-muted">+{racing.length - 12} more</span>}
          </div>
        </div>
      )}
      {timed.length === 0 && shown.status !== "live" && shown.entries.length === 0 && <div className="py-2 text-center text-2xl text-muted">The organisers are lining people up.</div>}
    </div>
  );
  return <Stage game={game} view={view} />;
}

function TttStage({ game }: { game: GameDetail }) {
  const tt = game.tictactoe;
  if (!tt) return <Stage game={game} view={{ kicker: "Individual game", tone: "wait", title: "Tic-tac-toe tournament", sub: "Starting soon" }} />;
  let view: StageView;
  if (tt.state === "registration") {
    view = {
      kicker: "Registration",
      label: tt.joinOpen ? "Join now" : "Up next",
      tone: tt.joinOpen ? "vote" : "wait",
      title: tt.joinOpen ? "Join the tournament on your phone" : "The tournament starts soon",
      sub: tt.joinOpen ? "Open the app, go to Games, pick Paper Cup Flip Tic-Tac-Toe and tap Join" : `${tt.players} players registered`,
    };
    view.body = (
      <div className="space-y-4">
        <VoteMeter count={tt.players} label={tt.players === 1 ? "player joined" : "players joined"} />
        <div className="flex flex-wrap gap-2">
          {tt.roster.slice(-18).map((p) => (
            <span key={p.userId} className="slide-in inline-flex items-center gap-2 rounded-full border border-line bg-sunken py-1 pl-1.5 pr-3 text-xl">
              <TeamIcon teamId={p.teamId} size={26} /> {p.name}
            </span>
          ))}
          {tt.roster.length > 18 && <span className="px-2 text-xl text-muted">+{tt.roster.length - 18} more</span>}
        </div>
      </div>
    );
    return <Stage game={game} view={view} />;
  }

  const real = (r: (typeof tt.rounds)[number]) => r.matches.filter((m) => !m.bye);
  const current = tt.rounds.find((r) => real(r).some((m) => !m.winnerId)) ?? tt.rounds[tt.rounds.length - 1];
  const matches = real(current);
  const playing = matches.filter((m) => m.status === "live");
  const done = matches.filter((m) => m.winnerId).length;
  if (tt.champion) {
    view = { kicker: "Result", tone: "done", title: `${tt.champion.name} is the champion`, sub: `${tt.roster.length} players, ${tt.roundsCount} rounds` };
  } else {
    view = { kicker: `${tt.roster.length} players`, tone: playing.length ? "live" : "wait", title: `${current.name} ${playing.length ? "is on" : "is under way"}`, sub: `${done} of ${matches.length} matches done${playing.length ? `  ·  ${playing.length} playing now` : ""}` };
  }
  view.steps = tt.rounds.map((r) => ({ label: r.name, state: real(r).every((m) => m.winnerId) ? "done" : r.round === current.round ? "live" : "next" }));
  const shown = [...matches].sort((a, b) => Number(!!a.winnerId) - Number(!!b.winnerId) || Number(b.status === "live") - Number(a.status === "live") || a.slot - b.slot);
  const limit = tt.champion ? 1 : 8;
  const row = (m: (typeof matches)[number]) => (
    <li key={m.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-2xl ${m.status === "live" ? "border-accent/60 bg-accent-soft" : m.winnerId ? "border-line bg-sunken" : "border-line"}`}>
      {[m.a, m.b].map((p, i) => (
        <span key={i} className={`flex min-w-0 flex-1 items-center gap-2 ${i ? "justify-end text-right" : ""} ${m.winnerId && m.winnerId !== p?.userId ? "text-subtle line-through" : "font-semibold"}`}>
          {i === 0 && p && <TeamIcon teamId={p.teamId} size={30} />}
          <span className="truncate">{p ? p.name : "To be decided"}</span>
          {m.winnerId != null && m.winnerId === p?.userId && <Crown size={22} className="shrink-0 text-warn" />}
          {i === 1 && p && <TeamIcon teamId={p.teamId} size={30} />}
        </span>
      ))}
      {m.status === "live" && <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-live" />}
    </li>
  );
  view.body = (
    <div className="space-y-3">
      {!tt.champion && (
        <ul className="space-y-2">{shown.slice(0, limit).map(row)}</ul>
      )}
      {!tt.champion && shown.length > limit && <div className="text-center text-xl text-muted">+{shown.length - limit} more matches in this round</div>}
      {tt.champion && (
        <ul className="space-y-2">
          {tt.rounds
            .slice(-2)
            .reverse()
            .flatMap((r) => real(r))
            .slice(0, 3)
            .map(row)}
        </ul>
      )}
    </div>
  );
  return <Stage game={game} view={view} />;
}

function HookStage({ game }: { game: GameDetail }) {
  const h = game.hookstep;
  if (!h?.configured) return <Stage game={game} view={{ kicker: "Individual game", tone: "wait", title: "Hook Step Challenge", sub: "The organisers are setting up" }} />;
  const rounds = h.rounds;
  const live = rounds.find((r) => r.status === "live");
  const lastDone = [...rounds].reverse().find((r) => r.status === "done");
  const next = rounds.find((r) => r.status === "idle");
  const winners = h.standings.filter((s) => s.winner);
  const lead = h.standings.filter((s) => h.leaders.includes(s.userId));
  const max = h.steps * h.roundsCount;
  const watching = live?.turns.filter((t) => t.status === "live") ?? [];
  const finished = live?.turns.filter((t) => t.status === "done") ?? [];

  let view: StageView;
  if (live) {
    const total = live.kind === "final" ? lead.length : h.roster.length;
    view = { kicker: live.kind === "final" ? "Final" : `Round ${live.ord} of ${h.roundsCount}`, tone: "live", title: live.kind === "final" ? "The final is on" : `Round ${live.ord} is on`, sub: `${finished.length} of ${total} done  ·  ${watching.length} being watched now` };
  } else if (winners.length) {
    view = { kicker: "Result", tone: "done", title: winners.length === 1 ? `${winners[0].name} wins` : `${winners.length} players win together`, sub: winners.length === 1 ? `${winners[0].total} of ${max} steps correct` : "Level at the top, so everyone level wins" };
  } else if (h.phase === "final") {
    view = { kicker: "Final", tone: "vote", title: `${lead.length} players go to the final`, sub: `All level on ${lead[0]?.total} of ${max}` };
  } else if (lastDone) {
    view = { kicker: `${hsLabel(lastDone)} complete`, tone: "wait", title: next ? `${hsLabel(next)} is up next` : "All rounds are done", sub: `${h.roster.length} players` };
  } else {
    view = { kicker: "Individual game", tone: "wait", title: "Hook Step Challenge starts soon", sub: `${h.roster.length} ${h.roster.length === 1 ? "player" : "players"} ready  ·  ${h.roundsCount} rounds of ${h.steps} steps` };
  }
  view.steps = rounds.map((r) => ({ label: hsLabel(r), state: r.status === "done" ? "done" : r.status === "live" ? "live" : "next" }));
  const ranked = h.standings.filter((s) => s.rank != null).slice(0, 8);
  view.body = (
    <div className="space-y-5">
      {watching.length > 0 && (
        <div className="grid gap-3">
          {watching.slice(0, 4).map((t) => (
            <div key={t.userId} className="rounded-xl border border-accent/60 bg-sunken p-4">
              <div className="mb-3 flex items-center gap-3">
                <TeamIcon teamId={t.teamId} size={40} />
                <span className="flex-1 truncate text-3xl font-semibold">{t.name}</span>
                <span className="text-4xl font-semibold tabular-nums">
                  <CountUp value={passes(t.steps)} ms={400} />
                  <span className="text-xl text-muted"> correct</span>
                </span>
              </div>
              <StepDots steps={t.steps} total={h.steps} big />
            </div>
          ))}
          {watching.length > 4 && <div className="text-center text-xl text-muted">+{watching.length - 4} more being watched</div>}
        </div>
      )}
      {ranked.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold uppercase tracking-widest text-subtle">{h.phase === "done" ? "Final standings" : "Standings so far"}</div>
          <ol className="space-y-2">
            {ranked.map((s) => (
              <li key={s.userId} className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-2xl ${s.winner ? "border border-warn bg-warn-soft" : "bg-sunken"}`}>
                <RankBadge rank={s.rank!} />
                <span className="flex-1 truncate font-medium">{s.name}</span>
                {s.winner && <Crown size={24} className="text-warn" />}
                <TeamIcon teamId={s.teamId} size={30} />
                <span className="w-24 text-right font-semibold tabular-nums">
                  <CountUp value={s.total} ms={800} /> <span className="text-base text-muted">/ {max}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
  return <Stage game={game} view={view} />;
}

function BoardStage({ game }: { game: GameDetail }) {
  const top = game.board?.top.slice(0, 5) ?? [];
  const view: StageView = {
    kicker: "Individual game",
    tone: "live",
    title: top.length ? "Leaders so far" : "Be the first on the board",
    body: (
      <ol className="space-y-2 text-2xl">
        {top.map((r) => (
          <li key={r.userId} className="flex items-center gap-3">
            <RankBadge rank={r.rank} />
            <span className="flex-1 truncate">{r.name}</span>
            <TeamIcon teamId={r.teamId} size={30} />
            <span className="font-semibold tabular-nums">{r.detail}</span>
          </li>
        ))}
      </ol>
    ),
  };
  return <Stage game={game} view={view} />;
}
