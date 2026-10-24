import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import "@fontsource-variable/inter";
import "./index.css";
import { applyTheme } from "./theme";
import { AuthProvider, isOrganiser, useAuth } from "./auth";
import { BottomNav, HeaderSlot, Spinner, Toaster } from "./ui";
import { NotificationBell, PulseProvider } from "./pulse";
import { Login, Setup, SignInLink } from "./pages/Entry";
import { GamesList, GameView, Home, Leaderboard, Profile } from "./pages/Participant";
import { AdminHub, PersonDetail, People, Register, ScanPage } from "./pages/Admin";
import { GameControl } from "./pages/GameControl";
import { Settings } from "./pages/Settings";
import { Screen } from "./pages/Screen";

function Protected({ organiser = false }: { organiser?: boolean }) {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  if (organiser && !isOrganiser(me)) return <Navigate to="/" replace />;
  return (
    <HeaderSlot.Provider value={<NotificationBell />}>
      <Outlet />
      <BottomNav />
    </HeaderSlot.Provider>
  );
}

function App(): ReactNode {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/s/:token" element={<SignInLink />} />
      <Route path="/screen" element={<Screen />} />

      <Route element={<Protected />}>
        <Route path="/" element={<Home />} />
        <Route path="/games" element={<GamesList />} />
        <Route path="/games/:id" element={<GameView />} />
        <Route path="/board" element={<Leaderboard />} />
        <Route path="/me" element={<Profile />} />
      </Route>

      <Route element={<Protected organiser />}>
        <Route path="/admin" element={<AdminHub />} />
        <Route path="/admin/register" element={<Register />} />
        <Route path="/admin/people" element={<People />} />
        <Route path="/admin/people/:id" element={<PersonDetail />} />
        <Route path="/admin/scan" element={<ScanPage />} />
        <Route path="/admin/games/:id" element={<GameControl />} />
        <Route path="/admin/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

applyTheme();

// Lets phone alerts show reliably (see public/sw.js)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PulseProvider>
          <App />
          <Toaster />
        </PulseProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
