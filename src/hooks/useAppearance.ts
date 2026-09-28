import { useEffect } from "react";
import { useSettings } from "@/lib/cache/settings";
import { useMediaQuery } from "./useMediaQuery";

/** Applies the app appearance (System, Light, Dark) to the document. */
export function useAppearanceEffect() {
  const { appearance } = useSettings();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const dark = appearance === "dark" || (appearance === "system" && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    const meta = document.querySelector('meta[name="theme-color"]') ?? Object.assign(document.createElement("meta"), { name: "theme-color" });
    meta.setAttribute("content", dark ? "#111316" : "#f6f7f8");
    if (!meta.parentNode) document.head.appendChild(meta);
  }, [dark]);
  return dark;
}
