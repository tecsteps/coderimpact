import { useEffect, useState } from "react";
import { getGitHubClient, type RateLimitState } from "@/lib/github/client";

export function useRateLimit(): RateLimitState | null {
  const client = getGitHubClient();
  const [rate, setRate] = useState<RateLimitState | null>(client.rate);
  useEffect(() => client.onRateLimit(setRate), [client]);
  return rate;
}
