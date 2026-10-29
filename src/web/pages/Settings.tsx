import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { TEAMS } from "../../shared/teams";
import { api, usePoll } from "../api";
import { TeamIcon } from "../art";
import { Btn, Card, IconBtn, Page, SectionLabel, Segmented, Spinner, inputCls, toast, toastError } from "../ui";
import { QrImage } from "./Admin";

type Tab = "rules" | "ledger" | "staff" | "audit";

const POINT_FIELDS: [string, string][] = [
  ["pts_semi_win", "Knockout games (Meme Charades, Shark Tank): semi-final win"],
  ["pts_final_win", "Knockout games: final win, on top of the semi-final point"],
  ["pts_final_runner_up", "Knockout games: final runner-up"],
  ["participation_points", "Solo games: points for just playing"],
  ["shark_min_votes", "Shark Tank: minimum votes to close a pitch"],
  ["shark_prep_seconds", "Shark Tank: preparation time (seconds)"],
  ["shark_pitch_seconds", "Shark Tank: pitch time (seconds)"],
  ["shark_vote_seconds", "Shark Tank: voting time (seconds)"],
  ["meme_act_seconds", "Meme Charades: acting time per turn (seconds)"],
  ["meme_turns_per_team", "Meme Charades: turns per team in a match"],
  ["meme_count", "Meme Charades: how many memes you have (numbered 1 to this)"],
  ["actout_act_seconds", "Act It Out: time for each team (seconds)"],
  ["actout_vote_seconds", "Act It Out: voting time (seconds)"],
  ["actout_rounds", "Act It Out: number of rounds"],
];

export function Settings() {
  const [tab, setTab] = useState<Tab>("rules");
  return (
    <Page title="Settings" back="/admin">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "rules", label: "Rules" },
          { value: "ledger", label: "Points" },
          { value: "staff", label: "Staff" },
          { value: "audit", label: "Log" },
        ]}
      />
      {tab === "rules" && <Rules />}
      {tab === "ledger" && <Ledger />}
      {tab === "staff" && <Staff />}
      {tab === "audit" && <Audit />}
    </Page>
  );
}

const checkboxCls = "mt-1 h-5 w-5 accent-[var(--accent)]";

function Rules() {
  const { data, reload } = usePoll<{ settings: Record<string, string> }>("/admin/settings", 0);
  const [form, setForm] = useState<Record<string, string>>({});
  const [screenUrl, setScreenUrl] = useState("");
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);

  if (!data) return <Spinner />;
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  async function save() {
    const body: Record<string, string> = {};
    for (const k of [...POINT_FIELDS.map((f) => f[0]), "rank_points", "team_rank_points", "shark_block_opponent", "individual_to_team"]) body[k] = form[k];
    try {
      await api("/admin/settings", { method: "PUT", body });
      toast("Saved");
      reload();
    } catch (e) {
      toastError(e);
    }
  }

  const listText = (raw: string | undefined) => {
    try {
      return JSON.parse(raw ?? "[]").join(", ");
    } catch {
      return raw ?? "";
    }
  };
  const toList = (text: string) =>
    JSON.stringify(
      text
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => !Number.isNaN(n)),
    );
  const rankText = listText(form.rank_points);
  const teamRankText = listText(form.team_rank_points);

  return (
    <>
      <section>
        <SectionLabel>Points</SectionLabel>
        <Card className="space-y-3">
          {POINT_FIELDS.map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm">{label}</span>
              <input
                className="w-20 rounded-lg border border-line bg-surface px-3 py-2 text-right text-base font-semibold tabular-nums outline-none focus:border-accent"
                inputMode="decimal"
                value={form[k] ?? ""}
                onChange={(e) => set(k, e.target.value)}
              />
            </label>
          ))}
          <label className="block">
            <span className="text-sm">Team games: points for 1st, 2nd, 3rd and 4th place (Act It Out rounds, Green Light – Red Light)</span>
            <input className={inputCls + " mt-1.5"} value={teamRankText} onChange={(e) => set("team_rank_points", toList(e.target.value))} />
          </label>
          <label className="block">
            <span className="text-sm">Solo rank points (1st, 2nd, 3rd and so on, comma separated)</span>
            <input
              className={inputCls + " mt-1.5"}
              value={rankText}
              onChange={(e) =>
                set(
                  "rank_points",
                  JSON.stringify(
                    e.target.value
                      .split(",")
                      .map((x) => Number(x.trim()))
                      .filter((n) => !Number.isNaN(n)),
                  ),
                )
              }
            />
          </label>
        </Card>
      </section>

      <section>
        <SectionLabel>Switches</SectionLabel>
        <Card className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" className={checkboxCls} checked={form.shark_block_opponent === "1"} onChange={(e) => set("shark_block_opponent", e.target.checked ? "1" : "0")} />
            <span className="text-sm">
              <b>Shark Tank:</b> also stop the opposing team in that match from rating. Off by default, so only the pitching team is blocked.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" className={checkboxCls} checked={form.individual_to_team === "1"} onChange={(e) => set("individual_to_team", e.target.checked ? "1" : "0")} />
            <span className="text-sm">
              <b>Solo points count for teams:</b> add each member's solo points to their team total. Off by default.
            </span>
          </label>
        </Card>
      </section>

      <Btn full size="lg" onClick={save}>
        Save settings
      </Btn>

      <section>
        <SectionLabel>Big screen</SectionLabel>
        <Card className="space-y-3">
          <p className="text-sm text-muted">Open this link on the projector or TV. Keep it private: anyone with it can see the live boards.</p>
          {screenUrl ? (
            <>
              <p className="break-all rounded-lg bg-sunken p-3 font-mono text-xs">{screenUrl}</p>
              <QrImage text={screenUrl} size={180} />
            </>
          ) : (
            <Btn
              variant="secondary"
              full
              onClick={async () => {
                try {
                  const r = await api<{ url: string }>("/admin/screen-key");
                  setScreenUrl(r.url);
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Show big-screen link
            </Btn>
          )}
        </Card>
      </section>
    </>
  );
}

function Ledger() {
  const { data, reload } = usePoll<{ entries: { id: number; teamId: number; points: number; reason: string; at: number; voidedAt: number | null; game: string | null }[] }>("/admin/team-points", 0);
  const [team, setTeam] = useState(1);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");

  async function add() {
    try {
      await api("/admin/team-points", { body: { teamId: team, points: Number(points), reason } });
      setPoints("");
      setReason("");
      reload();
      toast("Points added");
    } catch (e) {
      toastError(e);
    }
  }
  async function voidIt(id: number) {
    if (!confirm("Cancel these points?")) return;
    try {
      await api(`/admin/team-points/${id}`, { method: "DELETE", body: {} });
      reload();
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <>
      <section>
        <SectionLabel>Give or take points</SectionLabel>
        <Card className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {TEAMS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTeam(t.id)}
                aria-label={t.name}
                aria-pressed={team === t.id}
                className={`flex justify-center rounded-lg border py-2.5 transition ${team === t.id ? "" : "border-line bg-surface hover:bg-sunken"}`}
                style={team === t.id ? { borderColor: t.color, background: t.color + "22", boxShadow: `inset 0 0 0 1px ${t.color}` } : undefined}
              >
                <TeamIcon teamId={t.id} size={34} />
              </button>
            ))}
          </div>
          <input className={inputCls} inputMode="decimal" placeholder="Points (use a minus sign to deduct)" aria-label="Points" value={points} onChange={(e) => setPoints(e.target.value)} />
          <input className={inputCls} placeholder="Reason" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Btn full disabled={!points || !reason.trim() || Number.isNaN(Number(points))} onClick={add}>
            Add
          </Btn>
        </Card>
      </section>
      <section>
        <SectionLabel>Recent team points</SectionLabel>
        <Card>
          {!data ? (
            <Spinner />
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.entries.map((e) => (
                <li key={e.id} className={`flex items-center gap-3 py-2.5 ${e.voidedAt ? "opacity-40 line-through" : ""}`}>
                  <TeamIcon teamId={e.teamId} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.reason}</span>
                    <span className="text-xs text-subtle">{e.game ?? "Manual"}</span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {e.points > 0 ? "+" : ""}
                    {e.points}
                  </span>
                  {!e.voidedAt && (
                    <IconBtn label="Cancel these points" onClick={() => voidIt(e.id)} className="!h-8 !w-8 text-danger">
                      <X size={18} />
                    </IconBtn>
                  )}
                </li>
              ))}
              {data.entries.length === 0 && <li className="py-4 text-center text-muted">No points yet.</li>}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}

function Staff() {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"organiser" | "admin">("organiser");
  const [made, setMade] = useState<{ name: string; username: string; password: string; link: string } | null>(null);

  async function create() {
    try {
      setMade(await api("/admin/users", { body: { name, role } }));
      setName("");
    } catch (e) {
      toastError(e);
    }
  }
  return (
    <>
      <section>
        <SectionLabel>Add an organiser</SectionLabel>
        <Card className="space-y-3">
          <p className="text-sm text-muted">Organisers also join a team like everyone else. They can run games and score. Admins can also change settings.</p>
          <input className={inputCls} placeholder="Full name" aria-label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as "organiser" | "admin")} aria-label="Role">
            <option value="organiser">Organiser</option>
            <option value="admin">Admin</option>
          </select>
          <Btn full disabled={!name.trim()} onClick={create}>
            Create and show QR
          </Btn>
        </Card>
      </section>
      {made && (
        <Card className="space-y-3 text-center">
          <p className="font-semibold">{made.name} can scan this to sign in</p>
          <QrImage text={made.link} size={220} />
          <p className="font-mono text-sm text-muted">
            {made.username} / {made.password}
          </p>
        </Card>
      )}
    </>
  );
}

function Audit() {
  const { data } = usePoll<{ entries: { id: number; action: string; detail: string | null; at: number; by: string | null }[] }>("/admin/audit", 0);
  if (!data) return <Spinner />;
  return (
    <Card className="!p-0">
      <ul className="divide-y divide-line text-sm">
        {data.entries.map((e) => (
          <li key={e.id} className="px-4 py-2.5">
            <div className="flex justify-between">
              <span className="font-semibold">{e.action}</span>
              <span className="text-xs text-subtle">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="truncate text-xs text-muted">
              {e.by ?? "system"} {e.detail ? `· ${e.detail}` : ""}
            </div>
          </li>
        ))}
        {data.entries.length === 0 && <li className="p-4 text-center text-muted">Nothing logged yet.</li>}
      </ul>
    </Card>
  );
}
