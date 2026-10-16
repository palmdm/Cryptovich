"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { PostComposer } from "@/components/post-composer";
import { postPathFor } from "@platform/shared";

export default function NewPostPage() {
  const { t } = useLocale();
  const { user } = useSession();
  const router = useRouter();

  return (
    <div className="stack">
      <h1>{t("newPost.title")}</h1>
      <PostComposer onPublished={(post) => router.push(postPathFor(user?.username ?? "", post.id))} />
    </div>
  );
}
