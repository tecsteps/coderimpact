import { getKV } from "../cache/db";
import { sha256Hex } from "../util/hash";
import type { ExplainContext } from "./context";
import { buildMessages, PROMPT_VERSION } from "./prompt";
import { getProvider, type ExplanationProvider } from "./provider";
import { parseExplanation, type Explanation } from "./validate";

export interface ExplainResult {
  explanation: Explanation;
  model: string;
  cached: boolean;
}

interface CachedExplanation {
  explanation: Explanation;
  model: string;
  createdAt: number;
}

/** Cache key: prompt version, task, language, and exactly what was sent. */
export async function explanationKey(ctx: ExplainContext): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      v: PROMPT_VERSION,
      task: ctx.task,
      lang: ctx.language,
      focus: [ctx.focusStart, ctx.focusEnd],
      decl: ctx.declName ?? null,
      sig: ctx.enclosingSignature ?? null,
      familiar: ctx.familiar,
      code: ctx.code,
      tpl: ctx.template ?? null,
      fragment: ctx.fragment ?? null,
    }),
  );
}

export async function cachedExplanation(ctx: ExplainContext): Promise<ExplainResult | null> {
  const hit = await getKV().get<CachedExplanation>("explanations", await explanationKey(ctx));
  return hit ? { explanation: hit.explanation, model: hit.model, cached: true } : null;
}

export async function explain(
  ctx: ExplainContext,
  signal?: AbortSignal,
  provider: ExplanationProvider = getProvider(),
): Promise<ExplainResult> {
  const cached = await cachedExplanation(ctx);
  if (cached) return cached;
  const { text, model } = await provider.complete(buildMessages(ctx), signal);
  const explanation = parseExplanation(text, ctx.task, { fragment: ctx.fragment });
  await getKV()
    .put<CachedExplanation>("explanations", await explanationKey(ctx), { explanation, model, createdAt: Date.now() })
    .catch(() => undefined);
  return { explanation, model, cached: false };
}
