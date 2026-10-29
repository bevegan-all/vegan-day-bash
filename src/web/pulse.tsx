import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing } from "lucide-react";
import { api, usePoll, type AppNotification, type Pulse } from "./api";
import { useAuth } from "./auth";
import { Btn, IconBtn, Modal, Spinner, toast } from "./ui";

// ---------- phone alerts ----------
// Alerts appear on the phone while the app is open (even in the background).
// They can't reach a phone where the browser is fully closed: that needs a push service.

export type AlertState = "unsupported" | "default" | "granted" | "denied";

export const alertState = (): AlertState => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

export async function showSystemNotification(title: string, body: string, url = "/", tag?: string) {
  if (alertState() !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag, data: { url }, icon: "/favicon.svg" });
      return true;
    }
    new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}

export async function enableAlerts(): Promise<AlertState> {
  if (typeof Notification === "undefined") return "unsupported";
  const result = await Notification.requestPermission();
  if (result === "granted") await showSystemNotification("Alerts are on", "You will see game alerts here while the app is open.", "/", "alerts-on");
  return result;
}

// ---------- pulse (one light call polled for the whole app) ----------
interface PulseState {
  pulse: Pulse | null;
  reload: () => void;
  /** server clock minus this phone's clock, so countdowns match on every phone */
  offset: number;
}
const PulseCtx = createContext<PulseState>({ pulse: null, reload: () => {}, offset: 0 });
export const usePulse = () => useContext(PulseCtx);

function announce(n: AppNotification) {
  toast(`${n.title}. ${n.body}`);
  navigator.vibrate?.([140, 70, 140]);
  if (document.hidden) void showSystemNotification(n.title, n.body, n.gameId ? `/games/${n.gameId}` : "/", `n${n.id}`);
}

export function PulseProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  // Check more often while a Shark Tank turn is running, so phase changes arrive quickly
  const [every, setEvery] = useState(20000);
  const { data, reload } = usePoll<Pulse>(me ? "/pulse" : null, every);
  const seen = useRef<Set<number> | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!data) return;
    setOffset(data.serverNow - Date.now());
    setEvery(data.shark?.phase === "voting" || data.actout?.phase === "voting" ? 4000 : data.meme?.phase === "acting" || data.actout?.current?.phase === "acting" ? 5000 : data.shark || data.meme || data.actout ? 8000 : 20000);
  }, [data]);

  useEffect(() => {
    seen.current = null; // new person signed in (or out): start fresh
  }, [me?.id]);

  useEffect(() => {
    if (!data) return;
    if (seen.current === null) {
      // first load: only announce alerts that just happened, not old unread ones
      seen.current = new Set(data.notifications.map((n) => n.id));
      data.notifications.filter((n) => Date.now() - n.at < 90_000).forEach(announce);
      return;
    }
    for (const n of [...data.notifications].reverse()) {
      if (!seen.current.has(n.id)) {
        seen.current.add(n.id);
        announce(n);
      }
    }
  }, [data]);

  return <PulseCtx.Provider value={{ pulse: data, reload, offset }}>{children}</PulseCtx.Provider>;
}

// ---------- bell in the header ----------
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function AlertsToggle() {
  const [state, setState] = useState<AlertState>(alertState());
  if (state === "unsupported") return <p className="text-sm text-muted">This browser can't show phone alerts. You will still see alerts inside the app.</p>;
  if (state === "denied") return <p className="text-sm text-muted">Alerts are blocked. Allow notifications for this site in your browser settings to turn them on.</p>;
  if (state === "granted") {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Phone alerts are on while the app is open.</p>
        <Btn variant="secondary" size="sm" onClick={() => showSystemNotification("Test alert", "This is how game alerts will look.", "/", "test")}>
          Send test
        </Btn>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted">Get an alert on your phone when you are added to a game.</p>
      <Btn size="sm" onClick={async () => setState(await enableAlerts())}>
        Turn on
      </Btn>
    </div>
  );
}

export function NotificationBell() {
  const { pulse, reload } = usePulse();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const unread = pulse?.notifications.length ?? 0;

  async function show() {
    setOpen(true);
    setItems(null);
    try {
      const r = await api<{ notifications: AppNotification[] }>("/notifications");
      setItems(r.notifications);
      if (unread > 0) {
        await api("/notifications/read", { body: {} });
        reload();
      }
    } catch {
      setItems([]);
    }
  }

  return (
    <>
      <div className="relative">
        <IconBtn label={unread ? `${unread} new alerts` : "Alerts"} onClick={show}>
          {unread ? <BellRing size={20} className="text-accent" /> : <Bell size={20} />}
        </IconBtn>
        {unread > 0 && (
          <span className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-live px-1 text-[10px] font-bold text-white">{unread}</span>
        )}
      </div>
      {open && (
        <Modal title="Alerts" onClose={() => setOpen(false)}>
          {!items ? (
            <Spinner />
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nothing yet. You will see it here when you are added to a game.</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    className="flex w-full items-start gap-3 py-3 text-left"
                    onClick={() => {
                      setOpen(false);
                      if (n.gameId) nav(`/games/${n.gameId}`);
                    }}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2">
                        <span className="font-semibold">{n.title}</span>
                        <span className="shrink-0 text-xs text-subtle">{time(n.at)}</span>
                      </span>
                      <span className="block text-sm text-muted">{n.body}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 border-t border-line pt-4">
            <AlertsToggle />
          </div>
        </Modal>
      )}
    </>
  );
}
