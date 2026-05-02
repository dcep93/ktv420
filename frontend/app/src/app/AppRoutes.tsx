import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import AdminPage from "../pages/AdminPage";
import IframePage from "../pages/IframePage";
import PlayPage from "../pages/PlayPage";
import RootPage from "../pages/RootPage";
import SamplePage from "../pages/SamplePage";
import SettingsPage from "../pages/SettingsPage";
import { logPageView } from "./firebaseAnalytics";

export default function AppRoutes() {
  const { hash, pathname, search } = useLocation();

  useEffect(() => {
    void logPageView(`${pathname}${search}${hash}`);
  }, [hash, pathname, search]);

  return (
    <Routes>
      <Route path="/" element={<RootPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/iframe" element={<IframePage />} />
      <Route path="/play" element={<PlayPage />} />
      <Route path="/album/:spotifyId" element={<PlayPage spotifyKind="album" />} />
      <Route path="/playlist/:spotifyId" element={<PlayPage spotifyKind="playlist" />} />
      <Route path="/sample" element={<SamplePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
