import { useEffect, useState } from "react";

// Ticks four times a second. `offset` is the server clock minus this phone's clock,
// so every phone shows the same countdown.
export function useClock(offset = 0) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const t = setInterval(() => setNow(Date.now() + offset), 250);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
