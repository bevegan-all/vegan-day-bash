import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { Check, ChevronRight, LogOut, SlidersHorizontal } from "lucide-react";
import { teamById } from "../../shared/teams";
import { api, fmtTime, usePoll, type Board, type GameDetail, type GameSummary, type TeamRow } from "../api";
import { isOrganiser, useAuth } from "../auth";
import { TeamIcon } from "../art";
import { BoardList, GameCard, GameThumb, LocationTag, MatchCard, Podium } from "../components";
import { SharkLiveCard } from "../shark";
import { MemeLiveCard } from "../meme";
import { AlertsToggle, usePulse } from "../pulse";
import { InstallCard } from "../install";
import { Avatar, Btn, Card, ErrorBox, Page, RankBadge, SectionLabel, Segmented, Spinner, StatusPill, TeamChip, TeamMark, ThemeSelect } from "../ui";

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
  const { data, error, loading, reload } = usePoll<GameDetail>(`/games/${id}`, 15000);
  const { pulse, reload: reloadPulse, offset } = usePulse();
  const turn = pulse?.shark && String(pulse.shark.gameId) === id ? pulse.shark : null;
  const memeTurn = pulse?.meme && String(pulse.meme.gameId) === id ? pulse.meme : null;
  const turnKey = turn ? `${turn.pitchId}:${turn.phase}` : memeTurn ? `m${memeTurn.turnId}:${memeTurn.phase}:${memeTurn.last?.ord ?? 0}` : "";
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

          {data.board && data.type === "individual" && (
            <Card>
              <h3 className="mb-2 font-semibold">Top 10</h3>
              <BoardList board={data.board as Board} empty="No scores yet. Find an organiser to play." />
            </Card>
          )}

          {data.type === "activity" && <Card className="text-center text-sm text-muted">Just for fun. Watch the screen and join in.</Card>}
        </>
      )}
    </Page>
  );
}

function GreenRedView({ game }: { game: GameDetail }) {
  const g = game.greenred!;
  const rest = g.finishers.slice(3);
  return (
    <>
      <Card className={g.youIn ? "border-accent bg-accent-soft" : ""}>
        {g.youIn ? (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
              <Check size={20} strokeWidth={3} />
            </span>
            <div>
              <div className="font-semibold">You're in this game</div>
              <div className="text-sm text-muted">Head to the {game.location} and wait for the organisers.</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted">
            {g.count > 0 ? `${g.count} players are in this game.` : "Organisers will add the players when the game starts."} You will get an alert if you are added.
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Fastest finishers</h3>
          {g.count > 0 && <span className="text-sm text-muted">{g.count} playing</span>}
        </div>
        {g.finishers.length === 0 ? <p className="text-sm text-muted">No finish times yet.</p> : <Podium finishers={g.finishers} />}
        {rest.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {rest.map((f) => (
              <li key={f.userId} className="flex items-center gap-3 py-2">
                <RankBadge rank={f.rank} />
                <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                <TeamChip teamId={f.teamId} small />
                <span className="w-16 text-right text-sm font-semibold tabular-nums">{fmtTime(f.seconds)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {g.roster.length > 0 && (
        <details className="rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-semibold">All players ({g.roster.length})</summary>
          <ul className="mt-3 flex flex-wrap gap-2">
            {g.roster.map((p) => (
              <li key={p.userId} className="flex items-center gap-1.5 rounded-full bg-sunken py-1 pl-3 pr-1 text-sm">
                {p.name} <TeamChip teamId={p.teamId} small />
              </li>
            ))}
          </ul>
        </details>
      )}
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

      <section>
        <SectionLabel>Phone alerts</SectionLabel>
        <Card>
          <AlertsToggle />
        </Card>
      </section>

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
