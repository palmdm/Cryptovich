"use client";

import { RichText } from "@/components/rich-text";
import { useLocale } from "@/components/locale-provider";

/** policy.md, through the same renderer as a post: no HTML is trusted. */
export function PolicyView({ title, body }: { title: string | null; body: string }) {
  const { t } = useLocale();
  return (
    <article className="card policy">
      <h1>{title ?? t("policy.title")}</h1>
      {body && <RichText text={body} creatorUsername="" />}
    </article>
  );
}
