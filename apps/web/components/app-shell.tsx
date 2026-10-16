"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "./session-provider";
import { useLocale } from "./locale-provider";
import { apiFetch } from "@/lib/api";
import { notificationSoundOn, primeNotificationSounds, soundForNew, type UnreadAnswer } from "@/lib/notification-sound";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";
import { APP_VERSION } from "@platform/shared";
import {
  MenuIcon,
  SearchIcon,
  LogInIcon,
  UserPlusIcon,
  HomeIcon,
  CompassIcon,
  BellIcon,
  LibraryIcon,
  UsersIcon,
  UserIcon,
  GridIcon,
  ShieldIcon,
  SunIcon,
  BookmarkIcon,
  LinkIcon,
  LogOutIcon, AccountIcon, DownloadIcon } from "./icons";
import { useCanInstall } from "./install-banner";
import { ShellPrompts } from "./shell-prompts";
import { promptInstall } from "@/lib/pwa";
import { AnnouncementsButton, AnnouncementsPanel } from "./announcements";
import { AdminTwoFactorGate } from "./admin-two-factor-gate";
import { Avatar } from "./avatar";
import Form from "next/form";
import { QuickPostButton, QuickPostPanel, useQuickPost } from "./quick-post";
import { VersionButton } from "./about-dialog";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  badge?: number | null;
}

// Often enough that a donation is heard within the minute; a count and a
// few times each, never the list.
const UNREAD_EVERY_MS = 30_000;

/**
 * The badge's count, and the sound of a new notification. Asked on every
 * navigation (so the badge clears after the notifications page marks
 * things read), every half-minute, when the tab comes back into view, and
 * at once when a browser push arrives (the service worker says so).
 */
function useUnreadCount(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const pathname = usePathname();
  const seen = useRef<string | undefined>(undefined);
  const live = useRef(enabled);
  live.current = enabled;

  const check = useCallback(() => {
    apiFetch<UnreadAnswer>("/notifications/unread")
      .then((res) => {
        if (!live.current) return;
        setCount(res.unreadCount);
        soundForNew(res.latest, seen);
      })
      // A failed check keeps the badge it had; the next one will tell.
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      seen.current = undefined;
      return;
    }
    check();
  }, [enabled, pathname, check]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(check, UNREAD_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    const onPush = (event: MessageEvent) => (event.data as { type?: string } | null)?.type === "cryptovich:notification" && check();
    const prime = () => {
      document.removeEventListener("pointerdown", prime, true);
      document.removeEventListener("keydown", prime, true);
      if (notificationSoundOn()) primeNotificationSounds();
    };
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("pointerdown", prime, true);
    document.addEventListener("keydown", prime, true);
    navigator.serviceWorker?.addEventListener("message", onPush);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", prime, true);
      document.removeEventListener("keydown", prime, true);
      navigator.serviceWorker?.removeEventListener("message", onPush);
    };
  }, [enabled, check]);

  return count;
}

/** Whether the operator has published a usage policy (policy.md). */
const PolicyContext = createContext(false);
export const usePolicyPublished = () => useContext(PolicyContext);

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function CountBadge({ value }: { value: number }) {
  return (
    <span
      style={{
        marginLeft: "auto",
        minWidth: 20,
        padding: "0 6px",
        borderRadius: 999,
        background: "var(--accent)",
        color: "var(--accent-ink)",
        fontSize: "0.72rem",
        fontWeight: 700,
        lineHeight: "20px",
        textAlign: "center",
      }}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}

export function AppShell({
  children,
  version = APP_VERSION,
  policy = false,
}: {
  children: React.ReactNode;
  version?: string;
  policy?: boolean;
}) {
  const { user, loading, refresh } = useSession();
  const installable = useCanInstall();
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const unread = useUnreadCount(!!user);
  const quickPost = useQuickPost();
  const [menuOpen, setMenuOpen] = useState(false);

  // A route change means the sheet has done its job.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await apiFetch("/auth/logout", { method: "POST" });
    await refresh();
    router.push("/");
  }

  const browse: NavItem[] = [
    { href: "/", label: t("nav.home"), icon: HomeIcon },
    // Reading is open, so search is offered signed out as well.
    { href: "/search", label: t("nav.search"), icon: SearchIcon },
  ];

  // Signed out, the menu is the same as a member's — minus "my page" and
  // the admin area. Each of those pages answers with the sign-in prompt,
  // so what an account gives is visible before having one.
  const personal: NavItem[] = [
    { href: "/feed", label: t("nav.feed"), icon: CompassIcon },
    { href: "/notifications", label: t("nav.notifications"), icon: BellIcon, badge: unread },
    { href: "/library", label: t("nav.library"), icon: LibraryIcon },
    { href: "/bookmarks", label: t("nav.bookmarks"), icon: BookmarkIcon },
    { href: "/links", label: t("nav.links"), icon: LinkIcon },
    { href: "/subscriptions", label: t("nav.subscriptions"), icon: UsersIcon },
    ...(user ? [{ href: `/${user.username}`, label: t("nav.myPage"), icon: UserIcon }] : []),
  ];

  const signedIn = [...browse, ...personal];

  // Security and invites are in the cabinet, under "Account". Signed
  // out there is no cabinet, so what is left is the one setting a reader
  // without an account has: how the site looks.
  const manage: NavItem[] = [
    ...(user ? [{ href: "/dashboard", label: t("nav.dashboard"), icon: GridIcon }] : []),
    { href: "/settings/appearance", label: t("nav.appearance"), icon: SunIcon },
    ...(user?.role === "ADMIN" ? [{ href: "/admin", label: t("nav.admin"), icon: ShieldIcon }] : []),
  ];

  // The mobile bar carries the destinations you reach for repeatedly.
  // Everything else — the dashboard, the settings pages, the admin area —
  // used to live only in the desktop sidebar, so a phone could not reach
  // any of them without asking for the desktop site. They are one tap
  // away now, behind the last slot.
  const mobile = signedIn.slice(0, 4);
  const overflow: NavItem[] = [...signedIn.slice(4), ...manage];

  return (
    <PolicyContext.Provider value={policy}>
      <header className="topbar">
        <Link href="/" className="topbar-brand">
          {t("nav.brand")}
        </Link>

        {/* Search on a computer, in every theme (it began as the VK
            theme's, and was too handy to keep there). A phone has none in
            its narrow bar: search is a slot of its bottom bar instead. */}
        <div className="topbar-center">
          <Form action="/search" className="topbar-search" role="search">
            <SearchIcon size={15} />
            <input name="q" type="search" placeholder={t("nav.search")} aria-label={t("search.title")} />
          </Form>
          {/* Writing a post sits beside search on a computer: the "+"
              opens the floating editor. */}
          {user && <QuickPostButton onStart={quickPost.start} className="primary topbar-plus" />}
        </div>

        <div className="topbar-actions">
          <ThemeSwitcher />
          <AnnouncementsButton />
          <LanguageSwitcher />

          <span
            style={{ display: "inline-flex", gap: "inherit", alignItems: "center", visibility: loading ? "hidden" : "visible" }}
          >
            {user ? (
              <>
                {/* Publishing is one tap from anywhere — every account can
                    post, so this needs no role check. On a phone the "+"
                    is here (the box beside search is a computer's) and
                    leads to the feed's editor. */}
                <QuickPostButton onStart={quickPost.start} className="btn-primary topbar-new-post" />
                {/* The account as its own picture (in its frame), not a
                    handle: a long username crowded the header, and it is on
                    the page it opens. No picture yet: the person icon. */}
                <Link
                  href={`/${user.username}`}
                  className={`btn-secondary topbar-account${user.avatarUrl || user.avatarFrame ? " has-avatar" : ""}`}
                  title={`@${user.username}`}
                  aria-label={`${t("nav.myPage")} (@${user.username})`}
                >
                  {user.avatarUrl || user.avatarFrame ? (
                    <Avatar url={user.avatarUrl} name={user.username} frame={user.avatarFrame} size="sm" decorative />
                  ) : (
                    <AccountIcon size={20} />
                  )}
                </Link>
              </>
            ) : (
              <>
                {/* Icon-first, and on a phone icon-only: three labelled
                    buttons plus two switchers did not fit a 390px header
                    without the text crowding everything together. */}
                <Link href="/login" className="btn-secondary topbar-cta" title={t("nav.signIn")}>
                  <LogInIcon size={16} />
                  <span>{t("nav.signIn")}</span>
                </Link>
                <Link href="/register" className="btn-primary topbar-cta" title={t("nav.getStarted")}>
                  <UserPlusIcon size={16} />
                  <span>{t("nav.getStarted")}</span>
                </Link>
              </>
            )}
          </span>
        </div>
      </header>

      <div className="app-shell">
        <aside className="sidebar">
          {/* Search is the box in the header here, so not a link as well. */}
          {signedIn.filter((item) => item.href !== "/search").map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={`sidebar-link${isActive(pathname, item.href) ? " active" : ""}`}>
                <Icon size={20} />
                {item.label}
                {!!item.badge && <CountBadge value={item.badge} />}
              </Link>
            );
          })}

          {manage.length > 0 && (
            <>
              <div className="sidebar-heading">{t("nav.manage")}</div>
              {manage.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className={`sidebar-link${isActive(pathname, item.href) ? " active" : ""}`}>
                    <Icon size={20} />
                    {item.label}
                  </Link>
                );
              })}
              {user && (
                <button type="button" className="sidebar-link" onClick={handleLogout}>
                  <LogOutIcon size={20} />
                  {t("nav.signOut")}
                </button>
              )}
            </>
          )}

          {!loading && !user && (
            <div className="sidebar-note">
              <p className="meta">{t("nav.signedOutHint")}</p>
              <Link href="/register" className="btn-primary">
                {t("nav.getStarted")}
              </Link>
            </div>
          )}
          {policy && (
            <Link href="/policy" className="app-policy-link">
              {t("policy.link")}
            </Link>
          )}
          <VersionButton version={version} />
        </aside>

        <main className="content">
          {user?.sessionTemporary && (
            <p className="temporary-session" role="status">
              {t("qrLogin.temporaryNotice")}{" "}
              <button type="button" className="link-button" onClick={handleLogout}>
                {t("nav.signOut")}
              </button>
            </p>
          )}
          {/* Not over a phone's "sign this computer in" step: its code
              lasts two minutes and should be the first thing on screen. */}
          {!pathname.startsWith("/link/") && <AnnouncementsPanel />}
          <AdminTwoFactorGate>{children}</AdminTwoFactorGate>
        </main>
      </div>

      {!loading && (
        <nav className="bottom-nav" aria-label={t("nav.primary")}>
          {mobile.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={`bottom-nav-item${isActive(pathname, item.href) ? " active" : ""}`}
              >
                <span className="bottom-nav-icon">
                  <Icon size={24} />
                  {/* The unread count rides on the bell's corner, as on a phone's own apps. */}
                  {!!item.badge && (
                    <span className="bottom-nav-badge" aria-label={String(item.badge)}>
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </span>
                <span className="bottom-nav-label">{item.label}</span>
              </Link>
            );
          })}
          {overflow.length > 0 && (
            <button
              type="button"
              className={`bottom-nav-item${menuOpen ? " active" : ""}`}
              title={t("nav.more")}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MenuIcon size={24} />
              <span className="bottom-nav-label">{t("nav.more")}</span>
            </button>
          )}
        </nav>
      )}

      {menuOpen && (
        <>
          <button
            type="button"
            className="nav-sheet-backdrop"
            aria-label={t("common.cancel")}
            onClick={() => setMenuOpen(false)}
          />
          <div className="nav-sheet" role="menu" aria-label={t("nav.more")}>
            {overflow.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className={`sidebar-link${isActive(pathname, item.href) ? " active" : ""}`}
                >
                  <Icon size={20} />
                  {item.label}
                  {!!item.badge && <CountBadge value={item.badge} />}
                </Link>
              );
            })}
            {user ? (
              <button type="button" role="menuitem" className="sidebar-link" onClick={handleLogout}>
                <LogOutIcon size={20} />
                {t("nav.signOut")}
              </button>
            ) : (
              <>
                <Link href="/login" role="menuitem" className="sidebar-link">
                  <LogInIcon size={20} />
                  {t("nav.signIn")}
                </Link>
                <Link href="/register" role="menuitem" className="sidebar-link">
                  <UserPlusIcon size={20} />
                  {t("nav.getStarted")}
                </Link>
              </>
            )}
            {installable && (
              <button
                type="button"
                role="menuitem"
                className="sidebar-link"
                onClick={() => {
                  setMenuOpen(false);
                  void promptInstall();
                }}
              >
                <DownloadIcon size={20} />
                {t("pwa.installApp")}
              </button>
            )}
            {policy && (
              <Link href="/policy" role="menuitem" className="app-policy-link">
                {t("policy.link")}
              </Link>
            )}
            <VersionButton version={version} />
          </div>
        </>
      )}
      {/* Offers that float over the page, stacked so they never overlap. */}
      <ShellPrompts />
      {quickPost.mounted && <QuickPostPanel open={quickPost.open} onClose={quickPost.close} />}
    </PolicyContext.Provider>
  );
}
