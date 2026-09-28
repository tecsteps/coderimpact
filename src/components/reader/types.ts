import type { ExplainContext } from "@/lib/explain/context";
import type { ExplainResult } from "@/lib/explain/explain";
import type { Block } from "@/lib/lang/types";

export type ExplainRequest =
  | { task: "line"; line: number }
  /** `fragment`: the exact text selected when it is part of one line (for example just `protected`). */
  | { task: "selection"; start: number; end: number; fragment?: string }
  | { task: "declaration"; block: Block };

export interface Annotation {
  id: string;
  path: string;
  /** Row is inserted after this line. */
  anchor: number;
  title: string;
  ctx: ExplainContext;
  status: "loading" | "done" | "error";
  result?: ExplainResult;
  error?: { message: string; retryable: boolean };
  open: boolean;
  sentOpen: boolean;
}

export type AnnotationAction = "hide" | "retry" | "rerun" | "toggle-sent" | "cancel";

export interface SymbolHighlight {
  line: number;
  col: number;
  endCol: number;
  def?: boolean;
}
