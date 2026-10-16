/**
 * Telegram's Bot API, as the bridge uses it: JSON calls, multipart sends
 * (a picture or a file read from storage) and file downloads. The address
 * is always api.telegram.org — nothing here is a URL anyone else chose.
 */
export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: number,
    /** Seconds Telegram asks to wait (429). */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const API = "https://api.telegram.org";
/** A bot may download files up to 20MB. */
const MAX_DOWNLOAD = 20 * 1024 * 1024;

export class TelegramBot {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async answer<T>(res: Response): Promise<T> {
    const body = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as {
      ok: boolean;
      result?: T;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    if (!body.ok) throw new TelegramError(body.description ?? "Telegram refused", body.error_code ?? res.status, body.parameters?.retry_after);
    return body.result as T;
  }

  async call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    const res = await this.fetcher(`${API}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return this.answer<T>(res);
  }

  async send<T>(method: string, form: FormData): Promise<T> {
    const res = await this.fetcher(`${API}/bot${this.token}/${method}`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    return this.answer<T>(res);
  }

  /** A file someone sent the bot, by its id. */
  async download(fileId: string): Promise<{ bytes: Buffer; path: string }> {
    const file = await this.call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
    if (!file.file_path) throw new TelegramError("Telegram has no path for that file", 400);
    if ((file.file_size ?? 0) > MAX_DOWNLOAD) throw new TelegramError("The file is over the 20MB a bot may download", 413);
    const res = await this.fetcher(`${API}/file/bot${this.token}/${file.file_path}`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new TelegramError(`HTTP ${res.status}`, res.status);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > MAX_DOWNLOAD) throw new TelegramError("The file is over the 20MB a bot may download", 413);
    return { bytes, path: file.file_path };
  }
}

/** The bot's own words, in the member's language as far as it has them. */
const WORDS = {
  ru: {
    linked: "Готово: этот чат привязан к аккаунту @{username}. Новые посты авторов, которых вы отслеживаете или на которых подписаны, будут приходить сюда. Настройки — на сайте, в Кабинете → Telegram.",
    badCode: "Код не подошёл или устарел. Получите новый на сайте: Кабинет → Telegram.",
    hello: "Это бот {site}. Чтобы привязать аккаунт, нажмите «Подключить Telegram» на сайте: Кабинет → Telegram.",
    unlinked: "Чат отвязан от аккаунта. Посты сюда больше не придут.",
    notLinked: "Этот чат пока не привязан к аккаунту. Подключите его на сайте: Кабинет → Telegram.",
    help: "Команды:\n/follow имя — отслеживать автора\n/unfollow имя — перестать\n/list — кого вы отслеживаете\n/stop — отвязать чат\n\nПубликовать посты отсюда можно, если включить это в Кабинете → Telegram: первая строка сообщения станет заголовком.",
    followed: "Теперь вы отслеживаете {name}.",
    unfollowed: "Вы больше не отслеживаете {name}.",
    noSuchAuthor: "Автора @{username} здесь нет.",
    notYourself: "Отслеживать себя нельзя.",
    following: "Вы отслеживаете:\n{list}",
    followingNone: "Вы пока никого не отслеживаете. /follow имя",
    publishOff: "Чтобы публиковать посты из Telegram, включите это на сайте: Кабинет → Telegram.",
    needsText: "Добавьте к сообщению текст: пост не может состоять из одних файлов. Первая строка станет заголовком.",
    published: "Пост опубликован: {url}",
    drafted: "Черновик сохранён: {url}",
    publishFailed: "Не получилось опубликовать: {reason}",
    openOnSite: "Открыть на сайте",
    readMore: "Читать дальше",
    locked: "🔒 Этот пост открыт подписчикам или покупателям.",
  },
  en: {
    linked: "Done: this chat is linked to @{username}. New posts of the authors you follow or subscribe to will arrive here. Settings are on the site: Dashboard → Telegram.",
    badCode: "That code did not work or has expired. Get a new one on the site: Dashboard → Telegram.",
    hello: "This is {site}'s bot. To link your account, press \"Connect Telegram\" on the site: Dashboard → Telegram.",
    unlinked: "This chat is unlinked. Posts will no longer arrive here.",
    notLinked: "This chat is not linked to an account yet. Connect it on the site: Dashboard → Telegram.",
    help: "Commands:\n/follow name — follow an author\n/unfollow name — stop\n/list — who you follow\n/stop — unlink this chat\n\nTo publish posts from here, turn it on in Dashboard → Telegram: a message's first line becomes the title.",
    followed: "You now follow {name}.",
    unfollowed: "You no longer follow {name}.",
    noSuchAuthor: "There is no author @{username} here.",
    notYourself: "You cannot follow yourself.",
    following: "You follow:\n{list}",
    followingNone: "You follow nobody yet. /follow name",
    publishOff: "To publish posts from Telegram, turn it on on the site: Dashboard → Telegram.",
    needsText: "Add some text: a post can't be only files. The first line becomes the title.",
    published: "Published: {url}",
    drafted: "Saved as a draft: {url}",
    publishFailed: "Could not publish: {reason}",
    openOnSite: "Open on the site",
    readMore: "Read more",
    locked: "🔒 This post is for subscribers or buyers.",
  },
  ja: {
    linked: "完了：このチャットは @{username} に連携されました。フォロー中・購読中の作者の新しい投稿がここに届きます。設定はサイトのダッシュボード → Telegram で。",
    badCode: "コードが無効か期限切れです。サイトのダッシュボード → Telegram で新しいコードを取得してください。",
    hello: "{site} のボットです。アカウントを連携するには、サイトのダッシュボード → Telegram で「Telegramを接続」を押してください。",
    unlinked: "このチャットの連携を解除しました。投稿は届かなくなります。",
    notLinked: "このチャットはまだ連携されていません。サイトのダッシュボード → Telegram で接続してください。",
    help: "コマンド：\n/follow 名前 — 作者をフォロー\n/unfollow 名前 — フォロー解除\n/list — フォロー中の作者\n/stop — チャットの連携を解除\n\nここから投稿するには、ダッシュボード → Telegram で有効にしてください。最初の行がタイトルになります。",
    followed: "{name} をフォローしました。",
    unfollowed: "{name} のフォローを解除しました。",
    noSuchAuthor: "作者 @{username} は見つかりません。",
    notYourself: "自分自身はフォローできません。",
    following: "フォロー中：\n{list}",
    followingNone: "まだ誰もフォローしていません。/follow 名前",
    publishOff: "Telegramから投稿するには、サイトのダッシュボード → Telegram で有効にしてください。",
    needsText: "本文を追加してください。ファイルだけの投稿はできません。最初の行がタイトルになります。",
    published: "公開しました：{url}",
    drafted: "下書きを保存しました：{url}",
    publishFailed: "公開できませんでした：{reason}",
    openOnSite: "サイトで開く",
    readMore: "続きを読む",
    locked: "🔒 この投稿は購読者・購入者向けです。",
  },
} as const;

export type BotWord = keyof (typeof WORDS)["en"];

export function botWords(languageCode: string | null | undefined) {
  const lang = languageCode?.slice(0, 2);
  const table = lang === "ru" || lang === "uk" || lang === "be" ? WORDS.ru : lang === "ja" ? WORDS.ja : WORDS.en;
  return (word: BotWord, vars: Record<string, string> = {}) => table[word].replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");
}
