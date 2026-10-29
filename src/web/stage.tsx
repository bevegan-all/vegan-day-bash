import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Crown, Trophy } from "lucide-react";
import { teamById } from "../shared/teams";
import type { GameDetail } from "./api";
import { GameArt, TeamIcon } from "./art";
import { LocationTag } from "./components";
import { StatusPill, TeamName } from "./ui";

// ---------------------------------------------------------------------------
// One template for every game on the public screen.
//   Stage      : the card every live game sits in (title bar, progress, "what is happening now", details)
//   CountUp    : a number that counts up to its value
//   ScoreBar   : a team (or any row) with an animated bar and number
//   VoteMeter  : live count of votes coming in
//   useCelebrations + CelebrationOverlay : the full-screen "this team moves on / wins" moment
// ---------------------------------------------------------------------------

export function CountUp({ value, decimals = 0, ms = 1200 }: { value: number; decimals?: number; ms?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = Date.now();
    const a = from.current;
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / ms);
      const v = a + (value - a) * (1 - Math.pow(1 - p, 3));
      from.current = v;
      setShown(v);
      if (p >= 1) clearInterval(id);
    }, 33);
    return () => clearInterval(id);
  }, [value, ms]);
  return <span className="tabular-nums">{shown.toFixed(decimals)}</span>;
}

export type Tone = "wait" | "live" | "vote" | "done";

export interface Step {
  label: string;
  state: "done" | "live" | "next";
  /** the team that won this step, shown beside a finished step */
  teamId?: number | null;
}

export interface StageView {
  kicker: string;
  title: ReactNode;
  sub?: ReactNode;
  tone: Tone;
  clock?: ReactNode;
  steps?: Step[];
  body?: ReactNode;
}

const TONE: Record<Tone, { chip: string; label: string; panel: string; bar: string }> = {
  wait: { chip: "bg-sunken text-muted", label: "Up next", panel: "border-line bg-sunken", bar: "bg-line" },
  live: { chip: "bg-accent text-accent-fg", label: "In play", panel: "border-accent/60 bg-accent-soft", bar: "bg-accent" },
  vote: { chip: "bg-warn text-bg", label: "Voting open", panel: "border-warn/60 bg-warn-soft", bar: "bg-warn" },
  done: { chip: "bg-warn text-bg", label: "Result", panel: "border-warn/60 bg-warn-soft", bar: "bg-warn" },
};

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="mb-5 flex gap-2" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={i} className="min-w-0 flex-1">
          <div className={`h-1.5 rounded-full ${s.state === "done" ? "bg-accent" : s.state === "live" ? "animate-pulse bg-live" : "bg-line"}`} />
          <div className={`mt-1.5 flex items-center gap-1.5 truncate text-sm font-semibold ${s.state === "next" ? "text-subtle" : s.state === "live" ? "text-fg" : "text-muted"}`}>
            {s.state === "done" && (s.teamId ? <TeamIcon teamId={s.teamId} size={18} /> : <Check size={14} strokeWidth={3} className="text-accent" />)}
            <span className="truncate">{s.label}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Stage({ game, view }: { game: GameDetail; view: StageView }) {
  const tone = TONE[view.tone];
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

      {view.steps && view.steps.length > 1 && <Steps steps={view.steps} />}

      <div className={`mb-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-xl border p-5 transition-colors duration-700 ${tone.panel}`}>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-3 py-0.5 text-sm font-semibold uppercase tracking-wider ${tone.chip}`}>{tone.label}</span>
            <span className="text-sm font-semibold uppercase tracking-widest text-subtle">{view.kicker}</span>
          </div>
          <div key={String(view.tone) + String(typeof view.title === "string" ? view.title : "")} className="slide-in text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            {view.title}
          </div>
          {view.sub && <div className="mt-2 text-2xl text-muted">{view.sub}</div>}
        </div>
        {view.clock && <div className="shrink-0">{view.clock}</div>}
      </div>

      {view.body}
    </div>
  );
}

// A team or person with a bar that fills and a number that counts up
export function ScoreBar({
  teamId,
  label,
  value,
  max,
  decimals = 0,
  suffix = "",
  caption,
  winner,
  rank,
}: {
  teamId?: number | null;
  label?: string;
  value: number;
  max: number;
  decimals?: number;
  suffix?: string;
  caption?: ReactNode;
  winner?: boolean;
  rank?: number;
}) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(Math.max(0, Math.min(100, (value / Math.max(max, 0.0001)) * 100))), 80);
    return () => clearTimeout(t);
  }, [value, max]);
  const color = teamById(teamId)?.color ?? "var(--accent)";
  return (
    <div className={`rounded-xl border p-4 transition-colors ${winner ? "border-warn bg-warn-soft" : "border-line bg-surface"}`}>
      <div className="mb-2 flex items-center gap-3">
        {rank != null && (
          <span className="flex h-9 w-9 items-center justify-center rounded-full text-lg font-semibold text-[#1c1505]" style={{ background: rank === 1 ? "#d4a72c" : rank === 2 ? "#a9afb6" : rank === 3 ? "#c4875a" : "var(--sunken)", color: rank > 3 ? "var(--muted)" : undefined }}>
            {rank}
          </span>
        )}
        {teamId ? <TeamName teamId={teamId} size={44} className="text-3xl font-semibold" /> : <span className="text-3xl font-semibold">{label}</span>}
        {winner && <Crown size={26} className="text-warn" />}
        <span className="ml-auto text-5xl font-semibold tabular-nums tracking-tight">
          <CountUp value={value} decimals={decimals} />
          <span className="text-2xl text-muted">{suffix}</span>
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full transition-all duration-[1400ms] ease-out" style={{ width: `${w}%`, background: color }} />
      </div>
      {caption && <div className="mt-2 text-lg text-muted">{caption}</div>}
    </div>
  );
}

// Votes arriving, live
export function VoteMeter({ count, label = "votes in" }: { count: number; label?: string }) {
  return (
    <div className="flex items-center justify-center gap-4 rounded-xl border border-warn/60 bg-warn-soft p-5">
      <span className="h-3 w-3 animate-pulse rounded-full bg-live" />
      <span className="text-7xl font-semibold tracking-tight">
        <CountUp value={count} ms={700} />
      </span>
      <span className="text-3xl text-muted">{label}</span>
    </div>
  );
}

// ---------- the "team moves on" moment ----------
export interface Celebration {
  id: string;
  teamId?: number | null;
  kicker: string;
  title: string;
  sub?: string;
  rows?: { rank: number; name: string; teamId?: number | null; value: string }[];
}

const SHOW_MS = 10000;

// Gives back the celebration to show now. The first load only remembers what already happened.
export function useCelebrations(list: Celebration[]) {
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<Celebration[]>([]);
  const key = list.map((c) => c.id).join("|");

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(list.map((c) => c.id));
      return;
    }
    const fresh = list.filter((c) => !seen.current!.has(c.id));
    if (fresh.length) {
      fresh.forEach((c) => seen.current!.add(c.id));
      setQueue((q) => [...q, ...fresh]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = queue[0] ?? null;
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), SHOW_MS);
    return () => clearTimeout(t);
  }, [current]);

  return { current, dismiss: () => setQueue((q) => q.slice(1)) };
}

const PALETTE = ["#d4a72c", "#ffffff", "#52c48d", "#f0786d", "#6aa9ff", "#f59ac4"];

export function CelebrationOverlay({ c, onClose }: { c: Celebration | null; onClose: () => void }) {
  if (!c) return null;
  const team = teamById(c.teamId);
  const colors = team ? [team.color, "#d4a72c", "#ffffff", team.color, "#d4a72c"] : PALETTE;
  return (
    <div key={c.id} onClick={onClose} className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center overflow-hidden bg-black/80 p-8 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {Array.from({ length: 70 }, (_, i) => (
          <span
            key={i}
            className="confetti"
            style={{
              left: `${(i * 37) % 100}%`,
              background: colors[i % colors.length],
              animationDuration: `${3.2 + ((i * 7) % 5) * 0.6}s`,
              animationDelay: `${-((i * 13) % 10) * 0.45}s`,
              ["--drift" as string]: `${((i % 7) - 3) * 40}px`,
              transform: `rotate(${i * 29}deg)`,
              width: i % 3 === 0 ? 10 : 14,
            }}
          />
        ))}
      </div>
      <div className="relative z-10 flex max-w-4xl flex-col items-center text-center text-white">
        <div className="text-xl font-semibold uppercase tracking-[0.3em] text-white/70">{c.kicker}</div>
        <div className="pop relative mt-20" style={{ ["--halo" as string]: (team?.color ?? "#d4a72c") + "99" }}>
          {team ? (
            <div className="halo rounded-[32px]">
              <TeamIcon teamId={team.id} size={220} sticker />
            </div>
          ) : (
            <div className="halo flex h-48 w-48 items-center justify-center rounded-full bg-[#d4a72c] text-[#1c1505]">
              <Trophy size={104} />
            </div>
          )}
          {team && <Crown size={84} className="absolute -top-14 left-1/2 -translate-x-1/2 text-[#f2c744] drop-shadow-lg" fill="#f2c744" />}
        </div>
        <div className="slide-in mt-8 text-7xl font-semibold tracking-tight" style={{ animationDelay: "0.35s" }}>
          {c.title}
        </div>
        {c.sub && (
          <div className="slide-in mt-3 text-4xl text-white/80" style={{ animationDelay: "0.6s" }}>
            {c.sub}
          </div>
        )}
        {c.rows && c.rows.length > 0 && (
          <ol className="slide-in mt-8 w-full max-w-xl space-y-2 text-left text-3xl" style={{ animationDelay: "0.85s" }}>
            {c.rows.map((r) => (
              <li key={r.rank} className="flex items-center gap-4 rounded-xl bg-white/10 px-5 py-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full text-xl font-semibold text-[#1c1505]" style={{ background: r.rank === 1 ? "#d4a72c" : r.rank === 2 ? "#a9afb6" : r.rank === 3 ? "#c4875a" : "#8a918c" }}>
                  {r.rank}
                </span>
                <span className="flex-1 truncate font-semibold">{r.name}</span>
                {r.teamId ? <TeamIcon teamId={r.teamId} size={40} /> : null}
                <span className="tabular-nums text-white/80">{r.value}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
