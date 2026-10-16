"use client";

import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { postPathFor } from "@platform/shared";
import { isLocked } from "@/lib/product-access";
import type { ProductSummary } from "@/lib/types";
import { BookmarkButton } from "./bookmark-button";
import { CommentIcon, EyeIcon } from "./icons";
import { ImageGallery } from "./image-gallery";
import { useLocale } from "./locale-provider";
import { LockedPreview } from "./locked-preview";
import { ReactionBar } from "./reaction-bar";
import { RichText } from "./rich-text";
import { ShareButton } from "./share-button";
import { formatDate } from "@/lib/dates";

export interface FeedItem extends ProductSummary {
  creator: { username: string; displayName: string; avatarUrl: string | null; avatarFrame?: string | null };
}


/**
 * One post in a list that spans authors — the home feed and the saved
 * list. The author's own page draws its cards itself (it adds the pin and
 * edit controls), but everything a reader does without opening the post
 * is the same here: read the opening, see the pictures, react, save.
 */
export function FeedCard({ item: p, onBookmarkChange }: { item: FeedItem; onBookmarkChange?: (saved: boolean) => void }) {
  const { t, locale } = useLocale();
  const locked = isLocked(p);
  const href = postPathFor(p.creator.username, p.id);
  const images = p.images ?? [];
  const text = p.excerpt || p.description;

  return (
    <article className="feed-card">
      <div className="feed-card-head">
        <Link href={`/${p.creator.username}`} className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
          <Avatar url={p.creator.avatarUrl} name={p.creator.displayName} frame={p.creator.avatarFrame} size="sm" />
          <span className="feed-card-byline">
            <span className="feed-card-author" style={{ display: "block", fontWeight: 600, fontSize: "0.92rem" }}>
              {p.creator.displayName}
            </span>
            <span className="meta feed-card-date">{formatDate(p.publishedAt, locale)}</span>
          </span>
        </Link>
      </div>

      <Link href={href} className="feed-card-title">
        {p.title}
      </Link>

      {/* A gated post keeps its place and its price — only the body is
          withheld, and that happens server-side. */}
      {locked ? (
        <LockedPreview product={p} href={href} />
      ) : (
        <>
          {text && (
            <div className="feed-card-body">
              <RichText text={text} creatorUsername={p.creator.username} />
            </div>
          )}
          <ImageGallery images={images} total={p.imageCount} moreHref={href} />
          {p.hasMore && (
            <Link href={href} className="feed-card-more">
              {t("post.expand")}
            </Link>
          )}
        </>
      )}

      <ReactionBar productId={p.id} initial={p.reactions ?? { counts: [], mine: [] }} />

      <div className="action-bar">
        <Link href={href} className="action-item">
          <CommentIcon size={17} />
          {p.commentCount ?? 0}
        </Link>
        <ShareButton path={href} />
        <BookmarkButton productId={p.id} initial={Boolean(p.bookmarked)} onChange={onBookmarkChange} />
        {typeof p.viewCount === "number" && (
          <span className="action-views">
            <EyeIcon size={17} />
            {p.viewCount}
          </span>
        )}
      </div>
    </article>
  );
}
