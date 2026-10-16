"use client";

import Link from "next/link";

export interface SettingsSection {
  id: string;
  label: string;
  icon?: (props: { size?: number }) => React.ReactElement;
  /** Routed sections navigate; omit it and the section is selected in place. */
  href?: string;
  /** Optional heading this section sits under, macOS-style. */
  group?: string;
}

/**
 * Just the section list — the sidebar plus its compact fallback.
 *
 * A vertical list replaces a tab row deliberately. Tabs only fit as many
 * items as the viewport is wide, which is why the admin panel's nine of
 * them needed `overflow-x: auto` and became a sideways scroll on any
 * narrow screen. A list grows downward instead, so it never needs one.
 *
 * Below the breakpoint it collapses to a native select rather than
 * stacking: a full-height list above the panel would push the content
 * the reader actually came for off the screen.
 */
export function SettingsNav({
  sections,
  activeId,
  onSelect,
  label,
}: {
  sections: SettingsSection[];
  activeId: string;
  onSelect?: (id: string) => void;
  label: string;
}) {
  const groups = [...new Set(sections.map((s) => s.group ?? ""))];

  return (
    <>
      <nav className="settings-nav" aria-label={label}>
        {groups.map((group) => (
          <div key={group || "_"} className="settings-nav-group">
            {group && <div className="settings-nav-heading">{group}</div>}
            {sections
              .filter((s) => (s.group ?? "") === group)
              .map((section) => {
                const Icon = section.icon;
                const className = `settings-nav-item${section.id === activeId ? " active" : ""}`;
                const body = (
                  <>
                    {Icon && <Icon size={17} />}
                    <span>{section.label}</span>
                  </>
                );
                return section.href ? (
                  <Link key={section.id} href={section.href} className={className}>
                    {body}
                  </Link>
                ) : (
                  <button
                    key={section.id}
                    type="button"
                    className={className}
                    aria-current={section.id === activeId ? "page" : undefined}
                    onClick={() => onSelect?.(section.id)}
                  >
                    {body}
                  </button>
                );
              })}
          </div>
        ))}
      </nav>

      <label className="settings-nav-compact">
        <span className="visually-hidden">{label}</span>
        <select
          value={activeId}
          onChange={(e) => {
            const section = sections.find((s) => s.id === e.target.value);
            if (section?.href) window.location.href = section.href;
            else onSelect?.(e.target.value);
          }}
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {/* The group prefixes the label so the collapsed picker still
                  says which part of settings an entry belongs to — unless
                  they are the same word, which read as "Overview — Overview". */}
              {section.group && section.group !== section.label ? `${section.group} — ${section.label}` : section.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/**
 * The macOS System Settings shape: sections on the left, one panel at a
 * time on the right. For a screen that owns its own title and switches
 * panels in place — the admin area. Routed areas use `SettingsNav`
 * directly from a layout instead.
 */
export function SettingsShell({
  sections,
  activeId,
  onSelect,
  title,
  description,
  children,
}: {
  sections: SettingsSection[];
  activeId: string;
  onSelect?: (id: string) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1>{title}</h1>
        {description && <p className="lede">{description}</p>}
      </div>

      <div className="settings-shell">
        <SettingsNav sections={sections} activeId={activeId} onSelect={onSelect} label={title} />
        <div className="settings-panel">{children}</div>
      </div>
    </div>
  );
}

/** A titled block of rows — the card macOS groups related settings into. */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-group">
      {title && <h2 className="settings-group-title">{title}</h2>}
      {description && <p className="settings-group-description">{description}</p>}
      <div className="settings-rows">{children}</div>
    </section>
  );
}

/**
 * One row: what it is on the left, the control on the right. `stacked`
 * drops the control onto its own line for anything too wide to sit
 * beside a label — a textarea, a table — which is how a row avoids
 * becoming the thing that scrolls sideways.
 */
export function SettingsRow({
  label,
  hint,
  stacked = false,
  children,
}: {
  label?: string;
  hint?: string;
  stacked?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`settings-row${stacked ? " is-stacked" : ""}`}>
      {(label || hint) && (
        <div className="settings-row-label">
          {label && <span>{label}</span>}
          {hint && <span className="meta">{hint}</span>}
        </div>
      )}
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

/**
 * Wraps anything genuinely wide — a data table — so it scrolls inside
 * its own box. The page itself must never scroll horizontally.
 */
export function SettingsScroller({ children }: { children: React.ReactNode }) {
  return <div className="settings-scroller">{children}</div>;
}
