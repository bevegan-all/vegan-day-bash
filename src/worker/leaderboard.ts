import { getSettings, shortName, type Env } from "./lib";
import { parseTable } from "./scoring";
import { rankHookstep } from "./hookstep";
import { rankTictactoe } from "./tictactoe";

export interface Ranked {
  userId: number;
  name: string;
  teamId: number | null;
  rank: number;
  value: number; // game: best/aggregate value, overall: total points
  detail?: string;
}

interface Row {
  game_id: number;
  result_type: string | null;
  type: string;
  user_id: number;
  value: number;
  created_at: number;
  display_name: string;
  team_id: number | null;
}

type ResultType = "match_win" | "score_high" | "time_high" | "time_low" | "placement";

function effectiveType(r: { result_type: string | null; type: string }): ResultType {
  if (r.type === "greenred") return "time_low"; // value is the finish time in seconds, fastest wins
  return (r.result_type as ResultType) ?? "score_high";
}

interface Agg {
  userId: number;
  name: string;
  teamId: number | null;
  primary: number; // larger is always better after normalisation
  secondary: number; // larger is better
  first: number; // earliest created_at of contributing results
  detail: string;
}

function rankGame(rows: Row[]): Ranked[] {
  const type = effectiveType(rows[0]);
  const byUser = new Map<number, Row[]>();
  for (const r of rows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  const aggs: Agg[] = [];
  for (const [userId, list] of byUser) {
    const vals = list.map((r) => r.value);
    const first = Math.min(...list.map((r) => r.created_at));
    let primary = 0;
    let secondary = 0;
    let detail = "";
    switch (type) {
      case "match_win": {
        const wins = vals.reduce((a, b) => a + b, 0);
        primary = wins;
        secondary = -(vals.length - wins);
        detail = `${wins}W ${vals.length - wins}L`;
        break;
      }
      case "score_high":
        primary = Math.max(...vals);
        detail = `${primary}`;
        break;
      case "time_high":
        primary = Math.max(...vals);
        detail = `${primary}s`;
        break;
      case "time_low":
        primary = -Math.min(...vals);
        detail = `${-primary}s`;
        break;
      case "placement":
        primary = -Math.min(...vals);
        detail = `#${-primary}`;
        break;
    }
    aggs.push({ userId, name: list[0].display_name, teamId: list[0].team_id, primary, secondary, first, detail });
  }
  aggs.sort((a, b) => b.primary - a.primary || b.secondary - a.secondary || a.first - b.first);
  const out: Ranked[] = [];
  aggs.forEach((a, i) => {
    const prev = aggs[i - 1];
    const tied = prev && prev.primary === a.primary && prev.secondary === a.secondary;
    const rank = tied ? out[i - 1].rank : i + 1;
    const value = type === "time_low" || type === "placement" ? -a.primary : a.primary;
    out.push({ userId: a.userId, name: a.name, teamId: a.teamId, rank, value, detail: a.detail });
  });
  return out;
}

export interface IndividualBoards {
  perGame: Map<number, Ranked[]>;
  overall: Ranked[];
}

export async function computeIndividual(env: Env): Promise<IndividualBoards> {
  const settings = await getSettings(env);
  const rankPoints: number[] = JSON.parse(settings.rank_points ?? "[10,8,6,4,4,4,4,4,4,4]");
  const participation = Number(settings.participation_points ?? "1");
  const { results } = await env.DB.prepare(
    `SELECT r.game_id, g.result_type, g.type, r.user_id, r.value, r.created_at, u.display_name, u.team_id
       FROM results r
       JOIN games g ON g.id = r.game_id
       JOIN users u ON u.id = r.user_id
      WHERE r.voided_at IS NULL AND g.status != 'draft' AND g.type NOT IN ('hookstep', 'tictactoe')`,
  ).all<Row>();

  const byGame = new Map<number, Row[]>();
  for (const r of results) {
    const list = byGame.get(r.game_id) ?? [];
    list.push(r);
    byGame.set(r.game_id, list);
  }

  const perGame = new Map<number, Ranked[]>();
  const totals = new Map<number, { name: string; teamId: number | null; total: number; games: number }>();
  const award = (ranked: Ranked[], table: number[], fallback: number) => {
    for (const r of ranked) {
      const pts = r.rank <= table.length ? table[r.rank - 1] : fallback;
      const t = totals.get(r.userId) ?? { name: r.name, teamId: r.teamId, total: 0, games: 0 };
      t.total += pts;
      t.games += 1;
      totals.set(r.userId, t);
    }
  };
  for (const [gameId, rows] of byGame) {
    const ranked = rankGame(rows);
    perGame.set(gameId, ranked);
    const race = rows[0].type === "greenred";
    award(ranked, race ? parseTable(settings.greenred_points, [3, 2, 1]) : rankPoints, race ? 0 : participation);
  }
  // Hook Step Challenge: ranked from its rounds, and players who tie for the win all count as first
  const { results: hooks } = await env.DB.prepare("SELECT id FROM games WHERE type = 'hookstep' AND status != 'draft'").all<{ id: number }>();
  for (const h of hooks) {
    const ranked = await rankHookstep(env, h.id);
    perGame.set(h.id, ranked);
    award(ranked, rankPoints, participation);
  }
  // Paper cup flip tic-tac-toe: ranked by how far each player got, once the tournament is over
  const { results: tttGames } = await env.DB.prepare("SELECT id FROM games WHERE type = 'tictactoe' AND status != 'draft'").all<{ id: number }>();
  for (const tg of tttGames) {
    const ranked = await rankTictactoe(env, tg.id);
    perGame.set(tg.id, ranked);
    award(ranked, rankPoints, participation);
  }

  const arr = [...totals.entries()].map(([userId, t]) => ({ userId, ...t }));
  arr.sort((a, b) => b.total - a.total || b.games - a.games || a.userId - b.userId);
  const overall: Ranked[] = [];
  arr.forEach((a, i) => {
    const tied = i > 0 && arr[i - 1].total === a.total;
    overall.push({
      userId: a.userId,
      name: a.name,
      teamId: a.teamId,
      rank: tied ? overall[i - 1].rank : i + 1,
      value: a.total,
      detail: `${a.games} game${a.games === 1 ? "" : "s"}`,
    });
  });
  return { perGame, overall };
}

export function publicBoard(list: Ranked[], meId: number | null, limit = 10) {
  const top = list.slice(0, limit).map((r) => ({ ...r, name: shortName(r.name), me: r.userId === meId }));
  const mine = meId == null ? undefined : list.find((r) => r.userId === meId);
  return {
    top,
    count: list.length,
    me: mine ? { rank: mine.rank, value: mine.value, detail: mine.detail } : null,
  };
}

export interface TeamRow {
  teamId: number;
  name: string;
  emoji: string;
  color: string;
  total: number;
  byGame: Record<number, number>;
  individualPoints: number;
}

export async function computeTeamBoard(env: Env, boards?: IndividualBoards) {
  const settings = await getSettings(env);
  const { results: teams } = await env.DB.prepare("SELECT id, name, emoji, color FROM teams ORDER BY id").all<{
    id: number;
    name: string;
    emoji: string;
    color: string;
  }>();
  const { results: pts } = await env.DB.prepare(
    `SELECT team_id, game_id, SUM(points) AS pts FROM team_points WHERE voided_at IS NULL GROUP BY team_id, game_id`,
  ).all<{ team_id: number; game_id: number | null; pts: number }>();

  const rows = new Map<number, TeamRow>(
    teams.map((t) => [t.id, { teamId: t.id, name: t.name, emoji: t.emoji, color: t.color, total: 0, byGame: {}, individualPoints: 0 }]),
  );
  for (const p of pts) {
    const row = rows.get(p.team_id);
    if (!row) continue;
    row.total += p.pts;
    row.byGame[p.game_id ?? 0] = (row.byGame[p.game_id ?? 0] ?? 0) + p.pts;
  }
  if (settings.individual_to_team === "1") {
    const b = boards ?? (await computeIndividual(env));
    for (const o of b.overall) {
      const row = o.teamId == null ? undefined : rows.get(o.teamId);
      if (row) {
        row.individualPoints += o.value;
        row.total += o.value;
      }
    }
  }
  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.teamId - b.teamId);
  const ranked = list.map((r, i) => ({
    ...r,
    total: Math.round(r.total * 10) / 10,
    rank: i > 0 && list[i - 1].total === r.total ? 0 : i + 1,
  }));
  for (let i = 0; i < ranked.length; i++) if (ranked[i].rank === 0) ranked[i].rank = ranked[i - 1].rank;
  return ranked;
}
