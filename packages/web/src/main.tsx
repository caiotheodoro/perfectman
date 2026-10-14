import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

import "./design/fonts.css";
import "./design/tokens.css";
import "./design/shell.css";
import "./onboarding/intro.css";
import "./setup/setup.css";
import "./pick/pick.css";
import "./stage/figure.css";
import "./stage/stage.css";
import "./run/run.css";
import "./components/legacy.css";
import "./watch/fonts.css";
import "./watch/watch.css";
import "./watch/player.css";

const root = document.getElementById("root");
if (!root) throw new Error("no #root in index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
