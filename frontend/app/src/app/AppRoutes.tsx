import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import IframePage from "../pages/IframePage";
import PlayPage from "../pages/PlayPage";
import RootPage from "../pages/RootPage";
import SettingsPage from "../pages/SettingsPage";
import { logPageView } from "./firebaseAnalytics";

export default function AppRoutes() {
  const { hash, pathname, search } = useLocation();

  useEffect(() => {
    document.title = "ktv420";
    void logPageView(`${pathname}${search}${hash}`);
  }, [hash, pathname, search]);

  return (
    <Routes>
      <Route path="/" element={<RootPage />} />
      <Route path="/iframe" element={<IframePage />} />
      <Route path="/play" element={<PlayPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
