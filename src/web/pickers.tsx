import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { ScanLine, Search } from "lucide-react";
import { api } from "./api";
import { Btn, Card, Modal, Segmented, TeamChip, inputCls, toast, toastError } from "./ui";

export interface Person {
  id: number;
  name: string;
  username?: string;
  teamId: number | null;
  checkedIn?: number;
  role?: string;
}

export function QrScan({ onCode }: { onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const last = useRef({ code: "", at: 0 });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(
      video,
      (res) => {
        const t = Date.now();
        if (res.data === last.current.code && t - last.current.at < 3000) return;
        last.current = { code: res.data, at: t };
        onCode(res.data);
      },
      { preferredCamera: "environment", highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8, returnDetailedScanResult: true },
    );
    scanner
      .start()
      .catch((e) =>
        setError(
          String(e?.message ?? e).includes("Permission")
            ? "Camera permission was denied. Allow camera access in your browser settings, or search by name instead."
            : "Could not start the camera. Search by name instead.",
        ),
      );
    return () => {
      scanner.stop();
      scanner.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
      </div>
      {error && <p className="mt-2 text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}

export function PersonSearch({ onPick }: { onPick: (p: Person) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Person[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ users: Person[] }>(`/admin/users?q=${encodeURIComponent(q)}`)
        .then((r) => setList(r.users.slice(0, 30)))
        .catch(toastError);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <input className={inputCls} placeholder="Search name or username" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="mt-2 divide-y divide-line">
        {list.map((p) => (
          <li key={p.id}>
            <button className="flex w-full items-center justify-between gap-2 py-3 text-left transition active:bg-sunken" onClick={() => onPick(p)}>
              <span className="min-w-0 flex-1 truncate font-medium">
                {p.name} <span className="font-normal text-subtle">@{p.username}</span>
              </span>
              <TeamChip teamId={p.teamId} small />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="py-6 text-center text-sm text-muted">No one found.</li>}
      </ul>
    </div>
  );
}

// Pick a person by scanning their QR or searching by name
export function PersonPickerModal({
  onPick,
  onClose,
  title = "Pick a person",
  multi = false,
}: {
  onPick: (p: Person) => void;
  onClose: () => void;
  title?: string;
  multi?: boolean; // keep the scanner open so several people can be added in a row
}) {
  const [mode, setMode] = useState<"scan" | "search">("scan");
  const [busy, setBusy] = useState(false);

  async function handleCode(code: string) {
    if (busy) return;
    setBusy(true);
    try {
      const p = await api<{ id: number; name: string; teamId: number | null; username: string }>(`/admin/lookup?code=${encodeURIComponent(code)}`);
      navigator.vibrate?.(60);
      onPick({ id: p.id, name: p.name, teamId: p.teamId, username: p.username });
      if (multi) toast(`Added ${p.name}`);
      else onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="mb-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "scan", label: <><ScanLine size={16} /> Scan QR</> },
            { value: "search", label: <><Search size={16} /> Search</> },
          ]}
        />
      </div>
      {mode === "scan" ? (
        <QrScan onCode={handleCode} />
      ) : (
        <PersonSearch
          onPick={(p) => {
            onPick(p);
            if (multi) toast(`Added ${p.name}`);
            else onClose();
          }}
        />
      )}
      {multi && (
        <Btn full className="mt-3" onClick={onClose}>
          Done
        </Btn>
      )}
    </Modal>
  );
}

// A button that opens the picker, and shows the chosen person
export function PersonField({ label, value, onChange }: { label: string; value: Person | null; onChange: (p: Person | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-muted">{label}</div>
      {value ? (
        <Card className="flex items-center justify-between gap-2 !p-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold">{value.name}</span>
            <TeamChip teamId={value.teamId} small />
          </div>
          <Btn variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Change
          </Btn>
        </Card>
      ) : (
        <Btn variant="secondary" full onClick={() => setOpen(true)}>
          <ScanLine size={18} /> Scan or search
        </Btn>
      )}
      {open && <PersonPickerModal title={label} onPick={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}
