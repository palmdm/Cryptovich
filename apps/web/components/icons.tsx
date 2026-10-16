/**
 * A small, self-hosted icon set drawn on a 24px grid at 1.6 stroke, so
 * every glyph sits on the same optical weight as the UI text next to it.
 * Inline SVG rather than an icon font or a dependency: these are the only
 * ~15 marks the product needs.
 */
interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 20, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></Svg>
);

export const CompassIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5.5-5.5 2 2-5.5z" /></Svg>
);

export const BellIcon = (p: IconProps) => (
  <Svg {...p}><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" /><path d="M13.7 20a2 2 0 0 1-3.4 0" /></Svg>
);

// Books on a shelf, two upright and one leaning: what one has bought. It
// was a bookmark, and read as the same thing as "Избранное" beside it.
export const LibraryIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 4h3v15H5zM10 4h3v15h-3z" /><path d="M15.2 5.4l2.8-.9 3.3 13.8-2.8.8z" /><path d="M3 20.5h18" /></Svg>
);

export const UsersIcon = (p: IconProps) => (
  <Svg {...p}><path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" /><circle cx="9.5" cy="7.5" r="3.5" /><path d="M21 20v-1.5a4 4 0 0 0-3-3.87" /><path d="M16 4.13a4 4 0 0 1 0 7.75" /></Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="8" r="4" /></Svg>
);

/** The account button: a head over shoulders, outlined — the figure the
 * header shows in place of the username. */
export const AccountIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="7.5" r="4" />
    <path d="M4.5 21v-1.5a5.5 5.5 0 0 1 5.5-5.5h4a5.5 5.5 0 0 1 5.5 5.5V21Z" />
  </Svg>
);

export const MegaphoneIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1ZM16.5 8.5a5 5 0 0 1 0 7M8 15l1 5h2" /></Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}><path d="m15 6-6 6 6 6" /></Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>
);

export const SmileIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.2-7.5 9.5-4.4-1.3-7.5-4.9-7.5-9.5V6z" /></Svg>
);

export const FlagIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5" /></Svg>
);

export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></Svg>
);

export const LogInIcon = (p: IconProps) => (
  <Svg {...p}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></Svg>
);

export const UserPlusIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M18 8v6M21 11h-6" /></Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Svg>
);

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>
);

export const LogOutIcon = (p: IconProps) => (
  <Svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></Svg>
);

export const CommentIcon = (p: IconProps) => (
  <Svg {...p}><path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /></Svg>
);

/** YouTube's "Share": an arrow head on a curved tail, rising to the right. */
export const ShareIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 5.5 20.5 12 14 18.5v-3.9c-4.6 0-8 1.3-10.5 4.4.9-5.1 4.1-9.1 10.5-9.9V5.5Z" /></Svg>
);

export const GiftIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="9" width="18" height="4" rx="1" /><path d="M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M12 9v12" /><path d="M12 9C10 9 7.5 8.5 7.5 6.2A2.2 2.2 0 0 1 12 5.6a2.2 2.2 0 0 1 4.5.6C16.5 8.5 14 9 12 9" /></Svg>
);

export const AwardIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="8.5" r="5.5" /><path d="M8.6 13 7.2 21.5 12 19l4.8 2.5-1.4-8.5" /></Svg>
);

export const RotateIcon = (p: IconProps) => (
  <Svg {...p}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></Svg>
);

export const FingerprintIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 11v3a8 8 0 0 1-1.5 4.6" /><path d="M8.5 21a12 12 0 0 0 1.5-5.5V11a2 2 0 0 1 4 0v1" /><path d="M16 14.5c0 2.2-.4 4.3-1.2 6.2" /><path d="M5.5 17.5A11 11 0 0 0 6 14v-3a6 6 0 0 1 9.2-5.1" /><path d="M18 10.5V13" /><path d="M2.5 13.5c.3-1 .5-1.8.5-2.5V11a9 9 0 0 1 15.5-6.2" /><path d="M20.8 16.5c.2-1 .2-2 .2-3" /></Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}><path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" /></Svg>
);

export const MusicIcon = (p: IconProps) => (
  <Svg {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Svg>
);

export const CakeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" /><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1" /><path d="M2 21h20M7 8v3M12 8v3M17 8v3" /><path d="M7 4h.01M12 4h.01M17 4h.01" /></Svg>
);

export const MapPinIcon = (p: IconProps) => (
  <Svg {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>
);

export const EyeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12" /><circle cx="12" cy="12" r="3" /></Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}><path d="m4 12.5 5 5L20 6.5" /></Svg>
);

export const BroadcastIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="2.5" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" /></Svg>
);

export const FileTextIcon = (p: IconProps) => (
  <Svg {...p}><path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4M8.5 12h7M8.5 15.5h7M8.5 8.5h3" /></Svg>
);

export const PackageIcon = (p: IconProps) => (
  <Svg {...p}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="M4.5 7.5 12 12l7.5-4.5M12 12v9" /></Svg>
);

export const StickerIcon = (p: IconProps) => (
  <Svg {...p}><path d="M8 3h9a4 4 0 0 1 4 4v9l-6 5H8a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z" /><path d="M15 16v3a2 2 0 0 0 2-2v-1h3" /></Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .4 4.2 1M21.5 12S18 18.5 12 18.5c-1.6 0-3-.4-4.2-1" /><path d="M9.5 14.2A3 3 0 0 1 12 9M14 14.3a3 3 0 0 0 .5-4.6" /><path d="M4 4l16 16" /></Svg>
);

export const KeyIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="15" r="4.5" /><path d="M11.2 11.8 20 3M15.5 7.5 18 5M17.5 9.5 20 7" /></Svg>
);

export const BookmarkIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" /></Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 7h16M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" /><path d="M6.5 7v13a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V7" /><path d="M10 11v6M14 11v6" /></Svg>
);

export const BarChartIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 20h16" /><path d="M7 20v-6M12 20V6M17 20v-9" /></Svg>
);

export const SunIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" /></Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}><path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" /></Svg>
);

export const MonitorIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="12.5" rx="1.5" /><path d="M9 21h6M12 16.5V21" /></Svg>
);

export const PhoneIcon = (p: IconProps) => (
  <Svg {...p}><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></Svg>
);

export const TabletIcon = (p: IconProps) => (
  <Svg {...p}><rect x="4.5" y="3" width="15" height="18" rx="2" /><path d="M11 18h2" /></Svg>
);

/* --- editor formatting -------------------------------------------------- */

export const BoldIcon = (p: IconProps) => (
  <Svg {...p}><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" /></Svg>
);

export const ItalicIcon = (p: IconProps) => (
  <Svg {...p}><path d="M15 5h-5M14 19H9M13.5 5l-3 14" /></Svg>
);

export const StrikethroughIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 12h16M16.5 7.5C16 5.9 14.3 5 12.2 5 9.6 5 7.8 6.3 7.8 8.2c0 1.2.6 2.1 2 2.8M8 16.2C8.6 18 10.4 19 12.6 19c2.7 0 4.6-1.4 4.6-3.4 0-.6-.1-1.1-.4-1.6" /></Svg>
);

export const PinIcon = (p: IconProps) => (
  <Svg {...p}><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 15v5" /></Svg>
);

export const CodeIcon = (p: IconProps) => (
  <Svg {...p}><path d="m9 8-5 4 5 4M15 8l5 4-5 4" /></Svg>
);

export const LinkIcon = (p: IconProps) => (
  <Svg {...p}><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.7 6.6" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.4-1.4" /></Svg>
);

export const HeadingIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 5v14M18 5v14M6 12h12" /></Svg>
);

export const QuoteIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 6.5h2.5M4 12h16M4 17.5h16" /><path d="M4 6.5v11" strokeWidth={2.4} /></Svg>
);

export const ListIcon = (p: IconProps) => (
  <Svg {...p}><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="17.5" r="1.2" fill="currentColor" stroke="none" /></Svg>
);

export const CodeBlockIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="m9.5 10-2 2 2 2M14.5 10l2 2-2 2" /></Svg>
);

export const TableIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M3 10h18M9 10v9M15 10v9" /></Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>
);

export const FileIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /></Svg>
);

export const FolderIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" /></Svg>
);

export const PencilIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" /><path d="m14 6.5 3.5 3.5" /></Svg>
);

export const PaperclipIcon = (p: IconProps) => (
  <Svg {...p}><path d="M19 11.5 12.4 18a4.5 4.5 0 0 1-6.4-6.4l7.1-7.1a3 3 0 0 1 4.3 4.3l-7.1 7.1a1.5 1.5 0 0 1-2.2-2.2l6.4-6.4" /></Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></Svg>
);

export const WalletIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v2" /><path d="M4 7.5V17a2 2 0 0 0 2 2h12.5a.5.5 0 0 0 .5-.5V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z" /><circle cx="15.5" cy="13.5" r="1" /></Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5" /><path d="m3.5 16.5 8.5 4.5 8.5-4.5" /></Svg>
);

export const HeartIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" /></Svg>
);

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="1.8" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></Svg>
);

/** A log: lines of text on a page. */
export const ScrollIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></Svg>
);

/** A paper plane: sending, and Telegram. */
export const SendIcon = (p: IconProps) => (
  <Svg {...p}><path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z" /><path d="m10 13 4.5-4.5" /></Svg>
);
