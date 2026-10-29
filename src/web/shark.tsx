import { Check } from "lucide-react";
import { fmtClock, useClock } from "./clock";
import { PHASE_LABEL, stageLabel, type PitchPhase, type SharkLive } from "./api";
import { TeamIcon } from "./art";
import { RatingPicker } from "./components";
import { Card } from "./ui";

// ---------------------------------------------------------------------------
// Shared pieces for the Shark Tank turn-by-turn flow
// ---------------------------------------------------------------------------

const STEPS: { phase: Exclude<PitchPhase, "idle" | "done">; label: string }[] = [
  { phase: "prep", label: "Prepare" },
  { phase: "pitching", label: "Pitch" },
  { phase: "voting", label: "Vote" },
];

// Prepare, Pitch, Vote as a small progress strip
export function PhaseSteps({ phase }: { phase: PitchPhase }) {
  const at = phase === "idle" ? -1 : phase === "done" ? 3 : STEPS.findIndex((s) => s.phase === phase);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s.phase} className="flex flex-1 items-center gap-1.5">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
              i < at ? "bg-accent text-accent-fg" : i === at ? "bg-accent text-accent-fg ring-4 ring-accent/25" : "bg-sunken text-subtle"
            }`}
          >
            {i < at ? <Check size={12} strokeWidth={3} /> : i + 1}
          </span>
          <span className={`text-xs font-semibold ${i === at ? "text-fg" : "text-subtle"}`}>{s.label}</span>
          {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < at ? "bg-accent" : "bg-line"}`} />}
        </li>
      ))}
    </ol>
  );
}

const PHASE_TONE: Record<PitchPhase, string> = {
  idle: "bg-sunken text-muted",
  prep: "bg-warn-soft text-warn",
  pitching: "bg-accent-soft text-accent",
  voting: "bg-danger-soft text-live",
  done: "bg-sunken text-subtle",
};

export function PhaseChip({ phase }: { phase: PitchPhase }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${PHASE_TONE[phase]}`}>
      {phase === "voting" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />}
      {PHASE_LABEL[phase]}
    </span>
  );
}

// Big countdown. Shows a message when the time is up.
export function PhaseTimer({ phase, endsAt, now, big }: { phase: PitchPhase; endsAt: number | null; now: number; big?: boolean }) {
  const active = phase === "prep" || phase === "pitching" || phase === "voting";
  const left = endsAt ? endsAt - now : 0;
  const over = active && !!endsAt && left <= 0;
  return (
    <div className="text-center">
      <div className={`font-semibold tabular-nums tracking-tight ${big ? "text-8xl" : "text-5xl"} ${over ? "text-live" : ""}`}>
        {active && endsAt ? (over ? "0:00" : fmtClock(left)) : "–:––"}
      </div>
      <div className={`${big ? "text-2xl" : "text-sm"} font-medium text-muted`}>
        {over ? (phase === "voting" ? "Voting time is up" : "Time's up") : active ? `${PHASE_LABEL[phase].toLowerCase()} time left` : "Waiting to start"}
      </div>
    </div>
  );
}

// What a player sees for the turn in progress: whose turn, which phase, the clock, and voting.
export function SharkLiveCard({ shark, offset, onVoted }: { shark: SharkLive; offset: number; onVoted: () => void }) {
  const now = useClock(offset);
  const { phase } = shark;
  const timeUp = !!shark.endsAt && now > shark.endsAt + 5000;

  let message: string;
  if (shark.youPitching) {
    message =
      phase === "idle"
        ? "Your team is up next. Wait for the organisers to start your preparation."
        : phase === "prep"
          ? `Get ready. Plan your pitch for ${shark.item}.`
          : phase === "pitching"
            ? `You're on! Pitch ${shark.item} to the audience.`
            : "The audience is rating your pitch. You can't rate your own team.";
  } else {
    message =
      phase === "idle"
        ? `Team ${shark.teamName} pitches next.`
        : phase === "prep"
          ? `Team ${shark.teamName} is preparing their pitch.`
          : phase === "pitching"
            ? `Listen to Team ${shark.teamName}. You'll rate their pitch out of 10 next.`
            : shark.canVote
              ? ""
              : "You can't rate this pitch.";
  }

  return (
    <Card className={shark.youPitching ? "border-accent ring-1 ring-accent/30" : phase === "voting" && shark.canVote ? "border-live/50 ring-1 ring-live/20" : ""}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Shark Tank · {stageLabel(shark.stage)}</span>
        <PhaseChip phase={phase} />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <TeamIcon teamId={shark.teamId} size={52} />
        <div className="min-w-0">
          <div className="truncate text-xl font-semibold tracking-tight">Team {shark.teamName}</div>
          <div className="text-sm text-muted">
            {shark.ord === 1 ? "Pitching first" : "Pitching second"} · {shark.item}
          </div>
        </div>
      </div>

      {shark.youPitching && <div className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">It's your team's turn</div>}

      <div className="mb-4">
        <PhaseSteps phase={phase} />
      </div>

      <div className="rounded-xl bg-sunken py-4">
        <PhaseTimer phase={phase} endsAt={shark.endsAt} now={now} />
      </div>

      {message && <p className="mt-4 text-center text-sm font-medium text-muted">{message}</p>}

      {phase === "voting" && shark.canVote && (
        <div className="mt-4">
          {timeUp ? (
            <p className="text-center text-sm font-medium text-muted">Voting time is up. Thanks for rating!</p>
          ) : (
            <>
              <h3 className="mb-2 text-center font-semibold">Rate this pitch out of 10</h3>
              <RatingPicker
                key={shark.pitchId}
                pitch={{
                  id: shark.pitchId,
                  teamId: shark.teamId,
                  item: shark.item,
                  ord: shark.ord,
                  phase: "voting",
                  phaseEndsAt: shark.endsAt,
                  state: "voting",
                  votes: 0,
                  avg: null,
                  myRating: shark.myRating,
                  canVote: true,
                }}
                onDone={onVoted}
              />
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export { fmtClock, useClock };
