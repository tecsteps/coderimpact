import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Click feedback for every control: a short teal ring (see [data-pop] in index.css).
document.addEventListener(
  "click",
  (e) => {
    const el = (e.target as Element | null)?.closest?.("button, a, [role=button], [role=menuitem], [role=option], [role=switch], [role=radio]") as HTMLElement | null;
    if (!el) return;
    // A data attribute, not a class: React re-renders class names but leaves this alone.
    delete el.dataset.pop;
    el.getBoundingClientRect(); // force a reflow: restarts the animation on repeated clicks
    el.dataset.pop = "";
    window.setTimeout(() => delete el.dataset.pop, 450);
  },
  true,
);

// Installable app (PWA): the service worker keeps the app shell available offline.
// Not in development, and not in the claude.ai Artifact build (hash router).
if ("serviceWorker" in navigator && import.meta.env.PROD && import.meta.env.VITE_ROUTER !== "hash") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

// Size the app to the area the visitor can see. Mobile browsers with a bottom toolbar
// report a taller window than is visible; bars pinned to its bottom would hide behind it.
function syncViewport() {
  const vv = window.visualViewport;
  if (vv && vv.scale > 1.01) return; // pinch zoom: keep the layout as it is
  const h = vv ? vv.height : window.innerHeight;
  const bottom = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty("--app-h", `${Math.round(h)}px`);
  document.documentElement.style.setProperty("--vv-bottom", `${Math.round(bottom)}px`);
}
syncViewport();
window.visualViewport?.addEventListener("resize", syncViewport);
window.addEventListener("resize", syncViewport);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
