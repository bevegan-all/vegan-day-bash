import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Crown, MapPin } from "lucide-react";
import { teamById } from "../shared/teams";
import { PHASE_LABEL, api, fmtTime, stageLabel, type Board, type Finisher, type Match, type Pitch } from "./api";
import { GameArt, TeamIcon } from "./art";
import { TurnTracker } from "./meme";
import { Card, RankBadge, StatusPill, TeamChip, TeamMark, toast, toastError } from "./ui";

// Artwork tile for a game, used as a thumbnail or a banner (the parent sets the size or aspect ratio)
export function GameThumb({ slug, name, className = "" }: { slug: string; name: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg bg-sunken ${className}`}>
      <GameArt slug={slug} name={name} />
    </div>
  );
}

export function LocationTag({ location, className = "" }: { location: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <MapPin size={13} className="shrink-0" />
      {location}
    </span>
  );
}

const PODIUM = {
  1: { bg: "#d4a72c", h: "h-24", hBig: "h-40" },
  2: { bg: "#a9afb6", h: "h-16", hBig: "h-28" },
  3: { bg: "#c4875a", h: "h-12", hBig: "h-20" },
} as const;

// Top three finishers by time, with the winner in the middle
export function Podium({ finishers, big }: { finishers: Finisher[]; big?: boolean }) {
  const slots: [Finisher | undefined, 1 | 2 | 3][] = [
    [finishers[1], 2],
    [finishers[0], 1],
    [finishers[2], 3],
  ];
  return (
    <div className="grid grid-cols-3 items-end gap-2 text-center">
      {slots.map(([f, place]) => (
        <div key={place} className="flex min-w-0 flex-col items-center">
          {f ? (
            <>
              <TeamIcon teamId={f.teamId} size={big ? 56 : 36} />
              <div className={`mt-1.5 w-full truncate font-semibold ${big ? "text-2xl" : "text-sm"}`}>{f.name}</div>
              <div className={`font-semibold tabular-nums text-muted ${big ? "text-xl" : "text-sm"}`}>{fmtTime(f.seconds)}</div>
            </>
          ) : (
            <div className={`font-semibold text-subtle ${big ? "text-2xl" : "text-sm"}`}>–</div>
          )}
          <div
            className={`mt-2 flex w-full items-start justify-center rounded-t-lg pt-2 font-semibold text-[#1c1505] ${big ? "grow-up " + PODIUM[place].hBig : PODIUM[place].h} ${big ? "text-3xl" : "text-lg"}`}
            style={{ background: f ? PODIUM[place].bg : "var(--sunken)", color: f ? undefined : "var(--subtle)", animationDelay: big ? `${(4 - place) * 0.25}s` : undefined }}
          >
            {place}
          </div>
        </div>
      ))}
    </div>
  );
}

// A game as a colourful card, like a thumbnail on a games site
export function GameCard({
  game,
  featured,
}: {
  game: { id: number; slug: string; name: string; kind: string; status: string; location: string; youIn?: boolean };
  featured?: boolean;
}) {
  return (
    <Link
      to={`/games/${game.id}`}
      className={`group relative block overflow-hidden rounded-xl border bg-surface transition active:scale-[0.985] ${featured ? "col-span-2 aspect-[16/8]" : "aspect-[16/11]"} ${
        game.status === "live" ? "border-live/70 ring-2 ring-live/40" : "border-line"
      }`}
    >
      <GameArt slug={game.slug} name={game.name} className="transition duration-300 group-hover:scale-105" />
      <div className="absolute left-2.5 top-2.5">
        <StatusPill status={game.status} onArt />
      </div>
      {game.youIn && (
        <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg">
          <Check size={12} strokeWidth={3} /> You're in
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2.5 pt-10">
        <div className="text-[15px] font-semibold leading-tight text-white">{game.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-white/75">
          <span>{game.kind === "team" ? "Team game" : "Individual"}</span>
          <span aria-hidden>·</span>
          <LocationTag location={game.location} />
        </div>
      </div>
    </Link>
  );
}

export function RatingPicker({ pitch, onDone }: { pitch: Pitch; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<number | null>(pitch.myRating);

  async function rate(n: number) {
    setBusy(true);
    try {
      await api(`/pitches/${pitch.id}/vote`, { body: { rating: n } });
      setMine(n);
      toast(`Rated ${n} out of 10`);
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            disabled={busy}
            onClick={() => rate(n)}
            aria-pressed={mine === n}
            className={`min-h-13 rounded-lg border text-lg font-semibold tabular-nums transition active:scale-95 ${
              mine === n ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-fg hover:bg-sunken"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-center text-sm text-muted">
        {mine ? `You rated ${mine} out of 10. Tap another number to change it until rating closes.` : "1 is rough, 10 is a deal."}
      </p>
    </div>
  );
}

export function BoardList({ board, empty = "No results yet." }: { board: Board; empty?: string }) {
  if (board.top.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const meInTop = board.top.some((r) => r.me);
  return (
    <div>
      <ol className="divide-y divide-line">
        {board.top.map((r) => (
          <li key={r.userId} className={`flex items-center gap-3 py-2.5 ${r.me ? "-mx-2 rounded-lg bg-accent-soft px-2" : ""}`}>
            <RankBadge rank={r.rank} />
            <span className="min-w-0 flex-1 truncate font-medium">
              {r.name}
              {r.me && <span className="ml-1.5 text-xs font-semibold text-accent">You</span>}
            </span>
            <TeamChip teamId={r.teamId} small />
            <span className="w-14 text-right text-sm font-semibold tabular-nums">{r.detail ?? r.value}</span>
          </li>
        ))}
      </ol>
      {!meInTop && board.me && (
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-accent-soft px-3 py-3">
          <span className="text-lg font-semibold tabular-nums">#{board.me.rank}</span>
          <span className="flex-1 font-medium">Your rank</span>
          <span className="text-sm text-muted">of {board.count}</span>
          <span className="text-sm font-semibold tabular-nums">{board.me.detail ?? board.me.value}</span>
        </div>
      )}
      {!meInTop && !board.me && <p className="mt-3 text-center text-sm text-muted">You have no result here yet.</p>}
    </div>
  );
}

function TeamLine({ id }: { id: number | null }) {
  const t = teamById(id);
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      <TeamMark teamId={id} size={28} />
      {t ? t.name : "To be decided"}
    </span>
  );
}

export function MatchCard({ match, kind, onChanged }: { match: Match; kind: "meme" | "shark"; onChanged: () => void }) {
  const winner = match.winnerTeam;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{stageLabel(match.stage)}</span>
        <StatusPill status={match.status === "done" ? "closed" : match.status === "live" ? "live" : "upcoming"} />
      </div>

      {kind === "meme" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {[match.teamA, match.teamB].map((t, i) => (
              <div key={i} className={`rounded-lg border p-3 text-center ${winner && winner === t ? "border-accent bg-accent-soft" : "border-line bg-sunken"}`}>
                <div className="flex justify-center text-sm">
                  <TeamLine id={t} />
                </div>
                <div className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{t ? (match.totals?.[t] ?? 0) : "–"}</div>
                {winner && winner === t && (
                  <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent">
                    <Crown size={13} /> {match.stage === "final" ? "Champions" : "Advances"}
                  </div>
                )}
              </div>
            ))}
          </div>
          {match.turns && match.turns.length > 0 && (
            <div className="mt-4">
              <TurnTracker teamA={match.teamA} teamB={match.teamB} turns={match.turns} totals={match.totals ?? {}} />
            </div>
          )}
          {match.turns && match.turns.length > 0 && match.status !== "done" && match.turns.every((t) => t.phase === "done") && (
            <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">It's a tie. The organisers will decide who moves forward.</p>
          )}
        </>
      )}

      {kind === "shark" && (
        <div className="space-y-3">
          {(match.pitches ?? []).length === 0 && (
            <div className="flex items-center justify-between">
              <TeamLine id={match.teamA} />
              <span className="text-sm text-subtle">vs</span>
              <TeamLine id={match.teamB} />
            </div>
          )}
          {(match.pitches ?? []).length === 2 && match.pitches!.every((p) => p.phase === "done") && match.status !== "done" && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">It's a tie. The organisers will decide who moves forward.</p>
          )}
          {(match.pitches ?? []).map((p) => (
            <div key={p.id} className={`rounded-lg border p-3 ${winner === p.teamId ? "border-accent bg-accent-soft" : "border-line bg-sunken"}`}>
              <div className="flex items-center justify-between gap-2">
                <TeamLine id={p.teamId} />
                {p.phase === "done" ? (
                  <span className="text-2xl font-semibold tabular-nums">
                    {p.avg?.toFixed(1)}
                    <span className="text-sm font-normal text-subtle"> / 10</span>
                  </span>
                ) : (
                  <span className={`text-xs font-semibold ${p.phase === "idle" ? "text-subtle" : "text-accent"}`}>{PHASE_LABEL[p.phase]}</span>
                )}
              </div>
              <div className="mt-1 text-sm text-muted">
                {p.ord === 1 ? "Pitches first" : "Pitches second"} · {p.item}
              </div>
              {winner === p.teamId && (
                <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent">
                  <Crown size={13} /> Advances
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
