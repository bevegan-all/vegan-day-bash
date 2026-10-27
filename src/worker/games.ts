import { HttpError, getSettings, shortName, type Env, type User } from "./lib";
import { computeIndividual, publicBoard } from "./leaderboard";

export async function sharkTimers(env: Env) {
  const s = await getSettings(env);
  const n = (k: string, d: number) => {
    const v = Number(s[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return { prep: n("shark_prep_seconds", 300), pitch: n("shark_pitch_seconds", 180), vote: n("shark_vote_seconds", 60) };
}

export async function pitchTally(env: Env, p: { id: number; team_id: number; team_a: number; team_b: number }) {
  const s = await getSettings(env);
  const opponent = p.team_id === p.team_a ? p.team_b : p.team_a;
  const { results } = await env.DB.prepare(
    "SELECT v.rating, u.team_id FROM pitch_votes v JOIN users u ON u.id = v.voter_id WHERE v.pitch_id = ?",
  )
    .bind(p.id)
    .all<{ rating: number; team_id: number | null }>();
  const eligible = results.filter((r) => r.team_id !== p.team_id && (s.shark_block_opponent !== "1" || r.team_id !== opponent));
  const avg = eligible.length ? eligible.reduce((a, r) => a + r.rating, 0) / eligible.length : 0;
  return { votes: eligible.length, avg: Math.round(avg * 100) / 100, minVotes: Number(s.shark_min_votes) };
}

interface GameRow {
  id: number;
  slug: string;
  name: string;
  kind: string;
  type: string;
  result_type: string | null;
  description: string;
  rules: string;
  status: string;
  location: string;
}

// viewer: the signed-in user, or null for the public big screen.
export async function buildGameDetail(env: Env, gameId: number, viewer: User | null, organiser = false) {
  const game = await env.DB.prepare("SELECT id, slug, name, kind, type, result_type, description, rules, status, location FROM games WHERE id = ?")
    .bind(gameId)
    .first<GameRow>();
  if (!game || (game.status === "draft" && !organiser)) throw new HttpError(404, "Game not found");

  const base = {
    id: game.id,
    slug: game.slug,
    name: game.name,
    kind: game.kind,
    type: game.type,
    resultType: game.result_type,
    description: game.description,
    rules: game.rules,
    status: game.status,
    location: game.location,
  };

  if (game.type === "meme" || game.type === "shark") {
    const { results: matches } = await env.DB.prepare(
      "SELECT id, stage, team_a AS teamA, team_b AS teamB, status, winner_team AS winnerTeam FROM matches WHERE game_id = ? ORDER BY CASE stage WHEN 'semi1' THEN 1 WHEN 'semi2' THEN 2 ELSE 3 END",
    )
      .bind(gameId)
      .all<{ id: number; stage: string; teamA: number; teamB: number | null; status: string; winnerTeam: number | null }>();

    const out = [];
    for (const m of matches) {
      if (game.type === "meme") {
        const { results: rounds } = await env.DB.prepare("SELECT round, team_id AS teamId, correct FROM meme_rounds WHERE match_id = ? ORDER BY round")
          .bind(m.id)
          .all<{ round: number; teamId: number; correct: number }>();
        const totals: Record<number, number> = {};
        for (const r of rounds) totals[r.teamId] = (totals[r.teamId] ?? 0) + r.correct;
        out.push({ ...m, rounds, totals });
      } else {
        const { results: pitches } = await env.DB.prepare(
          "SELECT id, team_id AS teamId, item, state, votes, avg, ord, phase, phase_ends_at AS phaseEndsAt FROM pitches WHERE match_id = ? ORDER BY ord, id",
        )
          .bind(m.id)
          .all<{ id: number; teamId: number; item: string; state: string; votes: number; avg: number | null; ord: number; phase: string; phaseEndsAt: number | null }>();
        const enriched = [];
        for (const p of pitches) {
          let myRating: number | null = null;
          let votes = p.votes;
          if (viewer) {
            const v = await env.DB.prepare("SELECT rating FROM pitch_votes WHERE pitch_id = ? AND voter_id = ?").bind(p.id, viewer.id).first<{ rating: number }>();
            myRating = v?.rating ?? null;
          }
          if (p.state === "voting") {
            // live vote count is for organisers and the big screen; participants just see "open"
            if (organiser || !viewer) votes = (await pitchTally(env, { id: p.id, team_id: p.teamId, team_a: m.teamA, team_b: m.teamB ?? m.teamA })).votes;
            else votes = 0;
          }
          enriched.push({
            ...p,
            votes,
            avg: p.state === "closed" ? p.avg : null,
            myRating,
            canVote: !!viewer && viewer.team_id !== p.teamId,
          });
        }
        out.push({ ...m, pitches: enriched });
      }
    }
    return { ...base, matches: out, serverNow: Date.now(), timers: game.type === "shark" ? await sharkTimers(env) : undefined };
  }

  if (game.type === "greenred" || game.type === "individual") {
    const boards = await computeIndividual(env);
    const ranked = boards.perGame.get(gameId) ?? [];
    const board = publicBoard(ranked, viewer?.id ?? null, 10);
    let recent: unknown[] = [];
    if (organiser) {
      const { results } = await env.DB.prepare(
        `SELECT r.id, r.value, r.created_at AS at, u.display_name AS name, u.team_id AS teamId, r.match_ref AS matchRef
           FROM results r JOIN users u ON u.id = r.user_id
          WHERE r.game_id = ? AND r.voided_at IS NULL ORDER BY r.id DESC LIMIT 40`,
      )
        .bind(gameId)
        .all();
      recent = results;
    }
    let greenred: unknown = undefined;
    if (game.type === "greenred") {
      const display = (n: string) => (organiser ? n : shortName(n));
      const { results: roster } = await env.DB.prepare(
        `SELECT gp.user_id AS userId, u.display_name AS name, u.team_id AS teamId
           FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY u.display_name`,
      )
        .bind(gameId)
        .all<{ userId: number; name: string; teamId: number | null }>();
      const { results: times } = await env.DB.prepare(
        "SELECT id, user_id AS userId, value AS seconds FROM results WHERE game_id = ? AND voided_at IS NULL ORDER BY value, created_at",
      )
        .bind(gameId)
        .all<{ id: number; userId: number; seconds: number }>();
      const byUser = new Map(roster.map((p) => [p.userId, p]));
      const timeOf = new Map(times.map((t) => [t.userId, t]));
      const finishers = times.map((t, i) => {
        const p = byUser.get(t.userId);
        return {
          resultId: t.id,
          userId: t.userId,
          name: display(p?.name ?? "Player"),
          teamId: p?.teamId ?? null,
          seconds: t.seconds,
          rank: i > 0 && times[i - 1].seconds === t.seconds ? 0 : i + 1,
        };
      });
      for (let i = 0; i < finishers.length; i++) if (finishers[i].rank === 0) finishers[i].rank = finishers[i - 1].rank;
      greenred = {
        count: roster.length,
        youIn: !!viewer && byUser.has(viewer.id),
        finishers,
        roster: roster.map((p) => ({
          userId: p.userId,
          name: display(p.name),
          teamId: p.teamId,
          seconds: timeOf.get(p.userId)?.seconds ?? null,
          resultId: timeOf.get(p.userId)?.id ?? null,
        })),
      };
    }
    return { ...base, board, recent, greenred };
  }

  return base;
}
