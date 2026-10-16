"use client";

import { Fragment, useEffect, useState } from "react";
import { safeHttpUrl, trimBareUrl } from "@platform/shared";

export { trimBareUrl };
import { apiFetch } from "@/lib/api";
import { loadServerEmojiMap, stickerSrc } from "@/lib/server-emoji";
import { CodeBlock } from "./code-block";
import { embedName, parseSpotifyUrl, resolvePersonalLinks } from "@platform/shared";
import { InlineFile, PendingFile, type InlineAttachment } from "./inline-attachment";
import { SpotifyEmbed } from "./spotify-embed";

interface Emoji {
  shortcode: string;
  url: string;
}

const SHORTCODE = /:([a-z0-9_+-]+):/g;
// Inline spans, longest-delimiter-first so `**bold**` is not read as two
// italics. Links are [text](url); the url is validated before it renders.
// A bare http(s) address is a link too — pasting one is how most people
// write a link, and it used to render as dead text.
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>"'`]+)/g;


/**
 * One request per author per page, not per rendered body: a listing shows
 * a card for every post, and each card renders through here.
 *
 * The promise is cached, not just the result, so cards mounting together
 * share the one in-flight request instead of each starting their own.
 */
const emojiCache = new Map<string, Promise<Record<string, string>>>();

function loadCreatorEmoji(creatorUsername: string): Promise<Record<string, string>> {
  const cached = emojiCache.get(creatorUsername);
  if (cached) return cached;

  const request = apiFetch<{ emoji: Emoji[] }>(`/emoji/${creatorUsername}`)
    .then((res) => Object.fromEntries(res.emoji.map((e) => [e.shortcode, e.url])))
    .catch(() => {
      // Not cached as a failure: a later render should be able to retry.
      emojiCache.delete(creatorUsername);
      return {} as Record<string, string>;
    });
  emojiCache.set(creatorUsername, request);
  return request;
}

/**
 * The server's stickers, plus the author's own where there is an author —
 * the author's win a clash, since that is the one they meant when they
 * typed it. Text with no `:shortcode:` in it asks for neither.
 */
function loadEmoji(creatorUsername: string): Promise<Record<string, string>> {
  // The server's stickers by an address the browser can fetch (under /api).
  const server = loadServerEmojiMap().then((map) =>
    Object.fromEntries(Object.entries(map).map(([shortcode, url]) => [shortcode, stickerSrc(url)])),
  );
  if (!creatorUsername) return server;
  return Promise.all([server, loadCreatorEmoji(creatorUsername)]).then(([a, b]) => ({ ...a, ...b }));
}

/**
 * Renders an author's post or comment body.
 *
 * Everything here is built as React children — there is no
 * `dangerouslySetInnerHTML` anywhere in this path — so a body containing
 * `<script>` renders as the literal characters a reader sees, not as
 * markup. That is the property that makes it safe to render untrusted
 * text at all, and it is why the formatting is parsed here rather than by
 * converting markdown to HTML.
 */
export function RichText({
  text,
  creatorUsername,
  attachments,
}: {
  text: string;
  creatorUsername: string;
  /**
   * The post's files, for `![[name]]` lines: each is drawn where it is
   * named. Left out (an editor's preview, before upload), such a line
   * shows the file's name in its place.
   */
  attachments?: InlineAttachment[];
}) {
  const [emoji, setEmoji] = useState<Record<string, string>>({});

  // A body with no `:shortcode:` in it has nothing to resolve, and most
  // have none: this was a request per page, on every page, for a map that
  // was then never read.
  const needsEmoji = SHORTCODE.test(text);
  SHORTCODE.lastIndex = 0;

  useEffect(() => {
    if (!needsEmoji) return;
    let cancelled = false;
    loadEmoji(creatorUsername).then((loaded) => {
      if (!cancelled) setEmoji(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [creatorUsername, needsEmoji]);

  const files = attachments ? new Map(attachments.map((a) => [a.originalFilename, a])) : null;
  // A personal link the server did not make into the reader's own (the
  // author's view, a preview) shows as the ordinary link it is.
  return <>{renderBlocks(resolvePersonalLinks(text), emoji, 0, files)}</>;
}

/** Splits the body into blocks, pulling fenced code out first. */
/** A line that could be a table row: it has at least one interior pipe. */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && /\S/.test(trimmed.replace(/\|/g, ""));
}

/** The `| --- | :--: |` row that turns the line above it into a header. */
function isTableDelimiter(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
}

/**
 * Splits a row on unescaped pipes, dropping the optional leading and
 * trailing ones so `| a | b |` and `a | b` both yield two cells.
 */
function splitTableRow(line: string): string[] {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
  return cells.length === 1 && cells[0] === "" ? [] : cells;
}

function columnAlignment(cell: string): "left" | "center" | "right" {
  const spec = cell.trim();
  if (spec.startsWith(":") && spec.endsWith(":")) return "center";
  if (spec.endsWith(":")) return "right";
  return "left";
}

/** `> text`, or a bare `>` for a blank line inside the quote. */
const QUOTE_LINE = /^>( |$)/;
/** Quotes inside quotes stop being parsed past this; their text still shows. */
const MAX_QUOTE_DEPTH = 3;

/** Whether a line opens a block of its own, rather than continuing a paragraph or list item. */
function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i]!;
  return (
    line.trim() === "" ||
    // A Spotify link alone on its line is a player, not part of a paragraph;
    // so is a file placed in the text.
    parseSpotifyUrl(line) !== null ||
    embedName(line) !== null ||
    /^```/.test(line) ||
    /^[-*]\s/.test(line) ||
    /^\d+\.\s/.test(line) ||
    QUOTE_LINE.test(line) ||
    /^#{1,3}\s/.test(line) ||
    // A table directly after a paragraph, with no blank line between,
    // must start a table rather than be absorbed into the paragraph.
    (isTableRow(line) && i + 1 < lines.length && isTableDelimiter(lines[i + 1]!))
  );
}

function renderBlocks(
  text: string,
  emoji: Record<string, string>,
  depth = 0,
  files: Map<string, InlineAttachment> | null = null,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // ``` fenced code, with an optional language on the fence
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const language = fence[1] || undefined;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence, or end of input if the author never closed it
      out.push(<CodeBlock key={key++} code={body.join("\n")} language={language} />);
      continue;
    }

    // A file placed here (`![[name]]`): the picture, player or download.
    // One the post does not have (renamed, removed) leaves no trace.
    const placed = depth === 0 ? embedName(line) : null;
    if (placed !== null) {
      const file = files?.get(placed);
      if (!files) out.push(<PendingFile key={key++} name={placed} />);
      else if (file) out.push(<InlineFile key={key++} attachment={file} />);
      i += 1;
      continue;
    }

    // A Spotify link on a line of its own: Spotify's player, loaded when
    // the reader asks (see SpotifyEmbed). Inside a quote it stays a link.
    const spotify = depth === 0 ? parseSpotifyUrl(line) : null;
    if (spotify) {
      out.push(<SpotifyEmbed key={key++} spotify={spotify} />);
      i += 1;
      continue;
    }

    // # heading
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      const content = renderInline(heading[2]!, emoji, `h${key}`);
      out.push(
        level === 1 ? <h2 key={key++}>{content}</h2> : level === 2 ? <h3 key={key++}>{content}</h3> : <h4 key={key++}>{content}</h4>,
      );
      i += 1;
      continue;
    }

    // > quote — its content is blocks of its own, so a list quoted from
    // somewhere stays a list instead of a run of lines starting with "-".
    if (QUOTE_LINE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE_LINE.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^> ?/, ""));
        i += 1;
      }
      out.push(
        <blockquote key={key++} className="rt-quote">
          {depth < MAX_QUOTE_DEPTH
            ? renderBlocks(body.join("\n"), emoji, depth + 1)
            : renderInline(body.join("\n"), emoji, `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // - bullets / 1. numbered
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? lines[i]!.match(/^\d+\.\s+(.*)$/) : lines[i]!.match(/^[-*]\s+(.*)$/);
        if (m) {
          items.push(m[1]!);
        } else if (!startsBlock(lines, i)) {
          // A line right under an item, with no marker of its own, carries
          // that item on — the way Markdown reads it.
          items[items.length - 1] += `\n${lines[i]!}`;
        } else {
          break;
        }
        i += 1;
      }
      const rendered = items.map((item, n) => (
        <li key={n} style={{ whiteSpace: "pre-wrap" }}>
          {renderInline(item, emoji, `li${key}-${n}`)}
        </li>
      ));
      out.push(ordered ? <ol key={key++}>{rendered}</ol> : <ul key={key++}>{rendered}</ul>);
      continue;
    }

    // | pipe | tables |, recognised only when the line after the header
    // is a delimiter row (| --- | --- |). Without that check a paragraph
    // that merely contains a pipe would be eaten as a one-row table.
    if (isTableRow(line) && i + 1 < lines.length && isTableDelimiter(lines[i + 1]!)) {
      const header = splitTableRow(line);
      const alignments = splitTableRow(lines[i + 1]!).map(columnAlignment);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) {
        rows.push(splitTableRow(lines[i]!));
        i += 1;
      }
      out.push(
        // Wide tables scroll inside their own container rather than
        // pushing the whole page sideways.
        <div key={key++} className="rt-table-wrap">
          <table className="rt-table">
            <thead>
              <tr>
                {header.map((cell, n) => (
                  <th key={n} style={{ textAlign: alignments[n] ?? "left" }}>
                    {renderInline(cell, emoji, `th${key}-${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {/* Padded to the header's width so a short row cannot
                      shift the remaining cells into the wrong columns. */}
                  {header.map((_, c) => (
                    <td key={c} style={{ textAlign: alignments[c] ?? "left" }}>
                      {renderInline(row[c] ?? "", emoji, `td${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blank lines separate paragraphs.
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // The first line is taken unconditionally: one that only looks like a
    // block start (```js with text after it) used to match no block and
    // end the paragraph before it began, and the loop never advanced.
    const paragraph: string[] = [lines[i]!];
    i += 1;
    while (i < lines.length && !startsBlock(lines, i)) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    out.push(
      <p key={key++} style={{ whiteSpace: "pre-wrap" }}>
        {renderInline(paragraph.join("\n"), emoji, `p${key}`)}
      </p>,
    );
  }

  return out;
}

/** Inline formatting, custom emoji, and links — all as React children. */
function renderInline(text: string, emoji: Record<string, string>, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) parts.push(...withEmoji(text.slice(last, match.index), emoji, `${keyPrefix}-t${n++}`));
    const token = match[0];

    if (token.startsWith("`")) {
      parts.push(
        <code key={`${keyPrefix}-c${n++}`} className="rt-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-b${n++}`}>{withEmoji(token.slice(2, -2), emoji, `${keyPrefix}-b${n}`)}</strong>);
    } else if (token.startsWith("~~")) {
      parts.push(<del key={`${keyPrefix}-s${n++}`}>{withEmoji(token.slice(2, -2), emoji, `${keyPrefix}-s${n}`)}</del>);
    } else if (/^https?:\/\//.test(token)) {
      const url = trimBareUrl(token);
      const href = safeHttpUrl(url);
      if (href) {
        parts.push(
          <a key={`${keyPrefix}-u${n++}`} className="text-link" href={href} target="_blank" rel="noreferrer noopener">
            {url}
          </a>,
        );
      } else {
        parts.push(<Fragment key={`${keyPrefix}-u${n++}`}>{url}</Fragment>);
      }
      // The punctuation trimmed off the end is still text; it is picked up
      // from here as the start of the next plain run.
      last = match.index + url.length;
      INLINE.lastIndex = last;
      continue;
    } else if (token.startsWith("*")) {
      parts.push(<em key={`${keyPrefix}-i${n++}`}>{withEmoji(token.slice(1, -1), emoji, `${keyPrefix}-i${n}`)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const href = link ? safeHttpUrl(link[2]!) : null;
      // A link whose target is not http(s) renders as its own text, so a
      // `javascript:` target can never become a clickable anchor.
      if (link && href) {
        parts.push(
          <a key={`${keyPrefix}-a${n++}`} className="text-link" href={href} target="_blank" rel="noreferrer noopener">
            {withEmoji(link[1]!, emoji, `${keyPrefix}-a${n}`)}
          </a>,
        );
      } else {
        parts.push(...withEmoji(token, emoji, `${keyPrefix}-x${n++}`));
      }
    }
    last = match.index + token.length;
  }

  if (last < text.length) parts.push(...withEmoji(text.slice(last), emoji, `${keyPrefix}-t${n++}`));
  return parts;
}

/** Substitutes `:shortcode:` for the author's custom emoji. */
function withEmoji(text: string, emoji: Record<string, string>, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  SHORTCODE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SHORTCODE.exec(text)) !== null) {
    const url = safeHttpUrl(emoji[match[1]!]);
    if (!url) continue;
    if (match.index > last) parts.push(<Fragment key={`${keyPrefix}-${n++}`}>{text.slice(last, match.index)}</Fragment>);
    parts.push(
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={`${keyPrefix}-${n++}`}
        src={url}
        alt={`:${match[1]}:`}
        title={`:${match[1]}:`}
        loading="lazy"
        style={{ height: "1.3em", verticalAlign: "-0.25em", display: "inline-block" }}
      />,
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) parts.push(<Fragment key={`${keyPrefix}-${n++}`}>{text.slice(last)}</Fragment>);
  return parts;
}
