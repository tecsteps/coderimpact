import { useEffect, useRef } from "react";
import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { bracketMatching, indentUnit } from "@codemirror/language";
import type { RepoSession } from "@/lib/session";
import { memberAccessAt, memberCompletions } from "@/lib/lang/completion";
import { highlightClient } from "@/lib/highlight/client";
import type { DeclKind } from "@/lib/lang/types";


const COMPLETION_TYPE: Partial<Record<DeclKind, string>> = {
  method: "method",
  function: "function",
  const: "constant",
  property: "property",
  field: "property",
  var: "variable",
  type: "type",
  class: "class",
  enum: "enum",
};

/** Methods, properties and constants of the receiver's class, from the semantic index. */
function memberSource(session: RepoSession, path: string) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const access = memberAccessAt(line.text.slice(0, ctx.pos - line.from));
    if (!access) return null;
    const { receiver, op, typed } = access;
    const { items, exact } = memberCompletions(session.index, path, line.number, receiver, typed, ctx.state.sliceDoc(0, ctx.pos));
    if (!items.length) return null;
    // PHP: $obj->name, but Foo::$name for static properties.
    const bare = op.includes("->");
    return {
      from: ctx.pos - typed.length,
      options: items.map((i) => ({
        label: bare ? i.name.replace(/^\$/, "") : i.name,
        type: COMPLETION_TYPE[i.kind] ?? "text",
        detail: i.container,
        info: i.signature,
        boost: exact ? 1 : 0,
      })),
      validFor: /^\$?\w*$/,
    };
  };
}

const setTokens = StateEffect.define<DecorationSet>();

/** Syntax colors from the same Shiki theme as the reader, kept in place while typing. */
const tokenField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setTokens)) next = e.value;
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const markCache = new Map<string, Decoration>();
function mark(color?: string, fontStyle?: number): Decoration | null {
  if (!color && !fontStyle) return null;
  const key = `${color}|${fontStyle}`;
  let d = markCache.get(key);
  if (!d) {
    const style = [color ? `color:${color}` : "", fontStyle && fontStyle & 1 ? "font-style:italic" : "", fontStyle && fontStyle & 2 ? "font-weight:600" : ""].filter(Boolean).join(";");
    d = Decoration.mark({ attributes: { style } });
    markCache.set(key, d);
  }
  return d;
}

function shikiHighlighter(path: string, lang: string, theme: string): Extension {
  let n = 0;
  let timer = 0;
  const run = (view: EditorView) => {
    const text = view.state.doc.toString();
    const id = ++n;
    highlightClient
      .highlight(`edit:${path}:${id}`, text, lang, theme)
      .then(({ lines }) => {
        // A newer version is on its way, or the text changed meanwhile: skip this one.
        if (id !== n || view.state.doc.length !== text.length || view.state.doc.toString() !== text) return;
        const b = new RangeSetBuilder<Decoration>();
        let pos = 0;
        for (const line of lines) {
          for (const [content, color, fontStyle] of line) {
            const d = mark(color, fontStyle);
            if (d && content) b.add(pos, pos + content.length, d);
            pos += content.length;
          }
          pos += 1;
        }
        view.dispatch({ effects: setTokens.of(b.finish()) });
      })
      .catch(() => undefined);
  };
  return [
    tokenField,
    ViewPlugin.define((view) => {
      run(view);
      return {
        update(u) {
          if (!u.docChanged) return;
          window.clearTimeout(timer);
          timer = window.setTimeout(() => run(u.view), 120);
        },
        destroy() {
          window.clearTimeout(timer);
          n = -1;
        },
      };
    }),
  ];
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--code-bg)", color: "var(--code-fg)", fontSize: "var(--code-size)" },
  ".cm-scroller": { fontFamily: "var(--font-code)", lineHeight: "1.65" },
  ".cm-content": { caretColor: "var(--code-fg)", paddingBlock: "8px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--code-fg)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "var(--code-bg)", color: "var(--code-gutter)", border: "none", paddingLeft: "8px" },
  ".cm-lineNumbers .cm-gutterElement": { paddingRight: "12px", minWidth: "3ch" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--code-gutter-active)" },
  ".cm-activeLine": { backgroundColor: "var(--code-line-focus)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--code-selection) !important" },
  ".cm-selectionMatch": { backgroundColor: "var(--code-symbol)" },
  ".cm-matchingBracket": { outline: "1px solid var(--code-gutter)", backgroundColor: "transparent" },
  ".cm-searchMatch": { backgroundColor: "var(--code-match)" },
  ".cm-tooltip": { border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)", borderRadius: "8px", boxShadow: "var(--shadow-pop)", overflow: "hidden" },
  ".cm-tooltip-autocomplete ul li": { fontFamily: "var(--font-code)", fontSize: "12.5px", padding: "3px 8px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--foreground)" },
  ".cm-completionDetail": { color: "var(--subtle-foreground)", fontStyle: "normal", marginLeft: "8px" },
  ".cm-completionInfo": { fontFamily: "var(--font-code)", fontSize: "12px", padding: "6px 8px", maxWidth: "420px" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--foreground)", borderColor: "var(--border)" },
});

/**
 * Quick edits for local folders: CodeMirror with the reader's Shiki colors,
 * member completion from the semantic index, ⌘S to save.
 */
export default function CodeEditor({
  session,
  path,
  text,
  lang,
  theme,
  wrap,
  onChange,
  onSave,
  onExit,
}: Readonly<{
  session: RepoSession;
  path: string;
  text: string;
  lang: string;
  theme: string;
  wrap: boolean;
  onChange: (text: string) => void;
  onSave: (text: string) => void;
  /** Cmd/Ctrl+E: back to reading. */
  onExit: () => void;
}>) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onSave, onExit });
  handlers.current = { onChange, onSave, onExit };

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          closeBrackets(),
          search({ top: true }),
          highlightSelectionMatches(),
          indentUnit.of(/\t/.test(text.slice(0, 4000)) ? "\t" : "    "),
          autocompletion({ override: [memberSource(session, path)], activateOnTyping: true, icons: true }),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: (v) => {
                handlers.current.onSave(v.state.doc.toString());
                return true;
              },
            },
            {
              key: "Mod-e",
              preventDefault: true,
              run: () => {
                handlers.current.onExit();
                return true;
              },
            },
            indentWithTab,
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          wrap ? EditorView.lineWrapping : [],
          shikiHighlighter(path, lang, theme),
          editorTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
    // A new file, theme or wrap setting builds a new editor; the text is its starting point only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, path, lang, theme, wrap]);

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}
