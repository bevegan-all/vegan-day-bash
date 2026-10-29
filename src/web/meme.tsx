import { Check, X } from "lucide-react";
import { teamById } from "../shared/teams";
import { stageLabel, type MemeLive, type MemeTurn } from "./api";
import { TeamIcon } from "./art";
import { fmtClock, useClock } from "./clock";
import { Card, TeamName } from "./ui";

// ---------------------------------------------------------------------------
// Meme Charades pieces shared by players, organisers and the big screen.
// The meme itself is never shown here: it is on the projector, and it is the answer.
// ---------------------------------------------------------------------------

// Countdown for one acting turn
export function ActTimer({ endsAt, now, active, big }: { endsAt: number | null; now: number; active: boolean; big?: boolean }) {
  const left = endsAt ? endsAt - now : 0;
  const over = active && !!endsAt && left <= 0;
  return (
    <div className="text-center">
      <div className={`font-semibold tabular-nums tracking-tight ${big ? "text-8xl" : "text-5xl"} ${over ? "text-live" : ""}`}>
        {active && endsAt ? (over ? "0:00" : fmtClock(left)) : "–:––"}
      </div>
      <div className={`${big ? "text-2xl" : "text-sm"} font-medium text-muted`}>{over ? "Time's up" : active ? "acting time left" : "Waiting to start"}</div>
    </div>
  );
}

function Dot({ turn, big }: { turn: MemeTurn; big?: boolean }) {
  const size = big ? "h-9 w-9" : "h-6 w-6";
  const icon = big ? 20 : 14;
  if (turn.phase === "done" && turn.result === "point")
    return (
      <span className={`flex ${size} items-center justify-center rounded-full bg-accent text-accent-fg`} title="Point">
        <Check size={icon} strokeWidth={3} />
      </span>
    );
  if (turn.phase === "done")
    return (
      <span className={`flex ${size} items-center justify-center rounded-full bg-danger-soft text-danger`} title="Fail">
        <X size={icon} strokeWidth={3} />
      </span>
    );
  if (turn.phase === "acting") return <span className={`${size} animate-pulse rounded-full border-2 border-accent bg-surface`} title="Acting now" />;
  return <span className={`${size} rounded-full bg-sunken`} title="Waiting" />;
}

// One row per team: a dot for each of its turns (point, fail, now, waiting) and the score
export function TurnTracker({
  teamA,
  teamB,
  turns,
  totals,
  big,
}: {
  teamA: number;
  teamB: number | null;
  turns: MemeTurn[];
  totals: Record<number, number>;
  big?: boolean;
}) {
  const teams = [teamA, teamB].filter((t): t is number => t != null);
  return (
    <div className={big ? "space-y-4" : "space-y-2.5"}>
      {teams.map((team) => (
        <div key={team} className="flex items-center gap-3">
          <TeamIcon teamId={team} size={big ? 44 : 26} />
          <div className={`flex flex-1 ${big ? "gap-3" : "gap-1.5"}`}>
            {turns
              .filter((t) => t.teamId === team)
              .map((t) => (
                <Dot key={t.id} turn={t} big={big} />
              ))}
          </div>
          <span className={`text-right font-semibold tabular-nums ${big ? "w-12 text-4xl" : "w-6 text-lg"}`}>{totals[team] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

// What a player sees for the turn in progress
export function MemeLiveCard({ meme, offset }: { meme: MemeLive; offset: number }) {
  const now = useClock(offset);
  const acting = meme.phase === "acting";

  const message = meme.youActing
    ? acting
      ? "Your players are acting. Everyone else on your team, shout your guesses!"
      : "Your team acts next. Send your players to the front."
    : acting
      ? "Watch them act. Their own team is guessing, so keep the answer to yourself."
      : `Team ${teamName(meme.teamId)} acts next.`;

  return (
    <Card className={meme.youActing ? "border-accent ring-1 ring-accent/30" : ""}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Meme Charades · {stageLabel(meme.stage)}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${acting ? "bg-accent-soft text-accent" : "bg-sunken text-muted"}`}>
          {acting && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
          {acting ? "Acting" : "Up next"}
        </span>
      </div>

      <div className="mb-4 flex items-center justify-center gap-5 rounded-xl bg-sunken py-3">
        <div className="flex items-center gap-2.5">
          <TeamIcon teamId={meme.teamA} size={36} />
          <span className="text-3xl font-semibold tabular-nums">{meme.scores[meme.teamA] ?? 0}</span>
        </div>
        <span className="text-subtle">–</span>
        <div className="flex items-center gap-2.5">
          <span className="text-3xl font-semibold tabular-nums">{meme.scores[meme.teamB] ?? 0}</span>
          <TeamIcon teamId={meme.teamB} size={36} />
        </div>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <TeamIcon teamId={meme.teamId} size={48} />
        <div className="min-w-0">
          <div className="truncate text-xl font-semibold tracking-tight">Team {teamName(meme.teamId)}</div>
          <div className="text-sm text-muted">
            Turn {meme.ord} of {meme.total}
          </div>
        </div>
      </div>

      {meme.youActing && <div className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">It's your team's turn</div>}

      {meme.players.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted">Acting:</span>
          {meme.players.map((p) => (
            <span key={p} className="rounded-full bg-sunken px-2.5 py-0.5 font-medium">
              {p}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-sunken py-4">
        <ActTimer endsAt={meme.endsAt} now={now} active={acting} />
      </div>

      <p className="mt-4 text-center text-sm font-medium text-muted">{message}</p>

      {meme.last && meme.last.ord === meme.ord - 1 && (
        <p className={`mt-3 flex items-center justify-center gap-2 text-sm font-semibold ${meme.last.result === "point" ? "text-accent" : "text-danger"}`}>
          {meme.last.result === "point" ? <Check size={16} strokeWidth={3} /> : <X size={16} strokeWidth={3} />}
          <TeamName teamId={meme.last.teamId} size={18} /> {meme.last.result === "point" ? "got a point" : "missed"} last turn
        </p>
      )}
    </Card>
  );
}

const teamName = (id: number) => teamById(id)?.name ?? "Team";
