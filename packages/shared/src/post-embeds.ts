/**
 * An attachment placed in a post's text: `![[name]]` alone on a line (the
 * way Obsidian embeds a file) stands for the attachment of that file name,
 * shown right there — a picture, a player, a file to download. It names
 * the file rather than its id so it can be written before the file is
 * uploaded, and moved by moving the line.
 *
 * Other servers have no place for an attachment inside text: Mastodon
 * shows pictures under the post, Sharkey files too. So the federated text
 * leaves these lines out, and the Note carries every attachment as usual.
 */
export const EMBED_LINE = /^!\[\[([^\]\n]{1,255})\]\]\s*$/;

/** The file name an embed line names, or null for any other line. */
export function embedName(line: string): string | null {
  const match = EMBED_LINE.exec(line.trim());
  return match ? match[1]!.trim() : null;
}

/** The text without its embed lines — for an excerpt, another server, or deciding whether there is text at all. */
export function stripEmbeds(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => embedName(line) === null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Every file name a text embeds, in order. */
export function embeddedNames(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(embedName)
    .filter((name): name is string => name !== null);
}

/** Whether a post has words of its own, not only files placed in it. */
export function hasOwnText(text: string): boolean {
  return stripEmbeds(text).trim().length > 0;
}

/** The line that places a file in a text. */
export function embedLine(name: string): string {
  return `![[${name.replace(/[\]\n]/g, "")}]]`;
}
