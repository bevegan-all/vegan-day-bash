import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, Dices, MapPin, Play, ScanLine, Square, X } from "lucide-react";
import { TEAMS, teamById } from "../../shared/teams";
import { api, fmtTime, stageLabel, usePoll, type GameDetail, type MemeTurn, type Match, type Pitch } from "../api";
import { useAuth } from "../auth";
import { TeamIcon } from "../art";
import { GameThumb, LocationTag, Podium } from "../components";
import { PersonField, PersonPickerModal, type Person } from "../pickers";
import { ActTimer, TurnTracker } from "../meme";
import { ActOutControl } from "./ActOutControl";
import { GreenRedControl } from "./GreenRedControl";
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
  const [every, setEvery] = useState(8000);
  const { data, error, loading, reload } = usePoll<GameDetail>(`/admin/games/${id}`, every);
  const live = data?.type === "meme" || data?.type === "shark" || data?.type === "actout" || data?.type === "greenred";
  useEffect(() => setEvery(live ? 4000 : 8000), [live]);

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
          {data.type === "actout" && <ActOutControl game={data} reload={reload} />}
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
  const untouched = matches.length > 0 && matches.length === 2 && matches.every((m) => m.status === "pending" && !(m.turns?.length) && !(m.pitches?.length));

  async function create(pairs: [number, number][]) {
    if (await call(`/admin/games/${game.id}/bracket`, { pairs })) {
      toast("Matchups set");
      setChanging(false);
      reload();
    }
  }
  return (
    <>
      {matches.length === 0 || changing ? (
        <PairingPicker onCreate={create} label={matches.length ? "Save matchups" : "Create bracket"} onCancel={changing ? () => setChanging(false) : undefined} />
      ) : (
        <>
          {untouched && (
            <Btn variant="secondary" full onClick={() => setChanging(true)}>
              Change who plays whom
            </Btn>
          )}
          {matches.map((m) => (kind === "meme" ? <MemeRound key={m.id} match={m} game={game} reload={reload} /> : <SharkRound key={m.id} match={m} game={game} reload={reload} />))}
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

// When the scores are level the organiser chooses who moves forward
function TieChoice({ match, reload }: { match: Match; reload: () => void }) {
  const final = match.stage === "final";
  return (
    <div className="space-y-3 rounded-lg border border-warn/40 bg-warn-soft p-3">
      <div>
        <div className="font-semibold text-warn">It's a tie</div>
        <p className="text-sm text-muted">Both teams scored the same. {final ? "Choose the champion." : "Choose which team moves forward."}</p>
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
                  if (!confirm(`${teamById(t)?.name} ${final ? "wins" : "moves forward"}?`)) return;
                  if (await call(`/admin/matches/${match.id}/finish`, { winnerTeam: t })) {
                    toast(`Team ${teamById(t)?.name} ${final ? "wins" : "moves forward"}`);
                    reload();
                  }
                }}
              >
                <TeamIcon teamId={t} size={28} /> {teamById(t)?.name} {final ? "wins" : "moves forward"}
              </Btn>
            ),
        )}
      </div>
    </div>
  );
}

// One Meme Charades match. Each team sends players to act a meme (shown on the projector, not here);
// their own team guesses. The organiser starts the clock and then taps Point or Fail.
function MemeRound({ match, game, reload }: { match: Match; game: GameDetail; reload: () => void }) {
  const offset = useMemo(() => (game.serverNow ?? Date.now()) - Date.now(), [game.serverNow]);
  const cfg = game.meme ?? { act: 60, perTeam: 5, count: 16 };
  const turns = [...(match.turns ?? [])].sort((a, b) => a.ord - b.ord);
  const active = turns.find((t) => t.phase !== "done");
  const done = match.status === "done";
  const allDone = turns.length > 0 && !active;
  // memes already used anywhere in this game, so organisers can avoid repeats
  const used = new Set((game.matches ?? []).flatMap((m) => m.turns ?? []).filter((t) => t.phase !== "idle" && t.meme).map((t) => String(t.meme)));
  const [choosing, setChoosing] = useState(false);

  async function start(firstTeam: number) {
    if (await call(`/admin/matches/${match.id}/start-round`, { firstTeam })) {
      setChoosing(false);
      toast(`${teamById(firstTeam)?.name} goes first`);
      reload();
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{stageLabel(match.stage)}</h2>
        <StatusPill status={done ? "closed" : match.status === "live" ? "live" : "upcoming"} />
      </div>

      {turns.length === 0 ? (
        <>
          <div className="flex items-center justify-center gap-4 py-1">
            <TeamName teamId={match.teamA} size={32} className="font-semibold" />
            <span className="text-sm text-subtle">vs</span>
            <TeamName teamId={match.teamB} size={32} className="font-semibold" />
          </div>
          <p className="text-center text-sm text-muted">
            Each team gets {cfg.perTeam} turns, taken one after the other ({cfg.perTeam * 2} turns in all).
          </p>
          <Btn full size="lg" onClick={() => setChoosing(true)}>
            Start {stageLabel(match.stage).toLowerCase()}
          </Btn>
          {choosing && (
            <Modal title="Which team goes first?" onClose={() => setChoosing(false)}>
              <p className="mb-4 text-sm text-muted">The teams then take turns acting.</p>
              <div className="grid gap-2">
                {[match.teamA, match.teamB].map(
                  (t) =>
                    t && (
                      <Btn key={t} variant="secondary" size="lg" onClick={() => start(t)}>
                        <TeamIcon teamId={t} size={28} /> {teamById(t)?.name} goes first
                      </Btn>
                    ),
                )}
              </div>
            </Modal>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-center">
            {[match.teamA, match.teamB].map(
              (t) =>
                t && (
                  <div key={t} className={`rounded-lg border p-3 ${match.winnerTeam === t ? "border-accent bg-accent-soft" : "border-line bg-sunken"}`}>
                    <TeamName teamId={t} size={26} className="justify-center text-sm font-semibold" />
                    <div className="text-4xl font-semibold tabular-nums tracking-tight">{match.totals?.[t] ?? 0}</div>
                  </div>
                ),
            )}
          </div>
          <TurnTracker teamA={match.teamA} teamB={match.teamB} turns={turns} totals={match.totals ?? {}} />
          {active && <TurnPanel key={active.id} turn={active} total={turns.length} cfg={cfg} used={used} offset={offset} matchDone={done} reload={reload} />}
          {allDone && done && match.winnerTeam && (
            <div className="flex items-center gap-3 rounded-lg bg-accent-soft p-3">
              <TeamIcon teamId={match.winnerTeam} size={36} />
              <div className="font-semibold">
                Team {teamById(match.winnerTeam)?.name} wins
                <span className="block text-sm font-normal text-muted">{match.stage === "final" ? "Meme Charades champions" : "and moves to the final"}</span>
              </div>
            </div>
          )}
          {allDone && !done && <TieChoice match={match} reload={reload} />}
        </>
      )}
    </Card>
  );
}

function TurnPanel({
  turn,
  total,
  cfg,
  used,
  offset,
  matchDone,
  reload,
}: {
  turn: MemeTurn;
  total: number;
  cfg: { act: number; perTeam: number; count: number };
  used: Set<string>;
  offset: number;
  matchDone: boolean;
  reload: () => void;
}) {
  const now = useClock(offset);
  const [meme, setMeme] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const acting = turn.phase === "acting";

  async function startTurn() {
    setBusy(true);
    if (await call(`/admin/meme-turns/${turn.id}/start`, { meme })) reload();
    setBusy(false);
  }

  // The acting players live on the server, so every organiser sees the same list straight away
  async function addPlayer(p: Person) {
    if (await call(`/admin/meme-turns/${turn.id}/players`, { userId: p.id })) reload();
  }

  async function removePlayer(userId: number) {
    if (await call(`/admin/meme-turns/${turn.id}/players/${userId}`, undefined, "DELETE")) reload();
  }

  async function result(r: "point" | "fail") {
    setBusy(true);
    try {
      const x = await api<{ winner: number | null; tie: boolean }>(`/admin/meme-turns/${turn.id}/result`, { body: { result: r } });
      toast(r === "point" ? "Point!" : "No point");
      if (x.winner) toast(`Team ${teamById(x.winner)?.name} wins the round`);
      reload();
    } catch (e) {
      toastError(e);
    }
    setBusy(false);
  }

  async function restart() {
    if (!confirm("Start this turn over? Its result is cleared.")) return;
    if (await call(`/admin/meme-turns/${turn.id}/reset`)) reload();
  }

  return (
    <div className="space-y-4 rounded-xl border border-accent bg-surface p-3 ring-1 ring-accent/30">
      <div className="flex items-center justify-between gap-2">
        <div>
          <TeamName teamId={turn.teamId} size={34} className="text-lg font-semibold" />
          <div className="mt-0.5 text-xs text-muted">
            Turn {turn.ord} of {total}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${acting ? "bg-accent-soft text-accent" : "bg-sunken text-muted"}`}>
          {acting && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
          {acting ? "Acting" : "Up next"}
        </span>
      </div>

      {!acting ? (
        <>
          <div>
            <div className="mb-1.5 text-sm font-medium text-muted">Meme number (optional, only you can see this)</div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: cfg.count }, (_, i) => String(i + 1)).map((n) => (
                <button
                  key={n}
                  aria-pressed={meme === n}
                  onClick={() => setMeme(meme === n ? "" : n)}
                  className={`h-9 min-w-9 rounded-lg border px-2 text-sm font-semibold tabular-nums transition ${
                    meme === n ? "border-accent bg-accent text-accent-fg" : used.has(n) ? "border-dashed border-line bg-sunken text-subtle line-through" : "border-line bg-surface hover:bg-sunken"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            {used.size > 0 && <p className="mt-1.5 text-xs text-subtle">Crossed-out numbers were used already.</p>}
          </div>

          <div>
            <div className="mb-1.5 text-sm font-medium text-muted">Who is acting? (optional, shared between organisers, shown to everyone)</div>
            <div className="flex flex-wrap items-center gap-2">
              {turn.players.map((p) => (
                <span key={p.id} className="flex items-center gap-1 rounded-full bg-sunken py-1 pl-3 pr-1 text-sm font-medium">
                  {p.name}
                  <button className="rounded-full p-1 text-subtle hover:text-fg" aria-label={`Remove ${p.name}`} onClick={() => removePlayer(p.id)}>
                    <X size={14} />
                  </button>
                </span>
              ))}
              {turn.players.length < 3 && (
                <Btn variant="secondary" size="sm" onClick={() => setPicking(true)}>
                  <ScanLine size={16} /> Add players
                </Btn>
              )}
            </div>
            {picking && (
              <PersonPickerModal
                title="Who is acting?"
                multi
                onPick={(p) => addPlayer(p)}
                onClose={() => setPicking(false)}
              />
            )}
          </div>

          <Btn full size="lg" busy={busy} onClick={startTurn}>
            <Play size={16} /> Start acting ({mmss(cfg.act)})
          </Btn>
        </>
      ) : (
        <>
          <div className="rounded-lg bg-sunken py-3">
            <ActTimer endsAt={turn.phaseEndsAt} now={now} active />
          </div>
          {(turn.meme || turn.players.length > 0) && (
            <p className="text-center text-sm text-muted">
              {turn.meme ? <b className="text-fg">Meme {turn.meme}</b> : null}
              {turn.meme && turn.players.length > 0 ? " · " : ""}
              {turn.players.map((p) => p.name).join(", ")}
            </p>
          )}
          <p className="text-center text-sm font-medium text-muted">Did their team guess it?</p>
          <div className="grid grid-cols-2 gap-3">
            <Btn size="lg" busy={busy} onClick={() => result("point")} className="!min-h-16 text-lg">
              <Check size={22} strokeWidth={3} /> Point
            </Btn>
            <Btn size="lg" variant="danger" busy={busy} onClick={() => result("fail")} className="!min-h-16 text-lg">
              <X size={22} strokeWidth={3} /> Fail
            </Btn>
          </div>
        </>
      )}

      {acting && !matchDone && (
        <button className="text-sm font-semibold text-accent" onClick={restart}>
          Restart this turn
        </button>
      )}
    </div>
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
