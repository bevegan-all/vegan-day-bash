import { useEffect, useRef, useState } from "react";
import { Check, Crown, Minus, Plus, ScanLine, Undo2, X } from "lucide-react";
import { api, hsLabel, type GameDetail, type HookStep, type HsRound, type HsTurn } from "../api";
import { TeamIcon } from "../art";
import { useAuth } from "../auth";
import { StepDots, passes } from "../hookstep";
import { PersonPickerModal, type Person } from "../pickers";
import { Btn, Card, IconBtn, RankBadge, SectionLabel, StatusPill, TeamChip, toast, toastError } from "../ui";

async function call<T = unknown>(path: string, body: unknown = {}, method = "POST"): Promise<T | null> {
  try {
    return await api<T>(path, { method, body });
  } catch (e) {
    toastError(e);
    return null;
  }
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-sunken p-2">
      <span className="pl-2 text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <IconBtn label={`Fewer: ${label}`} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus size={18} />
        </IconBtn>
        <span className="w-10 text-center text-xl font-semibold tabular-nums">{value}</span>
        <IconBtn label={`More: ${label}`} onClick={() => onChange(Math.min(max, value + 1))}>
          <Plus size={18} />
        </IconBtn>
      </div>
    </div>
  );
}

// Organiser screen for the Hook Step Challenge
export function HookStepControl({ game, reload }: { game: GameDetail; reload: () => void }) {
  const h = game.hookstep;
  const { me } = useAuth();
  const [pick, setPick] = useState<number | null>(null);
  const [watch, setWatch] = useState<{ roundId: number; userId: number } | null>(null);
  if (!h || !h.configured) return <SetupCard game={game} reload={reload} />;

  const selected = h.rounds.find((r) => r.id === pick) ?? h.rounds.find((r) => r.status === "live") ?? h.rounds.find((r) => r.status !== "done") ?? h.rounds[h.rounds.length - 1];
  const watched = watch ? h.rounds.find((r) => r.id === watch.roundId)?.turns.find((t) => t.userId === watch.userId) : undefined;

  return (
    <>
      <Summary game={game} h={h} reload={reload} />

      {watch && (
        <Monitor
          key={`${watch.roundId}:${watch.userId}`}
          game={game}
          round={h.rounds.find((r) => r.id === watch.roundId)!}
          person={h.standings.find((s) => s.userId === watch.userId) ?? h.roster.find((p) => p.userId === watch.userId)!}
          turn={watched}
          steps={h.steps}
          reload={reload}
          onClose={() => setWatch(null)}
          onNext={(next) => (next ? setWatch({ roundId: watch.roundId, userId: next }) : setWatch(null))}
          nextUp={nextUp(h, h.rounds.find((r) => r.id === watch.roundId)!, watch.userId)}
        />
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {h.rounds.map((r) => (
          <button
            key={r.id}
            onClick={() => setPick(r.id)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${selected.id === r.id ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:text-fg"}`}
          >
            {hsLabel(r)}
            {r.status === "live" && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-live align-middle" />}
            {r.status === "done" && <Check size={13} strokeWidth={3} className="ml-1.5 inline" />}
          </button>
        ))}
      </div>

      <RoundPanel key={selected.id} game={game} h={h} round={selected} meId={me?.id ?? 0} watching={watch} onWatch={setWatch} reload={reload} />

      <Players game={game} h={h} reload={reload} />
      <Scoreboard game={game} h={h} reload={reload} />

      {me?.role === "admin" && (
        <Btn
          variant="ghost"
          full
          onClick={async () => {
            if (!confirm("Start the Hook Step Challenge over? The rounds, every score and the player list are removed.")) return;
            if (await call(`/admin/games/${game.id}/hookstep/reset`)) {
              toast("Game reset");
              setWatch(null);
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

// the next player still waiting in this round, to jump straight to after a turn
function nextUp(h: HookStep, round: HsRound, after: number) {
  const pool = round.kind === "final" ? round.turns.map((t) => t.userId) : h.roster.map((p) => p.userId);
  return pool.find((u) => u !== after && !round.turns.some((t) => t.userId === u && t.status !== "waiting")) ?? null;
}

function SetupCard({ game, reload }: { game: GameDetail; reload: () => void }) {
  const [rounds, setRounds] = useState(3);
  const [cap, setCap] = useState(20);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">How will this game run?</h2>
        <p className="mt-1 text-sm text-muted">Choose before the game starts. The number of rounds can't change once the first round has begun.</p>
      </div>
      <Stepper label="Number of rounds" value={rounds} min={1} max={10} onChange={setRounds} />
      <Stepper label="Most players" value={cap} min={2} max={100} onChange={setCap} />
      <p className="text-sm text-muted">
        Every round, each player does 10 hook steps while an organiser marks every step pass or fail. After {rounds} {rounds === 1 ? "round" : "rounds"} the player with the most correct steps wins. If several are level at the top they play a final, and anyone still level after it wins together.
      </p>
      <Btn
        full
        size="lg"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          if (await call(`/admin/games/${game.id}/hookstep/setup`, { rounds, cap })) reload();
          setBusy(false);
        }}
      >
        Create {rounds} {rounds === 1 ? "round" : "rounds"} for up to {cap} players
      </Btn>
    </Card>
  );
}

function Summary({ game, h, reload }: { game: GameDetail; h: HookStep; reload: () => void }) {
  const [cap, setCap] = useState(h.cap);
  useEffect(() => setCap(h.cap), [h.cap]);
  const winners = h.standings.filter((s) => s.winner);
  const level = h.standings.filter((s) => h.leaders.includes(s.userId));
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {h.roundsCount} {h.roundsCount === 1 ? "round" : "rounds"}, {h.steps} hook steps each
        </h2>
      </div>
      {h.phase === "done" && winners.length > 0 && (
        <div className="rounded-lg border border-warn bg-warn-soft p-3">
          <div className="flex items-center gap-2 font-semibold text-warn">
            <Crown size={18} /> {winners.length === 1 ? "Winner" : `${winners.length} winners, level on top`}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {winners.map((w) => (
              <span key={w.userId} className="inline-flex items-center gap-1.5 font-semibold">
                <TeamIcon teamId={w.teamId} size={20} /> {w.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {h.phase === "final" && (
        <div className="rounded-lg border border-accent bg-accent-soft p-3 text-sm">
          <b>{level.length} players</b> are level at the top with {level[0]?.total} of {h.steps * h.roundsCount}. They play a final: {level.map((l) => l.name).join(", ")}.
        </div>
      )}
      {h.phase === "done" && !winners.length && <p className="text-sm text-muted">Nobody scored a step, so there is no winner.</p>}
      <p className="text-sm text-muted">Highest total after all rounds wins. Level at the top: a final. Level after the final: everyone level wins.</p>
      <div className="flex items-center justify-between rounded-lg bg-sunken p-2">
        <span className="pl-2 text-sm font-medium">Most players</span>
        <div className="flex items-center gap-1">
          <IconBtn label="Fewer players" onClick={() => setCap(Math.max(Math.max(2, h.roster.length), cap - 1))}>
            <Minus size={18} />
          </IconBtn>
          <span className="w-10 text-center text-lg font-semibold tabular-nums">{cap}</span>
          <IconBtn label="More players" onClick={() => setCap(Math.min(300, cap + 1))}>
            <Plus size={18} />
          </IconBtn>
          {cap !== h.cap && (
            <Btn
              size="sm"
              onClick={async () => {
                if (await call(`/admin/games/${game.id}/hookstep/setup`, { rounds: h.roundsCount, cap })) {
                  toast("Saved");
                  reload();
                }
              }}
            >
              Save
            </Btn>
          )}
        </div>
      </div>
    </Card>
  );
}

function RoundPanel({
  game,
  h,
  round,
  meId,
  watching,
  onWatch,
  reload,
}: {
  game: GameDetail;
  h: HookStep;
  round: HsRound;
  meId: number;
  watching: { roundId: number; userId: number } | null;
  onWatch: (w: { roundId: number; userId: number }) => void;
  reload: () => void;
}) {
  const label = hsLabel(round);
  const pool = round.kind === "final" ? h.standings.filter((s) => h.leaders.includes(s.userId)) : h.roster.map((p) => ({ ...p, rank: null as number | null }));
  const turnOf = (u: number) => round.turns.find((t) => t.userId === u);
  const rank = (t?: HsTurn) => (t?.status === "live" ? 0 : !t || t.status === "waiting" ? 1 : 2);
  const rows = [...pool].sort((a, b) => rank(turnOf(a.userId)) - rank(turnOf(b.userId)));
  const done = round.turns.filter((t) => t.status === "done").length;

  async function setStatus(status: "live" | "done") {
    if (await call(`/admin/hs-rounds/${round.id}/status`, { status })) reload();
  }

  async function monitor(userId: number, takeover = false) {
    const r = await call<{ turn: HsTurn }>(`/admin/hs-rounds/${round.id}/monitor`, { userId, takeover });
    if (r) {
      onWatch({ roundId: round.id, userId });
      reload();
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{label}</h2>
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
        <Btn variant={round.status === "done" ? "secondary" : "primary"} disabled={round.status !== "live"} onClick={() => setStatus("done")}>
          Finish round
        </Btn>
      </div>
      <p className="text-xs text-subtle">
        {round.status === "idle" && "Start the round, then tap a player to begin watching them."}
        {round.status === "live" && `${done} of ${pool.length} done. Several organisers can each watch a different player at the same time.`}
        {round.status === "done" && "This round is finished. Its scores count towards the totals."}
      </p>
      {round.status === "live" && (
        <ul className="divide-y divide-line border-t border-line">
          {rows.length === 0 && <li className="py-3 text-sm text-muted">No players yet. Add some below.</li>}
          {rows.map((p) => {
            const t = turnOf(p.userId);
            const mine = t?.status === "live" && t.monitorId === meId;
            const open = watching?.roundId === round.id && watching.userId === p.userId;
            return (
              <li key={p.userId} className={`flex items-center gap-2 py-2.5 ${open ? "bg-accent-soft/50" : ""}`}>
                <TeamIcon teamId={p.teamId} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-xs text-subtle">
                    {t?.status === "live" ? `Step ${t.steps.length + 1} of ${h.steps} · ${mine ? "you" : (t.monitorName ?? "an organiser")}` : t?.status === "done" ? `${t.score} of ${h.steps} correct` : "Waiting"}
                  </div>
                </div>
                {t?.status === "done" ? (
                  <>
                    <span className="text-lg font-semibold tabular-nums text-accent">{t.score}</span>
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (confirm(`Start ${p.name}'s turn over? The ${t.score} is removed.`) && (await call(`/admin/hs-rounds/${round.id}/reset-turn`, { userId: p.userId }))) reload();
                      }}
                    >
                      Redo
                    </Btn>
                  </>
                ) : t?.status === "live" ? (
                  mine ? (
                    <Btn size="sm" onClick={() => onWatch({ roundId: round.id, userId: p.userId })} disabled={open}>
                      {open ? "Watching" : "Open"}
                    </Btn>
                  ) : (
                    <Btn size="sm" variant="secondary" onClick={() => confirm(`Take ${p.name} over from ${t.monitorName ?? "another organiser"}?`) && monitor(p.userId, true)}>
                      Take over
                    </Btn>
                  )
                ) : (
                  <Btn size="sm" onClick={() => monitor(p.userId)}>
                    Watch
                  </Btn>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="hidden">{game.id}</p>
    </Card>
  );
}

// The two big buttons. Every tap marks the next step pass or fail.
function Monitor({
  game,
  round,
  person,
  turn,
  steps: total,
  reload,
  onClose,
  onNext,
  nextUp,
}: {
  game: GameDetail;
  round: HsRound;
  person: { userId: number; name: string; teamId: number | null };
  turn?: HsTurn;
  steps: number;
  reload: () => void;
  onClose: () => void;
  onNext: (userId: number | null) => void;
  nextUp: number | null;
}) {
  const [local, setLocal] = useState<string | null>(null);
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const steps = local ?? turn?.steps ?? "";
  const done = steps.length >= total;

  useEffect(() => {
    if (local !== null && pending.current === 0 && (turn?.steps.length ?? 0) >= local.length) setLocal(null);
  }, [turn?.steps, local]);

  function mark(pass: boolean) {
    if (done || round.status !== "live") return;
    navigator.vibrate?.(15);
    const index = (local ?? turn?.steps ?? "").length;
    setLocal((local ?? turn?.steps ?? "") + (pass ? "P" : "F"));
    pending.current += 1;
    // taps are sent one after another so they always arrive in order
    queue.current = queue.current.then(async () => {
      try {
        const r = await api<{ turn: { steps: string; status: string } }>(`/admin/hs-rounds/${round.id}/step`, { body: { userId: person.userId, pass, index } });
        pending.current -= 1;
        if (pending.current === 0) {
          setLocal(r.turn.steps);
          if (r.turn.status === "done") reload();
        }
      } catch (e) {
        pending.current -= 1;
        toastError(e);
        if (pending.current === 0) setLocal(null);
        reload();
      }
    });
  }

  async function undo() {
    if (!steps.length || pending.current) return;
    const r = await call<{ turn: { steps: string } }>(`/admin/hs-rounds/${round.id}/undo`, { userId: person.userId, index: steps.length });
    if (r) {
      setLocal(r.turn.steps);
      reload();
    }
  }

  async function startOver() {
    if (!confirm(`Start ${person.name}'s turn over?`)) return;
    if (await call(`/admin/hs-rounds/${round.id}/reset-turn`, { userId: person.userId })) {
      setLocal(null);
      reload();
      onClose();
    }
  }

  return (
    <Card className="space-y-4 border-accent">
      <div className="flex items-center gap-3">
        <TeamIcon teamId={person.teamId} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{person.name}</div>
          <div className="text-sm text-muted">
            {hsLabel(round)} · {done ? "turn finished" : `step ${steps.length + 1} of ${total}`}
          </div>
        </div>
        <IconBtn label="Close" onClick={onClose}>
          <X size={20} />
        </IconBtn>
      </div>

      <StepDots steps={steps} total={total} big />

      {done ? (
        <div className="rounded-xl bg-accent-soft p-5 text-center">
          <div className="text-5xl font-semibold tabular-nums text-accent">
            {passes(steps)} <span className="text-2xl text-muted">of {total}</span>
          </div>
          <div className="mt-1 text-sm text-muted">correct steps</div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Btn variant="secondary" onClick={undo}>
              <Undo2 size={16} /> Undo last
            </Btn>
            {nextUp ? <Btn onClick={() => onNext(nextUp)}>Next player</Btn> : <Btn onClick={onClose}>Done</Btn>}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => mark(false)}
              className="flex h-28 select-none flex-col items-center justify-center gap-1 rounded-2xl bg-danger text-white shadow-sm transition active:scale-[0.97]"
              aria-label="Fail"
            >
              <X size={40} strokeWidth={3} />
              <span className="text-xl font-semibold">Fail</span>
            </button>
            <button
              onClick={() => mark(true)}
              className="flex h-28 select-none flex-col items-center justify-center gap-1 rounded-2xl bg-accent text-accent-fg shadow-sm transition active:scale-[0.97]"
              aria-label="Pass"
            >
              <Check size={40} strokeWidth={3} />
              <span className="text-xl font-semibold">Pass</span>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="secondary" size="sm" disabled={!steps.length} onClick={undo}>
              <Undo2 size={15} /> Undo last step
            </Btn>
            <Btn variant="ghost" size="sm" onClick={startOver}>
              Start over
            </Btn>
          </div>
        </>
      )}
      <p className="hidden">{game.id}</p>
    </Card>
  );
}

function Players({ game, h, reload }: { game: GameDetail; h: HookStep; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const full = h.roster.length >= h.cap;

  async function add(userIds: number[]) {
    const r = await call<{ added: number; total: number; cap: number; full: boolean }>(`/admin/games/${game.id}/hookstep/players`, { userIds });
    if (r) {
      if (r.full) toast(`The list is full: ${r.total} of ${r.cap}`);
      reload();
    }
  }

  return (
    <section>
      <SectionLabel>
        Players {h.roster.length} of {h.cap}
      </SectionLabel>
      <Card className="space-y-3">
        <div className="h-2 overflow-hidden rounded-full bg-sunken">
          <div className={`h-full rounded-full transition-all ${full ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(100, (h.roster.length / h.cap) * 100)}%` }} />
        </div>
        <p className="text-sm text-muted">Everyone you add gets an alert on their phone. Several organisers can add people at the same time, and the list stops at {h.cap}.</p>
        <div className="grid grid-cols-2 gap-2">
          <Btn variant="secondary" size="sm" disabled={full} onClick={async () => confirm("Add everyone who has checked in?") && (await call(`/admin/games/${game.id}/hookstep/players`, { scope: "checked_in" })) && reload()}>
            Add checked-in
          </Btn>
          <Btn variant="secondary" size="sm" disabled={full} onClick={async () => confirm("Add people from every team until the list is full?") && (await call(`/admin/games/${game.id}/hookstep/players`, { scope: "all" })) && reload()}>
            Add everyone
          </Btn>
        </div>
        <Btn full disabled={full} onClick={() => setAdding(true)}>
          <ScanLine size={18} /> {full ? "The list is full" : "Add people (scan or search)"}
        </Btn>
        {adding && <PersonPickerModal title="Add players" multi onPick={(p: Person) => add([p.id])} onClose={() => setAdding(false)} />}
      </Card>
    </section>
  );
}

function Scoreboard({ game, h, reload }: { game: GameDetail; h: HookStep; reload: () => void }) {
  const regular = h.rounds.filter((r) => r.kind === "round");
  if (h.standings.length === 0) return null;
  return (
    <section>
      <SectionLabel>Scores</SectionLabel>
      <Card>
        <ul className="divide-y divide-line">
          {h.standings.map((s) => (
            <li key={s.userId} className="flex items-center gap-2 py-2.5">
              {s.rank ? <RankBadge rank={s.rank} /> : <span className="w-7 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{s.name}</span>
                  {s.winner && <Crown size={15} className="shrink-0 text-warn" />}
                </div>
                <div className="text-xs tabular-nums text-subtle">
                  {regular.map((r, i) => `R${r.ord} ${s.scores[i] ?? "–"}`).join("  ")}
                  {s.final != null && `  Final ${s.final}`}
                </div>
              </div>
              <TeamChip teamId={s.teamId} small />
              <span className="w-9 text-right text-lg font-semibold tabular-nums">{s.total}</span>
              <IconBtn
                label={`Remove ${s.name}`}
                className="!h-8 !w-8 text-danger"
                onClick={async () => confirm(`Take ${s.name} off the game? They get an alert and their scores are removed.`) && (await call(`/admin/games/${game.id}/hookstep/players/${s.userId}`, undefined, "DELETE")) && reload()}
              >
                <X size={18} />
              </IconBtn>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
