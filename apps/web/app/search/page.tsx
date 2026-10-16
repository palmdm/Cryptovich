"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { Avatar } from "@/components/avatar";
import { RichText } from "@/components/rich-text";
import { LockIcon, SearchIcon } from "@/components/icons";
import { postPathFor } from "@platform/shared";
import { Username } from "@/components/username";
import { Loading } from "@/components/loading";

interface Results {
  query: string;
  creators: { username: string; displayName: string; bio: string | null; avatarUrl: string | null; avatarFrame: string | null; publishedProductCount: number }[];
  posts: {
    id: string;
    title: string;
    slug: string;
    creatorUsername: string;
    creatorDisplayName: string;
    visibility: string;
    canAccess: boolean;
    excerpt: string | null;
    tags: { id: string; name: string }[];
  }[];
  tags: { id: string; name: string; postCount: number }[];
}

/**
 * One box, three kinds of answer: authors, posts and tags.
 *
 * The query lives in the URL, so a search is a link — it can be shared,
 * bookmarked and reached from the back button, which a box holding its
 * state in memory cannot do.
 */
export default function SearchPage() {
  const { t, tn } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get("q") ?? "";

  const [input, setInput] = useState(query);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(query);
  }, [query]);

  const load = useCallback(async () => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResults(await apiFetch<Results>(`/search?q=${encodeURIComponent(query)}`));
    } catch (err) {
      setError(localizedErrorMessage(err, t, "search.error"));
    } finally {
      setLoading(false);
    }
  }, [query, t]);

  useEffect(() => {
    load();
  }, [load]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(input.trim())}`);
  }

  const nothing =
    results && results.creators.length === 0 && results.posts.length === 0 && results.tags.length === 0;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1>{t("search.title")}</h1>

      <form className="search-form" onSubmit={submit}>
        <SearchIcon size={17} />
        <input
          aria-label={t("search.placeholder")}
          placeholder={t("search.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <button className="primary" type="submit">
          {t("search.submit")}
        </button>
      </form>

      {error && <div className="error-banner">{error}</div>}
      {loading && <Loading />}
      {!loading && query.trim().length < 2 && <p className="lede">{t("search.hint")}</p>}
      {!loading && nothing && <div className="empty-state">{t("search.nothing", { query })}</div>}

      {results && results.creators.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2>{t("search.authors")}</h2>
          {results.creators.map((creator) => (
            <Link key={creator.username} href={`/${creator.username}`} className="search-row">
              <Avatar url={creator.avatarUrl} name={creator.displayName} frame={creator.avatarFrame} size="sm" decorative />
              <span className="stack" style={{ gap: 2 }}>
                <strong>{creator.displayName}</strong>
                <span className="meta">
                  <Username username={creator.username} /> · {tn("profile.postsCount", creator.publishedProductCount)}
                </span>
              </span>
            </Link>
          ))}
        </section>
      )}

      {results && results.tags.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2>{t("search.tags")}</h2>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {results.tags.map((tag) => (
              <Link key={tag.id} href={`/search?q=${encodeURIComponent(tag.name)}`} className="chip">
                #{tag.name} {tag.postCount}
              </Link>
            ))}
          </div>
        </section>
      )}

      {results && results.posts.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2>{t("search.posts")}</h2>
          {results.posts.map((post) => (
            <article key={post.id} className="search-row search-post">
              <Link href={postPathFor(post.creatorUsername, post.id)} className="feed-card-title">
                {post.title}
              </Link>
              <span className="meta">
                <Link href={`/${post.creatorUsername}`}>{post.creatorDisplayName}</Link>
              </span>
              {/* A gated post keeps its place and its title; only the text
                  is withheld, and the server never sent it. */}
              {post.canAccess ? (
                post.excerpt && (
                  <div className="feed-card-body">
                    <RichText text={post.excerpt} creatorUsername={post.creatorUsername} />
                  </div>
                )
              ) : (
                <span className="meta row" style={{ gap: 6 }}>
                  <LockIcon size={14} />
                  {t("profile.forSupporters")}
                </span>
              )}
              {post.tags.length > 0 && (
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {post.tags.map((tag) => (
                    <Link key={tag.id} href={`/search?q=${encodeURIComponent(tag.name)}`} className="chip">
                      #{tag.name}
                    </Link>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
