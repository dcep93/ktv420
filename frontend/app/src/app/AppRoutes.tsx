import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import AdminPage from "../pages/AdminPage";
import IframePage from "../pages/IframePage";
import PlayPage from "../pages/PlayPage";
import RootPage from "../pages/RootPage";
import SamplePage from "../pages/SamplePage";
import SettingsPage from "../pages/SettingsPage";
import { logPageView } from "./firebaseAnalytics";

function getPageTitle(pathname: string) {
  if (pathname === "/admin") {
    return "ktv420 admin";
  }

  if (pathname === "/iframe") {
    return "ktv420 iframe";
  }

  if (pathname === "/play") {
    return "ktv420 player";
  }

  if (pathname.startsWith("/album/")) {
    return "ktv420 album";
  }

  if (pathname.startsWith("/playlist/")) {
    return "ktv420 playlist";
  }

  if (pathname === "/sample") {
    return "ktv420 sample";
  }

  if (pathname === "/settings") {
    return "ktv420 settings";
  }

  return "ktv420";
}

export default function AppRoutes() {
  const { hash, pathname, search } = useLocation();

  useEffect(() => {
    const pageTitle = getPageTitle(pathname);

    document.title = pageTitle;
    void logPageView(`${pathname}${search}${hash}`, pageTitle);
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
