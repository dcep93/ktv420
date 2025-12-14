import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Stem420 from "./Stem420/index.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Stem420 />
  </StrictMode>
);
