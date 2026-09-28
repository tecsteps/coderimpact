import { Language, Parser, Query } from "web-tree-sitter";
import { SEMANTIC_LANGUAGES, type SemanticLanguage } from "./registry";
import { extractGo } from "./go";
import { extractPhp } from "./php";
import { extractGeneric, type GenericQueries } from "./generic";
import { querySource } from "./queries";
import type { FileIndex } from "./types";

/**
 * Loads Tree-sitter and grammars on demand and turns source text into a
 * FileIndex: the hand-written adapters for Go and PHP, the generic
 * query-driven adapter for every other language. Runs inside the parser
 * workers in the browser, and directly in Node for tests.
 */
// A C++ keyword at the start of a line (after indentation only), and what must
// follow it for the line to count as C++ rather than C.
const CPP_LINE_KEYWORD = /^[ \t]*(class|namespace|template|public|private|protected)\b/gm;
const CPP_KEYWORD_TAIL: Record<string, RegExp> = {
  class: /\s+\w[^;{]*\{/y,
  namespace: /\s+(?:\w+\s*)?\{/y,
  template: /\s*</y,
  public: /\s*:/y,
  private: /\s*:/y,
  protected: /\s*:/y,
};

function looksLikeCpp(text: string): boolean {
  if (/\bstd::/.test(text)) return true;
  CPP_LINE_KEYWORD.lastIndex = 0;
  for (let m = CPP_LINE_KEYWORD.exec(text); m; m = CPP_LINE_KEYWORD.exec(text)) {
    const tail = CPP_KEYWORD_TAIL[m[1]];
    tail.lastIndex = CPP_LINE_KEYWORD.lastIndex;
    if (tail.test(text)) return true;
  }
  return false;
}

export class ParserHost {
  private parser: Parser | null = null;
  private readonly langs = new Map<SemanticLanguage, Promise<{ language: Language; queries?: GenericQueries }>>();
  private readonly locate: (file: string) => string;
  private initPromise: Promise<void> | null = null;

  constructor(locate: (file: string) => string) {
    this.locate = locate;
  }

  private init(): Promise<void> {
    this.initPromise ??= Parser.init({ locateFile: (f: string) => this.locate(f) }).then(() => {
      this.parser = new Parser();
    });
    return this.initPromise;
  }

  private load(lang: SemanticLanguage) {
    let p = this.langs.get(lang);
    if (!p) {
      p = Language.load(this.locate(SEMANTIC_LANGUAGES[lang].grammar)).then((language) => {
        if (lang === "go" || lang === "php") return { language };
        const tags = querySource(lang, "tags");
        const locals = querySource(lang, "locals");
        return {
          language,
          queries: {
            tags: new Query(language, tags ?? "(ERROR) @none"),
            locals: locals ? new Query(language, locals) : undefined,
          },
        };
      });
      this.langs.set(lang, p);
    }
    return p;
  }

  async index(path: string, lang: SemanticLanguage, text: string): Promise<FileIndex> {
    // .h is shared by C and C++: a header with C++ constructs gets the C++ grammar.
    if (lang === "c" && /\.h$/i.test(path) && looksLikeCpp(text)) lang = "cpp";
    await this.init();
    const { language, queries } = await this.load(lang);
    const parser = this.parser!;
    parser.setLanguage(language);
    const tree = parser.parse(text);
    if (!tree) throw new Error(`Could not parse ${path}`);
    try {
      if (lang === "go") return extractGo(tree, text, path);
      if (lang === "php") return extractPhp(tree, text, path);
      return extractGeneric(lang, tree, text, path, queries!);
    } finally {
      tree.delete();
    }
  }
}
