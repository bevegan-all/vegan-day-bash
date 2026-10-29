import { useSearchParams } from "react-router-dom";
import { Crown } from "lucide-react";
import { teamById } from "../../shared/teams";
import { usePoll, stageLabel, toFinishers, fmtTime, type ActRound, type Board, type GameDetail, type GrRound, type Match, type Pitch, type TeamRow } from "../api";
import { ActTimer, TurnTracker } from "../meme";
import { TeamOrder } from "../actout";
import { PhaseChip, PhaseTimer, useClock } from "../shark";
import { TeamIcon } from "../art";
import { Podium } from "../components";
import { CelebrationOverlay, CountUp, ScoreBar, Stage, VoteMeter, useCelebrations, type Celebration, type Step, type StageView } from "../stage";
import { Logo, RankBadge, StatusPill, TeamName } from "../ui";

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
