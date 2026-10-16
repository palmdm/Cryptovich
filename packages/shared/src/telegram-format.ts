import { stripEmbeds } from "./post-embeds.js";
import { resolvePersonalLinks } from "./personal-links.js";
import { isSafeHttpUrl } from "./safe-url.js";

/**
 * A post's text as a Telegram message (parse_mode HTML) and back: the
 * bridge sends new posts to members' chats, and turns what an author
 * writes to the bot into a post. Only what both sides share is carried —
 * bold, italic, strike-through, code, code blocks, links, quotes; lists
 * become "•" lines and headings bold lines in Telegram.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

function inlineHtml(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    out += escapeHtml(text.slice(last, match.index));
    const token = match[0];
    if (match[1]) out += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    else if (match[2]) out += `<b>${inlineHtml(token.slice(2, -2))}</b>`;
    else if (match[3]) out += `<s>${inlineHtml(token.slice(2, -2))}</s>`;
    else if (match[4]) out += `<i>${inlineHtml(token.slice(1, -1))}</i>`;
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      out += isSafeHttpUrl(link[2]!) ? `<a href="${escapeHtml(link[2]!).replace(/"/g, "&quot;")}">${inlineHtml(link[1]!)}</a>` : escapeHtml(token);
    }
    last = match.index! + token.length;
  }
  return out + escapeHtml(text.slice(last));
}

/** A post body as Telegram HTML. Files placed in the text are sent as files, so their lines are left out. */
export function markdownToTelegramHtml(text: string): string {
  const lines = resolvePersonalLinks(stripEmbeds(text)).replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i += 1;
      const lang = fence[1] ? ` class="language-${fence[1]}"` : "";
      out.push(`<pre><code${lang}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^>( |$)/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>( |$)/.test(lines[i]!)) quoted.push(inlineHtml(lines[i++]!.replace(/^> ?/, "")));
      out.push(`<blockquote>${quoted.join("\n")}</blockquote>`);
      continue;
    }
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    if (heading) out.push(`<b>${inlineHtml(heading[1]!)}</b>`);
    else if (/^[-*]\s+/.test(line)) out.push(`• ${inlineHtml(line.replace(/^[-*]\s+/, ""))}`);
    else out.push(inlineHtml(line));
    i += 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** One of Telegram's message entities (offsets in UTF-16 units, as JavaScript strings count). */
export interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  language?: string;
}

/**
 * What an author wrote to the bot, as a post's text: Telegram's entities
 * become the same marks the post editor writes. Underline, spoilers and
 * the like have no mark here and stay plain text.
 */
export function telegramToMarkdown(text: string, entities: TelegramEntity[] = []): string {
  type Insert = { at: number; rank: number; text: string };
  const inserts: Insert[] = [];
  // Longer entities open first and close last, so nested ones nest.
  const sorted = [...entities].sort((a, b) => a.offset - b.offset || b.length - a.length);
  sorted.forEach((e, n) => {
    const start = e.offset;
    const end = e.offset + e.length;
    const wrap = (open: string, close: string) => {
      inserts.push({ at: start, rank: 2 * n, text: open });
      inserts.push({ at: end, rank: -2 * n - 1, text: close });
    };
    switch (e.type) {
      case "bold":
        wrap("**", "**");
        break;
      case "italic":
        wrap("*", "*");
        break;
      case "strikethrough":
        wrap("~~", "~~");
        break;
      case "code":
        wrap("`", "`");
        break;
      case "pre":
        wrap(`\n\`\`\`${e.language ?? ""}\n`, "\n```\n");
        break;
      case "text_link":
        if (e.url && isSafeHttpUrl(e.url)) wrap("[", `](${e.url})`);
        break;
      case "blockquote":
      case "expandable_blockquote":
        inserts.push({ at: start, rank: 2 * n, text: "> " });
        for (let p = start; p < end; p++) if (text[p] === "\n") inserts.push({ at: p + 1, rank: 2 * n, text: "> " });
        break;
    }
  });
  // At one position: closings (innermost first), then openings (outermost first).
  inserts.sort((a, b) => a.at - b.at || a.rank - b.rank);
  let out = "";
  let last = 0;
  for (const insert of inserts) {
    out += text.slice(last, insert.at) + insert.text;
    last = insert.at;
  }
  out += text.slice(last);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
