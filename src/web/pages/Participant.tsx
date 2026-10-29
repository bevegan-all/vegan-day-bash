import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { Check, ChevronRight, Crown, LogOut, SlidersHorizontal } from "lucide-react";
import { teamById } from "../../shared/teams";
import { api, fmtTime, toFinishers, usePoll, type Board, type GameDetail, type GameSummary, type TeamRow } from "../api";
import { isOrganiser, useAuth } from "../auth";
import { TeamIcon } from "../art";
import { BoardList, GameCard, GameThumb, LocationTag, MatchCard, Podium } from "../components";
import { SharkLiveCard } from "../shark";
import { MemeLiveCard } from "../meme";
import { ActOutLiveCard, ActOutSummary } from "../actout";
import { AlertsToggle, usePulse } from "../pulse";
import { InstallCard } from "../install";
import { StepDots, passes } from "../hookstep";
import { Avatar, Btn, Card, toastError, ErrorBox, Page, RankBadge, SectionLabel, Segmented, Spinner, StatusPill, TeamChip, TeamMark, ThemeSelect } from "../ui";

interface HomeData {
  teams: TeamRow[];
  myTeamRank: number | null;
  individual: { rank: number; value: number } | null;
  individualCount: number;
}

export function Home() {
  const { me } = useAuth();
  const { data, error, loading, reload } = usePoll<HomeData>("/home", 45000);
  const { pulse, reload: reloadPulse, offset } = usePulse();
  const live = pulse?.live ?? [];
  const team = teamById(me?.team?.id);
  const myPoints = data?.teams.find((t) => t.teamId === team?.id)?.total;

  return (
    <Page title={`Hi, ${me?.name.split(" ")[0] ?? ""}`}>
      {team && (
        <Card className="flex items-stretch gap-0 overflow-hidden !p-0">
          <div className="w-1.5 shrink-0" style={{ background: team.color }} />
          <div className="flex flex-1 items-center gap-4 p-4">
            <TeamMark teamId={team.id} size={56} />
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-subtle">Your team</div>
              <div className="truncate text-2xl font-semibold tracking-tight">{team.name}</div>
            </div>
          </div>
        </Card>
      )}

      {loading && !data && <Spinner />}
      {error && !data && <ErrorBox message={error.message} onRetry={reload} />}

      {data && (
        <Card className="grid grid-cols-3 divide-x divide-line !p-0 text-center">
          <Stat label="Team rank" value={data.myTeamRank ? `#${data.myTeamRank}` : "–"} />
          <Stat label="Team points" value={myPoints != null ? String(myPoints) : "–"} />
          <Stat label="Your rank" value={data.individual ? `#${data.individual.rank}` : "–"} hint={data.individual ? `of ${data.individualCount}` : "play a solo game"} />
        </Card>
      )}

      {pulse?.shark && <SharkLiveCard shark={pulse.shark} offset={offset} onVoted={reloadPulse} />}
      {pulse?.meme && <MemeLiveCard meme={pulse.meme} offset={offset} />}
      {pulse?.actout && <ActOutLiveCard a={pulse.actout} offset={offset} onVoted={reloadPulse} />}

      {live.length > 0 && (
        <section>
          <SectionLabel>Happening now</SectionLabel>
          <Card className="divide-y divide-line !p-0">
            {live.map((g) => (
              <Link key={g.id} to={`/games/${g.id}`} className="flex items-center gap-3 p-3 transition active:bg-sunken">
                <GameThumb slug={g.slug} name={g.name} className="aspect-[16/10] w-20 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{g.name}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <LocationTag location={g.location} />
                    {g.youIn && <span className="font-semibold text-accent">You're in</span>}
                    {!g.youIn && g.joinOpen && <span className="font-semibold text-accent">Join now</span>}
                  </span>
                </span>
                <StatusPill status="live" />
                <ChevronRight size={18} className="shrink-0 text-subtle" />
              </Link>
            ))}
          </Card>
        </section>
      )}

      {data && (
        <section>
          <SectionLabel
            right={
              <Link to="/board" className="text-sm font-semibold text-accent">
                All boards
              </Link>
            }
          >
            Team standings
          </SectionLabel>
          <Card>
            <TeamBars teams={data.teams} mine={me?.team?.id} />
          </Card>
        </section>
      )}
    </Page>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-2 py-3.5">
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-muted">{label}</div>
      {hint && <div className="text-[11px] text-subtle">{hint}</div>}
    </div>
  );
}

export function TeamBars({ teams, mine }: { teams: TeamRow[]; mine?: number | null }) {
  const max = Math.max(1, ...teams.map((t) => t.total));
  const noPoints = teams.every((t) => t.total === 0);
  return (
    <ul className="space-y-4">
      {teams.map((t) => (
        <li key={t.teamId}>
          <div className="mb-1.5 flex items-center gap-2.5">
            <RankBadge rank={t.rank} plain={noPoints} />
            <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
              <TeamIcon teamId={t.teamId} size={24} />
              <span className="truncate">{t.name}</span>
              {mine === t.teamId && <span className="text-xs font-semibold text-accent">Your team</span>}
            </span>
            <span className="text-lg font-semibold tabular-nums">{t.total}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(t.total / max) * 100}%`, background: t.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function GamesList() {
  const { me } = useAuth();
  const { data, error, loading, reload } = usePoll<{ games: GameSummary[] }>("/games", 30000);
  const liveFirst = (a: GameSummary, b: GameSummary) => Number(b.status === "live") - Number(a.status === "live");
  const groups: [string, GameSummary[]][] = data
    ? [
        ["Team games", data.games.filter((g) => g.kind === "team").sort(liveFirst)],
        ["Individual games", data.games.filter((g) => g.kind === "individual").sort(liveFirst)],
      ]
    : [];
  return (
    <Page title="Games">
      {loading && !data && <Spinner />}
      {error && !data && <ErrorBox message={error.message} onRetry={reload} />}
      {groups.map(([title, games]) => (
        <section key={title}>
          <SectionLabel>{title}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {games.map((g) => (
              <GameCard key={g.id} game={g} featured={g.status === "live"} />
            ))}
          </div>
        </section>
      ))}
      {isOrganiser(me) && <p className="text-center text-xs text-subtle">Drafts (backup games) are visible to organisers only.</p>}
    </Page>
  );
}

export function GameView() {
  const { id } = useParams();
  const { me } = useAuth();
  const [every, setEvery] = useState(15000);
  const { data, error, loading, reload } = usePoll<GameDetail>(`/games/${id}`, every);
  // while the Hook Step Challenge is live, steps are marked every few seconds
  const hookLive = data?.type === "hookstep" && data.status === "live";
  useEffect(() => setEvery(hookLive ? 6000 : 15000), [hookLive]);
  const { pulse, reload: reloadPulse, offset } = usePulse();
  const turn = pulse?.shark && String(pulse.shark.gameId) === id ? pulse.shark : null;
  const memeTurn = pulse?.meme && String(pulse.meme.gameId) === id ? pulse.meme : null;
  const actRound = pulse?.actout && String(pulse.actout.gameId) === id ? pulse.actout : null;
  const turnKey = turn
    ? `${turn.pitchId}:${turn.phase}`
    : memeTurn
      ? `m${memeTurn.turnId}:${memeTurn.phase}:${memeTurn.last?.ord ?? 0}`
      : actRound
        ? `a${actRound.roundId}:${actRound.phase}:${actRound.turns.map((x) => x.phase[0]).join("")}`
        : "";
  useEffect(() => {
    if (turnKey) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);

  return (
    <Page
      title={data?.name ?? "Game"}
      back="/games"
      right={
        isOrganiser(me) && data ? (
          <Link to={`/admin/games/${data.id}`} className="mr-1 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg">
            Controls
          </Link>
        ) : undefined
      }
    >
      {loading && !data && <Spinner />}
      {error && !data && <ErrorBox message={error.message} onRetry={reload} />}
      {data && (
        <>
          <GameThumb slug={data.slug} name={data.name} className="aspect-[16/7] w-full rounded-xl border border-line" />
          {turn && <SharkLiveCard shark={turn} offset={offset} onVoted={reloadPulse} />}
          {memeTurn && <MemeLiveCard meme={memeTurn} offset={offset} />}
          {actRound && <ActOutLiveCard a={actRound} offset={offset} onVoted={reloadPulse} />}
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <StatusPill status={data.status} />
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{data.kind === "team" ? "Team game" : "Individual game"}</span>
              <LocationTag location={data.location} className="ml-auto text-sm font-medium text-muted" />
            </div>
            <p>{data.description}</p>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-subtle">How it works</h3>
            <p className="mt-1 text-sm text-muted">{data.rules}</p>
          </Card>

          {data.matches &&
            (data.matches.length === 0 ? (
              <Card className="text-center text-sm text-muted">The bracket will appear here when the game starts.</Card>
            ) : (
              data.matches.map((m) => <MatchCard key={m.id} match={m} kind={data.type === "meme" ? "meme" : "shark"} onChanged={reload} />)
            ))}

          {data.type === "greenred" && data.greenred && <GreenRedView game={data} />}
          {data.type === "hookstep" && data.hookstep && <HookStepView game={data} />}
          {data.type === "tictactoe" && data.tictactoe && <TttView game={data} reload={reload} />}

          {data.board && data.type === "individual" && (
            <Card>
              <h3 className="mb-2 font-semibold">Top 10</h3>
              <BoardList board={data.board as Board} empty="No scores yet. Find an organiser to play." />
            </Card>
          )}

          {data.type === "actout" && <ActOutSummary game={data} />}

          {data.type === "activity" && <Card className="text-center text-sm text-muted">Just for fun. Watch the screen and join in.</Card>}
        </>
      )}
    </Page>
  );
}

function TttView({ game, reload }: { game: GameDetail; reload: () => void }) {
  const t = game.tictactoe!;
  const { me } = useAuth();
  const [busy, setBusy] = useState(false);
  const you = t.you;

  async function join(leave: boolean) {
    setBusy(true);
    try {
      await api(`/games/${game.id}/join`, { method: leave ? "DELETE" : "POST", body: {} });
      reload();
    } catch (e) {
      toastError(e);
    }
    setBusy(false);
  }

  const shown = t.rounds.find((r) => r.matches.some((m) => !m.bye && !m.winnerId)) ?? t.rounds[t.rounds.length - 1];
  const singular = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/s$/, "");

  return (
    <>
      {t.state === "registration" && (
        <Card className="space-y-3 text-center">
          <div className="text-5xl font-semibold tabular-nums">{t.players}</div>
          <div className="-mt-2 text-sm text-muted">{t.players === 1 ? "player has" : "players have"} joined</div>
          {t.mine ? (
            <>
              <div className="flex items-center justify-center gap-2 font-semibold text-accent">
                <Check size={18} strokeWidth={3} /> You're registered
              </div>
              <Btn variant="secondary" full busy={busy} onClick={() => join(true)}>
                Leave the list
              </Btn>
            </>
          ) : t.joinOpen ? (
            <Btn full size="lg" busy={busy} onClick={() => join(false)}>
              Join the tournament
            </Btn>
          ) : (
            <p className="text-sm text-muted">Joining opens when the organisers make the game live.</p>
          )}
          <p className="text-xs text-subtle">When the organisers start, everyone is matched at random. Winners go through to the next round.</p>
        </Card>
      )}

      {t.state !== "registration" && (
        <Card className={you?.champion ? "border-warn bg-warn-soft" : you?.status === "ready" || you?.status === "live" ? "border-accent bg-accent-soft" : ""}>
          {you?.champion ? (
            <div className="flex items-center gap-3">
              <Crown size={30} className="text-warn" />
              <div>
                <div className="font-semibold">You are the champion</div>
                <div className="text-sm text-muted">Well played!</div>
              </div>
            </div>
          ) : you?.status === "ready" || you?.status === "live" ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-accent">{you.round}</div>
              <div className="mt-1 text-lg font-semibold">{you.status === "live" ? "Your match is on now" : "Your match is ready"}</div>
              <div className="mt-2 flex items-center gap-2">
                <TeamIcon teamId={you.opponent?.teamId} size={32} />
                <span className="font-semibold">vs {you.opponent?.name}</span>
              </div>
              <div className="mt-1 text-sm text-muted">Head to the {game.location}.</div>
            </div>
          ) : you?.status === "waiting" ? (
            <div>
              <div className="font-semibold">You're through to the {singular(you.round)}</div>
              <div className="text-sm text-muted">Waiting for your opponent to be decided.</div>
            </div>
          ) : you?.outIn ? (
            <div>
              <div className="font-semibold">You went out in the {singular(you.outIn)}</div>
              <div className="text-sm text-muted">Thanks for playing. You can still follow the bracket below.</div>
            </div>
          ) : (
            <p className="text-sm text-muted">{t.mine ? "You're registered." : "The tournament is under way. Watch the bracket below."}</p>
          )}
        </Card>
      )}

      {t.champion && !you?.champion && (
        <Card className="flex items-center gap-3">
          <Crown size={24} className="text-warn" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-subtle">Champion</div>
            <div className="font-semibold">{t.champion.name}</div>
          </div>
        </Card>
      )}

      {t.rounds.map((r) => {
        const real = r.matches.filter((m) => !m.bye);
        return (
          <details key={r.round} open={r === shown} className="rounded-xl border border-line bg-surface p-4">
            <summary className="flex cursor-pointer items-center justify-between font-semibold">
              <span>
                {r.name} <span className="font-normal text-muted">· {real.length} {real.length === 1 ? "match" : "matches"}</span>
              </span>
              <span className="text-xs text-subtle">
                {real.filter((m) => m.winnerId).length}/{real.length} done
              </span>
            </summary>
            <ul className="mt-3 divide-y divide-line">
              {real.map((m) => (
                <li key={m.id} className={`flex items-center gap-2 py-2 text-sm ${m.status === "live" ? "font-semibold" : ""}`}>
                  {[m.a, m.b].map((p, i) => (
                    <span key={i} className={`flex min-w-0 flex-1 items-center gap-1.5 ${m.winnerId && m.winnerId !== p?.userId ? "text-subtle line-through" : ""} ${p && p.userId === me?.id ? "text-accent" : ""} ${i ? "justify-end text-right" : ""}`}>
                      {i === 0 && p && <TeamIcon teamId={p.teamId} size={20} />}
                      <span className="truncate">{p ? p.name : "To be decided"}</span>
                      {m.winnerId != null && m.winnerId === p?.userId && <Crown size={13} className="shrink-0 text-warn" />}
                      {i === 1 && p && <TeamIcon teamId={p.teamId} size={20} />}
                    </span>
                  ))}
                  {m.status === "live" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-live" />}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </>
  );
}

function HookStepView({ game }: { game: GameDetail }) {
  const h = game.hookstep!;
  const { me } = useAuth();
  if (!h.configured) return <Card className="text-center text-sm text-muted">The organisers will set up the rounds soon. If you're added, you'll get an alert.</Card>;
  const live = h.rounds.find((r) => r.status === "live");
  const myTurn = live?.turns.find((t) => t.userId === me?.id);
  const iWon = h.winners.includes(me?.id ?? -1);
  const winners = h.standings.filter((s) => s.winner);
  const regular = h.rounds.filter((r) => r.kind === "round");
  const max = h.steps * h.roundsCount;

  return (
    <>
      <Card className={iWon ? "border-warn bg-warn-soft" : h.mine ? "border-accent bg-accent-soft" : ""}>
        {iWon ? (
          <div className="flex items-center gap-3">
            <Crown size={30} className="text-warn" />
            <div>
              <div className="font-semibold">{winners.length > 1 ? "You won, together with the others" : "You won"}</div>
              <div className="text-sm text-muted">Well done!</div>
            </div>
          </div>
        ) : h.mine ? (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
              <Check size={20} strokeWidth={3} />
            </span>
            <div>
              <div className="font-semibold">{h.finalist && h.phase === "final" ? "You're in the final" : "You're in this game"}</div>
              <div className="text-sm text-muted">Head to the {game.location} when the organisers call you.</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Organisers add the players ({h.roster.length} of {h.cap} places taken). You will get an alert if you're added.</p>
        )}
      </Card>

      {myTurn && myTurn.status !== "waiting" && live && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Your turn, {live.kind === "final" ? "final" : `round ${live.ord}`}</h3>
            {myTurn.status === "done" && <span className="text-lg font-semibold text-accent">{myTurn.score} of {h.steps}</span>}
          </div>
          <StepDots steps={myTurn.steps} total={h.steps} />
          <p className="text-xs text-subtle">{myTurn.status === "live" ? `Watched by ${myTurn.monitorName ?? "an organiser"}. ${passes(myTurn.steps)} correct so far.` : "Turn finished."}</p>
        </Card>
      )}

      {h.phase === "final" && (
        <Card className="text-sm">
          <b>{h.leaders.length} players</b> are level at the top and play a final: {h.standings.filter((s) => h.leaders.includes(s.userId)).map((s) => s.name).join(", ")}.
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Scores</h3>
          <span className="text-sm text-muted">
            {h.roundsCount} {h.roundsCount === 1 ? "round" : "rounds"} · {max} steps
          </span>
        </div>
        {h.standings.every((s) => s.rank == null) ? (
          <p className="text-sm text-muted">No scores yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {h.standings
              .filter((s) => s.rank != null)
              .slice(0, 12)
              .map((s) => (
                <li key={s.userId} className="flex items-center gap-2 py-2">
                  <RankBadge rank={s.rank!} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{s.name}</span>
                      {s.winner && <Crown size={14} className="shrink-0 text-warn" />}
                    </div>
                    <div className="text-xs tabular-nums text-subtle">
                      {regular.map((r, i) => `R${r.ord} ${s.scores[i] ?? "–"}`).join("  ")}
                      {s.final != null && `  Final ${s.final}`}
                    </div>
                  </div>
                  <TeamChip teamId={s.teamId} small />
                  <span className="w-9 text-right text-lg font-semibold tabular-nums">{s.total}</span>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function GreenRedView({ game }: { game: GameDetail }) {
  const g = game.greenred!;
  if (!g.mode || g.rounds.length === 0) {
    return <Card className="text-center text-sm text-muted">The organisers will set up the race soon. If you're added, you'll get an alert.</Card>;
  }
  const multi = g.mode === "multi";
  const heats = g.rounds.filter((r) => r.kind === "heat");
  const final = g.rounds.find((r) => r.kind === "final")!;
  const myHeat = heats.find((r) => g.mine.includes(r.id));
  const inFinal = g.mine.includes(final.id);
  const timed = final.entries.filter((e) => e.seconds != null);
  const rest = timed.filter((e) => (e.rank ?? 99) > 3);
  const pts = (i: number) => g.points[i] ?? 0;

  return (
    <>
      <Card className={g.mine.length ? "border-accent bg-accent-soft" : ""}>
        {g.mine.length ? (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
              <Check size={20} strokeWidth={3} />
            </span>
            <div>
              <div className="font-semibold">{inFinal && multi ? "You made the final" : myHeat ? `You're in Heat ${myHeat.ord}` : "You're in this race"}</div>
              <div className="text-sm text-muted">Head to the {game.location} and wait for the organisers.</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Organisers add the players for each round. You will get an alert if you're added.</p>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">{multi ? "Final: fastest" : "Fastest finishers"}</h3>
          <span className="text-sm text-muted">
            {final.entries.length} {multi ? "in the final" : "racing"}
          </span>
        </div>
        {timed.length === 0 ? (
          <p className="text-sm text-muted">{multi ? "The final starts when the heats are finished. The top 3 of each heat go through." : "No finish times yet."}</p>
        ) : (
          <Podium finishers={toFinishers(final.entries)} />
        )}
        {rest.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {rest.map((e) => (
              <li key={e.userId} className="flex items-center gap-3 py-2">
                <RankBadge rank={e.rank!} />
                <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                <TeamChip teamId={e.teamId} small />
                <span className="w-16 text-right text-sm font-semibold tabular-nums">{fmtTime(e.seconds!)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-subtle">
          Points: 1st {pts(0)}, 2nd {pts(1)}, 3rd {pts(2)}.
        </p>
      </Card>

      {multi &&
        heats.map((h) => {
          const top = h.entries.filter((e) => e.seconds != null).slice(0, 3);
          return (
            <details key={h.id} className="rounded-xl border border-line bg-surface p-4" open={h.status === "live"}>
              <summary className="flex cursor-pointer items-center justify-between font-semibold">
                <span>
                  Heat {h.ord} <span className="font-normal text-muted">· {h.entries.length} players</span>
                </span>
                <StatusPill status={h.status === "done" ? "closed" : h.status === "live" ? "live" : "upcoming"} />
              </summary>
              {top.length > 0 ? (
                <ul className="mt-3 divide-y divide-line">
                  {top.map((e) => (
                    <li key={e.userId} className="flex items-center gap-3 py-2">
                      <RankBadge rank={e.rank!} />
                      <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                      <TeamChip teamId={e.teamId} small />
                      <span className="w-16 text-right text-sm font-semibold tabular-nums">{fmtTime(e.seconds!)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">{h.entries.length ? "Racing soon." : "No players yet."}</p>
              )}
              {h.status === "done" && <p className="mt-2 text-xs text-subtle">The top 3 went to the final.</p>}
            </details>
          );
        })}
    </>
  );
}

export function Leaderboard() {
  const [tab, setTab] = useState<"teams" | "solo">("teams");
  const [game, setGame] = useState("all");
  const { me } = useAuth();
  const teams = usePoll<{ teams: TeamRow[]; games: { id: number; name: string }[] }>(tab === "teams" ? "/leaderboard/teams" : null, 30000);
  const solo = usePoll<Board & { games: { id: number; name: string }[] }>(tab === "solo" ? `/leaderboard/individual?game=${game}` : null, 30000);

  return (
    <Page title="Leaderboards">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "teams", label: "Teams" },
          { value: "solo", label: "Individuals" },
        ]}
      />

      {tab === "teams" && <Card>{teams.loading && !teams.data ? <Spinner /> : teams.data ? <TeamBars teams={teams.data.teams} mine={me?.team?.id} /> : null}</Card>}

      {tab === "solo" && (
        <>
          <select
            className="w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-base font-medium text-fg outline-none focus:border-accent"
            value={game}
            onChange={(e) => setGame(e.target.value)}
            aria-label="Game"
          >
            <option value="all">Overall (all solo games)</option>
            {(solo.data?.games ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <Card>{solo.loading && !solo.data ? <Spinner /> : solo.data ? <BoardList board={solo.data} /> : null}</Card>
          <p className="text-center text-xs text-subtle">The top 10 are shown. Everyone else can see their own rank.</p>
        </>
      )}
    </Page>
  );
}

export function Profile() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const [qr, setQr] = useState("");

  useEffect(() => {
    api<{ code: string }>("/me/qr")
      .then((r) => QRCode.toDataURL(r.code, { width: 600, margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } }))
      .then(setQr)
      .catch(() => {});
  }, []);

  if (!me) return null;
  const team = teamById(me.team?.id);
  return (
    <Page title="Profile">
      <Card className="flex items-center gap-4">
        <Avatar name={me.name} teamId={team?.id} size={56} />
        <div className="min-w-0">
          <div className="truncate text-xl font-semibold tracking-tight">{me.name}</div>
          <div className="mt-1 flex items-center gap-2">
            <TeamChip teamId={team?.id} small />
            <span className="truncate text-sm text-subtle">@{me.username}</span>
          </div>
        </div>
      </Card>

      <Card className="text-center">
        <h2 className="font-semibold">My QR code</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Show this to an organiser at a game station so they can find you instantly.</p>
        {qr ? (
          <div className="mx-auto w-full max-w-64 rounded-xl bg-white p-3 ring-1 ring-line">
            <img src={qr} alt="My QR code" className="w-full" />
          </div>
        ) : (
          <Spinner />
        )}
        <p className="mt-3 text-xs text-subtle">Turn up your screen brightness if it won't scan.</p>
      </Card>

      <section>
        <SectionLabel>Install the app</SectionLabel>
        <Card>
          <InstallCard />
        </Card>
      </section>

      <AlertsToggle />

      <section>
        <SectionLabel>Appearance</SectionLabel>
        <ThemeSelect />
      </section>

      <div className="space-y-2">
        {isOrganiser(me) && (
          <Btn full variant="secondary" onClick={() => nav("/admin")}>
            <SlidersHorizontal size={18} /> Organiser tools
          </Btn>
        )}
        <Btn
          full
          variant="ghost"
          onClick={async () => {
            await logout();
            nav("/login");
          }}
        >
          <LogOut size={18} /> Sign out
        </Btn>
      </div>
    </Page>
  );
}
