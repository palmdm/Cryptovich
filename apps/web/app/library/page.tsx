"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { AuthRequired } from "@/components/auth-prompt";
import { Loading } from "@/components/loading";

interface LibraryItem {
  entitlementId: string;
  sourceType: string;
  grantedAt: string;
  product: { title: string; slug: string; type: string; creatorId: string } | null;
}

export default function LibraryPage() {
  const { user, loading: sessionLoading } = useSession();
  const { t } = useLocale();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ items: LibraryItem[] }>("/library")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : t("library.loadError")));
  }, [user, t]);

  if (sessionLoading) return <Loading />;
  if (!user) return <AuthRequired />;

  return (
    <div className="stack">
      <h1>{t("library.title")}</h1>
      {error && <div className="error-banner">{error}</div>}
      {items?.length === 0 && <div className="empty-state">{t("library.empty")}</div>}
      {items && items.length > 0 && (
        <div className="product-grid">
          {items.map((item) => (
            <div key={item.entitlementId} className="product-card">
              <strong>{item.product?.title}</strong>
              <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>via {item.sourceType.toLowerCase()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
