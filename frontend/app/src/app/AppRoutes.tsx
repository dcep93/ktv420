import { Navigate, Route, Routes } from "react-router-dom";

import AdminPage from "../features/admin/AdminPage";
import SamplePage from "../features/sample/SamplePage";
import IframePage from "../pages/iframe/IframePage";
import RootPage from "../pages/root/RootPage";

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
