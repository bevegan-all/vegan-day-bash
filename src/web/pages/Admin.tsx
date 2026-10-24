import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { Check, ChevronRight, ScanLine, Search, Settings as SettingsIcon, UserPlus, Users } from "lucide-react";
import { TEAMS, teamById } from "../../shared/teams";
import { api, usePoll, type GameSummary } from "../api";
import { useAuth } from "../auth";
import { TeamIcon } from "../art";
import { GameThumb } from "../components";
import { PersonSearch, QrScan, type Person } from "../pickers";
import { Avatar, Btn, Card, Modal, Page, SectionLabel, Segmented, Spinner, StatusPill, TeamChip, TeamMark, inputCls, toast, toastError } from "../ui";

// ---------- Hub ----------
export function AdminHub() {
  const { me } = useAuth();
  const people = usePoll<{ users: Person[]; stats: { teamId: number; members: number; checkedIn: number }[] }>("/admin/users", 30000);
  const games = usePoll<{ games: GameSummary[] }>("/games", 30000);
  const total = people.data?.stats.reduce((a, s) => a + s.members, 0) ?? 0;

  async function setStatus(id: number, status: string) {
    try {
      await api(`/admin/games/${id}`, { method: "PATCH", body: { status } });
      games.reload();
    } catch (e) {
      toastError(e);
    }
  }

  const tiles = [
    { to: "/admin/register", Icon: UserPlus, label: "Register", sub: "Add a person" },
    { to: "/admin/scan", Icon: ScanLine, label: "Scan", sub: "Identify someone" },
    { to: "/admin/people", Icon: Users, label: "People", sub: `${total} registered` },
    ...(me?.role === "admin" ? [{ to: "/admin/settings", Icon: SettingsIcon, label: "Settings", sub: "Points and staff" }] : []),
  ];

  return (
    <Page title="Organiser tools">
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(({ to, Icon, label, sub }) => (
          <Link key={to} to={to} className="rounded-xl border border-line bg-surface p-4 transition hover:bg-sunken active:bg-sunken">
            <Icon size={22} className="text-accent" />
            <div className="mt-3 font-semibold">{label}</div>
            <div className="text-sm text-muted">{sub}</div>
          </Link>
        ))}
      </div>

      {people.data && (
        <section>
          <SectionLabel>Team sizes</SectionLabel>
          <Card className="grid grid-cols-4 divide-x divide-line !p-0 text-center">
            {TEAMS.map((t) => {
              const s = people.data!.stats.find((x) => x.teamId === t.id);
              return (
                <div key={t.id} className="flex flex-col items-center px-1 py-3">
                  <TeamIcon teamId={t.id} size={30} />
                  <div className="mt-1.5 text-xl font-semibold tabular-nums">{s?.members ?? 0}</div>
                  <div className="text-[11px] text-subtle">{s?.checkedIn ?? 0} in</div>
                </div>
              );
            })}
          </Card>
        </section>
      )}

      <section>
        <SectionLabel>Run a game</SectionLabel>
        {!games.data && <Spinner />}
        <Card className="divide-y divide-line !p-0">
          {games.data?.games.map((g) => (
            <div key={g.id} className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <GameThumb slug={g.slug} name={g.name} className="aspect-[16/10] w-14 shrink-0" />
                <Link to={`/admin/games/${g.id}`} className="flex min-w-0 flex-1 items-center gap-1 font-semibold">
                  <span className="truncate">{g.name}</span>
                  <ChevronRight size={16} className="shrink-0 text-subtle" />
                </Link>
                <StatusPill status={g.status} />
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                {(["upcoming", "live", "closed"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(g.id, s)}
                    className={`rounded-md py-1.5 text-xs font-semibold capitalize transition ${g.status === s ? "bg-accent text-accent-fg" : "bg-sunken text-muted hover:text-fg"}`}
                  >
                    {s === "closed" ? "Finished" : s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
      </section>
    </Page>
  );
}

// ---------- Register ----------
interface Created {
  id: number;
  name: string;
  username: string;
  password: string;
  team: { id: number; name: string; emoji: string; color: string };
  link: string;
}

// QR codes are always dark on white, even in dark mode, so every phone camera can read them
export function QrImage({ text, size = 280 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } }).then(setSrc);
  }, [text, size]);
  return (
    <div className="mx-auto w-fit rounded-xl bg-white p-3 ring-1 ring-line">
      {src ? <img src={src} alt="QR code" width={size} height={size} /> : <div style={{ width: size, height: size }} />}
    </div>
  );
}

function SignInCard({ created, onNext, onSameGroup, inGroup }: { created: Created; onNext: () => void; onSameGroup: () => void; inGroup: boolean }) {
  const [link, setLink] = useState(created.link);
  const [used, setUsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [showCreds, setShowCreds] = useState(false);
  const timer = useRef<number>(undefined);

  useEffect(() => {
    if (used) return;
    const poll = window.setInterval(async () => {
      try {
        const r = await api<{ used: boolean }>(`/admin/users/${created.id}/linkstatus`);
        if (r.used) setUsed(true);
      } catch {
        /* ignore, try again */
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [created.id, used, link]);

  useEffect(() => {
    clearTimeout(timer.current);
    setHidden(false);
    timer.current = window.setTimeout(() => setHidden(true), 60000);
    return () => clearTimeout(timer.current);
  }, [link]);

  async function regenerate() {
    try {
      const r = await api<{ link: string }>(`/admin/users/${created.id}/link`, { method: "POST", body: {} });
      setLink(r.link);
      setUsed(false);
    } catch (e) {
      toastError(e);
    }
  }

  const t = created.team;
  return (
    <div className="space-y-4">
      <div className="rounded-xl p-5 text-center text-white" style={{ background: t.color }}>
        <div className="text-xs font-semibold uppercase tracking-wider text-white/80">Give this sticker</div>
        <div className="my-3 flex justify-center">
          <TeamIcon teamId={t.id} size={104} sticker />
        </div>
        <div className="text-3xl font-semibold uppercase tracking-wide">{t.name}</div>
        <div className="mt-1 text-sm text-white/85">for {created.name}</div>
      </div>

      <Card className="text-center">
        {used ? (
          <div className="py-8">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg">
              <Check size={30} strokeWidth={2.5} />
            </span>
            <div className="mt-3 text-xl font-semibold">Signed in</div>
            <p className="text-sm text-muted">{created.name} is ready to play.</p>
          </div>
        ) : hidden ? (
          <div className="py-8">
            <p className="mb-3 text-sm text-muted">QR hidden for safety.</p>
            <Btn onClick={regenerate}>Show a new QR</Btn>
          </div>
        ) : (
          <>
            <p className="mb-3 font-semibold">Ask them to scan this with their camera or Google Lens</p>
            <QrImage text={link} />
            <p className="mt-3 text-xs text-subtle">Hides after 60 seconds. Waiting for them to sign in…</p>
          </>
        )}
        <button className="mt-4 text-sm font-semibold text-accent" onClick={() => setShowCreds(!showCreds)}>
          {showCreds ? "Hide login details" : "Camera not working? Show username and password"}
        </button>
        {showCreds && (
          <div className="mt-2 rounded-lg bg-sunken p-3 font-mono text-lg">
            <div>{created.username}</div>
            <div className="font-semibold">{created.password}</div>
          </div>
        )}
      </Card>

      <div className="grid gap-2">
        <Btn size="lg" onClick={onNext}>
          Next person
        </Btn>
        {inGroup && (
          <Btn variant="secondary" onClick={onSameGroup}>
            Same group, next person (different team)
          </Btn>
        )}
      </div>
    </div>
  );
}

export function Register() {
  const [name, setName] = useState("");
  const [withGroup, setWithGroup] = useState(false);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let party = partyId;
      if (withGroup && !party) {
        party = crypto.randomUUID();
        setPartyId(party);
      }
      const r = await api<Created>("/admin/users", { body: { name, partyId: withGroup ? party : null } });
      setCreated(r);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  function next(keepGroup: boolean) {
    setCreated(null);
    setName("");
    if (!keepGroup) {
      setPartyId(null);
      setWithGroup(false);
    }
  }

  return (
    <Page title="Register a person" back="/admin">
      {created ? (
        <SignInCard created={created} onNext={() => next(false)} onSameGroup={() => next(true)} inGroup={withGroup} />
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-muted">
                Full name
              </label>
              <input id="name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riya Sharma" autoFocus autoComplete="off" />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-sunken p-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--accent)]" checked={withGroup} onChange={(e) => setWithGroup(e.target.checked)} />
              <span>
                <span className="font-semibold">Arrived with friends</span>
                <span className="block text-sm text-muted">Tick this for everyone in the group so they land on different teams.</span>
              </span>
            </label>
            <Btn full size="lg" busy={busy} disabled={!name.trim()}>
              Register and show QR
            </Btn>
          </form>
        </Card>
      )}
    </Page>
  );
}

// ---------- People ----------
export function People() {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState(0);
  const [users, setUsers] = useState<Person[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ users: Person[] }>(`/admin/users?q=${encodeURIComponent(q)}&team=${team}`)
        .then((r) => setUsers(r.users))
        .catch(toastError);
    }, 200);
    return () => clearTimeout(t);
  }, [q, team]);

  return (
    <Page title="People" back="/admin">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input className={inputCls + " pl-10"} placeholder="Search name or username" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ id: 0, name: "All" }, ...TEAMS].map((t) => (
          <button
            key={t.id}
            onClick={() => setTeam(t.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border py-1.5 text-sm font-semibold transition ${t.id ? "pl-1.5 pr-3.5" : "px-4"} ${team === t.id ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:text-fg"}`}
          >
            {t.id > 0 && <TeamIcon teamId={t.id} size={20} />}
            {t.name}
          </button>
        ))}
      </div>
      {!users ? (
        <Spinner />
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-line">
            {users.map((p) => (
              <li key={p.id}>
                <Link to={`/admin/people/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition active:bg-sunken">
                  <Avatar name={p.name} teamId={p.teamId} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{p.name}</span>
                      {p.checkedIn ? <Check size={15} className="shrink-0 text-accent" strokeWidth={3} /> : null}
                      {p.role !== "participant" && <span className="rounded bg-warn-soft px-1.5 text-[11px] font-semibold uppercase text-warn">{p.role}</span>}
                    </span>
                    <span className="block truncate text-sm text-subtle">@{p.username}</span>
                  </span>
                  <TeamChip teamId={p.teamId} small />
                </Link>
              </li>
            ))}
            {users.length === 0 && <li className="p-6 text-center text-sm text-muted">No one found.</li>}
          </ul>
        </Card>
      )}
    </Page>
  );
}

interface PersonCard {
  id: number;
  name: string;
  username: string;
  role: string;
  teamId: number | null;
  checkedIn: number;
  history: { name: string; value: number; at: number }[];
}

export function PersonDetail() {
  const { id } = useParams();
  const { data, reload } = usePoll<PersonCard>(`/admin/users/${id}`, 0);
  const [qrLink, setQrLink] = useState<string | null>(null);
  const [newPw, setNewPw] = useState<string | null>(null);

  async function patch(body: object) {
    try {
      await api(`/admin/users/${id}`, { method: "PATCH", body });
      reload();
    } catch (e) {
      toastError(e);
    }
  }

  if (!data) {
    return (
      <Page title="Person" back="/admin/people">
        <Spinner />
      </Page>
    );
  }
  return (
    <Page title={data.name} back="/admin/people">
      <Card className="flex items-center gap-4">
        <Avatar name={data.name} teamId={data.teamId} size={52} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm text-subtle">@{data.username}</div>
          <div className="mt-1">
            <TeamChip teamId={data.teamId} />
          </div>
        </div>
        <Btn variant={data.checkedIn ? "secondary" : "primary"} size="sm" onClick={() => patch({ checkedIn: !data.checkedIn })}>
          {data.checkedIn ? (
            <>
              <Check size={16} strokeWidth={3} /> In
            </>
          ) : (
            "Check in"
          )}
        </Btn>
      </Card>

      <section>
        <SectionLabel>Change team</SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {TEAMS.map((t) => (
            <button
              key={t.id}
              onClick={() => data.teamId !== t.id && confirm(`Move ${data.name} to Team ${t.name}?`) && patch({ teamId: t.id })}
              className={`rounded-xl border py-3 text-center transition ${data.teamId === t.id ? "text-fg" : "border-line bg-surface hover:bg-sunken"}`}
              style={data.teamId === t.id ? { borderColor: t.color, background: t.color + "22", boxShadow: `inset 0 0 0 1px ${t.color}` } : undefined}
            >
              <div className="flex justify-center">
                <TeamIcon teamId={t.id} size={36} />
              </div>
              <div className="mt-1.5 text-xs font-semibold">{t.name}</div>
            </button>
          ))}
        </div>
      </section>

      <div className="space-y-2">
        <Btn
          full
          variant="secondary"
          onClick={async () => {
            try {
              const r = await api<{ link: string }>(`/admin/users/${id}/link`, { method: "POST", body: {} });
              setQrLink(r.link);
            } catch (e) {
              toastError(e);
            }
          }}
        >
          Show a new sign-in QR
        </Btn>
        <Btn
          full
          variant="secondary"
          onClick={async () => {
            if (!confirm("Reset their password? Their old password stops working.")) return;
            try {
              const r = await api<{ password: string }>(`/admin/users/${id}/password`, { method: "POST", body: {} });
              setNewPw(r.password);
            } catch (e) {
              toastError(e);
            }
          }}
        >
          Reset password
        </Btn>
      </div>

      <section>
        <SectionLabel>Recent results</SectionLabel>
        <Card>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.history.map((h, i) => (
                <li key={i} className="flex justify-between py-2">
                  <span>{h.name}</span>
                  <span className="font-semibold tabular-nums">{h.value}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {qrLink && (
        <Modal title="Sign-in QR" onClose={() => setQrLink(null)}>
          <p className="mb-3 text-center text-sm text-muted">The old QR no longer works. Ask {data.name} to scan this.</p>
          <QrImage text={qrLink} />
        </Modal>
      )}
      {newPw && (
        <Modal title="New password" onClose={() => setNewPw(null)}>
          <p className="rounded-lg bg-sunken p-4 text-center font-mono text-2xl font-semibold">{newPw}</p>
          <p className="mt-2 text-center text-sm text-muted">Username: {data.username}</p>
        </Modal>
      )}
    </Page>
  );
}

// ---------- Scan ----------
export function ScanPage() {
  const nav = useNavigate();
  const [card, setCard] = useState<PersonCard | null>(null);
  const [mode, setMode] = useState<"scan" | "search">("scan");

  async function lookup(code: string) {
    try {
      const p = await api<PersonCard>(`/admin/lookup?code=${encodeURIComponent(code)}`);
      navigator.vibrate?.(60);
      setCard(p);
    } catch (e) {
      toastError(e);
    }
  }

  async function show(p: Person) {
    setCard(await api<PersonCard>(`/admin/users/${p.id}`));
  }

  async function checkIn() {
    if (!card) return;
    await api(`/admin/users/${card.id}`, { method: "PATCH", body: { checkedIn: true } });
    setCard({ ...card, checkedIn: 1 });
    toast("Checked in");
  }

  return (
    <Page title="Scan a person" back="/admin">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "scan", label: <><ScanLine size={16} /> Scan</> },
          { value: "search", label: <><Search size={16} /> Search</> },
        ]}
      />
      {!card && (mode === "scan" ? <QrScan onCode={lookup} /> : <PersonSearch onPick={show} />)}
      {card && (
        <Card className="rise text-center">
          <div className="flex justify-center">
            <TeamMark teamId={card.teamId} size={72} />
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-tight">{card.name}</div>
          <div className="mt-2">
            <TeamChip teamId={card.teamId} />
          </div>
          <p className="mt-1 text-sm text-subtle">@{card.username}</p>
          <p className="sr-only">{teamById(card.teamId)?.name}</p>
          <div className="mt-5 grid gap-2">
            {!card.checkedIn ? (
              <Btn size="lg" onClick={checkIn}>
                Check in
              </Btn>
            ) : (
              <p className="inline-flex items-center justify-center gap-1.5 font-semibold text-accent">
                <Check size={18} strokeWidth={3} /> Already checked in
              </p>
            )}
            <Btn variant="secondary" onClick={() => nav(`/admin/people/${card.id}`)}>
              Open profile
            </Btn>
            <Btn variant="ghost" onClick={() => setCard(null)}>
              Scan another
            </Btn>
          </div>
        </Card>
      )}
    </Page>
  );
}
