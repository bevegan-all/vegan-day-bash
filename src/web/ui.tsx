import { createContext, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ChevronLeft, CircleUser, Gamepad2, House, Monitor, Moon, SlidersHorizontal, Sun, Trophy, X } from "lucide-react";
import { teamById } from "../shared/teams";
import { TeamIcon } from "./art";
import { isOrganiser, useAuth } from "./auth";
import { useTheme } from "./theme";

// ---------- toast ----------
type ToastMsg = { id: number; text: string; kind: "ok" | "error" };
let toastId = 0;
const listeners = new Set<(t: ToastMsg) => void>();
export const toast = (text: string, kind: "ok" | "error" = "ok") => {
  const t = { id: ++toastId, text, kind };
  listeners.forEach((l) => l(t));
};
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : "Something went wrong", "error");

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const l = (t: ToastMsg) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 3500);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={`rise pointer-events-auto max-w-sm rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg ${
            t.kind === "error" ? "border-danger/40 bg-danger-soft text-danger" : "border-line bg-fg text-bg"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------- primitives ----------
export const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-base text-fg placeholder:text-subtle outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{children}</h2>
      {right}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "sm" | "lg";
  busy?: boolean;
  full?: boolean;
};

export function Btn({ variant = "primary", size = "md", busy, full, className = "", children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-accent text-accent-fg hover:brightness-110 active:brightness-95 disabled:opacity-40",
    secondary: "border border-line bg-surface text-fg hover:bg-sunken active:bg-sunken disabled:opacity-40",
    danger: "bg-danger text-white hover:brightness-110 active:brightness-95 disabled:opacity-40",
    ghost: "text-accent hover:bg-accent-soft active:bg-accent-soft disabled:opacity-40",
  }[variant];
  const s = { sm: "min-h-9 px-3 text-sm", md: "min-h-11 px-4 text-[15px]", lg: "min-h-13 px-5 text-base" }[size];
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition select-none ${v} ${s} ${full ? "w-full" : ""} ${className}`}
    >
      {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : children}
    </button>
  );
}

export function IconBtn({ label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-sunken hover:text-fg active:bg-sunken ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="grid rounded-lg bg-sunken p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-semibold transition ${
            value === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TeamChip({ teamId, small }: { teamId: number | null | undefined; small?: boolean }) {
  const t = teamById(teamId);
  if (!t) return <span className="text-sm text-subtle">No team</span>;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium text-fg ${small ? "py-0.5 pl-0.5 pr-2 text-xs" : "py-1 pl-1 pr-3 text-sm"}`}
      style={{ borderColor: t.color + "66", background: t.color + "1a" }}
    >
      <TeamIcon teamId={teamId} size={small ? 18 : 22} />
      {t.name}
    </span>
  );
}

export function TeamMark({ teamId, size = 48, sticker }: { teamId: number | null | undefined; size?: number; sticker?: boolean }) {
  return <TeamIcon teamId={teamId} size={size} sticker={sticker} />;
}

// Team icon followed by the team name, for lists and headings
export function TeamName({ teamId, size = 22, className = "" }: { teamId: number | null | undefined; size?: number; className?: string }) {
  const t = teamById(teamId);
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <TeamIcon teamId={teamId} size={size} />
      <span>{t?.name ?? "To be decided"}</span>
    </span>
  );
}

export function Avatar({ name, teamId, size = 44 }: { name: string; teamId?: number | null; size?: number }) {
  const t = teamById(teamId);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: t?.color ?? "#6b7280", fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

// plain: show a neutral badge, for boards where nobody has scored yet
export function RankBadge({ rank, plain }: { rank: number; plain?: boolean }) {
  const tone = plain ? null : rank === 1 ? "#d4a72c" : rank === 2 ? "#a9afb6" : rank === 3 ? "#c4875a" : null;
  return (
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${tone ? "text-[#1c1505]" : "bg-sunken text-muted"}`}
      style={tone ? { background: tone } : undefined}
    >
      {rank}
    </span>
  );
}

// onArt: a version that stays readable on top of the colourful game artwork
export function StatusPill({ status, onArt }: { status: string; onArt?: boolean }) {
  if (status === "live") {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${onArt ? "bg-live text-white" : "bg-danger-soft text-live"}`}>
        <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${onArt ? "bg-white" : "bg-live"}`} />
        Live
      </span>
    );
  }
  const map: Record<string, string> = onArt
    ? {
        upcoming: "bg-black/55 text-white backdrop-blur-sm",
        closed: "bg-black/55 text-white/70 backdrop-blur-sm",
        draft: "bg-black/55 text-white/70 backdrop-blur-sm",
      }
    : {
        upcoming: "bg-warn-soft text-warn",
        closed: "bg-sunken text-subtle",
        draft: "border border-dashed border-line text-subtle",
      };
  const label = status === "upcoming" ? "Upcoming" : status === "closed" ? "Finished" : "Draft";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${map[status] ?? ""}`}>{label}</span>;
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12" role="status" aria-label="Loading">
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-line border-t-accent" />
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="text-center">
      <p className="text-danger">{message}</p>
      {onRetry && (
        <Btn variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Btn>
      )}
    </Card>
  );
}

// Drawn on the page body, not inside whatever opened it: a blurred header would otherwise trap it
export function Modal({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="rise safe-bottom max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <IconBtn label="Close" onClick={onClose} className="-mr-2">
            <X size={20} />
          </IconBtn>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ThemeToggle() {
  const { dark, set } = useTheme();
  return (
    <IconBtn label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => set(dark ? "light" : "dark")}>
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </IconBtn>
  );
}

export function ThemeSelect() {
  const { pref, set } = useTheme();
  return (
    <Segmented
      value={pref}
      onChange={set}
      options={[
        { value: "system", label: <><Monitor size={15} /> Auto</> },
        { value: "light", label: <><Sun size={15} /> Light</> },
        { value: "dark", label: <><Moon size={15} /> Dark</> },
      ]}
    />
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M16 25V14M16 14c0-4 3-7 8-7 0 4-3 7-8 7ZM16 18c0-3-2-5-6-5 0 3 2 5 6 5Z"
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------- layout ----------
// The signed-in layout puts the alerts bell here, so every page header gets it
export const HeaderSlot = createContext<ReactNode>(null);

export function Page({ title, back, right, children }: { title: string; back?: string; right?: ReactNode; children: ReactNode }) {
  const nav = useNavigate();
  const slot = useContext(HeaderSlot);
  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg pb-28">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="flex h-14 items-center gap-1 px-3">
          {back && (
            <IconBtn label="Back" onClick={() => nav(back)} className="-ml-1">
              <ChevronLeft size={22} />
            </IconBtn>
          )}
          <h1 className={`min-w-0 flex-1 truncate text-lg font-semibold tracking-tight ${back ? "" : "pl-1"}`}>{title}</h1>
          {right}
          {slot}
          <ThemeToggle />
        </div>
      </header>
      <div className="space-y-5 px-4 pt-5">{children}</div>
    </div>
  );
}

export function BottomNav() {
  const { me } = useAuth();
  const items = [
    { to: "/", label: "Home", Icon: House, end: true },
    { to: "/games", label: "Games", Icon: Gamepad2 },
    { to: "/board", label: "Boards", Icon: Trophy },
    { to: "/me", label: "Profile", Icon: CircleUser },
    ...(isOrganiser(me) ? [{ to: "/admin", label: "Organise", Icon: SlidersHorizontal }] : []),
  ];
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur" aria-label="Main">
      <div className="mx-auto flex max-w-lg">
        {items.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `relative flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] font-semibold transition ${isActive ? "text-accent" : "text-subtle hover:text-fg"}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-accent" />}
                <Icon size={22} strokeWidth={isActive ? 2.25 : 1.75} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-sm font-semibold text-accent">
      {children}
    </Link>
  );
}

export function Countdown({ presets }: { presets: { label: string; seconds: number }[] }) {
  const [left, setLeft] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (left == null || left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const mm = left == null ? "" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <div className="rounded-xl bg-fg p-4 text-center text-bg">
      <div className="text-xs font-semibold uppercase tracking-wider opacity-60">{label || "Timer"}</div>
      <div className={`my-1 text-5xl font-semibold tabular-nums tracking-tight ${left === 0 ? "animate-pulse" : ""}`}>
        {left == null ? "–:––" : left === 0 ? "Time" : mm}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            className="rounded-lg bg-bg/15 px-3 py-2 text-sm font-semibold transition hover:bg-bg/25 active:bg-bg/30"
            onClick={() => (setLabel(p.label), setLeft(p.seconds))}
          >
            {p.label}
          </button>
        ))}
        {left != null && (
          <button className="rounded-lg px-3 py-2 text-sm font-semibold opacity-70 hover:opacity-100" onClick={() => setLeft(null)}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
