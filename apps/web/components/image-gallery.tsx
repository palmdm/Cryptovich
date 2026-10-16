"use client";

import { useState } from "react";
import Link from "next/link";
import { API_URL } from "@/lib/api";
import { Lightbox } from "./lightbox";
import { useLocale } from "./locale-provider";

export interface GalleryImage {
  /** Path of the gated download route, as the API returned it. */
  url: string;
  alt: string;
}

/**
 * A post's pictures as a tiled block that opens in the viewer on click.
 *
 * `card` is what a listing shows without the post being opened: at most
 * the three the API sent, the last carrying "+N" for the rest. `full` is
 * the post page, every picture, in a grid that grows with the count.
 * Either way a lone picture keeps its own proportions instead of being
 * cropped into a tile.
 */
export function ImageGallery({
  images,
  total,
  moreHref,
  variant = "card",
}: {
  images: GalleryImage[];
  /** How many pictures the post has, when more than `images` carries. */
  total?: number;
  /** Where the "+N" tile goes: the card only carries three pictures, the post has them all. */
  moreHref?: string;
  variant?: "card" | "full";
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;

  const hidden = Math.max(0, (total ?? images.length) - images.length);
  const shown = variant === "card" ? images.slice(0, 3) : images;
  const layout = shown.length === 1 ? "one" : variant === "card" ? `n${shown.length}` : "many";

  return (
    <>
      <div className={`gallery is-${layout}`}>
        {shown.map((image, i) => {
          const overflow = variant === "card" && hidden > 0 && i === shown.length - 1;
          const img = (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${API_URL}${image.url}`} alt={image.alt} loading="lazy" draggable={false} />
          );
          const more = overflow ? (
            <span className="gallery-more" aria-hidden="true">
              +{hidden}
            </span>
          ) : null;
          if (overflow && moreHref) {
            return (
              <Link key={image.url} href={moreHref} className="gallery-item" aria-label={`${t("post.expand")} (+${hidden})`}>
                {img}
                {more}
              </Link>
            );
          }
          return (
            <button
              key={image.url}
              type="button"
              className="gallery-item"
              onClick={() => setOpen(i)}
              aria-label={`${t("gallery.open")}: ${image.alt}`}
            >
              {img}
              {more}
            </button>
          );
        })}
      </div>
      {open !== null && (
        <Lightbox
          images={shown.map((image) => ({ src: `${API_URL}${image.url}`, alt: image.alt }))}
          index={open}
          onIndexChange={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
