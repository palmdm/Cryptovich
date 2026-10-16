import { stripEmbeds } from "./post-embeds.js";
import { resolvePersonalLinks } from "./personal-links.js";
import { isSafeHttpUrl } from "./safe-url.js";
import { parseSpotifyUrl } from "./spotify.js";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/**
 * A bare URL ends before trailing punctuation that belongs to the sentence
 * ("see https://example.com." or "(https://example.com)"), but keeps a
 * closing bracket it opened itself, as Wikipedia addresses do. Shared by
 * the page and by federation, so a link ends in the same place on both.
 */
export function trimBareUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (!last) return url;
    if (".,;:!?'\"»…".includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    const open = pairs[last];
    if (open && url.split(open).length - 1 < url.split(last).length - 1) {
      url = url.slice(0, -1);
      continue;
    }
    return url;
  }
}

// The same inline spans the page renders (apps/web RichText), in the same
// order: code, bold, strikethrough, italic, [text](url), a bare address.
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>"'`]+)/g;

function link(href: string, inner: string): string {
  return `<a href="${escapeHtml(href)}" rel="nofollow noopener noreferrer" target="_blank">${inner}</a>`;
}

/** One line or paragraph of inline markup, as escaped HTML. */
function inlineHtml(text: string): string {
  let out = "";
  let last = 0;
  const re = new RegExp(INLINE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, match.index));
    const token = match[0];
    let consumed = token.length;
    if (token.startsWith("`")) {
      out += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    } else if (token.startsWith("**")) {
      out += `<strong>${inlineHtml(token.slice(2, -2))}</strong>`;
    } else if (token.startsWith("~~")) {
      out += `<del>${inlineHtml(token.slice(2, -2))}</del>`;
    } else if (/^https?:\/\//.test(token)) {
      const url = trimBareUrl(token);
      consumed = url.length;
      out += isSafeHttpUrl(url) ? link(url, escapeHtml(url)) : escapeHtml(url);
    } else if (token.startsWith("*")) {
      out += `<em>${inlineHtml(token.slice(1, -1))}</em>`;
    } else {
      const m = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      out += m && isSafeHttpUrl(m[2]!) ? link(m[2]!, inlineHtml(m[1]!)) : escapeHtml(token);
    }
    last = match.index + consumed;
    re.lastIndex = last;
  }
  out += escapeHtml(text.slice(last));
  return out.replace(/\n/g, "<br />");
}

/**
 * A post body, written in the editor's markdown, as the HTML other servers
 * render: paragraphs, headings, quotes, lists, code, links, bold, italic,
 * strikethrough. Sent as plain text it arrived with its asterisks showing
 * and its links dead. Everything the author typed is escaped — only the
 * markup produced here reaches someone else's timeline — and a link is
 * made only for an http(s) address.
 *
 * Mastodon keeps p, br, a, strong, em, del, code, pre, blockquote and
 * lists, and turns headings into bold paragraphs; Misskey and Sharkey keep
 * headings as headings.
 */
export function markdownToActivityHtml(text: string): string {
  // Files placed in the text (`![[name]]`) travel as the Note's
  // attachments; another server has no place for them inside the text.
  // A personal link (@[text](url)) is an ordinary one for another server.
  return blocksHtml(resolvePersonalLinks(stripEmbeds(text)).split("\n"), 0);
}

const QUOTE_LINE = /^>( |$)/;
const MAX_QUOTE_DEPTH = 3;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+\.\s+(.*)$/;

/**
 * Whether a line opens a block of its own (the web's `RichText` uses the
 * same rule). A Spotify link alone on its line is one: the web draws the
 * player there, and other servers get it as a paragraph holding the link.
 */
function startsBlock(line: string): boolean {
  return (
    line.trim() === "" ||
    /^```/.test(line) ||
    /^#{1,3}\s/.test(line) ||
    QUOTE_LINE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    parseSpotifyUrl(line) !== null
  );
}

function blocksHtml(lines: string[], depth: number): string {
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    const fence = line.match(/^```\w*\s*$/);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i += 1;
      blocks.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length + 1; // the title is the h1
      blocks.push(`<h${level}>${inlineHtml(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }

    if (QUOTE_LINE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE_LINE.test(lines[i]!)) body.push(lines[i++]!.replace(/^> ?/, ""));
      blocks.push(
        depth < MAX_QUOTE_DEPTH
          ? `<blockquote>${blocksHtml(body, depth + 1)}</blockquote>`
          : `<blockquote><p>${inlineHtml(body.join("\n"))}</p></blockquote>`,
      );
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const pattern = NUMBERED.test(line) ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i]!.match(pattern);
        if (m) items.push(m[1]!);
        // An unmarked line under an item carries that item on.
        else if (!startsBlock(lines[i]!)) items[items.length - 1] += `\n${lines[i]!.trim()}`;
        else break;
        i += 1;
      }
      const lis = items.map((item) => `<li>${inlineHtml(item)}</li>`).join("");
      blocks.push(pattern === NUMBERED ? `<ol>${lis}</ol>` : `<ul>${lis}</ul>`);
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // The first line is taken unconditionally. One that only looks like a
    // block start (```js with text after it) matched no block above and
    // ended the paragraph before it began, so this loop never advanced —
    // and it runs inside the API and the worker, whole processes it hung.
    // A Spotify link alone on its line at the top level is a block of its
    // own (the web's player); here, the link in a paragraph by itself.
    if (depth === 0 && parseSpotifyUrl(line) !== null) {
      blocks.push(`<p>${inlineHtml(line.trim())}</p>`);
      i += 1;
      continue;
    }

    const paragraph: string[] = [lines[i++]!.trim()];
    while (i < lines.length && !startsBlock(lines[i]!)) paragraph.push(lines[i++]!.trim());
    blocks.push(`<p>${inlineHtml(paragraph.join("\n"))}</p>`);
  }

  return blocks.join("");
}

/**
 * A whole post as a Note's `content`: its title as the heading, then the
 * body. The title used to be left out, so on Mastodon a post was only its
 * text, and a post with none was only its title in a bare paragraph.
 */
export function postToActivityHtml(post: { title: string; body: string | null }): string {
  const title = post.title.trim();
  const body = post.body?.trim() ? markdownToActivityHtml(post.body) : "";
  return `${title ? `<h1>${escapeHtml(title)}</h1>` : ""}${body}` || "<p></p>";
}
