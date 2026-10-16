"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { FolderItemRow, type FolderItem } from "@/components/folders";
import { Loading } from "@/components/loading";

interface FolderDetail {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  items: FolderItem[];
}

export function FolderView({ params }: { params: { username: string; slug: string } }) {
  const { t } = useLocale();
  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ folder: FolderDetail }>(`/creators/${params.username}/folders/${params.slug}`)
      .then((res) => !cancelled && setFolder(res.folder))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : t("folders.loadError")));
    return () => {
      cancelled = true;
    };
  }, [params.username, params.slug, t]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!folder) return <Loading />;

  return (
    <div className="stack">
      <div>
        <Link href={`/${params.username}`} className="text-link meta">
          @{params.username}
        </Link>
        <h1 style={{ marginTop: 4 }}>{folder.title}</h1>
        {folder.description && <p className="lede">{folder.description}</p>}
      </div>

      {folder.items.length === 0 ? (
        <div className="empty-state">{t("folders.emptyPublic")}</div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {folder.items.map((item) => (
            <FolderItemRow key={item.id} item={item} username={params.username} />
          ))}
        </div>
      )}
    </div>
  );
}
