import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, EllipsisVertical, Share, SquarePlus } from "lucide-react";
import { api } from "./api";
import { Btn, Modal, toastError } from "./ui";

// ---------------------------------------------------------------------------
// "Install the app". Browsers that can install (Android Chrome, desktop) hand us an
// install event once; we keep it and trigger it from our own button after sign-in.
// iPhones have no such event, so we show the Add to Home Screen steps instead.
// ---------------------------------------------------------------------------

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallEvent | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

// ?install=ios on any page previews the iPhone steps on another device
export const isIos = () =>
  new URLSearchParams(location.search).get("install") === "ios" ||
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const SNOOZE_KEY = "vdb-install-snooze";
const SNOOZE_MS = 12 * 3600 * 1000;
const snoozed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(SNOOZE_KEY) ?? 0) < SNOOZE_MS;
  } catch {
    return false;
  }
};
const snooze = () => {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
};

export function useInstall() {
  const canPrompt = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => deferred !== null,
  );
  return {
    canPrompt,
    ios: isIos(),
    standalone: isStandalone(),
    async install() {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      emit();
    },
  };
}

// ---------- sign-in code for the installed app ----------
function HandoffCode() {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function get() {
    setBusy(true);
    try {
      const r = await api<{ code: string }>("/auth/handoff", { body: {} });
      setCode(r.code);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-lg bg-sunken p-3">
      <p className="text-sm text-muted">
        The installed app may ask you to sign in again. On the sign-in page tap <b className="text-fg">Sign in with a code</b> and enter this one.
      </p>
      {code ? (
        <div className="mt-2 text-center">
          <div className="font-mono text-3xl font-semibold tracking-widest">{code}</div>
          <div className="text-xs text-subtle">Works once, for 15 minutes</div>
        </div>
      ) : (
        <Btn variant="secondary" size="sm" full className="mt-2" busy={busy} onClick={get}>
          Show my sign-in code
        </Btn>
      )}
    </div>
  );
}

function Step({ n, icon, children }: { n: number; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg">{n}</span>
      <span className="flex-1 text-sm">{children}</span>
      {icon && <span className="text-accent">{icon}</span>}
    </li>
  );
}

export function InstallBody({ onDone }: { onDone: () => void }) {
  const { canPrompt, ios, install } = useInstall();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" width={56} height={56} className="rounded-xl" />
        <p className="text-sm text-muted">Install Vegan Day Bash on your phone for one-tap access, a full-screen view and game alerts.</p>
      </div>

      {canPrompt ? (
        <Btn
          full
          size="lg"
          onClick={async () => {
            await install();
            onDone();
          }}
        >
          Install the app
        </Btn>
      ) : ios ? (
        <ol className="space-y-3">
          <Step n={1} icon={<Share size={20} />}>
            Tap the <b>Share</b> button in Safari's toolbar.
          </Step>
          <Step n={2} icon={<SquarePlus size={20} />}>
            Scroll down and tap <b>Add to Home Screen</b>.
          </Step>
          <Step n={3}>
            Tap <b>Add</b>, then open <b>Vegan Bash</b> from your home screen.
          </Step>
        </ol>
      ) : (
        <ol className="space-y-3">
          <Step n={1} icon={<EllipsisVertical size={20} />}>
            Open your browser's menu.
          </Step>
          <Step n={2}>
            Tap <b>Install app</b> or <b>Add to Home screen</b>.
          </Step>
        </ol>
      )}

      <HandoffCode />
    </div>
  );
}

// The sheet that appears after sign-in. Only for people who can actually install.
export function InstallPrompt() {
  const { canPrompt, ios, standalone } = useInstall();
  const [open, setOpen] = useState(false);
  const eligible = !standalone && (canPrompt || ios);

  useEffect(() => {
    if (!eligible || snoozed()) return;
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [eligible]);

  if (!open || !eligible) return null;
  const close = () => {
    snooze();
    setOpen(false);
  };
  return (
    <Modal title="Get the app" onClose={close}>
      <InstallBody onDone={() => setOpen(false)} />
      <Btn variant="ghost" full className="mt-3" onClick={close}>
        Not now
      </Btn>
    </Modal>
  );
}

// Always-available entry on the Profile page
export function InstallCard() {
  const { standalone } = useInstall();
  const [open, setOpen] = useState(false);
  if (standalone) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Check size={18} className="text-accent" strokeWidth={3} /> You are using the installed app.
      </p>
    );
  }
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Add Vegan Day Bash to your home screen.</p>
        <Btn size="sm" onClick={() => setOpen(true)}>
          Install
        </Btn>
      </div>
      {open && (
        <Modal title="Get the app" onClose={() => setOpen(false)}>
          <InstallBody onDone={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
