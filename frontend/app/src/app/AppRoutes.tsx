import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import IframePage from "../pages/IframePage";
import PlayPage from "../pages/PlayPage";
import RootPage from "../pages/RootPage";
import SettingsPage from "../pages/SettingsPage";
import { logPageView } from "./firebaseAnalytics";

function getPageTitle(pathname: string, hash: string) {
  if (pathname === "/play" && hash.startsWith("#album/")) {
    return "ktv420 album";
  }

  if (pathname === "/play" && hash.startsWith("#playlist/")) {
    return "ktv420 playlist";
  }

  if (pathname === "/iframe") {
    return "ktv420 iframe";
  }

  if (pathname === "/play") {
    return "ktv420 player";
  }

  if (pathname === "/settings") {
    return "ktv420 settings";
  }

  return "ktv420";
}

export default function AppRoutes() {
  const { hash, pathname, search } = useLocation();

  useEffect(() => {
    const pageTitle = getPageTitle(pathname, hash);

    document.title = pageTitle;
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
