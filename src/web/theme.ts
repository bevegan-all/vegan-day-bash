import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "vdb-theme";

export function getPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export function applyTheme(pref: ThemePref = getPref()) {
  const dark = pref === "dark" || (pref === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e100f" : "#f6f6f3");
  return dark;
}

export function setPref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: the choice just won't persist */
  }
  applyTheme(pref);
  window.dispatchEvent(new Event("vdb-theme"));
}

export function useTheme() {
  const [pref, setP] = useState<ThemePref>(getPref);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const sync = () => {
      setP(getPref());
      setDark(applyTheme());
    };
    window.addEventListener("vdb-theme", sync);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    return () => {
      window.removeEventListener("vdb-theme", sync);
      mq.removeEventListener("change", sync);
    };
  }, []);
  return { pref, dark, set: setPref };
}
