/** Marks a post that came in from the author's other feed. */
export const IMPORTED_MARK = "🗻";
const HEADLINE_MAX = 100;

/**
 * A title and body for a post imported from a feed that has no titles —
 * a Mastodon or Sharkey post is just text.
 *
 * The title is the post's opening sentence, marked with 🗻, cut at a word
 * boundary only when that sentence is long. It used to be the first line
 * chopped at 80 characters, mid-word, and the same line then opened the
 * body too. When the title took the whole first line, the body starts
 * after it; otherwise the body is the full text.
 */
export function importedTitleAndBody(text: string): { title: string; body: string } {
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  const firstLine = (lines.find((line) => line.trim()) ?? "").trim();

  const sentence = firstLine.match(/^.+?[.!?…](?=\s|$)/u)?.[0] ?? firstLine;
  let headline = sentence;
  if ([...headline].length > HEADLINE_MAX) {
    const cut = [...headline].slice(0, HEADLINE_MAX).join("");
    const space = cut.lastIndexOf(" ");
    headline = `${(space > HEADLINE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }

  const title = headline ? `${IMPORTED_MARK} ${headline}` : IMPORTED_MARK;
  const body =
    headline === firstLine ? trimmed.slice(trimmed.indexOf(firstLine) + firstLine.length).trim() : trimmed;
  return { title, body };
}
