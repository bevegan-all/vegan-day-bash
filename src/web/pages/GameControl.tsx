import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Dices, MapPin, Minus, Play, Plus, ScanLine, Square, X } from "lucide-react";
import { TEAMS, teamById } from "../../shared/teams";
import { api, fmtTime, stageLabel, usePoll, type GameDetail, type Match, type Pitch } from "../api";
import { useAuth } from "../auth";
import { TeamIcon } from "../art";
import { GameThumb, LocationTag, Podium } from "../components";
import { PersonField, PersonPickerModal, type Person } from "../pickers";
import { PhaseChip, PhaseSteps, PhaseTimer, useClock } from "../shark";
import { Btn, Card, Countdown, ErrorBox, IconBtn, Modal, Page, RankBadge, SectionLabel, Spinner, StatusPill, TeamChip, TeamMark, TeamName, toast, toastError } from "../ui";

async function call(path: string, body: unknown = {}, method = "POST") {
  try {
    await api(path, { method, body });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "closed", label: "Finished" },
] as const;

export function GameControl() {
  const { id } = useParams();
  const { me } = useAuth();
  const { data, error, loading, reload } = usePoll<GameDetail>(`/admin/games/${id}`, 8000);

  async function setStatus(status: string) {
    if (await call(`/admin/games/${id}`, { status }, "PATCH")) reload();
  }

  async function resetBracket() {
    if (!confirm("Delete the whole bracket and its points for this game? This cannot be undone.")) return;
    if (await call(`/admin/games/${id}/bracket/reset`)) {
      toast("Bracket reset");
      reload();
    }
  }

  return (
    <Page title={data?.name ?? "Game"} back="/admin">
      {loading && !data && <Spinner />}
      {error && !data && <ErrorBox message={error.message} onRetry={reload} />}
      {data && (
        <>
          <GameThumb slug={data.slug} name={data.name} className="aspect-[16/6] w-full rounded-xl border border-line" />
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <StatusPill status={data.status} />
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{data.kind === "team" ? "Team game" : "Individual game"}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStatus(s.value)}
                  className={`rounded-md py-2 text-xs font-semibold transition ${data.status === s.value ? "bg-accent text-accent-fg" : "bg-sunken text-muted hover:text-fg"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted">{data.rules}</p>
            {me?.role === "admin" ? (
              <LocationEditor game={data} reload={reload} />
            ) : (
              <LocationTag location={data.location} className="mt-3 text-sm font-medium text-muted" />
            )}
          </Card>

          {data.type === "individual" && <IndividualControl game={data} reload={reload} />}
          {data.type === "greenred" && <GreenRedControl game={data} reload={reload} />}
          {data.type === "meme" && <BracketControl game={data} reload={reload} kind="meme" />}
          {data.type === "shark" && <BracketControl game={data} reload={reload} kind="shark" />}
          {data.type === "activity" && <ActivityControl />}

          {(data.type === "meme" || data.type === "shark") && me?.role === "admin" && data.matches && data.matches.length > 0 && (
            <Btn variant="ghost" full onClick={resetBracket}>
              Reset bracket (admin)
            </Btn>
          )}
        </>
      )}
    </Page>
  );
}

// ---------- Individual games ----------
function IndividualControl({ game, reload }: { game: GameDetail; reload: () => void }) {
  const isMatch = game.resultType === "match_win";
  const [p1, setP1] = useState<Person | null>(null);
  const [p2, setP2] = useState<Person | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const unit = { score_high: "Score", time_high: "Seconds", time_low: "Seconds", placement: "Place (1 is best)" }[game.resultType ?? ""] ?? "Value";

  async function save() {
    setBusy(true);
    const body = isMatch
      ? { winnerId: p1?.id, loserId: p2?.id, idem: crypto.randomUUID() }
      : { userId: p1?.id, value: Number(value), idem: crypto.randomUUID() };
    if (await call(`/admin/games/${game.id}/results`, body)) {
      toast("Saved");
      setP1(null);
      setP2(null);
      setValue("");
      reload();
    }
    setBusy(false);
  }

  async function voidResult(rid: number) {
    if (!confirm("Remove this result?")) return;
    if (await call(`/admin/results/${rid}`, undefined, "DELETE")) reload();
  }

  const ready = isMatch ? !!p1 && !!p2 : !!p1 && value !== "" && Number.isFinite(Number(value));

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-semibold">{isMatch ? "Record a match" : "Record a result"}</h2>
        <PersonField label={isMatch ? "Winner" : "Player"} value={p1} onChange={setP1} />
        {isMatch ? (
          <PersonField label="Loser" value={p2} onChange={setP2} />
        ) : (
          <div>
            <div className="mb-1.5 text-sm font-medium text-muted">{unit}</div>
            <input
              className="w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-2xl font-semibold tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              aria-label={unit}
            />
            {game.resultType === "placement" && (
              <div className="mt-2 flex gap-2">
                {[1, 2, 3].map((n) => (
                  <Btn key={n} variant="secondary" size="sm" onClick={() => setValue(String(n))}>
                    {n === 1 ? "1st" : n === 2 ? "2nd" : "3rd"}
                  </Btn>
                ))}
              </div>
            )}
          </div>
        )}
        <Btn full size="lg" busy={busy} disabled={!ready} onClick={save}>
          Save
        </Btn>
      </Card>

      <section>
        <SectionLabel>Recent entries</SectionLabel>
        <Card>
          {!game.recent || game.recent.length === 0 ? (
            <p className="text-sm text-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {game.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  <TeamChip teamId={r.teamId} small />
                  <span className="w-12 text-right text-sm font-semibold tabular-nums">{isMatch ? (r.value ? "Won" : "Lost") : r.value}</span>
                  <IconBtn label="Remove result" onClick={() => voidResult(r.id)} className="!h-8 !w-8 text-danger">
                    <X size={18} />
                  </IconBtn>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}

// ---------- Green Light – Red Light ----------
function GreenRedControl({ game, reload }: { game: GameDetail; reload: () => void }) {
  const g = game.greenred;
  const roster = g?.roster ?? [];
  const finishers = g?.finishers ?? [];
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [seconds, setSeconds] = useState("");
  const [busy, setBusy] = useState(false);

  async function addScope(scope: "all" | "checked_in" | "team", label: string, teamId?: number) {
    if (!confirm(`Add ${label}? Each person gets an alert on their phone.`)) return;
    try {
      const r = await api<{ added: number; total: number }>(`/admin/games/${game.id}/players`, { body: { scope, teamId } });
      toast(r.added ? `Added ${r.added} players, ${r.total} in total` : "Everyone there was already added");
      reload();
    } catch (e) {
      toastError(e);
    }
  }

  async function addPerson(p: Person) {
    if (await call(`/admin/games/${game.id}/players`, { userIds: [p.id] })) reload();
  }

  async function removePlayer(userId: number, name: string) {
    if (!confirm(`Take ${name} off the player list? They get an alert, and any finish time they have is removed.`)) return;
    if (await call(`/admin/games/${game.id}/players/${userId}`, undefined, "DELETE")) reload();
  }

  async function clearAll() {
    if (!confirm("Clear the whole player list and all finish times? Nobody is told. This is for fixing a mistake.")) return;
    if (await call(`/admin/games/${game.id}/players`, undefined, "DELETE")) {
      toast("Player list cleared");
      reload();
    }
  }

  async function saveTime() {
    setBusy(true);
    if (await call(`/admin/games/${game.id}/finish`, { userId: person?.id, seconds: Number(seconds) })) {
      toast(`${person?.name}: ${fmtTime(Number(seconds))}`);
      setPerson(null);
      setSeconds("");
      reload();
    }
    setBusy(false);
  }

  async function removeTime(resultId: number) {
    if (!confirm("Remove this finish time?")) return;
    if (await call(`/admin/results/${resultId}`, undefined, "DELETE")) reload();
  }

  const timeOk = seconds !== "" && Number(seconds) > 0 && Number.isFinite(Number(seconds));

  return (
    <>
      <Card className="space-y-3">
        <div>
          <h2 className="font-semibold">Players ({roster.length})</h2>
          <p className="mt-1 text-sm text-muted">Everyone you add gets an alert on their phone telling them they are in and where to go ({game.location}).</p>
        </div>
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
        <Btn full onClick={() => setAdding(true)}>
          <ScanLine size={18} /> Add people (scan or search)
        </Btn>
        {adding && <PersonPickerModal title="Add players" multi onPick={addPerson} onClose={() => setAdding(false)} />}
      </Card>

      <Card className="space-y-3">
        <div>
          <h2 className="font-semibold">Record a finish</h2>
          <p className="mt-1 text-sm text-muted">Scan the player at the finish line and type their time. The fastest time wins. Saving again for the same person replaces their time.</p>
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
          {finishers.length === 0 ? <p className="text-sm text-muted">No finish times yet.</p> : <Podium finishers={finishers} />}
          {finishers.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {finishers.map((f) => (
                <li key={f.resultId} className="flex items-center gap-2 py-2">
                  <RankBadge rank={f.rank} />
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <TeamChip teamId={f.teamId} small />
                  <span className="w-16 text-right text-sm font-semibold tabular-nums">{fmtTime(f.seconds)}</span>
                  <IconBtn label="Remove time" onClick={() => removeTime(f.resultId)} className="!h-8 !w-8 text-danger">
                    <X size={18} />
                  </IconBtn>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <details className="rounded-xl border border-line bg-surface p-4" open={roster.length > 0 && roster.length <= 12}>
        <summary className="cursor-pointer font-semibold">Player list ({roster.length})</summary>
        <ul className="mt-2 divide-y divide-line">
          {roster.map((p) => (
            <li key={p.userId} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <TeamChip teamId={p.teamId} small />
              <button
                className="w-16 text-right text-sm font-semibold tabular-nums text-accent"
                onClick={() => {
                  setPerson({ id: p.userId, name: p.name, teamId: p.teamId });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                {p.seconds != null ? fmtTime(p.seconds) : "Set time"}
              </button>
              <IconBtn label={`Remove ${p.name}`} onClick={() => removePlayer(p.userId, p.name)} className="!h-8 !w-8 text-danger">
                <X size={18} />
              </IconBtn>
            </li>
          ))}
          {roster.length === 0 && <li className="py-4 text-center text-sm text-muted">No players added yet.</li>}
        </ul>
        {roster.length > 0 && (
          <Btn variant="ghost" size="sm" className="mt-2" onClick={clearAll}>
            Clear the whole list
          </Btn>
        )}
      </details>
    </>
  );
}

// Where the game happens. Everything defaults to the terrace.
function LocationEditor({ game, reload }: { game: GameDetail; reload: () => void }) {
  const [custom, setCustom] = useState("");
  async function set(location: string) {
    if (await call(`/admin/games/${game.id}`, { location }, "PATCH")) {
      toast(`Location: ${location}`);
      setCustom("");
      reload();
    }
  }
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted">
        <MapPin size={15} /> Location
      </div>
      <div className="flex flex-wrap gap-2">
        {["Terrace", "Hall"].map((l) => (
          <button
            key={l}
            onClick={() => set(l)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${game.location === l ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:text-fg"}`}
          >
            {l}
          </button>
        ))}
        <input
          className="min-w-0 flex-1 rounded-full border border-line bg-surface px-3.5 py-1.5 text-base outline-none focus:border-accent"
          placeholder={["Terrace", "Hall"].includes(game.location) ? "Somewhere else…" : game.location}
          aria-label="Custom location"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && custom.trim() && set(custom.trim())}
        />
        {custom.trim() && (
          <Btn size="sm" onClick={() => set(custom.trim())}>
            Set
          </Btn>
        )}
      </div>
    </div>
  );
}

// ---------- Brackets (Meme Charades, Shark Tank) ----------
// Every way to split four teams into two matches
const PAIRINGS: [number, number][][] = [
  [[1, 2], [3, 4]],
  [[1, 3], [2, 4]],
  [[1, 4], [2, 3]],
];

function PairingPicker({ onCreate, label, onCancel }: { onCreate: (pairs: [number, number][]) => Promise<void>; label: string; onCancel?: () => void }) {
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold">Who plays whom?</h2>
        <p className="mt-1 text-sm text-muted">Choose the two first matches. The winners then meet in the final.</p>
      </div>
      <div className="space-y-2">
        {PAIRINGS.map((pairs, i) => (
          <button
            key={i}
            onClick={() => setPick(i)}
            aria-pressed={pick === i}
            className={`w-full rounded-lg border p-3 text-left transition ${pick === i ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-sunken"}`}
          >
            {pairs.map(([a, b], m) => (
              <div key={m} className="flex items-center justify-center gap-3 py-1 text-sm font-semibold">
                <TeamName teamId={a} size={26} className="w-24 justify-end flex-row-reverse" />
                <span className="text-xs font-medium text-subtle">vs</span>
                <TeamName teamId={b} size={26} className="w-24" />
              </div>
            ))}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {onCancel && (
          <Btn variant="secondary" onClick={onCancel}>
            Cancel
          </Btn>
        )}
        <Btn
          full
          size="lg"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onCreate(PAIRINGS[pick]);
            setBusy(false);
          }}
        >
          {label}
        </Btn>
      </div>
    </Card>
  );
}

function BracketControl({ game, reload, kind }: { game: GameDetail; reload: () => void; kind: "meme" | "shark" }) {
  const matches = game.matches ?? [];
  const [changing, setChanging] = useState(false);
  // matchups can be changed until anything has started
  const untouched = matches.length > 0 && matches.length === 2 && matches.every((m) => m.status === "pending" && !(m.rounds?.length) && !(m.pitches?.length));

  async function create(pairs: [number, number][]) {
    if (await call(`/admin/games/${game.id}/bracket`, { pairs })) {
      toast("Matchups set");
      setChanging(false);
      reload();
    }
  }
  return (
    <>
      {kind === "meme" && <Countdown presets={[{ label: "Decide 1:00", seconds: 60 }, { label: "Act 1:00", seconds: 60 }]} />}
      {matches.length === 0 || changing ? (
        <PairingPicker onCreate={create} label={matches.length ? "Save matchups" : "Create bracket"} onCancel={changing ? () => setChanging(false) : undefined} />
      ) : (
        <>
          {untouched && (
            <Btn variant="secondary" full onClick={() => setChanging(true)}>
              Change who plays whom
            </Btn>
          )}
          {matches.map((m) => (kind === "meme" ? <MemeMatch key={m.id} match={m} reload={reload} /> : <SharkRound key={m.id} match={m} game={game} reload={reload} />))}
        </>
      )}
    </>
  );
}

function FinishButton({ match, reload, label = "Finish match" }: { match: Match; reload: () => void; label?: string }) {
  const [tie, setTie] = useState(false);
  async function finish(winnerTeam?: number) {
    try {
      await api(`/admin/matches/${match.id}/finish`, { body: winnerTeam ? { winnerTeam } : {} });
      toast("Match finished and points given");
      setTie(false);
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/tie/i.test(msg)) setTie(true);
      else toastError(e);
    }
  }
  return (
    <>
      <Btn full variant={match.status === "done" ? "secondary" : "primary"} onClick={() => finish()}>
        {match.status === "done" ? "Recalculate winner" : label}
      </Btn>
      {tie && (
        <Modal title="It's a tie" onClose={() => setTie(false)}>
          <p className="mb-4 text-sm text-muted">Add another round, or pick the winner yourself.</p>
          <div className="grid gap-2">
            {[match.teamA, match.teamB].map(
              (t) =>
                t && (
                  <Btn key={t} size="lg" onClick={() => finish(t)}>
                    <TeamIcon teamId={t} size={24} /> {teamById(t)?.name} wins
                  </Btn>
                ),
            )}
            <Btn variant="ghost" onClick={() => setTie(false)}>
              Add a sudden-death round instead
            </Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

function MemeMatch({ match, reload }: { match: Match; reload: () => void }) {
  const roundsDone = Math.max(0, ...(match.rounds ?? []).map((r) => r.round));
  const [round, setRound] = useState(Math.min(roundsDone + 1, 12));
  const teams = [match.teamA, match.teamB].filter((t): t is number => t != null);
  const existing = (r: number, t: number) => match.rounds?.find((x) => x.round === r && x.teamId === t)?.correct ?? 0;
  const [scores, setScores] = useState<Record<number, number>>(Object.fromEntries(teams.map((t) => [t, 0])));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setScores(Object.fromEntries(teams.map((t) => [t, existing(round, t)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, match.rounds?.length]);

  async function save() {
    setBusy(true);
    if (await call(`/admin/matches/${match.id}/rounds`, { round, scores })) {
      toast(`Round ${round} saved`);
      reload();
      if (round === roundsDone + 1) setRound(Math.min(round + 1, 12));
    }
    setBusy(false);
  }

  const done = match.status === "done";
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{stageLabel(match.stage)}</h2>
        <StatusPill status={done ? "closed" : match.status === "live" ? "live" : "upcoming"} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        {teams.map((t) => (
          <div key={t} className={`rounded-lg border p-3 ${match.winnerTeam === t ? "border-accent bg-accent-soft" : "border-line bg-sunken"}`}>
            <TeamName teamId={t} size={22} className="justify-center text-sm font-semibold" />
            <div className="text-4xl font-semibold tabular-nums tracking-tight">{match.totals?.[t] ?? 0}</div>
          </div>
        ))}
      </div>

      {!done && (
        <>
          <div className="flex items-center justify-between rounded-lg bg-sunken p-1.5">
            <Btn variant="ghost" size="sm" onClick={() => setRound(Math.max(1, round - 1))} aria-label="Previous round">
              ‹
            </Btn>
            <span className="font-semibold">
              Round {round}
              {round > 5 && <span className="ml-1.5 text-xs font-semibold text-warn">Sudden death</span>}
            </span>
            <Btn variant="ghost" size="sm" onClick={() => setRound(Math.min(12, round + 1))} aria-label="Next round">
              ›
            </Btn>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {teams.map((t) => (
              <div key={t} className="text-center">
                <div className="mb-2 text-sm font-medium text-muted">{teamById(t)?.name} correct guesses</div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-surface transition active:bg-sunken"
                    aria-label={`Fewer for ${teamById(t)?.name}`}
                    onClick={() => setScores({ ...scores, [t]: Math.max(0, scores[t] - 1) })}
                  >
                    <Minus size={20} />
                  </button>
                  <span className="w-10 text-3xl font-semibold tabular-nums">{scores[t]}</span>
                  <button
                    className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-accent-fg transition active:brightness-90"
                    aria-label={`More for ${teamById(t)?.name}`}
                    onClick={() => setScores({ ...scores, [t]: scores[t] + 1 })}
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Btn full busy={busy} onClick={save}>
            Save round {round}
          </Btn>
        </>
      )}
      {match.rounds && match.rounds.length > 0 && (
        <p className="text-center text-xs text-subtle">
          Saved: {[...new Set(match.rounds.map((r) => r.round))].map((n) => `R${n} ${teams.map((t) => existing(n, t)).join("–")}`).join("  ·  ")}
        </p>
      )}
      <FinishButton match={match} reload={reload} />
    </Card>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// One Shark Tank round (two pitches, one after the other). The organiser steps each team through
// preparation, pitch and voting with one button at a time.
function SharkRound({ match, game, reload }: { match: Match; game: GameDetail; reload: () => void }) {
  const offset = useMemo(() => (game.serverNow ?? Date.now()) - Date.now(), [game.serverNow]);
  const timers = game.timers ?? { prep: 300, pitch: 180, vote: 60 };
  const [choosing, setChoosing] = useState(false);
  const pitches = [...(match.pitches ?? [])].sort((a, b) => a.ord - b.ord);
  const active = pitches.find((p) => p.phase !== "done");
  const done = match.status === "done";
  const bothDone = pitches.length === 2 && !active;

  async function start(firstTeam: number) {
    if (await call(`/admin/matches/${match.id}/start-round`, { firstTeam })) {
      setChoosing(false);
      toast(`${teamById(firstTeam)?.name} pitches first`);
      reload();
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{stageLabel(match.stage)}</h2>
        <StatusPill status={done ? "closed" : match.status === "live" ? "live" : "upcoming"} />
      </div>

      {pitches.length === 0 ? (
        <>
          <div className="flex items-center justify-center gap-4 py-1">
            <TeamName teamId={match.teamA} size={32} className="font-semibold" />
            <span className="text-sm text-subtle">vs</span>
            <TeamName teamId={match.teamB} size={32} className="font-semibold" />
          </div>
          <Btn full size="lg" onClick={() => setChoosing(true)}>
            Start {stageLabel(match.stage).toLowerCase()}
          </Btn>
          {choosing && (
            <Modal title="Who pitches first?" onClose={() => setChoosing(false)}>
              <p className="mb-4 text-sm text-muted">The other team pitches second. A veggie or fruit is drawn for each team.</p>
              <div className="grid gap-2">
                {[match.teamA, match.teamB].map(
                  (t) =>
                    t && (
                      <Btn key={t} variant="secondary" size="lg" onClick={() => start(t)}>
                        <TeamIcon teamId={t} size={28} /> {teamById(t)?.name} pitches first
                      </Btn>
                    ),
                )}
              </div>
            </Modal>
          )}
        </>
      ) : (
        pitches.map((p) => (
          <PitchPanel key={p.id} pitch={p} active={active?.id === p.id} timers={timers} offset={offset} matchDone={done} reload={reload} />
        ))
      )}

      {bothDone && done && match.winnerTeam && (
        <div className="flex items-center gap-3 rounded-lg bg-accent-soft p-3">
          <TeamIcon teamId={match.winnerTeam} size={36} />
          <div className="font-semibold">
            Team {teamById(match.winnerTeam)?.name} wins
            <span className="block text-sm font-normal text-muted">{match.stage === "final" ? "Shark Tank champions" : "and moves to the final"}</span>
          </div>
        </div>
      )}
      {bothDone && !done && (
        <div className="space-y-3 rounded-lg border border-warn/40 bg-warn-soft p-3">
          <div>
            <div className="font-semibold text-warn">It's a tie</div>
            <p className="text-sm text-muted">
              Both teams scored the same. {match.stage === "final" ? "Choose the Shark Tank champion." : "Choose which team moves forward."}
            </p>
          </div>
          <div className="grid gap-2">
            {[match.teamA, match.teamB].map(
              (t) =>
                t && (
                  <Btn
                    key={t}
                    variant="secondary"
                    size="lg"
                    onClick={async () => {
                      if (!confirm(`${teamById(t)?.name} ${match.stage === "final" ? "wins Shark Tank" : "moves forward"}?`)) return;
                      if (await call(`/admin/matches/${match.id}/finish`, { winnerTeam: t })) {
                        toast(`Team ${teamById(t)?.name} ${match.stage === "final" ? "wins" : "moves forward"}`);
                        reload();
                      }
                    }}
                  >
                    <TeamIcon teamId={t} size={28} /> {teamById(t)?.name} {match.stage === "final" ? "wins" : "moves forward"}
                  </Btn>
                ),
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function PitchPanel({
  pitch,
  active,
  timers,
  offset,
  matchDone,
  reload,
}: {
  pitch: Pitch;
  active: boolean;
  timers: { prep: number; pitch: number; vote: number };
  offset: number;
  matchDone: boolean;
  reload: () => void;
}) {
  const now = useClock(offset);
  const [busy, setBusy] = useState(false);
  const ph = pitch.phase;

  const next =
    ph === "idle"
      ? { label: `Start preparation (${mmss(timers.prep)})`, phase: "prep" }
      : ph === "prep"
        ? { label: `Start pitch (${mmss(timers.pitch)})`, phase: "pitching" }
        : ph === "pitching"
          ? { label: `Open voting (${mmss(timers.vote)})`, phase: "voting" }
          : null;

  async function go(phase: string) {
    setBusy(true);
    if (await call(`/admin/pitches/${pitch.id}/phase`, { phase })) reload();
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ winner: number | null; tie: boolean }>(`/admin/pitches/${pitch.id}/close`, { body: {} });
      if (r.winner) toast(`Team ${teamById(r.winner)?.name} wins the round`);
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/Only \d+ votes/.test(msg) && confirm(`${msg}\n\nSave anyway with ${pitch.votes} votes?`)) {
        await call(`/admin/pitches/${pitch.id}/close`, { force: true });
        reload();
      } else toastError(e);
    }
    setBusy(false);
  }

  async function restart() {
    if (!confirm("Start this team's turn over? Their votes and score are cleared.")) return;
    if (await call(`/admin/pitches/${pitch.id}/reset`)) reload();
  }

  async function editItem() {
    const item = prompt("Veggie or fruit for this team", pitch.item);
    if (item && (await call(`/admin/pitches/${pitch.id}`, { item }, "PATCH"))) reload();
  }

  return (
    <div className={`space-y-3 rounded-xl border p-3 ${active ? "border-accent bg-surface ring-1 ring-accent/30" : "border-line bg-sunken"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <TeamName teamId={pitch.teamId} size={30} className="font-semibold" />
          <div className="mt-0.5 text-xs text-muted">{pitch.ord === 1 ? "Pitches first" : "Pitches second"}</div>
        </div>
        {ph === "done" ? (
          <span className="text-2xl font-semibold tabular-nums">
            {pitch.avg?.toFixed(1)}
            <span className="text-sm font-normal text-subtle"> ({pitch.votes} votes)</span>
          </span>
        ) : (
          <PhaseChip phase={ph} />
        )}
      </div>

      <button className="text-left text-sm text-muted underline decoration-dotted underline-offset-4" onClick={editItem}>
        Pitching: {pitch.item} (tap to change)
      </button>

      {active && (
        <>
          <PhaseSteps phase={ph} />
          <div className="rounded-lg bg-sunken py-3">
            <PhaseTimer phase={ph} endsAt={pitch.phaseEndsAt} now={now} />
          </div>
          {ph === "voting" && (
            <p className="text-center text-sm font-medium text-muted">
              {pitch.votes} {pitch.votes === 1 ? "vote" : "votes"} so far. Everyone except Team {teamById(pitch.teamId)?.name} is rating.
            </p>
          )}
          {next && (
            <Btn full size="lg" busy={busy} onClick={() => go(next.phase)}>
              <Play size={16} /> {next.label}
            </Btn>
          )}
          {ph === "voting" && (
            <Btn full size="lg" variant="danger" busy={busy} onClick={save}>
              <Square size={14} className="fill-current" /> Save result
            </Btn>
          )}
        </>
      )}
      {!active && ph === "idle" && <p className="text-sm text-muted">Waiting for the first team's turn to finish.</p>}

      {!matchDone && (ph !== "idle" || false) && (
        <button className="text-sm font-semibold text-accent" onClick={restart}>
          Restart this turn
        </button>
      )}
    </div>
  );
}

// ---------- Activity games ----------
function ActivityControl() {
  const [pick, setPick] = useState<Person | null>(null);
  async function random() {
    try {
      const r = await api<{ users: Person[] }>("/admin/users");
      const pool = r.users.filter((u) => u.checkedIn);
      const list = pool.length ? pool : r.users;
      if (!list.length) return toast("No one is registered yet", "error");
      setPick(list[Math.floor(Math.random() * list.length)]);
    } catch (e) {
      toastError(e);
    }
  }
  return (
    <>
      <Countdown presets={[{ label: "1 min", seconds: 60 }, { label: "2 min", seconds: 120 }, { label: "5 min", seconds: 300 }]} />
      <Card className="space-y-3 text-center">
        <h2 className="font-semibold">Random person picker</h2>
        {pick && (
          <div className="rise rounded-lg bg-accent-soft p-4">
            <div className="text-2xl font-semibold tracking-tight">{pick.name}</div>
            <div className="mt-2">
              <TeamChip teamId={pick.teamId} />
            </div>
          </div>
        )}
        <Btn full size="lg" onClick={random}>
          <Dices size={18} /> Pick someone
        </Btn>
        <p className="text-xs text-subtle">Checked-in people are picked first.</p>
      </Card>
    </>
  );
}
