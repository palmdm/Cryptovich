"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { useLocale } from "./locale-provider";
import { RichText } from "./rich-text";
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  CodeIcon,
  LinkIcon,
  HeadingIcon,
  QuoteIcon,
  ListIcon,
  CodeBlockIcon,
  TableIcon,
  SmileIcon,
  MusicIcon,
} from "./icons";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { EmojiPicker } from "./emoji-picker";
import { ShortcodeSuggest, shortcodeAtCaret, type Suggestion } from "./shortcode-suggest";
import { embedLine, parseSpotifyUrl, spotifyUrl } from "@platform/shared";
import { LengthRing, usePostLimit } from "./length-ring";

interface ToolbarAction {
  labelKey: TranslationKey;
  icon: (props: { size?: number }) => React.ReactElement;
  /** Wraps the selection, or inserts at the caret when nothing is selected. */
  before: string;
  after?: string;
  /** Prefixes each selected line instead of wrapping (lists, quotes, headings). */
  linePrefix?: string;
  sample: string;
  /** Inserted verbatim on its own lines, ignoring any selection (tables). */
  block?: string;
}

const TABLE_SKELETON = ["| Column | Column |", "| --- | --- |", "| Cell | Cell |"].join("\n");

const ACTIONS: ToolbarAction[] = [
  { labelKey: "editor.bold", icon: BoldIcon, before: "**", after: "**", sample: "bold text" },
  { labelKey: "editor.italic", icon: ItalicIcon, before: "*", after: "*", sample: "italic text" },
  { labelKey: "editor.strikethrough", icon: StrikethroughIcon, before: "~~", after: "~~", sample: "struck text" },
  { labelKey: "editor.inlineCode", icon: CodeIcon, before: "`", after: "`", sample: "code" },
  { labelKey: "editor.link", icon: LinkIcon, before: "[", after: "](https://example.com)", sample: "link text" },
  { labelKey: "editor.heading", icon: HeadingIcon, before: "", linePrefix: "## ", sample: "Heading" },
  { labelKey: "editor.quote", icon: QuoteIcon, before: "", linePrefix: "> ", sample: "Quoted" },
  { labelKey: "editor.bullets", icon: ListIcon, before: "", linePrefix: "- ", sample: "List item" },
  { labelKey: "editor.codeBlock", icon: CodeBlockIcon, before: "```js\n", after: "\n```", sample: "const x = 1;" },
  { labelKey: "editor.table", icon: TableIcon, before: "", sample: "", block: TABLE_SKELETON },
];

/**
 * A plain-textarea editor with a formatting toolbar and a live preview.
 *
 * Deliberately not a contenteditable rich-text surface: the body is
 * stored and federated as text, and the preview renders through exactly
 * the same component readers see, so what an author previews is what
 * publishes. A WYSIWYG editor would need an HTML model on both sides and
 * a sanitiser between them.
 */
export interface PostEditorHandle {
  /** Places files in the text at the caret, each on a line of its own (`![[name]]`). */
  place: (names: string[]) => void;
}

export const PostEditor = forwardRef<PostEditorHandle, {
  value: string;
  onChange: (next: string) => void;
  /** Whose custom emoji the preview should resolve. */
  previewAs: string;
  rows?: number;
  id?: string;
  /**
   * Images pasted or dropped straight into the text area. Given, the
   * editor accepts them the way GitHub's comment box does — a screenshot
   * on the clipboard becomes an attachment without a trip to the file
   * picker. Without it, paste behaves as plain text paste. It answers the
   * names the files were taken under, and each is placed in the text
   * where it was pasted or dropped.
   */
  onFiles?: (files: File[]) => string[] | void;
}>(function PostEditor({ value, onChange, previewAs, rows = 14, id = "content", onFiles }, handle) {
  const { t } = useLocale();
  const maxChars = usePostLimit();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // What `:shortcode` the caret is inside, if any, and which suggestion the
  // arrow keys have landed on.
  const [suggest, setSuggest] = useState<{ query: string; from: number } | null>(null);
  const [active, setActive] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  /** Puts `text` in at the caret (replacing `replaceFrom`… if given). */
  function insert(text: string, replaceFrom?: number) {
    const el = ref.current;
    if (!el) return;
    const start = replaceFrom ?? el.selectionStart;
    const end = el.selectionEnd;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    const caret = start + text.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  /** Files at the caret, each `![[name]]` on a line of its own. */
  function placeFiles(names: string[] | void) {
    const el = ref.current;
    if (!el || !names || names.length === 0) return;
    const start = el.selectionStart ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(el.selectionEnd ?? start);
    const lead = before === "" || before.endsWith("\n") ? "" : "\n";
    const trail = after === "" || after.startsWith("\n") ? "" : "\n";
    insert(lead + names.map(embedLine).join("\n") + trail);
  }

  useImperativeHandle(handle, () => ({ place: placeFiles }));

  /** Asks for a Spotify link and puts it on a line of its own at the caret. */
  function insertSpotify() {
    const link = window.prompt(t("editor.spotifyPrompt"), "https://open.spotify.com/");
    if (link === null) return;
    const spotify = parseSpotifyUrl(link);
    if (!spotify) {
      window.alert(t("editor.spotifyInvalid"));
      return;
    }
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const before = value.slice(0, start);
    const lead = before === "" || before.endsWith("\n") ? "" : "\n";
    insert(`${lead}${spotifyUrl(spotify)}\n`);
  }

  function updateSuggest(el: HTMLTextAreaElement) {
    const found = shortcodeAtCaret(el.value, el.selectionStart);
    setSuggest(found);
    setActive(0);
  }

  function pickSuggestion(text: string) {
    // A sticker goes in whole; an emoji needs no trailing colon.
    insert(text, suggest?.from);
    setSuggest(null);
  }

  const onSuggestions = useCallback((list: Suggestion[]) => setSuggestions(list), []);

  function apply(action: ToolbarAction) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);

    let next: string;
    let caret: number;

    if (action.block) {
      // A table only makes sense as whole lines, so it is inserted at the
      // start of the caret's line with blank lines around it rather than
      // wrapping whatever happened to be selected.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const before = value.slice(0, lineStart);
      const after = value.slice(lineStart);
      const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
      const trail = after.startsWith("\n") ? "\n" : "\n\n";
      const body = `${lead}${action.block}${trail}`;
      onChange(before + body + after);
      const caretAt = before.length + lead.length;
      requestAnimationFrame(() => {
        el.focus();
        // Land on the first header cell so typing replaces it.
        el.setSelectionRange(caretAt + 2, caretAt + 8);
      });
      return;
    }

    if (action.linePrefix) {
      // Prefix every line the selection touches, so a multi-line
      // selection becomes a whole list rather than one prefixed line.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const body = (selected || action.sample).split("\n").map((l) => `${action.linePrefix}${l}`).join("\n");
      next = value.slice(0, lineStart) + body + value.slice(Math.max(end, lineStart));
      caret = lineStart + body.length;
    } else {
      const body = selected || action.sample;
      next = value.slice(0, start) + action.before + body + (action.after ?? "") + value.slice(end);
      // With nothing selected, leave the sample text selected so typing
      // replaces it.
      caret = start + action.before.length + body.length;
    }

    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const selectSample = !selected;
      const from = selectSample ? caret - (action.sample.length) : caret;
      el.setSelectionRange(from, caret);
    });
  }

  return (
    <div className="editor">
      <div className="editor-toolbar">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          // The glyph alone never carries the meaning — every button
          // keeps its translated name for screen readers and on hover.
          const label = t(action.labelKey);
          return (
            <button
              key={action.labelKey}
              type="button"
              className="editor-tool"
              onClick={() => apply(action)}
              aria-label={label}
              title={label}
            >
              <Icon size={16} />
            </button>
          );
        })}
        {/* A Spotify link on its own line becomes the player in the post. */}
        <button type="button" className="editor-tool" onClick={insertSpotify} aria-label={t("editor.spotify")} title={t("editor.spotify")}>
          <MusicIcon size={16} />
        </button>
        <span className="editor-emoji-wrap">
          <button
            type="button"
            className={`editor-tool${pickerOpen ? " active" : ""}`}
            aria-label={t("editor.emoji")}
            title={t("editor.emoji")}
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
          >
            <SmileIcon size={16} />
          </button>
          {pickerOpen && (
            <span className="editor-emoji-picker">
              <EmojiPicker
                onPick={(picked) => {
                  insert(picked);
                  setPickerOpen(false);
                }}
                onClose={() => setPickerOpen(false)}
              />
            </span>
          )}
        </span>
        <button
          type="button"
          className={`editor-tool is-text${preview ? " active" : ""}`}
          style={{ marginLeft: "auto" }}
          onClick={() => setPreview((v) => !v)}
        >
          {preview ? t("editor.write") : t("editor.preview")}
        </button>
      </div>

      {preview ? (
        <div className="editor-preview">
          {value.trim() ? <RichText text={value} creatorUsername={previewAs} /> : <p className="meta">{t("editor.nothingYet")}</p>}
        </div>
      ) : (
        <div className="editor-area">
        <textarea
          id={id}
          ref={ref}
          rows={rows}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            updateSuggest(e.target);
          }}
          onKeyDown={(e) => {
            // While the suggestion list is up it owns the arrow keys,
            // Enter and Tab; Escape puts it away without losing the text.
            if (!suggest || suggestions.length === 0) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pickSuggestion(suggestions[active]!.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setSuggest(null);
            }
          }}
          onClick={(e) => updateSuggest(e.currentTarget)}
          onBlur={() => setSuggest(null)}
          onPaste={(e) => {
            if (!onFiles) return;
            // Only when the clipboard actually carries files: copying text
            // from a page also puts an `image/*` *type* on the clipboard,
            // and swallowing that would break ordinary paste.
            const files = Array.from(e.clipboardData.files);
            if (files.length === 0) return;
            e.preventDefault();
            placeFiles(onFiles(files));
          }}
          onDragOver={(e) => {
            if (onFiles && e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!onFiles) return;
            const files = Array.from(e.dataTransfer.files);
            if (files.length === 0) return;
            e.preventDefault();
            placeFiles(onFiles(files));
          }}
          spellCheck
          className="editor-textarea"
        />
        {suggest && (
          <ShortcodeSuggest query={suggest.query} active={active} onPick={pickSuggestion} onCount={onSuggestions} />
        )}
        </div>
      )}

      {/* The hint, and the length against the server's limit at its end. */}
      <div className="editor-foot">
        <span className="meta">{t("editor.hint")}</span>
        <LengthRing text={value} max={maxChars} />
      </div>
    </div>
  );
});
