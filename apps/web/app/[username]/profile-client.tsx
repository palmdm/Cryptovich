"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { uploadedImageSrc } from "@/lib/uploaded-image";
import { DonateBox } from "@/components/donate-box";
import { Avatar } from "@/components/avatar";
import { SubscribeBox } from "@/components/subscribe-box";
import { ShareButton } from "@/components/share-button";
import { FundraisingGoals } from "@/components/fundraising-goal";
import { CreatorRewards, RewardButton } from "@/components/rewards";
import { ProfileAbout, type CreatorAbout } from "@/components/profile-about";
import { SpotifyEmbed } from "@/components/spotify-embed";
import { FolderList } from "@/components/folders";
import { AchievementBadges } from "@/components/achievements";
import { EngagementStatsModal } from "@/components/engagement-stats-modal";
import { ReactionBar } from "@/components/reaction-bar";
import { CommentIcon, EyeIcon, PencilIcon, TrashIcon, PinIcon, PlusIcon, PackageIcon } from "@/components/icons";
import { useLocale } from "@/components/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { isLocked } from "@/lib/product-access";
import { RichText } from "@/components/rich-text";
import { useSession } from "@/components/session-provider";
import { safeHttpUrl, postPathFor, profileLinksFrom , parseSpotifyUrl } from "@platform/shared";
import { formatMoney } from "@/lib/money";
import type { ProductSummary, TaxonomyRef } from "@/lib/types";
import { PinButton } from "@/components/pin-button";
import { LockedPreview } from "@/components/locked-preview";
import { ImageGallery } from "@/components/image-gallery";
import { BookmarkButton } from "@/components/bookmark-button";
import { Username } from "@/components/username";
import { formatDate } from "@/lib/dates";
import { Loading } from "@/components/loading";
import { ReportButton } from "@/components/report-button";
import { ServiceIcon, serviceName } from "@/components/service-icon";
import { FollowButton } from "@/components/follow-button";
import { SalePrice } from "@/components/sale-price";

interface PublicDonation {
  id: string;
  amountMinor: string;
  currency: string;
  message: string | null;
  senderUsername: string | null;
  createdAt: string;
}

interface SubscriptionTier {
  id: string;
  name: string;
  description: string | null;
  imageUrl?: string | null;
  currency: string;
  amountMinor: string;
  period: "MONTH" | "YEAR";
  discountPercent?: number | null;
  discountEndsAt?: string | null;
}

interface CreatorPublicProfile {
  username: string;
  displayName: string;
  bio: string | null;
  links?: unknown;
  avatarUrl: string | null;
  avatarFrame: string | null;
  coverUrl: string | null;
  achievements: import("@platform/shared").AchievementProgress[];
  chatUrl: string | null;
  subscriberCount: number | null;
  publishedProductCount: number;
  about?: CreatorAbout;
  /** A Spotify track, album or playlist the author shows on their page. */
  spotifyUrl?: string | null;
}

type Tab = "posts" | "membership" | "tips";


export function CreatorProfile({ params }: { params: { username: string } }) {
  const router = useRouter();
  const [creator, setCreator] = useState<CreatorPublicProfile | null>(null);
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [donations, setDonations] = useState<PublicDonation[]>([]);
  const [tiers, setTiers] = useState<SubscriptionTier[]>([]);
  const [tab, setTab] = useState<Tab>("posts");
  const [categories, setCategories] = useState<(TaxonomyRef & { postCount: number })[]>([]);
  // null means "everything"; a slug narrows the feed to one section.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const { t, tn, locale } = useLocale();
  const { theme } = useTheme();
  const { user } = useSession();
  // Which of the author's own posts has its breakdown open.
  const [statsFor, setStatsFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A refused pin, shown above the posts rather than instead of the page.
  const [pinError, setPinError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  /**
   * A page of the author's posts, under whatever filter is on. With a
   * cursor the page is appended; without one it replaces what is there.
   *
   * The impressions for the page go out from here, in one call — the page
   * used to send one per card, and an author with hundreds of posts spent
   * the reader's whole rate-limit budget on its own beacons.
   */
  const fetchProducts = useCallback(
    async (cursor?: string) => {
      const query = new URLSearchParams();
      if (activeCategory) query.set("category", activeCategory);
      if (activeTag) query.set("tag", activeTag);
      if (cursor) query.set("cursor", cursor);
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const res = await apiFetch<{ products: ProductSummary[]; nextCursor: string | null }>(
        `/store/${params.username}${suffix}`,
      );
      setProducts((prev) => (cursor && prev ? [...prev, ...res.products] : res.products));
      setNextCursor(res.nextCursor);
      if (res.products.length > 0) {
        apiFetch("/products/impressions", {
          method: "POST",
          body: JSON.stringify({ productIds: res.products.map((p) => p.id) }),
        }).catch(() => {});
      }
      return res;
    },
    [activeCategory, activeTag, params.username],
  );

  useEffect(() => {
    async function load() {
      try {
        // Resolved first and alone: if this name is historical, the API
        // hands back the owner's *current* username here, and every other
        // fetch below (and the address bar) should use that, not the
        // possibly-stale one from the URL.
        const creatorRes = await apiFetch<{ creator: CreatorPublicProfile }>(`/creators/${params.username}`);
        if (creatorRes.creator.username !== params.username) {
          router.replace(`/${creatorRes.creator.username}`);
          return;
        }

        const [donationsRes, tiersRes] = await Promise.all([
          apiFetch<{ donations: PublicDonation[] }>(`/donations/public/${params.username}`),
          apiFetch<{ tiers: SubscriptionTier[] }>(`/subscriptions/tiers/${params.username}`),
        ]);
        const categoryRes = await apiFetch<{ categories: (TaxonomyRef & { postCount: number })[] }>(
          `/categories/${params.username}`,
        );
        setCategories(categoryRes.categories);
        setCreator(creatorRes.creator);
        setDonations(donationsRes.donations);
        setTiers(tiersRes.tiers);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("profile.loadError"));
      }
    }
    load();
  }, [params.username, t, router]);

  // The posts load on their own, here: this runs on mount and again
  // whenever a filter changes, and filtering re-queries rather than
  // filtering in the browser, so a section shows every post in it — not
  // just the ones already loaded.
  useEffect(() => {
    fetchProducts().catch(() => {});
  }, [fetchProducts]);

  async function deletePost(product: ProductSummary) {
    if (!window.confirm(t("post.deleteConfirm", { title: product.title }))) return;
    setDeleting(product.id);
    try {
      await apiFetch(`/products/${product.id}`, { method: "DELETE" });
      setProducts((prev) => prev?.filter((x) => x.id !== product.id) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("post.deleteError"));
    } finally {
      setDeleting(null);
    }
  }

  /** The listing again, under the current filter — pins change its order. */
  function reloadProducts() {
    fetchProducts().catch(() => {});
  }

  function clearFilters() {
    setActiveCategory(null);
    setActiveTag(null);
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!creator) return <Loading />;

  // VK's arrangement — photo and buttons in a column on the left, facts
  // and the posts on the right — for the VK theme and, at the operator's
  // choice, for Warcraft's. Every other theme has Boosty's: three columns,
  // the author on the left, the posts in the middle, the tiers on the right.
  const columns = theme === "vk_classic" || theme.startsWith("wc3_");

  // Only tabs with something behind them are offered — an empty tab is a
  // dead end the reader has to discover by clicking.
  const tabs: { id: Tab; label: string }[] = [
    // Just "Posts": the count sits right above it in the stats row, and
    // "Posts 1" next to "1 post" read as two different numbers.
    //
    // Except in the VKontakte theme, where that tab is the wall — the
    // theme is a period piece, and its own vocabulary is part of it.
    { id: "posts", label: t(theme === "vk_classic" ? "profile.tabWall" : "profile.tabPosts") },
    // The tiers are a tab only in VK's arrangement; everywhere else they
    // are a column of their own beside the posts, as on Boosty.
    ...(tiers.length > 0 && columns ? [{ id: "membership" as Tab, label: t("profile.tabMembership") }] : []),
    ...(donations.length > 0 ? [{ id: "tips" as Tab, label: t("profile.tabTips") }] : []),
  ];
  const activeTab = tabs.some((x) => x.id === tab) ? tab : "posts";
  const isOwnPage = user?.username === creator.username;

  // What can be done here, as one row of round icon buttons — labelled
  // for screen readers and by a tooltip. As words they were five buttons
  // that filled most of a phone's first screen.
  const chatUrl = safeHttpUrl(creator.chatUrl);
  const actions = (
    <div className="profile-actions" role="group" aria-label={t("profile.actions")}>
      {/* Your own page is where you write from. */}
      {isOwnPage && (
        <Link href="/dashboard/new-post" className="profile-action" aria-label={t("dashboard.newPost")} title={t("dashboard.newPost")}>
          <PlusIcon size={19} />
        </Link>
      )}
      {/* A bundle gathers posts of this page, so it is made from here too. */}
      {isOwnPage && (
        <Link href="/dashboard/new-bundle" className="profile-action" aria-label={t("dashboard.newBundle")} title={t("dashboard.newBundle")}>
          <PackageIcon size={19} />
        </Link>
      )}
      <DonateBox creatorUsername={creator.username} variant="icon" />
      {!isOwnPage && <RewardButton creatorUsername={creator.username} variant="icon" />}
      {/* The author's own contact link — re-checked here because a row
          could predate URL-scheme validation. */}
      {chatUrl && (
        <a className="profile-action" href={chatUrl} target="_blank" rel="noreferrer noopener" aria-label={t("profile.chat")} title={t("profile.chat")}>
          <CommentIcon size={19} />
        </a>
      )}
      <ShareButton path={`/${creator.username}`} variant="icon" />
    </div>
  );
  // Following for free — its own button, in words: the one thing on the
  // page a reader may want without paying.
  const follow = isOwnPage ? null : (
    <div className="profile-follow">
      <FollowButton username={creator.username} />
    </div>
  );
  const handle = (
    <div className="profile-handle">
      <Username username={creator.username} focusable />
      <AchievementBadges achievements={creator.achievements ?? []} />
    </div>
  );
  const title = (
    <div className="profile-title">
      <h1>{creator.displayName}</h1>
      {handle}
    </div>
  );
  const bio = creator.bio ? (
    <div className="profile-bio" style={{ maxWidth: "60ch" }}>
      <RichText text={creator.bio} creatorUsername={creator.username} />
    </div>
  ) : null;
  // The author's own places, each with its service's mark (GitHub,
  // YouTube, Telegram…) or a plain link icon.
  const links =
    profileLinksFrom(creator.links).length > 0 ? (
      <ul className="profile-links">
        {profileLinksFrom(creator.links).map((link) => (
          <li key={`${link.label}-${link.url}`}>
            <a href={link.url} target="_blank" rel="me noopener noreferrer" title={serviceName(link.url) ?? undefined}>
              <ServiceIcon url={link.url} />
              {link.label}
              <span className="link-host">{new URL(link.url).hostname.replace(/^www\./, "")}</span>
            </a>
          </li>
        ))}
      </ul>
    ) : null;
  const wall = (
    <>
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={activeTab === x.id}
            className={`tab${activeTab === x.id ? " active" : ""}`}
            onClick={() => setTab(x.id)}
          >
            {x.label}
          </button>
        ))}
        {/* The counts end the posts' own band, in every theme — VK's
            place for them. Boosty's arrangement says the subscribers
            under the name, so here only the posts. */}
        <span className="tabs-aside">
          {columns && creator.subscriberCount !== null && <>{tn("profile.subscribersCount", creator.subscriberCount)} · </>}
          {tn("profile.postsCount", creator.publishedProductCount)}
        </span>
      </div>

      {activeTab === "posts" && (
        <div className="stack" style={{ gap: 12 }}>
          {(categories.length > 0 || activeTag) && (
            <div className="row" style={{ gap: 8 }}>
              <button
                className={`chip${!activeCategory && !activeTag ? " selected" : ""}`}
                onClick={clearFilters}
              >
                {t("taxonomy.allPosts")}
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={`chip${activeCategory === c.slug ? " selected" : ""}`}
                  onClick={() => {
                    setActiveTag(null);
                    setActiveCategory(c.slug ?? null);
                  }}
                >
                  {c.name} {c.postCount}
                </button>
              ))}
              {activeTag && <span className="chip selected">#{activeTag}</span>}
            </div>
          )}
          {pinError && <div className="error-banner">{pinError}</div>}
          {products?.length === 0 && <div className="empty-state">{t("profile.noPosts")}</div>}
          {products?.map((p) => {
            const locked = isLocked(p);
            const href = postPathFor(creator.username, p.id);
            return (
              <article key={p.id} className="feed-card">
                <div className="feed-card-head">
                  <Avatar url={creator.avatarUrl} name={creator.displayName} frame={creator.avatarFrame} size="sm" decorative />
                  <div className="feed-card-byline">
                    <div className="feed-card-author" style={{ fontWeight: 600, fontSize: "0.92rem" }}>
                      {creator.displayName}
                    </div>
                    <div className="meta feed-card-date">{formatDate(p.publishedAt, locale)}</div>
                  </div>
                  {p.pinned && (
                    <span className="pinned-badge" style={{ marginLeft: "auto" }}>
                      <PinIcon size={13} />
                      {t("post.pinned")}
                    </span>
                  )}
                </div>

                <Link href={href} className="feed-card-title">
                  {p.title}
                </Link>

                {locked ? (
                  <LockedPreview product={p} href={href} />
                ) : (
                  // The post itself, as far as a card shows it — a listing
                  // that only carried the title made every post a click to
                  // find out what it said.
                  <>
                    {(p.excerpt || p.description) && (
                      <div className="feed-card-body">
                        <RichText text={p.excerpt || p.description || ""} creatorUsername={creator.username} />
                      </div>
                    )}
                    <ImageGallery images={p.images ?? []} total={p.imageCount} moreHref={href} />
                    {p.hasMore && (
                      <Link href={href} className="feed-card-more">
                        {t("post.expand")}
                      </Link>
                    )}
                  </>
                )}

                {p.tags && p.tags.length > 0 && (
                  <div className="row" style={{ gap: 6 }}>
                    {p.tags.map((tag) => (
                      <button
                        key={tag.id}
                        className="chip"
                        style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                        onClick={() => {
                          setActiveCategory(null);
                          setActiveTag(tag.name);
                        }}
                      >
                        #{tag.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* The whole reaction row, live in the feed: every
                    reaction already placed is visible and a new one can
                    be added without opening the post. */}
                <ReactionBar productId={p.id} initial={p.reactions ?? { counts: [], mine: [] }} />

                <div className="action-bar">
                  <Link href={href} className="action-item">
                    <CommentIcon size={17} />
                    {p.commentCount ?? 0}
                  </Link>
                  <ShareButton path={href} />
                  <BookmarkButton productId={p.id} initial={Boolean(p.bookmarked)} />
                  {/* The author gets the same controls the post page
                      offers, so managing a post never requires opening
                      it first. Nobody else sees them at all. */}
                  {isOwnPage && (
                    <PinButton
                      productId={p.id}
                      pinned={Boolean(p.pinned)}
                      onChange={reloadProducts}
                      onError={setPinError}
                    />
                  )}
                  {isOwnPage && (
                    <Link
                      href={`/dashboard/posts/${p.id}/edit`}
                      className="action-item is-icon"
                      aria-label={t("post.edit")}
                      title={t("post.edit")}
                    >
                      <PencilIcon size={17} />
                    </Link>
                  )}
                  {isOwnPage && (
                    <button
                      type="button"
                      className="action-item is-icon is-danger"
                      onClick={() => deletePost(p)}
                      disabled={deleting === p.id}
                      aria-label={deleting === p.id ? t("post.deleting") : t("post.delete")}
                      title={t("post.delete")}
                    >
                      <TrashIcon size={17} />
                    </button>
                  )}
                  {typeof p.viewCount === "number" &&
                    // Stats are owner-only, so the count is a plain
                    // figure unless this is the author's own page.
                    (isOwnPage ? (
                      <button
                        type="button"
                        className="action-views is-button"
                        onClick={() => setStatsFor(p.id)}
                        title={t("stats.view")}
                      >
                        <EyeIcon size={17} />
                        {p.viewCount}
                      </button>
                    ) : (
                      <span className="action-views">
                        <EyeIcon size={17} />
                        {p.viewCount}
                      </span>
                    ))}
                </div>
              </article>
            );
          })}
          {nextCursor && (
            <button
              className="secondary"
              style={{ alignSelf: "center" }}
              disabled={loadingMore}
              onClick={async () => {
                setLoadingMore(true);
                await fetchProducts(nextCursor).catch(() => {});
                setLoadingMore(false);
              }}
            >
              {loadingMore ? (
            <>
              <span className="spinner is-small" aria-hidden="true" /> {t("common.loading")}
            </>
          ) : (
            t("feed.loadMore")
          )}
            </button>
          )}
        </div>
      )}

      {activeTab === "membership" && (
        <div className="stack" style={{ gap: 12 }}>
          {tiers.map((tier) => (
            <TierCard key={tier.id} tier={tier} creatorUsername={creator.username} own={isOwnPage} />
          ))}
        </div>
      )}

      {activeTab === "tips" && (
        <div className="stack" style={{ gap: 10 }}>
          {donations.map((d) => (
            <div key={d.id} className="card" style={{ padding: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{d.senderUsername ? `@${d.senderUsername}` : t("common.anonymous")}</strong>
                <span className="amount-positive">+{formatMoney(d.amountMinor, d.currency)}</span>
              </div>
              {d.message && <p style={{ marginTop: 6 }}>{d.message}</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
  const statsModal = statsFor && <EngagementStatsModal productId={statsFor} onClose={() => setStatsFor(null)} />;
  const cover = (
    <div
      className="profile-cover"
      style={
        creator.coverUrl
          ? { backgroundImage: `url(${JSON.stringify(uploadedImageSrc(creator.coverUrl) ?? "")})` }
          : undefined
      }
    />
  );
  // Quiet, at the end of the page's head — in VK's place at the foot of
  // the photo's column. Never on one's own page.
  const report = isOwnPage ? null : (
    <div className="profile-report">
      <ReportButton target="CREATOR" id={creator.username} />
    </div>
  );
  const spotify = creator.spotifyUrl ? parseSpotifyUrl(creator.spotifyUrl) : null;
  const music = spotify ? (
    <div className="profile-music">
      <SpotifyEmbed spotify={spotify} />
    </div>
  ) : null;

  // Classic VKontakte: the cover, a band with the name, then two
  // columns — the photo with the actions and counts under it on the
  // left; the name, the status and the facts as a table, then the wall,
  // on the right. The same pieces as the page below, laid out its way
  // (and on a phone, VK's mobile way: see globals.css).
  if (columns) {
    return (
      <div className="vk-profile">
        {cover}
        {/* The name once, as the page's heading in the band; beside the
            photo only the handle and the badges — the band used to say both
            and the column said them again. */}
        <div className="vk-band vk-profile-band">
          <h1 className="vk-band-title">{creator.displayName}</h1>
        </div>
        <div className="vk-profile-columns">
          <aside className="vk-profile-side">
            <div className="vk-profile-photo">
              <Avatar url={creator.avatarUrl} name={creator.displayName} frame={creator.avatarFrame} size="lg" />
            </div>
            {follow}
            {actions}
            <CreatorRewards username={creator.username} />
            {report}
          </aside>
          <div className="vk-profile-main">
            <div className="vk-profile-info">
              <div className="profile-title">{handle}</div>
              {bio}
              {links}
              <ProfileAbout about={creator.about} variant="table" />
            </div>
            {/* In the wide column: Spotify's player needs about 300px and
                squeezed into the photo's column it lost its title and buttons. */}
            {music}
            <FundraisingGoals username={creator.username} />
            <FolderList username={creator.username} />
            {wall}
          </div>
        </div>
        {statsModal}
      </div>
    );
  }

  // Boosty's arrangement. The author on the left: picture, name, how many
  // subscribe, what can be done. In the middle what they say about
  // themselves, then their posts. On the right what one can subscribe to,
  // each tier with its picture, and the goals. Narrower, the left column
  // goes over the other two and then everything stacks (container queries
  // in globals.css) — the tiers before the posts, scrolling sideways.
  const about =
    bio || links || music || creator.about ? (
      <section className="card creator-about stack" aria-label={t("profile.aboutTitle")}>
        {bio}
        {links}
        <ProfileAbout about={creator.about} />
        {music}
      </section>
    ) : null;
  return (
    <div className="creator-page">
      {cover}
      <div className="creator-columns">
        <aside className="creator-side">
          <Avatar url={creator.avatarUrl} name={creator.displayName} frame={creator.avatarFrame} size="lg" />
          {title}
          {creator.subscriberCount !== null && (
            <p className="creator-subscribers">{tn("profile.subscribersCount", creator.subscriberCount)}</p>
          )}
          {follow}
          {actions}
          <CreatorRewards username={creator.username} />
          {report}
        </aside>

        <div className="creator-main stack">
          {about}
          <FolderList username={creator.username} />
          {wall}
        </div>

        {/* Empty when there are neither tiers nor goals — the grid then
            gives its width to the posts (`:empty` in globals.css). */}
        <aside className="creator-tiers">
          {tiers.length > 0 && (
            <section className="stack" aria-labelledby="creator-tiers-heading" style={{ gap: 10 }}>
              <h2 id="creator-tiers-heading" className="creator-tiers-heading">
                {t("tiers.title")}
              </h2>
              <div className="creator-tier-list">
                {tiers.map((tier) => (
                  <TierCard key={tier.id} tier={tier} creatorUsername={creator.username} own={isOwnPage} />
                ))}
              </div>
            </section>
          )}
          <FundraisingGoals username={creator.username} />
        </aside>
      </div>
      {statsModal}
    </div>
  );
}

/**
 * A tier as Boosty shows one: its picture, its name and price, the way to
 * subscribe, then what it offers. A long list of perks is folded after a
 * few lines, with a button to read the rest.
 */
function TierCard({ tier, creatorUsername, own }: { tier: SubscriptionTier; creatorUsername: string; own: boolean }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const long = (tier.description?.length ?? 0) > 240 || (tier.description?.split("\n").length ?? 0) > 6;
  return (
    <div className="tier-card">
      {tier.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="tier-image" src={uploadedImageSrc(tier.imageUrl) ?? undefined} alt="" loading="lazy" />
      )}
      <div className="tier-card-head">
        <h3>{tier.name}</h3>
        {tier.amountMinor === "0" ? (
          <span className="price-tag">{t("common.free")}</span>
        ) : (
          <SalePrice
            amountMinor={tier.amountMinor}
            currency={tier.currency}
            sale={{ discountPercent: tier.discountPercent ?? null, discountEndsAt: tier.discountEndsAt ?? null }}
            suffix={` / ${tier.period === "MONTH" ? t("common.perMonth") : t("common.perYear")}`}
          />
        )}
      </div>
      {/* One's own tier is edited, not subscribed to. */}
      {own ? (
        <Link href="/dashboard/tiers" className="btn-secondary tier-own">
          <PencilIcon size={15} />
          {t("tiers.edit")}
        </Link>
      ) : (
        <SubscribeBox tierId={tier.id} isFree={tier.amountMinor === "0"} creatorUsername={creatorUsername} currency={tier.currency} />
      )}
      {tier.description && (
        <div className={`tier-description${long && !open ? " is-folded" : ""}`}>
          <RichText text={tier.description} creatorUsername={creatorUsername} />
        </div>
      )}
      {long && (
        <button type="button" className="link-button tier-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t("tiers.less") : t("tiers.more")}
        </button>
      )}
    </div>
  );
}
