"use client";

import { Fragment, useEffect, useState } from "react";
import type Prism from "prismjs";
import { useLocale } from "./locale-provider";

type PrismLib = typeof Prism;

let prism: Promise<PrismLib> | null = null;

/**
 * Prism and its grammars, fetched the first time a code block names a
 * language. Imported up front they were in every page's bundle (16 KB
 * gzipped): an announcement renders through RichText, which the layout
 * carries. One chunk ("prism"); the grammars register themselves on the
 * global Prism, so each loads after the ones it extends.
 */
function loadPrism(): Promise<PrismLib> {
  prism ??= (async () => {
    const { default: core } = await import(/* webpackChunkName: "prism" */ "prismjs");
    await import(/* webpackChunkName: "prism" */ "prismjs/components/prism-typescript");
    await import(/* webpackChunkName: "prism" */ "prismjs/components/prism-jsx");
    await import(/* webpackChunkName: "prism" */ "prismjs/components/prism-tsx");
    await Promise.all([
      import(/* webpackChunkName: "prism" */ "prismjs/components/prism-python"),
      import(/* webpackChunkName: "prism" */ "prismjs/components/prism-bash"),
      import(/* webpackChunkName: "prism" */ "prismjs/components/prism-json"),
      import(/* webpackChunkName: "prism" */ "prismjs/components/prism-yaml"),
      import(/* webpackChunkName: "prism" */ "prismjs/components/prism-sql"),
      import(/* webpackChunkName: "prism" */ "prismjs/components/prism-rust"),
      import(/* webpackChunkName: "prism" */ "prismjs/components/prism-go"),
      import(/* webpackChunkName: "prism" */ "prismjs/components/prism-markdown"),
    ]);
    return core;
  })().catch((err: unknown) => {
    prism = null;
    throw err;
  });
  return prism;
}

/**
 * Prism is used for its tokenizer only, never its HTML output.
 * `Prism.highlight` returns a markup string that would have to go through
 * `dangerouslySetInnerHTML`; `Prism.tokenize` returns a token tree, which
 * renders as React children instead. Post bodies are untrusted, so the
 * difference matters: this path cannot inject markup even if the
 * tokenizer is fed something pathological.
 */
const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  rs: "rust",
  golang: "go",
  md: "markdown",
};

function tokensToNodes(tokens: (string | Prism.Token)[], keyPrefix = ""): React.ReactNode[] {
  return tokens.map((token, i) => {
    const key = `${keyPrefix}${i}`;
    if (typeof token === "string") return <Fragment key={key}>{token}</Fragment>;

    const content = Array.isArray(token.content)
      ? tokensToNodes(token.content as (string | Prism.Token)[], `${key}-`)
      : typeof token.content === "string"
        ? token.content
        : tokensToNodes([token.content as Prism.Token], `${key}-`);

    const alias = Array.isArray(token.alias) ? token.alias.join(" ") : (token.alias ?? "");
    return (
      <span key={key} className={`tok tok-${token.type}${alias ? ` tok-${alias}` : ""}`}>
        {content}
      </span>
    );
  });
}

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  const resolved = language ? (ALIASES[language.toLowerCase()] ?? language.toLowerCase()) : "";
  // Plain until Prism arrives — which is also what the server rendered.
  const [lib, setLib] = useState<PrismLib | null>(null);
  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    loadPrism()
      .then((loaded) => !cancelled && setLib(loaded))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resolved]);
  const grammar = resolved && lib ? lib.languages[resolved] : undefined;

  // An unknown language renders as plain text rather than failing — a post
  // should never break because it named a language Prism doesn't carry.
  const body = grammar && lib ? tokensToNodes(lib.tokenize(code, grammar)) : code;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{resolved || t("editor.plainText")}</span>
        <button type="button" className="code-copy" onClick={copy}>
          {copied ? t("common.linkCopied") : t("editor.copy")}
        </button>
      </div>
      <pre>
        <code>{body}</code>
      </pre>
    </div>
  );
}
