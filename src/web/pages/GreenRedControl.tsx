import { useState } from "react";
import { Minus, Plus, ScanLine, Shuffle, X } from "lucide-react";
import { TEAMS } from "../../shared/teams";
import { api, fmtTime, grLabel, toFinishers, type GameDetail, type GrRound } from "../api";
import { TeamIcon } from "../art";
import { useAuth } from "../auth";
import { Podium } from "../components";
import { PersonField, PersonPickerModal, type Person } from "../pickers";
import { Btn, Card, IconBtn, RankBadge, SectionLabel, Segmented, StatusPill, TeamChip, toast, toastError } from "../ui";

async function call(path: string, body: unknown = {}, method = "POST") {
  try {
    await api(path, { method, body });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

// Organiser screen for Green Light – Red Light: choose one round or several, then run each round.
export function GreenRedControl({ game, reload }: { game: GameDetail; reload: () => void }) {
  const g = game.greenred;
  const { me } = useAuth();
  const [pick, setPick] = useState<number | null>(null);
  const rounds = g?.rounds ?? [];

  if (!g || !g.mode || rounds.length === 0) return <SetupCard game={game} reload={reload} />;

  const selected = rounds.find((r) => r.id === pick) ?? rounds.find((r) => r.status !== "done") ?? rounds[rounds.length - 1];
  const multi = g.mode === "multi";
  const heatsEmpty = multi && rounds.filter((r) => r.kind === "heat").every((r) => r.entries.length === 0);

  return (
    <>
      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{multi ? `Multiple rounds: ${g.heats} heats and a final` : "Single round"}</h2>
        </div>
        <p className="text-sm text-muted">
          {multi
            ? "The top 3 of every heat go to the final. Only the final counts for the leaderboard."
            : "Players race once. The times are kept and decide the leaderboard."}{" "}
          Points: 1st {g.points[0] ?? 0}, 2nd {g.points[1] ?? 0}, 3rd {g.points[2] ?? 0}.
        </p>
        {heatsEmpty && (
          <Btn
            variant="secondary"
            full
            onClick={async () => {
              if (!confirm("Share everyone out across the heats at random? Everyone gets an alert.")) return;
              if (await call(`/admin/games/${game.id}/greenred/split`)) {
                toast("Everyone has been shared across the heats");
                reload();
              }
            }}
          >
            <Shuffle size={16} /> Share everyone evenly across the heats
          </Btn>
        )}
      </Card>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {rounds.map((r) => (
          <button
            key={r.id}
            onClick={() => setPick(r.id)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
              selected.id === r.id ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:text-fg"
            }`}
          >
            {grLabel(r, g.mode)}
            <span className={`ml-1.5 text-xs ${selected.id === r.id ? "opacity-80" : "text-subtle"}`}>{r.entries.length}</span>
            {r.status === "live" && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-live align-middle" />}
          </button>
        ))}
      </div>

      <RoundPanel key={selected.id} game={game} round={selected} mode={g.mode} reload={reload} />

      {me?.role === "admin" && (
        <Btn
          variant="ghost"
          full
          onClick={async () => {
            if (!confirm("Start Green Light – Red Light over? All rounds, times and leaderboard entries for this game are removed.")) return;
            if (await call(`/admin/games/${game.id}/greenred/reset`)) {
              toast("Game reset");
              reload();
            }
          }}
        >
          Start the game over (admin)
        </Btn>
      )}
    </>
  );
}

function SetupCard({ game, reload }: { game: GameDetail; reload: () => void }) {
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [heats, setHeats] = useState(4);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">How will this game run?</h2>
        <p className="mt-1 text-sm text-muted">Choose before the game starts. You can't change it later without starting over.</p>
      </div>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "single", label: "Single round" },
          { value: "multi", label: "Multiple rounds" },
        ]}
      />
      {mode === "single" ? (
        <p className="text-sm text-muted">Everyone races once. You add the players and record the times. The times decide the leaderboard.</p>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-lg bg-sunken p-2">
            <span className="pl-2 text-sm font-medium">Number of heats</span>
            <div className="flex items-center gap-2">
              <IconBtn label="Fewer heats" onClick={() => setHeats(Math.max(1, heats - 1))}>
                <Minus size={18} />
              </IconBtn>
              <span className="w-6 text-center text-xl font-semibold tabular-nums">{heats}</span>
              <IconBtn label="More heats" onClick={() => setHeats(Math.min(8, heats + 1))}>
                <Plus size={18} />
              </IconBtn>
            </div>
          </div>
          <p className="text-sm text-muted">
            {heats} heats are played first. The top 3 of every heat (up to {heats * 3} players) go to the final. The final decides the leaderboard: 1st gets 3 points, 2nd gets 2 and 3rd gets 1.
          </p>
        </>
      )}
      <Btn
        full
        size="lg"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          if (await call(`/admin/games/${game.id}/greenred/setup`, { mode, heats })) reload();
          setBusy(false);
        }}
      >
        {mode === "single" ? "Start with a single round" : `Create ${heats} heats and a final`}
      </Btn>
    </Card>
  );
}

function RoundPanel({ game, round, mode, reload }: { game: GameDetail; round: GrRound; mode: string; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [seconds, setSeconds] = useState("");
  const [busy, setBusy] = useState(false);
  const label = grLabel(round, mode);
  const autoFilled = round.kind === "final" && mode === "multi";
  const timed = round.entries.filter((e) => e.seconds != null);
  const timeOk = seconds !== "" && Number(seconds) > 0 && Number.isFinite(Number(seconds));

  async function addScope(scope: "all" | "checked_in" | "team", what: string, teamId?: number) {
    if (!confirm(`Add ${what} to ${label}? Each person gets an alert on their phone.`)) return;
    try {
      const r = await api<{ added: number; total: number }>(`/admin/gr-rounds/${round.id}/players`, { body: { scope, teamId } });
      toast(r.added ? `Added ${r.added}, ${r.total} in ${label}` : "Nobody new to add");
      reload();
    } catch (e) {
      toastError(e);
    }
  }

  async function addPerson(p: Person) {
    if (await call(`/admin/gr-rounds/${round.id}/players`, { userIds: [p.id] })) reload();
  }

  async function setStatus(status: string) {
    if (await call(`/admin/gr-rounds/${round.id}/status`, { status })) {
      if (round.kind === "heat" && status === "done") toast("Heat finished: its top 3 are in the final");
      reload();
    }
  }

  async function saveTime() {
    setBusy(true);
    if (await call(`/admin/gr-rounds/${round.id}/time`, { userId: person?.id, seconds: Number(seconds) })) {
      toast(`${person?.name}: ${fmtTime(Number(seconds))}`);
      setPerson(null);
      setSeconds("");
      reload();
    }
    setBusy(false);
  }

  return (
    <>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{label[0].toUpperCase() + label.slice(1)}</h2>
          <StatusPill status={round.status === "done" ? "closed" : round.status === "live" ? "live" : "upcoming"} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {round.status !== "live" ? (
            <Btn onClick={() => setStatus("live")}>{round.status === "done" ? "Reopen" : "Start round"}</Btn>
          ) : (
            <Btn variant="secondary" disabled>
              Round is live
            </Btn>
          )}
          <Btn variant={round.status === "done" ? "secondary" : "primary"} disabled={round.status === "done"} onClick={() => setStatus("done")}>
            {round.kind === "heat" ? "Finish heat" : "Finish round"}
          </Btn>
        </div>
        {round.kind === "heat" && <p className="text-xs text-subtle">Finishing a heat sends its top 3 to the final.</p>}
      </Card>

      <Card className="space-y-3">
        <div>
          <h3 className="font-semibold">Players ({round.entries.length})</h3>
          <p className="mt-1 text-sm text-muted">
            {autoFilled ? "The top 3 of every finished heat are added here automatically. You can also add someone by hand." : "Everyone you add gets an alert on their phone. Several organisers can add people at the same time."}
          </p>
        </div>
        {!autoFilled && (
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="secondary" size="sm" onClick={() => addScope("all", "everyone")}>
              Add everyone
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => addScope("checked_in", "everyone checked in")}>
              Add checked-in
            </Btn>
            {TEAMS.map((t) => (
              <Btn key={t.id} variant="secondary" size="sm" onClick={() => addScope("team", `all of Team ${t.name}`, t.id)}>
                <TeamIcon teamId={t.id} size={20} /> Team {t.name}
              </Btn>
            ))}
          </div>
        )}
        <Btn full onClick={() => setAdding(true)}>
          <ScanLine size={18} /> Add people (scan or search)
        </Btn>
        {adding && <PersonPickerModal title={`Add players to ${label}`} multi onPick={addPerson} onClose={() => setAdding(false)} />}
      </Card>

      <Card className="space-y-3">
        <div>
          <h3 className="font-semibold">Record a finish</h3>
          <p className="mt-1 text-sm text-muted">Scan the player at the finish line and type their time. Saving again replaces it.</p>
        </div>
        <PersonField label="Finisher" value={person} onChange={setPerson} />
        <div>
          <div className="mb-1.5 text-sm font-medium text-muted">Time in seconds</div>
          <input
            className="w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-2xl font-semibold tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            inputMode="decimal"
            placeholder="12.40"
            aria-label="Time in seconds"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </div>
        <Btn full size="lg" busy={busy} disabled={!person || !timeOk} onClick={saveTime}>
          Save time
        </Btn>
      </Card>

      <section>
        <SectionLabel>Results</SectionLabel>
        <Card className="space-y-4">
          {timed.length === 0 ? <p className="text-sm text-muted">No finish times yet.</p> : <Podium finishers={toFinishers(round.entries)} />}
          {round.entries.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {round.entries.map((e) => (
                <li key={e.userId} className="flex items-center gap-2 py-2">
                  {e.rank ? <RankBadge rank={e.rank} /> : <span className="w-7 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                  <TeamChip teamId={e.teamId} small />
                  <button
                    className="w-16 text-right text-sm font-semibold tabular-nums text-accent"
                    onClick={() => {
                      setPerson({ id: e.userId, name: e.name, teamId: e.teamId });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    {e.seconds != null ? fmtTime(e.seconds) : "Set time"}
                  </button>
                  <IconBtn
                    label={`Remove ${e.name}`}
                    className="!h-8 !w-8 text-danger"
                    onClick={async () => confirm(`Take ${e.name} off ${label}? They get an alert, and any time they have is removed.`) && (await call(`/admin/gr-rounds/${round.id}/players/${e.userId}`, undefined, "DELETE")) && reload()}
                  >
                    <X size={18} />
                  </IconBtn>
                </li>
              ))}
            </ul>
          )}
          {round.entries.length > 0 && (
            <Btn
              variant="ghost"
              size="sm"
              onClick={async () => confirm(`Clear the whole list of ${label}? Nobody is told.`) && (await call(`/admin/gr-rounds/${round.id}/players`, undefined, "DELETE")) && reload()}
            >
              Clear the whole list
            </Btn>
          )}
        </Card>
      </section>
      <p className="hidden">{game.id}</p>
    </>
  );
}
