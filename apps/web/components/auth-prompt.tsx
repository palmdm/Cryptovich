"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@platform/shared";
import { useLocale } from "./locale-provider";
import { useSession } from "./session-provider";
import { CloseIcon, LogInIcon, UserPlusIcon } from "./icons";

/**
 * A signed-out reader sees every action a member does. Using one that
 * needs an account opens this prompt instead of doing nothing, or of the
 * button not being there at all — which is how people used to miss that
 * bookmarks, comments and subscriptions existed.
 */
interface AuthPromptValue {
  /** True when signed in. Otherwise opens the prompt and returns false. */
  requireAccount: () => boolean;
}

const AuthPromptContext = createContext<AuthPromptValue>({ requireAccount: () => true });

export function useAuthPrompt(): AuthPromptValue {
  return useContext(AuthPromptContext);
}

/**
 * Where to go to sign in or register and then come back. Only a path on
 * this site is ever passed on — `next` is read back by the sign-in page,
 * and an absolute URL there would be an open redirect.
 */
export function accountHref(kind: "login" | "register", returnTo: string | null): string {
  const back = returnTo && safeReturnPath(returnTo);
  return back ? `/${kind}?next=${encodeURIComponent(back)}` : `/${kind}`;
}

/** A same-site path to return to after signing in, or null. */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/^\/(login|register)\b/.test(value)) return null;
  return value;
}

function useReturnPath(): string {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(window.location.search), [pathname]);
  return `${pathname}${search}`;
}

/** The message itself, with the site's name set apart as in the request. */
function PromptText() {
  const { t } = useLocale();
  const [before, after = ""] = t("auth.required.text").split("{site}");
  return (
    <p className="lede" style={{ margin: 0 }}>
      {before}
      <strong>{APP_NAME}</strong>
      {after}
    </p>
  );
}

function PromptActions({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLocale();
  const back = useReturnPath();
  return (
    <div className="auth-prompt-actions">
      <Link href={accountHref("login", back)} className="btn-primary" onClick={onNavigate}>
        <LogInIcon size={16} />
        {t("auth.required.signIn")}
      </Link>
      <Link href={accountHref("register", back)} className="btn-secondary" onClick={onNavigate}>
        <UserPlusIcon size={16} />
        {t("auth.required.register")}
      </Link>
    </div>
  );
}

function AuthPromptDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    if (mounted) panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [mounted]);

  if (!mounted) return null;
  // In <body>, for the same reason as the other dialogs: an ancestor with a
  // transform or backdrop-filter would trap a fixed-position panel.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel auth-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-prompt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="auth-prompt-title" style={{ margin: 0 }}>
            {t("auth.required.title")}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
            <CloseIcon size={18} />
          </button>
        </div>
        <PromptText />
        <PromptActions onNavigate={onClose} />
      </div>
    </div>,
    document.body,
  );
}

export function AuthPromptProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const requireAccount = useCallback(() => {
    if (user) return true;
    setOpen(true);
    return false;
  }, [user]);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ requireAccount }), [requireAccount]);
  return (
    <AuthPromptContext.Provider value={value}>
      {children}
      {open && !user && <AuthPromptDialog onClose={close} />}
    </AuthPromptContext.Provider>
  );
}

/** The same message, in place, for a page that is someone's own (the feed, bookmarks…). */
export function AuthRequired() {
  const { t } = useLocale();
  return (
    <div className="card stack auth-prompt" style={{ gap: 14 }}>
      <h2 style={{ margin: 0 }}>{t("auth.required.title")}</h2>
      <PromptText />
      <PromptActions />
    </div>
  );
}
