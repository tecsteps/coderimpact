import { useSyncExternalStore } from "react";
import { getProvider, type ProviderState } from "@/lib/explain/provider";

export function useProviderState(): ProviderState {
  const p = getProvider();
  return useSyncExternalStore(
    (cb) => p.subscribe(cb),
    () => p.state(),
    () => p.state(),
  );
}
