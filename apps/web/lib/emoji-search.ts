export interface UnicodeEmoji {
  emoji: string;
  name: string;
  slug: string;
  group: string;
}

export interface EmojiData {
  all: UnicodeEmoji[];
  /** The groups, in Unicode's own order, as the picker lists them. */
  groups: { group: string; emoji: UnicodeEmoji[] }[];
}

interface RawEmoji {
  name: string;
  slug: string;
  group: string;
}

interface RawGroup {
  name: string;
  slug: string;
  emojis: (RawEmoji & { emoji: string })[];
}

/**
 * Every Unicode emoji with its English name, from `unicode-emoji-json` —
 * the Unicode data itself, so nothing here is a hand-kept list that falls
 * behind.
 *
 * Loaded on demand, not with the page: it is ~90KB, and it is needed only
 * once someone opens the picker. The promise is kept, so a second opening
 * (or a second picker on the page) costs nothing.
 */
let pending: Promise<EmojiData> | null = null;

export function loadEmojiData(): Promise<EmojiData> {
  pending ??= Promise.all([
    import("unicode-emoji-json/data-by-emoji.json"),
    import("unicode-emoji-json/data-by-group.json"),
  ])
    .then(([byEmoji, byGroup]) => {
      const dataByEmoji = (byEmoji.default ?? byEmoji) as unknown as Record<string, RawEmoji>;
      const dataByGroup = (byGroup.default ?? byGroup) as unknown as Record<string, RawGroup>;
      const all = Object.entries(dataByEmoji).map(([emoji, data]) => ({
        emoji,
        name: data.name,
        slug: data.slug,
        group: data.group,
      }));
      const groups = Object.values(dataByGroup).map((group) => ({
        group: group.name,
        emoji: group.emojis.map((item) => ({ emoji: item.emoji, name: item.name, slug: item.slug, group: group.name })),
      }));
      return { all, groups };
    })
    .catch((err) => {
      // Not kept as a failure: opening the picker again should retry.
      pending = null;
      throw err;
    });
  return pending;
}

/** Matches a whole word first, then anywhere — "ice" before "police car". */
export function searchEmoji(all: UnicodeEmoji[], query: string, limit = 120): UnicodeEmoji[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: UnicodeEmoji[] = [];
  const contains: UnicodeEmoji[] = [];
  for (const item of all) {
    if (item.emoji === q) return [item];
    const haystack = `${item.slug} ${item.name.toLowerCase()}`;
    if (haystack.startsWith(q) || haystack.includes(`_${q}`) || haystack.includes(` ${q}`)) starts.push(item);
    else if (haystack.includes(q)) contains.push(item);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
