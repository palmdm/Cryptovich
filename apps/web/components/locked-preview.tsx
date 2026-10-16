"use client";

import Link from "next/link";
import { LockIcon } from "./icons";
import { useLocale } from "./locale-provider";
import { uploadedImageSrc } from "@/lib/uploaded-image";
import { accessLabel, lockHeadingKey } from "@/lib/product-access";
import type { ProductSummary } from "@/lib/types";

/**
 * What a reader without access sees in place of a post: what it takes to
 * open it, and a button to go and do that. With a cover set, Boosty's
 * layout — the cover dimmed across the card, the lock panel over its
 * lower part. The cover is the author's public teaser; the body is never
 * sent, so there is nothing behind it to reveal.
 *
 * Given `href` (a card in a listing) the whole thing links to the post;
 * given `onOpen` (the post page) the button runs it — scrolling to the
 * sign-in, purchase or subscription below.
 */
export function LockedPreview({
  product,
  href,
  onOpen,
}: {
  product: ProductSummary;
  href?: string;
  onOpen?: () => void;
}) {
  const { t } = useLocale();
  const cover = product.coverUrl ? uploadedImageSrc(product.coverUrl) : null;
  const heading = product.visibility === "TIER" && product.requiredTier ? t("lock.needLevel") : t(lockHeadingKey(product));
  const className = `locked-card${cover ? " has-cover" : ""}`;

  const body = (
    <>
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="locked-cover" src={cover} alt="" aria-hidden="true" loading="lazy" />
      )}
      <div className="locked-panel">
        {!cover && (
          <span className="lock-badge">
            <LockIcon size={20} />
          </span>
        )}
        <span className="locked-need">{heading}</span>
        <strong className="locked-what">{accessLabel(product, t)}</strong>
        {href ? (
          <span className="locked-open">
            <LockIcon size={17} />
            {t("lock.openPost")}
          </span>
        ) : (
          <button type="button" className="locked-open" onClick={onOpen}>
            <LockIcon size={17} />
            {t("lock.openPost")}
          </button>
        )}
      </div>
    </>
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
