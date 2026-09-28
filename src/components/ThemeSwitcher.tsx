import { Monitor, Moon, Sun } from "lucide-react";
import { updateSettings, useSettings, type Appearance } from "@/lib/cache/settings";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

const ORDER: Appearance[] = ["system", "light", "dark"];
const LABEL: Record<Appearance, string> = { system: "System", light: "Light", dark: "Dark" };
const ICON: Record<Appearance, typeof Monitor> = { system: Monitor, light: Sun, dark: Moon };

/** App appearance switcher: cycles System, Light and Dark. Remembered. */
export function ThemeSwitcher() {
  const { appearance } = useSettings();
  const next = ORDER[(ORDER.indexOf(appearance) + 1) % ORDER.length];
  const Icon = ICON[appearance];
  const label = `Appearance: ${LABEL[appearance]}. Switch to ${LABEL[next]}`;
  return (
    <Tooltip content={label}>
      <Button variant="ghost" size="icon" aria-label={label} onClick={() => updateSettings({ appearance: next })}>
        <Icon strokeWidth={1.75} />
      </Button>
    </Tooltip>
  );
}
