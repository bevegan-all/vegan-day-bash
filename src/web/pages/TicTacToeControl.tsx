import { useState } from "react";
import { Crown, Play, ScanLine, X } from "lucide-react";
import { api, type GameDetail, type Tictactoe, type TttMatch, type TttPlayer, type TttRound } from "../api";
import { TeamIcon } from "../art";
import { useAuth } from "../auth";
import { PersonPickerModal, type Person } from "../pickers";
import { Btn, Card, IconBtn, SectionLabel, StatusPill, TeamChip, toast, toastError } from "../ui";

async function call<T = unknown>(path: string, body: unknown = {}, method = "POST"): Promise<T | null> {
  try {
    return await api<T>(path, { method, body });
  } catch (e) {
    toastError(e);
    return null;
  }
}

// Organiser screen for the knockout tournament: collect players, start it, then pick the winner of each match.
export function TicTacToeControl({ game, reload }: { game: GameDetail; reload: () => void }) {
  const t = game.tictactoe;
  const { me } = useAuth();
  if (!t) return null;
  return (
    <>
      {t.state === "registration" ? <Registration game={game} t={t} reload={reload} /> : <Bracket t={t} reload={reload} />}
      {me?.role === "admin" && (
        <Btn
          variant="ghost"
          full
          onClick={async () => {
            if (!confirm("Start the tournament over? The bracket and its results are removed. The players who joined stay on the list.")) return;
            if (await call(`/admin/games/${game.id}/tictactoe/reset`)) {
              toast("Back to registration");
              reload();
            }
          }}
        >
          Start the tournament over (admin)
        </Btn>
      )}
    </>
  );
}

function plan(n: number) {
  let size = 2;
  while (size < n) size *= 2;
  return { rounds: Math.log2(size), byes: size - n, size };
}

function Registration({ game, t, reload }: { game: GameDetail; t: Tictactoe; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = plan(t.players);
  return (
    <>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Registration is open</h2>
          <StatusPill status={game.status} />
        </div>
        <div className="flex items-end gap-3">
          <span className="text-5xl font-semibold tabular-nums">{t.players}</span>
          <span className="pb-1.5 text-muted">{t.players === 1 ? "player" : "players"} registered</span>
        </div>
        <p className="text-sm text-muted">
          {game.status === "live"
            ? "Players join from their phone: Games, then this game, then Join. You can also add people yourself, for anyone without a phone."
            : "Set the game to Live (above) so players can join from their phone."}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Btn variant="secondary" size="sm" onClick={async () => confirm("Add everyone who has checked in?") && (await call(`/admin/games/${game.id}/tictactoe/players`, { scope: "checked_in" })) && reload()}>
            Add checked-in
          </Btn>
          <Btn variant="secondary" size="sm" onClick={async () => confirm("Add every person to the tournament?") && (await call(`/admin/games/${game.id}/tictactoe/players`, { scope: "all" })) && reload()}>
            Add everyone
          </Btn>
        </div>
        <Btn full onClick={() => setAdding(true)}>
          <ScanLine size={18} /> Add people (scan or search)
        </Btn>
        {adding && <PersonPickerModal title="Add players" multi onPick={async (p: Person) => (await call(`/admin/games/${game.id}/tictactoe/players`, { userIds: [p.id] })) && reload()} onClose={() => setAdding(false)} />}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Start the tournament</h3>
        <p className="text-sm text-muted">
          {t.players < 2
            ? "At least 2 players are needed."
            : `${t.players} players: ${p.rounds} ${p.rounds === 1 ? "round" : "rounds"}${p.byes ? `, and ${p.byes} ${p.byes === 1 ? "player gets" : "players get"} a bye in the first round` : ""}. Everyone is matched at random and nobody can join after you start.`}
        </p>
        <Btn
          full
          size="lg"
          busy={busy}
          disabled={t.players < 2}
          onClick={async () => {
            if (!confirm(`Start with ${t.players} players? Registration closes and the bracket is drawn.`)) return;
            setBusy(true);
            if (await call(`/admin/games/${game.id}/tictactoe/start`)) {
              toast("The bracket is drawn");
              reload();
            }
            setBusy(false);
          }}
        >
          <Play size={18} /> Start the tournament
        </Btn>
      </Card>

      {t.roster.length > 0 && (
        <section>
          <SectionLabel>Players</SectionLabel>
          <Card>
            <ul className="divide-y divide-line">
              {t.roster.map((p) => (
                <li key={p.userId} className="flex items-center gap-2 py-2">
                  <TeamIcon teamId={p.teamId} size={28} />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <TeamChip teamId={p.teamId} small />
                  <IconBtn label={`Remove ${p.name}`} className="!h-8 !w-8 text-danger" onClick={async () => confirm(`Take ${p.name} off the list? They get an alert.`) && (await call(`/admin/games/${game.id}/tictactoe/players/${p.userId}`, undefined, "DELETE")) && reload()}>
                    <X size={18} />
                  </IconBtn>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}

function Bracket({ t, reload }: { t: Tictactoe; reload: () => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const open = (r: TttRound) => r.matches.some((m) => !m.bye && !m.winnerId);
  const selected = t.rounds.find((r) => r.round === pick) ?? t.rounds.find(open) ?? t.rounds[t.rounds.length - 1];
  const real = (r: TttRound) => r.matches.filter((m) => !m.bye);
  return (
    <>
      {t.champion && (
        <Card className="border-warn bg-warn-soft">
          <div className="flex items-center gap-3">
            <Crown size={30} className="shrink-0 text-warn" />
            <div>
              <div className="text-sm font-semibold uppercase tracking-wider text-warn">Champion</div>
              <div className="flex items-center gap-2 text-xl font-semibold">
                <TeamIcon teamId={t.champion.teamId} size={28} /> {t.champion.name}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {t.rounds.map((r) => {
          const done = real(r).filter((m) => m.winnerId).length;
          const total = real(r).length;
          return (
            <button
              key={r.round}
              onClick={() => setPick(r.round)}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${selected.round === r.round ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:text-fg"}`}
            >
              {r.name}
              <span className={`ml-1.5 text-xs ${selected.round === r.round ? "opacity-80" : "text-subtle"}`}>
                {done}/{total}
              </span>
            </button>
          );
        })}
      </div>

      <RoundList round={selected} reload={reload} />
    </>
  );
}

const order = (m: TttMatch) => (m.status === "live" ? 0 : m.ready ? 1 : m.winnerId ? 3 : 2);

function RoundList({ round, reload }: { round: TttRound; reload: () => void }) {
  const byes = round.matches.filter((m) => m.bye);
  const matches = round.matches.filter((m) => !m.bye).sort((a, b) => order(a) - order(b) || a.slot - b.slot);
  const decided = matches.filter((m) => m.winnerId).length;
  return (
    <section className="space-y-3">
      <SectionLabel>
        {round.name}: {decided} of {matches.length} matches done
      </SectionLabel>
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} reload={reload} />
      ))}
      {byes.length > 0 && (
        <Card className="text-sm text-muted">
          <b className="text-fg">{byes.length === 1 ? "1 bye" : `${byes.length} byes`}:</b> {byes.map((b) => b.a?.name).join(", ")} go straight through.
        </Card>
      )}
    </section>
  );
}

function MatchCard({ match, reload }: { match: TttMatch; reload: () => void }) {
  const done = !!match.winnerId;
  const status = done ? "Done" : match.status === "live" ? "Playing now" : match.ready ? "Ready" : "Waiting for players";

  async function win(p: TttPlayer) {
    if (match.winnerId === p.userId) return;
    if (done && !confirm(`Change the winner to ${p.name}?`)) return;
    if (await call(`/admin/ttt-matches/${match.id}/winner`, { userId: p.userId })) {
      if (!done) toast(`${p.name} moves on`);
      reload();
    }
  }

  const side = (p: TttPlayer | null, label: string) =>
    p ? (
      <button
        onClick={() => win(p)}
        disabled={!match.ready && !done}
        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99] ${
          match.winnerId === p.userId ? "border-warn bg-warn-soft" : done ? "border-line opacity-50" : match.ready ? "border-line bg-surface hover:border-accent hover:bg-accent-soft" : "border-line opacity-70"
        }`}
      >
        <TeamIcon teamId={p.teamId} size={40} />
        <span className="min-w-0 flex-1 truncate text-lg font-semibold">{p.name}</span>
        {match.winnerId === p.userId ? (
          <span className="flex items-center gap-1 text-sm font-semibold text-warn">
            <Crown size={16} /> Moves on
          </span>
        ) : match.ready ? (
          <span className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg">Wins</span>
        ) : null}
      </button>
    ) : (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3 text-muted">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-sm font-semibold">?</span>
        <span>{label}</span>
      </div>
    );

  return (
    <Card className={`space-y-2.5 ${match.status === "live" ? "border-accent" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted">Match {match.slot + 1}</span>
        <div className="flex items-center gap-2">
          {match.status === "live" && <span className="h-2 w-2 animate-pulse rounded-full bg-live" />}
          <span className={`text-xs font-semibold ${done ? "text-subtle" : match.ready ? "text-accent" : "text-subtle"}`}>{status}</span>
        </div>
      </div>
      {side(match.a, "Waiting for a winner")}
      <div className="text-center text-xs font-semibold uppercase tracking-widest text-subtle">versus</div>
      {side(match.b, "Waiting for a winner")}
      {(match.ready && match.status !== "live") || done ? (
        <div className="flex gap-2">
          {match.ready && match.status !== "live" && (
            <Btn variant="secondary" size="sm" className="flex-1" onClick={async () => (await call(`/admin/ttt-matches/${match.id}/start`)) && reload()}>
              <Play size={15} /> Start this match
            </Btn>
          )}
          {done && (
            <Btn
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={async () => confirm("Clear this result? The winner is taken out of the next round.") && (await call(`/admin/ttt-matches/${match.id}/winner`, { userId: null })) && reload()}
            >
              Undo result
            </Btn>
          )}
        </div>
      ) : null}
    </Card>
  );
}
