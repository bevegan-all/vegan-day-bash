import { useState } from "react";
import { Check } from "lucide-react";
import { teamById } from "../shared/teams";
import { api, type ActOutLive, type GameDetail } from "./api";
import { TeamIcon } from "./art";
import { useClock } from "./clock";
import { useAuth } from "./auth";
import { ActTimer } from "./meme";
import { Btn, Card, RankBadge, TeamName, toast, toastError } from "./ui";

// ---------------------------------------------------------------------------
// Act It Out: every team performs the scene in turn, then everyone ranks the other three teams.
// ---------------------------------------------------------------------------

type Phase = "idle" | "acting" | "done";

// The four teams in the order they perform, showing who is done, who is on now, and who is next
export function TeamOrder({ turns, big }: { turns: { teamId: number; phase: Phase }[]; big?: boolean }) {
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Order of performance">
      {turns.map((t, i) => (
        <li key={t.teamId} className="flex flex-col items-center gap-1.5">
          <div className={`relative rounded-xl ${t.phase === "acting" ? "animate-pulse ring-4 ring-accent/40" : ""} ${t.phase === "idle" ? "opacity-55" : ""}`}>
            <TeamIcon teamId={t.teamId} size={big ? 72 : 46} />
            {t.phase === "done" && (
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-fg ring-2 ring-surface">
                <Check size={12} strokeWidth={3.5} />
              </span>
            )}
          </div>
          <span className={`${big ? "text-lg" : "text-xs"} font-semibold ${t.phase === "acting" ? "text-accent" : t.phase === "done" ? "text-fg" : "text-subtle"}`}>
            {t.phase === "acting" ? "Now" : t.phase === "done" ? "Done" : `#${i + 1}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

// "Tap the teams best first": each tap gives the next place, tap again to take it back
export function RankPicker({ roundId, eligible, initial, onSaved }: { roundId: number; eligible: number[]; initial: number[] | null; onSaved: () => void }) {
  const [order, setOrder] = useState<number[]>(initial ?? []);
  const [saved, setSaved] = useState<number[] | null>(initial);
  const [busy, setBusy] = useState(false);
  const same = saved && order.length === saved.length && order.every((x, i) => x === saved[i]);

  async function submit() {
    setBusy(true);
    try {
      await api(`/act-rounds/${roundId}/vote`, { body: { ranking: order } });
      setSaved(order);
      toast("Ranking saved");
      onSaved();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const place = (id: number) => order.indexOf(id) + 1;
  return (
    <div>
      <p className="mb-3 text-center text-sm text-muted">Tap the teams from best to worst. Your own team isn't here.</p>
      <div className="space-y-2">
        {eligible.map((id) => (
          <button
            key={id}
            onClick={() => setOrder(order.includes(id) ? order.filter((x) => x !== id) : order.length < eligible.length ? [...order, id] : order)}
            aria-pressed={order.includes(id)}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99] ${order.includes(id) ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-sunken"}`}
          >
            <TeamIcon teamId={id} size={44} />
            <span className="flex-1 text-lg font-semibold">{teamById(id)?.name}</span>
            <span className={`flex h-9 w-9 items-center justify-center rounded-full text-lg font-semibold ${order.includes(id) ? "bg-accent text-accent-fg" : "border-2 border-dashed border-line text-transparent"}`}>
              {place(id) || "·"}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Btn variant="ghost" size="sm" className="shrink-0 whitespace-nowrap" disabled={!order.length} onClick={() => setOrder([])}>
          Start over
        </Btn>
        <Btn full busy={busy} disabled={order.length < eligible.length || !!same} onClick={submit}>
          {same ? (
            <>
              <Check size={18} strokeWidth={3} /> Saved
            </>
          ) : saved ? (
            "Update ranking"
          ) : (
            "Submit ranking"
          )}
        </Btn>
      </div>
      {same && <p className="mt-2 text-center text-xs text-subtle">You can change it until voting closes.</p>}
    </div>
  );
}

// How a finished round went: place, team and points
export function RoundResults({ results, big }: { results: { teamId: number; rank: number; points: number }[]; big?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {results.map((r) => (
        <li key={r.teamId} className={`flex items-center gap-3 ${big ? "py-3 text-3xl" : "py-2"}`}>
          <RankBadge rank={r.rank} />
          <TeamName teamId={r.teamId} size={big ? 44 : 26} className="flex-1 font-medium" />
          <span className={`${big ? "text-3xl" : "text-sm"} font-semibold tabular-nums text-accent`}>+{r.points}</span>
        </li>
      ))}
    </ul>
  );
}

// What a player sees for the round in progress
export function ActOutLiveCard({ a, offset, onVoted }: { a: ActOutLive; offset: number; onVoted: () => void }) {
  const now = useClock(offset);
  const myTeam = useAuth().me?.team?.id;
  const voting = a.phase === "voting";
  const cur = a.current;
  const acting = cur?.phase === "acting";
  const mine = cur ? teamById(cur.teamId) : undefined;
  const timeUp = voting && !!a.endsAt && now > a.endsAt + 5000;

  const chip = voting ? "Voting" : acting ? "Performing" : cur ? "Up next" : "All done";
  const message = voting
    ? ""
    : !cur
      ? "Every team has performed. Voting opens soon."
      : acting
        ? `Watch Team ${mine?.name} act the scene. After everyone has performed, you will rank the other teams.`
        : `Team ${mine?.name} performs next.`;

  return (
    <Card className={voting && a.canVote ? "border-live/50 ring-1 ring-live/20" : ""}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Act It Out · Round {a.ord} of {a.total}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${voting ? "bg-danger-soft text-live" : acting ? "bg-accent-soft text-accent" : "bg-sunken text-muted"}`}>
          {(voting || acting) && <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${voting ? "bg-live" : "bg-accent"}`} />}
          {chip}
        </span>
      </div>

      {a.scene && <div className="mb-3 rounded-lg bg-sunken px-3 py-2 text-sm font-semibold">Scene: {a.scene}</div>}

      <div className="mb-4">
        <TeamOrder turns={a.turns} />
      </div>

      {!voting && cur && (
        <>
          <div className="mb-3 flex items-center gap-3">
            <TeamIcon teamId={cur.teamId} size={48} />
            <div className="min-w-0">
              <div className="truncate text-xl font-semibold tracking-tight">Team {mine?.name}</div>
              <div className="text-sm text-muted">{acting ? "is acting the scene" : "performs next"}</div>
            </div>
          </div>
          {myTeam === cur.teamId && (
            <div className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">{acting ? "It's your team's turn. Act it out!" : "You're up next. Get ready!"}</div>
          )}
          <div className="rounded-xl bg-sunken py-4">
            <ActTimer endsAt={cur.endsAt} now={now} active={acting} />
          </div>
        </>
      )}

      {voting && (
        <>
          <div className="mb-4 rounded-xl bg-sunken py-4">
            <ActTimer endsAt={a.endsAt} now={now} active label="voting time left" />
          </div>
          {!a.canVote ? (
            <p className="text-center text-sm text-muted">You're not on a team yet, so you can't vote.</p>
          ) : timeUp ? (
            <p className="text-center text-sm font-medium text-muted">Voting time is up. Thanks for ranking!</p>
          ) : (
            <RankPicker key={a.roundId} roundId={a.roundId} eligible={a.eligible} initial={a.myRanking} onSaved={onVoted} />
          )}
        </>
      )}

      {message && <p className="mt-4 text-center text-sm font-medium text-muted">{message}</p>}

      {a.last && (
        <div className="mt-5 border-t border-line pt-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-subtle">Round {a.last.ord} result</div>
          <RoundResults results={a.last.results} />
        </div>
      )}
    </Card>
  );
}

// The game page for everyone: points so far and how every round went
export function ActOutSummary({ game }: { game: GameDetail }) {
  const rounds = game.rounds ?? [];
  const totals = game.pointsByTeam ?? {};
  const teams = [1, 2, 3, 4].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0) || a - b);
  const finished = rounds.filter((r) => r.phase === "done");
  return (
    <>
      <Card>
        <h3 className="mb-3 font-semibold">Points in this game</h3>
        <div className="grid grid-cols-4 gap-2 text-center">
          {teams.map((t) => (
            <div key={t}>
              <div className="flex justify-center">
                <TeamIcon teamId={t} size={40} />
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{totals[t] ?? 0}</div>
            </div>
          ))}
        </div>
      </Card>
      {rounds.length === 0 && <Card className="text-center text-sm text-muted">The rounds start when the organisers begin the game.</Card>}
      {finished.map((r) => (
        <Card key={r.id}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-subtle">
            Round {r.ord}
            {r.scene ? ` · ${r.scene}` : ""}
          </div>
          <RoundResults results={r.results} />
        </Card>
      ))}
    </>
  );
}
