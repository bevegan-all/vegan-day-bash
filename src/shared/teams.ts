// Fixed teams. These match the rows seeded in migrations/0001_init.sql.
export interface Team {
  id: number;
  name: string;
  emoji: string;
  color: string;
}

export const TEAMS: Team[] = [
  { id: 1, name: "Cow", emoji: "🐄", color: "#2563eb" },
  { id: 2, name: "Chicken", emoji: "🐔", color: "#f59e0b" },
  { id: 3, name: "Goat", emoji: "🐐", color: "#16a34a" },
  { id: 4, name: "Pig", emoji: "🐖", color: "#ec4899" },
];

export const teamById = (id: number | null | undefined): Team | undefined => TEAMS.find((t) => t.id === id);
