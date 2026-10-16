"use client";

import { usePathname } from "next/navigation";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { SettingsNav, type SettingsSection } from "@/components/settings-shell";
import { GridIcon, CompassIcon, UsersIcon, SlidersIcon, BarChartIcon, KeyIcon, FileIcon, AwardIcon, GiftIcon, ShieldIcon, FolderIcon, SendIcon } from "@/components/icons";
import { AuthRequired } from "@/components/auth-prompt";

/**
 * One navigation for the whole author area, in the same shape as the
 * rest of settings: a grouped list on the left, the page as the panel.
 *
 * It lives in a layout rather than in each page so the nine sub-pages
 * share one definition — and so the grid of link cards that used to sit
 * at the bottom of the dashboard is no longer needed at all. Navigation
 * that is always visible beats navigation you have to scroll back to.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useSession();
  const { t } = useLocale();

  const sections: SettingsSection[] = [
    { id: "/dashboard", href: "/dashboard", label: t("dashboard.overview"), icon: GridIcon, group: t("dashboard.groupContent") },
    { id: "/dashboard/organize", href: "/dashboard/organize", label: t("dashboard.organize"), icon: FolderIcon, group: t("dashboard.groupContent") },
    { id: "/dashboard/feeds", href: "/dashboard/feeds", label: t("dashboard.feeds"), icon: CompassIcon, group: t("dashboard.groupContent") },
    { id: "/dashboard/files", href: "/dashboard/files", label: t("dashboard.myFiles"), icon: FileIcon, group: t("dashboard.groupContent") },

    { id: "/dashboard/tiers", href: "/dashboard/tiers", label: t("dashboard.tiers"), icon: UsersIcon, group: t("dashboard.groupMoney") },
    { id: "/dashboard/subscribers", href: "/dashboard/subscribers", label: t("dashboard.subscribers"), icon: UsersIcon, group: t("dashboard.groupMoney") },
    { id: "/dashboard/payments", href: "/dashboard/payments", label: t("dashboard.payments"), icon: SlidersIcon, group: t("dashboard.groupMoney") },
    { id: "/dashboard/rewards", href: "/dashboard/rewards", label: t("rewards.title"), icon: AwardIcon, group: t("dashboard.groupMoney") },
    { id: "/dashboard/analytics", href: "/dashboard/analytics", label: t("dashboard.analytics"), icon: BarChartIcon, group: t("dashboard.groupMoney") },

    // One API entry, not two. "Request access" and "mint a key" are two
    // steps of one flow, and listing both made it look like there were two
    // ways to get an API key — a paid one and a free one. Whoever may
    // already mint (an approved author, and the operator themselves) is
    // past the request; everyone else has nothing to mint yet.
    ...(user?.canMintApiKeys
      ? [{ id: "/dashboard/tokens", href: "/dashboard/tokens", label: t("dashboard.tokens"), icon: KeyIcon, group: t("dashboard.groupAccess") }]
      : [{ id: "/dashboard/api-access", href: "/dashboard/api-access", label: t("dashboard.apiAccess"), icon: KeyIcon, group: t("dashboard.groupAccess") }]),

    // The account itself lives here too, not in the site menu: a signed-out
    // reader has neither, and the menu is shared with them.
    { id: "/dashboard/security", href: "/dashboard/security", label: t("nav.security"), icon: ShieldIcon, group: t("dashboard.groupAccount") },
    { id: "/dashboard/invites", href: "/dashboard/invites", label: t("nav.invites"), icon: GiftIcon, group: t("dashboard.groupAccount") },
    { id: "/dashboard/telegram", href: "/dashboard/telegram", label: t("telegram.title"), icon: SendIcon, group: t("dashboard.groupAccount") },
  ];

  // Exact match for the overview, prefix for everything else — otherwise
  // "/dashboard" would light up on every page beneath it. Routes with no
  // section of their own (composing a post, editing one) fall back to
  // the overview, which is where they were reached from.
  const active =
    sections.find((s) => s.href !== "/dashboard" && s.href && pathname.startsWith(s.href))?.id ?? "/dashboard";

  // The cabinet is someone's own: signed out, it asks for an account
  // rather than drawing a menu of sections that would each refuse.
  if (!loading && !user) return <AuthRequired />;

  return (
    <div className="settings-shell">
      <SettingsNav sections={sections} activeId={active} label={t("dashboard.title")} />
      <div className="settings-panel">{children}</div>
    </div>
  );
}
