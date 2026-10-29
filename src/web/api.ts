import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  }).catch(() => {
    throw new ApiError(0, "No connection. Check your internet and try again.");
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

// Polls an endpoint. Pauses while the tab is hidden, so idle phones cost nothing.
export function usePoll<T>(path: string | null, intervalMs = 15000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    setLoading(true);
    if (path) load();
  }, [path, load]);

  useEffect(() => {
    if (!path || intervalMs <= 0) return;
    const tick = () => {
      if (document.visibilityState === "visible") load();
    };
    const timer = window.setInterval(tick, intervalMs);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [path, intervalMs, load]);

  return { data, error, loading, reload: load };
}

export interface Me {
  id: number;
  name: string;
  username: string;
  role: "participant" | "organiser" | "admin";
  team: { id: number; name: string; emoji: string; color: string } | null;
}

export interface GameSummary {
  id: number;
  slug: string;
  name: string;
  kind: "team" | "individual";
  type: "meme" | "greenred" | "shark" | "activity" | "actout" | "individual" | "hookstep" | "tictactoe";
  resultType: string | null;
  description: string;
  status: "draft" | "upcoming" | "live" | "closed";
  location: string;
  youIn?: boolean;
}

export interface Finisher {
  resultId: number;
  userId: number;
  name: string;
  teamId: number | null;
  seconds: number;
  rank: number;
}

export interface GrEntry {
  userId: number;
  name: string;
  teamId: number | null;
  seconds: number | null;
  rank: number | null;
  via: "manual" | "qualified";
}

export interface GrRound {
  id: number;
  ord: number;
  kind: "heat" | "final";
  status: "idle" | "live" | "done";
  entries: GrEntry[];
}

export const grLabel = (r: { kind: string; ord: number }, mode: string | null) => (r.kind === "heat" ? `Heat ${r.ord}` : mode === "single" ? "race" : "final");

export const toFinishers = (entries: GrEntry[]): Finisher[] =>
  entries.filter((e) => e.seconds != null).map((e) => ({ resultId: 0, userId: e.userId, name: e.name, teamId: e.teamId, seconds: e.seconds as number, rank: e.rank as number }));

export interface HsTurn {
  userId: number;
  name: string;
  teamId: number | null;
  status: "waiting" | "live" | "done";
  /** one letter per step so far: P for pass, F for fail */
  steps: string;
  score: number | null;
  monitorId: number | null;
  monitorName: string | null;
}

export interface HsRound {
  id: number;
  ord: number;
  kind: "round" | "final";
  status: "idle" | "live" | "done";
  turns: HsTurn[];
}

export interface HsStanding {
  userId: number;
  name: string;
  teamId: number | null;
  rank: number | null;
  total: number;
  scores: (number | null)[];
  final: number | null;
  winner: boolean;
  finalist: boolean;
}

export interface HookStep {
  configured: boolean;
  roundsCount: number;
  cap: number;
  steps: number;
  phase: "setup" | "rounds" | "final" | "done";
  mine: boolean;
  finalist: boolean;
  leaders: number[];
  winners: number[];
  hasFinal: boolean;
  roster: { userId: number; name: string; teamId: number | null }[];
  rounds: HsRound[];
  standings: HsStanding[];
}

export interface TttPlayer {
  userId: number;
  name: string;
  teamId: number | null;
}

export interface TttMatch {
  id: number;
  slot: number;
  a: TttPlayer | null;
  b: TttPlayer | null;
  winnerId: number | null;
  status: "pending" | "live" | "done";
  bye: boolean;
  /** both players are known and nobody has won yet */
  ready: boolean;
}

export interface TttRound {
  round: number;
  name: string;
  matches: TttMatch[];
}

export interface Tictactoe {
  state: "registration" | "running" | "done";
  joinOpen: boolean;
  roundsCount: number;
  players: number;
  mine: boolean;
  roster: TttPlayer[];
  rounds: TttRound[];
  champion: TttPlayer | null;
  you: {
    inBracket: boolean;
    matchId: number | null;
    round: string | null;
    status: "live" | "ready" | "waiting" | null;
    opponent: TttPlayer | null;
    outIn: string | null;
    champion: boolean;
  } | null;
}

export const hsLabel = (r: { kind: string; ord: number }) => (r.kind === "final" ? "Final" : `Round ${r.ord}`);

export interface RosterPlayer {
  userId: number;
  name: string;
  teamId: number | null;
  seconds: number | null;
  resultId: number | null;
}

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  gameId: number | null;
  at: number;
  readAt?: number | null;
}

// The Shark Tank turn in progress, as seen by one person
export interface SharkLive {
  gameId: number;
  matchId: number;
  stage: "semi1" | "semi2" | "final";
  pitchId: number;
  teamId: number;
  teamName: string;
  item: string;
  ord: number;
  phase: Exclude<PitchPhase, "done">;
  endsAt: number | null;
  youPitching: boolean;
  canVote: boolean;
  myRating: number | null;
}

// The Meme Charades turn in progress, as seen by one person
export interface MemeLive {
  gameId: number;
  matchId: number;
  stage: "semi1" | "semi2" | "final";
  turnId: number;
  ord: number;
  total: number;
  teamId: number;
  teamA: number;
  teamB: number;
  phase: "idle" | "acting";
  endsAt: number | null;
  players: string[];
  youActing: boolean;
  scores: Record<number, number>;
  last: { teamId: number; result: "point" | "fail"; ord: number } | null;
}

// The Act It Out round in progress, as seen by one person
export interface ActOutLive {
  gameId: number;
  roundId: number;
  ord: number;
  total: number;
  scene: string | null;
  phase: "idle" | "performing" | "voting";
  endsAt: number | null;
  turns: { teamId: number; phase: "idle" | "acting" | "done"; endsAt: number | null }[];
  current: { teamId: number; phase: "idle" | "acting" | "done"; endsAt: number | null } | null;
  canVote: boolean;
  eligible: number[];
  myRanking: number[] | null;
  last: { ord: number; results: { teamId: number; rank: number; points: number }[] } | null;
}

export interface Pulse {
  serverNow: number;
  notifications: AppNotification[];
  live: { id: number; slug: string; name: string; kind: string; type: string; location: string; youIn: boolean; joinOpen?: boolean }[];
  shark: SharkLive | null;
  meme: MemeLive | null;
  actout: ActOutLive | null;
}

export const fmtTime = (s: number) => {
  if (s < 60) return `${Number(s.toFixed(2))} s`;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};

export interface BoardRow {
  userId: number;
  name: string;
  teamId: number | null;
  rank: number;
  value: number;
  detail?: string;
  me?: boolean;
}

export interface Board {
  top: BoardRow[];
  count: number;
  me: { rank: number; value: number; detail?: string } | null;
}

export interface TeamRow {
  teamId: number;
  name: string;
  emoji: string;
  color: string;
  total: number;
  rank: number;
}

export type PitchPhase = "idle" | "prep" | "pitching" | "voting" | "done";

export const PHASE_LABEL: Record<PitchPhase, string> = {
  idle: "Up next",
  prep: "Preparing",
  pitching: "Pitching",
  voting: "Voting",
  done: "Done",
};

export interface Pitch {
  id: number;
  teamId: number;
  item: string;
  ord: number;
  phase: PitchPhase;
  phaseEndsAt: number | null;
  state: "pending" | "voting" | "closed";
  votes: number;
  avg: number | null;
  myRating: number | null;
  canVote: boolean;
}

export interface MemeTurn {
  id: number;
  ord: number;
  teamId: number;
  phase: "idle" | "acting" | "done";
  phaseEndsAt: number | null;
  result: "point" | "fail" | null;
  players: { id: number; name: string }[];
  /** the meme number: sent to organisers only, it is the answer */
  meme?: string | null;
}

export interface ActTurn {
  id: number;
  ord: number;
  teamId: number;
  phase: "idle" | "acting" | "done";
  phaseEndsAt: number | null;
}

export interface ActResult {
  teamId: number;
  rank: number;
  points: number;
  avg: number;
  firsts: number;
  ballots: number;
}

export interface ActRound {
  id: number;
  ord: number;
  scene: string | null;
  phase: "idle" | "performing" | "voting" | "done";
  phaseEndsAt: number | null;
  turns: ActTurn[];
  results: ActResult[];
  votes: number;
  myRanking: number[] | null;
}

export interface Match {
  id: number;
  stage: "semi1" | "semi2" | "final";
  teamA: number;
  teamB: number | null;
  status: "pending" | "live" | "done";
  winnerTeam: number | null;
  turns?: MemeTurn[];
  totals?: Record<number, number>;
  pitches?: Pitch[];
}

export interface GameDetail extends GameSummary {
  rules: string;
  serverNow?: number;
  timers?: { prep: number; pitch: number; vote: number };
  meme?: { act: number; perTeam: number; count: number };
  rounds?: ActRound[];
  actout?: { act: number; vote: number; rounds: number };
  pointsByTeam?: Record<number, number>;
  matches?: Match[];
  board?: Board;
  recent?: { id: number; value: number; at: number; name: string; teamId: number | null; matchRef: string | null }[];
  hookstep?: HookStep | null;
  tictactoe?: Tictactoe | null;
  greenred?: {
    mode: "single" | "multi" | null;
    heats: number;
    points: number[];
    mine: number[];
    rounds: GrRound[];
  } | null;
}

export const stageLabel = (s: string) => (s === "semi1" ? "Semi-final 1" : s === "semi2" ? "Semi-final 2" : "Final");
