import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { TEAMS } from "../../shared/teams";
import { api } from "../api";
import { useAuth } from "../auth";
import { Btn, Card, ErrorBox, Logo, Spinner, TeamChip, ThemeToggle, inputCls, toastError } from "../ui";

const teamIdByName = (name: string) => TEAMS.find((t) => t.name === name)?.id;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="absolute right-3 top-3">
        <ThemeToggle />
      </div>
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo size={48} />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Vegan Day Bash</h1>
        <p className="mt-1 text-sm text-muted">1 November 2026</p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

const TEST_LOGINS = [
  { label: "Test admin", username: "admin", password: "admin123" },
  { label: "Test user", username: "user", password: "user123" },
];

export function Login() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ needsSetup: false, testAccounts: false });

  useEffect(() => {
    api<typeof status>("/setup/status").then(setStatus).catch(() => {});
  }, []);

  if (me) return <Navigate to="/" replace />;

  async function signIn(u: string, p: string) {
    setBusy(true);
    try {
      await api("/auth/login", { body: { username: u, password: p } });
      await refresh();
      nav("/", { replace: true });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    signIn(username, password);
  }

  return (
    <Shell>
      <Card>
        <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
        <p className="mt-1 text-sm text-muted">
          Quickest: scan the QR code an organiser shows you, using your phone camera or Google Lens.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            className={inputCls}
            placeholder="Username"
            aria-label="Username"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="Password"
            aria-label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Btn full busy={busy} disabled={!username || !password}>
            Sign in
          </Btn>
        </form>
        {status.needsSetup && (
          <Btn variant="ghost" full className="mt-2" onClick={() => nav("/setup")}>
            First time? Set up the admin account
          </Btn>
        )}
      </Card>

      {status.testAccounts && (
        <div className="mt-4 rounded-xl border border-dashed border-line p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
            <FlaskConical size={14} /> Testing only
          </div>
          <div className="grid grid-cols-2 gap-2">
            {TEST_LOGINS.map((t) => (
              <Btn key={t.username} variant="secondary" size="sm" disabled={busy} onClick={() => signIn(t.username, t.password)}>
                {t.label}
              </Btn>
            ))}
          </div>
          <p className="mt-3 text-xs text-subtle">These accounts exist only while test mode is on. Turn it off before the real event.</p>
        </div>
      )}
    </Shell>
  );
}

export function Setup() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ code: "", name: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/setup", { body: f });
      await refresh();
      nav("/admin", { replace: true });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Shell>
      <Card>
        <h2 className="text-lg font-semibold tracking-tight">Create the admin account</h2>
        <p className="mt-1 text-sm text-muted">This works only once, while there is no admin yet. You need the setup code you saved as a secret.</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input className={inputCls} placeholder="Setup code" aria-label="Setup code" value={f.code} onChange={set("code")} autoCapitalize="none" />
          <input className={inputCls} placeholder="Your name" aria-label="Your name" value={f.name} onChange={set("name")} />
          <input className={inputCls} placeholder="Username" aria-label="Username" value={f.username} onChange={set("username")} autoCapitalize="none" />
          <input className={inputCls} placeholder="Password (8+ characters)" aria-label="Password" type="password" value={f.password} onChange={set("password")} />
          <Btn full busy={busy}>
            Create admin
          </Btn>
        </form>
      </Card>
    </Shell>
  );
}

// /s/:token is opened by scanning the sign-in QR. It shows who the link is for, and one tap signs in.
export function SignInLink() {
  const { token } = useParams();
  const { refresh, me } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState<{ name: string; team: { name: string; emoji: string; color: string } | null } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<typeof info>(`/auth/link/${token}`).then(setInfo).catch((e) => setError(e.message));
  }, [token]);

  async function go() {
    setBusy(true);
    try {
      await api("/auth/link", { body: { token } });
      await refresh();
      nav("/", { replace: true });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Card className="text-center">
        {error ? (
          <ErrorBox message={error} />
        ) : !info ? (
          <Spinner />
        ) : (
          <>
            <p className="text-sm text-muted">You are signing in as</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{info.name}</p>
            {info.team && (
              <div className="mt-3">
                <TeamChip teamId={teamIdByName(info.team.name)} />
              </div>
            )}
            <Btn full size="lg" className="mt-5" busy={busy} onClick={go}>
              Sign in
            </Btn>
            {me && <p className="mt-3 text-xs text-subtle">You are currently signed in as {me.name}. Continuing switches to this account.</p>}
            <p className="mt-3 text-xs text-subtle">Not you? Don't tap the button, and tell an organiser.</p>
          </>
        )}
      </Card>
    </Shell>
  );
}
