"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "./session-provider";
import { useAuthPrompt } from "./auth-prompt";
import { RichText } from "./rich-text";
import { useLocale } from "@/components/locale-provider";
import { Username } from "./username";
import { formatDateTime } from "@/lib/dates";
import { Loading } from "@/components/loading";
import { ReportButton } from "./report-button";

interface CommentNode {
  id: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
  parentId: string | null;
  userId: string;
  user: { username: string };
  replies: CommentNode[];
}

/** Rendered only where the caller has already confirmed `access.allowed` —
 * comments follow the exact same gate as the post content itself. */
export function CommentThread({ productId, creatorUsername }: { productId: string; creatorUsername: string }) {
  const { user } = useSession();
  const { requireAccount } = useAuthPrompt();
  const { t, locale } = useLocale();
  const [comments, setComments] = useState<CommentNode[] | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ comments: CommentNode[] }>(`/products/${productId}/comments`);
      setComments(res.comments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("comments.loadError"));
    }
  }, [productId, t]);

  useEffect(() => {
    load();
  }, [load]);

  // A notification links to `#comment-<id>` (or `#comments`), but the
  // thread is fetched after the page renders, so the browser has nothing
  // to jump to yet: scroll once the comments are actually in.
  const [scrolledToHash, setScrolledToHash] = useState(false);
  useEffect(() => {
    if (comments === null || scrolledToHash) return;
    setScrolledToHash(true);
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith("comment")) return;
    document.getElementById(hash)?.scrollIntoView({ block: "center" });
  }, [comments, scrolledToHash]);

  async function post(text: string, parentId?: string) {
    if (!text.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/products/${productId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text, ...(parentId ? { parentId } : {}) }),
      });
      setBody("");
      setReplyBody("");
      setReplyTo(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("comments.postError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiFetch(`/comments/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("comments.deleteError"));
    }
  }

  const canModerate = user?.username === creatorUsername;

  function renderNode(node: CommentNode, depth: number): React.ReactNode {
    // A tombstone: the comment was deleted but still holds replies, so the
    // thread stays readable instead of losing its middle.
    if (node.deletedAt) {
      return (
        <div key={node.id} id={`comment-${node.id}`} className="comment" style={{ marginLeft: depth * 20 }}>
          <div className="card" style={{ padding: 12 }}>
            <span className="meta">{t("comments.deleted")}</span>
          </div>
          {node.replies.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    return (
      <div key={node.id} id={`comment-${node.id}`} className="comment" style={{ marginLeft: depth * 20 }}>
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>
              <Username username={node.user.username} focusable />
            </strong>
            <span className="meta">{formatDateTime(node.createdAt, locale)}</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <RichText text={node.body} creatorUsername={creatorUsername} />
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button
              className="link-button"
              onClick={() => requireAccount() && setReplyTo(replyTo === node.id ? null : node.id)}
            >
              {t("comments.reply")}
            </button>
            {(user?.id === node.userId || canModerate) && (
              <button className="link-button" style={{ color: "var(--danger)" }} onClick={() => remove(node.id)}>
                {t("common.delete")}
              </button>
            )}
            {user?.id !== node.userId && <ReportButton target="COMMENT" id={node.id} />}
          </div>

          {replyTo === node.id && (
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              <textarea
                rows={2}
                maxLength={10000}
                placeholder={t("comments.replyPlaceholder")}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
              />
              <div className="row" style={{ gap: 8 }}>
                <button className="primary" disabled={busy || !replyBody.trim()} onClick={() => post(replyBody, node.id)}>
                  {busy ? t("comments.submitting") : t("comments.submit")}
                </button>
                <button className="secondary" onClick={() => setReplyTo(null)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>

        {node.replies.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <div id="comments" className="stack" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{t("comments.title")}</h2>
      {error && <div className="error-banner">{error}</div>}

      {/* Shown signed out as well: starting to write asks for an account
          before anything is typed, rather than the form being absent. */}
      <form
        className="stack"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (requireAccount()) post(body);
        }}
      >
        <textarea
          rows={3}
          maxLength={10000}
          placeholder={t("comments.placeholder")}
          value={body}
          onFocus={(e) => {
            if (!user) {
              e.currentTarget.blur();
              requireAccount();
            }
          }}
          onChange={(e) => setBody(e.target.value)}
        />
        <button
          className="primary"
          type="submit"
          disabled={busy || (Boolean(user) && !body.trim())}
          style={{ alignSelf: "flex-start" }}
        >
          {busy ? t("comments.submitting") : t("comments.submit")}
        </button>
      </form>

      {comments === null && <Loading label={t("comments.loading")} />}
      {comments?.length === 0 && <p className="lede">{t("comments.empty")}</p>}
      {comments && comments.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>{comments.map((node) => renderNode(node, 0))}</div>
      )}
    </div>
  );
}
