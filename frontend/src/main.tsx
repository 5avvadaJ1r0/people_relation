import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyDefaultSiteSeo } from "./lib/siteSeo";
import "./ui/styles.scss";

applyDefaultSiteSeo();

createRoot(document.getElementById("root")!).render(<App />);

