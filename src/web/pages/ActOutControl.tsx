import { useMemo, useState } from "react";
import { Play, RotateCcw, Square, Check } from "lucide-react";
import { teamById } from "../../shared/teams";
import { api, type ActRound, type GameDetail } from "../api";
import { TeamIcon } from "../art";
import { TeamOrder, RoundResults } from "../actout";
import { useClock } from "../clock";
import { ActTimer } from "../meme";
import { Btn, Card, SectionLabel, StatusPill, TeamName, inputCls, toast, toastError } from "../ui";

async function call(path: string, body: unknown = {}, method = "POST") {
  try {
    await api(path, { method, body });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Organiser screen for Act It Out. Each round: start each team in turn, open voting, save the result.
export function ActOutControl({ game, reload }: { game: GameDetail; reload: () => void }) {
  const rounds = game.rounds ?? [];
  const cfg = game.actout ?? { act: 60, vote: 60, rounds: 5 };
  const offset = useMemo(() => (game.serverNow ?? Date.now()) - Date.now(), [game.serverNow]);
  const active = rounds.find((r) => r.phase !== "done");
  const totals = game.pointsByTeam ?? {};

  if (rounds.length === 0) {
    return (
      <Card className="space-y-3 text-center">
        <p className="text-sm text-muted">
          {cfg.rounds} rounds. In every round each team acts the scene for up to {mmss(cfg.act)}, one team after the other. Then everyone ranks the other three teams.
        </p>
        <Btn
          size="lg"
          onClick={async () => {
            if (await call(`/admin/games/${game.id}/actout/start`)) {
              toast("Rounds created");
              reload();
            }
          }}
        >
          Start the game
        </Btn>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Points in this game</div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[1, 2, 3, 4].map((t) => (
            <div key={t}>
              <div className="flex justify-center">
                <TeamIcon teamId={t} size={34} />
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{totals[t] ?? 0}</div>
            </div>
          ))}
        </div>
      </Card>

      {rounds.map((r) => (r.id === active?.id ? <ActiveRound key={r.id} round={r} total={rounds.length} cfg={cfg} offset={offset} reload={reload} /> : <RoundRow key={r.id} round={r} />))}
    </>
  );
}

function RoundRow({ round }: { round: ActRound }) {
  const done = round.phase === "done";
  return (
    <section>
      <SectionLabel right={<StatusPill status={done ? "closed" : "upcoming"} />}>
        Round {round.ord}
        {round.scene ? ` · ${round.scene}` : ""}
      </SectionLabel>
      <Card className={done ? "" : "opacity-70"}>{done ? <RoundResults results={round.results} /> : <p className="text-sm text-muted">Waiting for the earlier rounds.</p>}</Card>
    </section>
  );
}

function ActiveRound({ round, total, cfg, offset, reload }: { round: ActRound; total: number; cfg: { act: number; vote: number; rounds: number }; offset: number; reload: () => void }) {
  const now = useClock(offset);
  const [scene, setScene] = useState(round.scene ?? "");
  const [busy, setBusy] = useState(false);
  const cur = round.turns.find((t) => t.phase !== "done");
  const voting = round.phase === "voting";
  const acting = cur?.phase === "acting";

  async function run(fn: () => Promise<boolean>) {
    setBusy(true);
    if (await fn()) reload();
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ ballots: number }>(`/admin/act-rounds/${round.id}/close`, { body: {} });
      toast(`Round ${round.ord} saved (${r.ballots} votes)`);
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/No votes yet/.test(msg) && confirm("Nobody has voted. Save the round anyway? All teams would share the points.")) {
        await call(`/admin/act-rounds/${round.id}/close`, { force: true });
        reload();
      } else toastError(e);
    }
    setBusy(false);
  }

  return (
    <Card className="space-y-4 border-accent ring-1 ring-accent/30">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          Round {round.ord} of {total}
        </h2>
        <StatusPill status="live" />
      </div>

      <div>
        <div className="mb-1.5 text-sm font-medium text-muted">Scene (optional, shown to everyone)</div>
        <input
          className={inputCls}
          placeholder="e.g. Titanic"
          aria-label="Scene"
          value={scene}
          onChange={(e) => setScene(e.target.value)}
          onBlur={() => scene.trim() !== (round.scene ?? "") && call(`/admin/act-rounds/${round.id}`, { scene }, "PATCH")}
        />
      </div>

      <TeamOrder turns={round.turns} />

      {!voting && cur && (
        <div className="space-y-3 rounded-xl bg-sunken p-3">
          <TeamName teamId={cur.teamId} size={34} className="text-lg font-semibold" />
          {acting ? (
            <>
              <ActTimer endsAt={cur.phaseEndsAt} now={now} active />
              <Btn full size="lg" busy={busy} onClick={() => run(() => call(`/admin/act-turns/${cur.id}/done`))}>
                <Check size={18} strokeWidth={3} /> Team is done
              </Btn>
              <button className="text-sm font-semibold text-accent" onClick={() => confirm("Start this team's turn over?") && run(() => call(`/admin/act-turns/${cur.id}/reset`))}>
                Restart this turn
              </button>
            </>
          ) : (
            <Btn full size="lg" busy={busy} onClick={() => run(() => call(`/admin/act-turns/${cur.id}/start`, { scene }))}>
              <Play size={16} /> Start Team {teamById(cur.teamId)?.name} ({mmss(cfg.act)})
            </Btn>
          )}
        </div>
      )}

      {!voting && !cur && (
        <div className="space-y-3 rounded-xl bg-sunken p-3">
          <p className="text-sm font-medium text-muted">Every team has performed. Open voting so everyone can rank the other teams.</p>
          <Btn full size="lg" busy={busy} onClick={() => run(() => call(`/admin/act-rounds/${round.id}/open-voting`))}>
            <Play size={16} /> Open voting ({mmss(cfg.vote)})
          </Btn>
        </div>
      )}

      {voting && (
        <div className="space-y-3 rounded-xl bg-sunken p-3">
          <ActTimer endsAt={round.phaseEndsAt} now={now} active label="voting time left" />
          <p className="text-center text-sm font-medium text-muted">
            {round.votes} {round.votes === 1 ? "person has" : "people have"} ranked the teams so far.
          </p>
          <Btn full size="lg" variant="danger" busy={busy} onClick={save}>
            <Square size={14} className="fill-current" /> Save result
          </Btn>
        </div>
      )}

      {round.phase !== "idle" && (
        <button
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent"
          onClick={() => confirm("Start this whole round over? Its votes and points are cleared.") && run(() => call(`/admin/act-rounds/${round.id}/reset`))}
        >
          <RotateCcw size={14} /> Restart this round
        </button>
      )}
    </Card>
  );
}
