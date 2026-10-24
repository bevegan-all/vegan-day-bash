import { useSearchParams } from "react-router-dom";
import { Crown } from "lucide-react";
import { teamById } from "../../shared/teams";
import { usePoll, stageLabel, type Board, type GameDetail, type TeamRow } from "../api";
import { GameArt, TeamIcon } from "../art";
import { LocationTag, Podium } from "../components";
import { Logo, RankBadge, StatusPill, TeamName } from "../ui";

interface ScreenData {
  teams: TeamRow[];
  individual: Board;
  liveGames: GameDetail[];
}

// The projector page is always dark, whatever the phone theme is: it reads best in a dim room.
export function Screen() {
  const [params] = useSearchParams();
  const key = params.get("key") ?? "";
  const { data, error } = usePoll<ScreenData>(`/screen?key=${encodeURIComponent(key)}`, 8000);

  if (error && !data) {
    return <div className="dark flex min-h-dvh items-center justify-center bg-bg p-8 text-center text-2xl text-fg">{error.message}</div>;
  }
  if (!data) return <div className="dark min-h-dvh bg-bg" />;

  const max = Math.max(1, ...data.teams.map((t) => t.total));
  return (
    <div className="dark min-h-dvh bg-bg p-6 text-fg md:p-10">
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
                    <span className="tabular-nums">{t.total}</span>
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

function LiveGame({ game }: { game: GameDetail }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="mb-5 flex items-center gap-4">
        <div className="aspect-[16/10] w-28 shrink-0 overflow-hidden rounded-lg">
          <GameArt slug={game.slug} name={game.name} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{game.name}</h2>
          <LocationTag location={game.location} className="mt-1 text-lg text-muted" />
        </div>
        <StatusPill status="live" />
      </div>

      {game.type === "meme" &&
        game.matches?.map((m) => (
          <div key={m.id} className="mb-3 rounded-xl bg-sunken p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-subtle">{stageLabel(m.stage)}</div>
            <div className="grid grid-cols-2 gap-4 text-center">
              {[m.teamA, m.teamB].map((t, i) => (
                <div key={i} className={m.winnerTeam === t ? "text-warn" : ""}>
                  <TeamName teamId={t} size={34} className="justify-center text-2xl font-semibold" />
                  <div className="text-7xl font-semibold tabular-nums tracking-tight">{t ? (m.totals?.[t] ?? 0) : "–"}</div>
                </div>
              ))}
            </div>
          </div>
        ))}

      {game.type === "shark" &&
        game.matches?.map((m) => (
          <div key={m.id} className="mb-3 rounded-xl bg-sunken p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-subtle">{stageLabel(m.stage)}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {(m.pitches ?? []).map((p) => (
                <div key={p.id} className={`rounded-lg border p-4 text-center ${m.winnerTeam === p.teamId ? "border-warn bg-warn-soft" : "border-line bg-surface"}`}>
                  <TeamName teamId={p.teamId} size={34} className="justify-center text-2xl font-semibold" />
                  <div className="text-base text-muted">{p.item}</div>
                  {p.state === "closed" && <div className="mt-1 text-6xl font-semibold tabular-nums tracking-tight">{p.avg?.toFixed(1)}</div>}
                  {p.state === "voting" && (
                    <div className="mt-2 text-xl font-semibold text-live">
                      Rate now on your phone <span className="tabular-nums">({p.votes} votes)</span>
                    </div>
                  )}
                  {p.state === "pending" && <div className="mt-1 text-subtle">Up next</div>}
                  {m.winnerTeam === p.teamId && (
                    <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-warn">
                      <Crown size={16} /> Advances
                    </div>
                  )}
                </div>
              ))}
              {(m.pitches ?? []).length === 0 && (
                <div className="text-2xl md:col-span-2">
                  {teamById(m.teamA)?.name} vs {teamById(m.teamB ?? 0)?.name}
                </div>
              )}
            </div>
          </div>
        ))}

      {game.type === "greenred" && game.greenred && (
        <div>
          {game.greenred.finishers.length === 0 ? (
            <div className="py-4 text-center">
              <div className="text-3xl font-semibold">Green light, red light</div>
              <div className="mt-2 text-xl text-muted">{game.greenred.count} players ready</div>
            </div>
          ) : (
            <>
              <Podium finishers={game.greenred.finishers} big />
              {game.greenred.finishers.length > 3 && <div className="mt-4 text-center text-xl text-muted">{game.greenred.finishers.length - 3} more finished</div>}
            </>
          )}
        </div>
      )}

      {game.type === "individual" && game.board && (
        <ol className="space-y-2 text-2xl">
          {game.board.top.slice(0, 5).map((r) => (
            <li key={r.userId} className="flex items-center gap-3">
              <RankBadge rank={r.rank} />
              <span className="flex-1 truncate">{r.name}</span>
              <TeamIcon teamId={r.teamId} size={30} />
              <span className="font-semibold tabular-nums">{r.detail}</span>
            </li>
          ))}
          {game.board.top.length === 0 && <li className="text-muted">Be the first on the board.</li>}
        </ol>
      )}

      {game.type === "activity" && <div className="text-center text-3xl font-semibold">{game.description}</div>}
    </div>
  );
}
