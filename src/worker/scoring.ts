// Points by finishing position, shared by every team game.

export function parseTable(raw: string | undefined, fallback = [2, 1, 1, 0]): number[] {
  try {
    const arr = JSON.parse(raw ?? "");
    if (Array.isArray(arr) && arr.length && arr.every((n) => typeof n === "number")) return arr;
  } catch {
    /* use the default */
  }
  return fallback;
}

// `groups` is the teams in order of finishing, best first, with teams that tied together in one group.
// A tied group shares the points of the positions it fills (two teams tied for 1st split 2 + 1).
export function sharePoints(groups: number[][], table: number[]) {
  const out = new Map<number, { points: number; rank: number }>();
  let pos = 0;
  for (const g of groups) {
    const slice = g.map((_, i) => table[pos + i] ?? 0);
    const avg = slice.reduce((a, b) => a + b, 0) / g.length;
    for (const t of g) out.set(t, { points: Math.round(avg * 100) / 100, rank: pos + 1 });
    pos += g.length;
  }
  return out;
}

// Turn a sorted list into tie groups: neighbours with the same key belong together.
export function tieGroups<T>(sorted: T[], key: (x: T) => string, id: (x: T) => number): number[][] {
  const groups: number[][] = [];
  let last: string | null = null;
  for (const x of sorted) {
    const k = key(x);
    if (k === last) groups[groups.length - 1].push(id(x));
    else groups.push([id(x)]);
    last = k;
  }
  return groups;
}
