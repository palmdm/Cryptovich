"use client";

import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { Loading } from "@/components/loading";
import { CategoryManager } from "@/components/taxonomy-editor";
import { FundraisingManager } from "@/components/fundraising-manager";
import { FolderManager } from "@/components/folders";

/**
 * Кабинет → «Папки, цели и разделы»: how an author arranges their page,
 * in one place — folders of posts, fundraising goals, and the sections
 * (categories) posts are filed under. They were three long cards on the
 * overview, between the profile and the list of posts.
 */
export default function OrganizePage() {
  const { t } = useLocale();
  const { user, loading } = useSession();
  if (loading || !user) return <Loading />;
  return (
    <div className="stack">
      <h1>{t("dashboard.organize")}</h1>
      <p className="lede" style={{ margin: 0 }}>{t("dashboard.organizeLede")}</p>
      <FolderManager canUpload={user.canUploadFiles} username={user.username} />
      <FundraisingManager />
      <CategoryManager />
    </div>
  );
}
