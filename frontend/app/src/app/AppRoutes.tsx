import { Navigate, Route, Routes } from "react-router-dom";

import AdminPage from "../pages/AdminPage";
import IframePage from "../pages/IframePage";
import RootPage from "../pages/RootPage";
import SamplePage from "../pages/SamplePage";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/iframe" element={<IframePage />} />
      <Route path="/sample" element={<SamplePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
