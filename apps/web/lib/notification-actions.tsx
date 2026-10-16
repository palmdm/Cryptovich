import type { ComponentType } from "react";
import type { NotificationActionId } from "@platform/shared";
import type { TranslationKey } from "./i18n/en";
import {
  BarChartIcon,
  CheckIcon,
  CloseIcon,
  CommentIcon,
  CopyIcon,
  FileTextIcon,
  GiftIcon,
  HeartIcon,
  KeyIcon,
  LayersIcon,
  LibraryIcon,
  ShieldIcon,
  MegaphoneIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/icons";

type IconComponent = ComponentType<{ className?: string }>;

/**
 * The look of each place a notification can lead: an icon and the words
 * for its tooltip and screen-reader name. Where it goes is decided in
 * `@platform/shared` (`notificationActionsFor`), so this is only the face.
 */
export const NOTIFICATION_ACTION_UI: Record<NotificationActionId, { icon: IconComponent; label: TranslationKey }> = {
  "confirm-payment": { icon: CheckIcon, label: "notify.action.confirm-payment" },
  "reject-payment": { icon: CloseIcon, label: "notify.action.reject-payment" },
  payments: { icon: WalletIcon, label: "notify.action.payments" },
  analytics: { icon: BarChartIcon, label: "notify.action.analytics" },
  subscribers: { icon: UsersIcon, label: "notify.action.subscribers" },
  tiers: { icon: LayersIcon, label: "notify.action.tiers" },
  "open-post": { icon: FileTextIcon, label: "notify.action.open-post" },
  "open-comments": { icon: CommentIcon, label: "notify.action.open-comments" },
  author: { icon: UserIcon, label: "notify.action.author" },
  membership: { icon: GiftIcon, label: "notify.action.membership" },
  library: { icon: LibraryIcon, label: "notify.action.library" },
  subscriptions: { icon: HeartIcon, label: "notify.action.subscriptions" },
  "api-access": { icon: ShieldIcon, label: "notify.action.api-access" },
  reports: { icon: ShieldIcon, label: "notify.action.reports" },
  announcement: { icon: MegaphoneIcon, label: "notify.action.announcement" },
  tokens: { icon: KeyIcon, label: "notify.action.tokens" },
  rewards: { icon: GiftIcon, label: "notify.action.rewards" },
  "copy-code": { icon: CopyIcon, label: "notify.action.copy-code" },
};
