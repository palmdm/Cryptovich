"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import type { CurrentUser } from "@/lib/types";

interface SessionContextValue {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Only the API saying "nobody is signed in" signs the page out. A refusal
  // for too many requests, a dropped connection or a server error says
  // nothing about the session: whoever was signed in stays so, and the
  // question is asked again a little later. Treating those as a sign-out
  // threw an administrator out mid-way through a sticker import.
  const refresh = useCallback(async () => {
    setLoading(true);
    for (let attempt = 0; ; attempt++) {
      try {
        const data = await apiFetch<{ user: CurrentUser | null }>("/auth/me");
        setUser(data.user);
        break;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setUser(null);
          break;
        }
        if (attempt >= 5) break;
        await new Promise((resolve) => window.setTimeout(resolve, Math.min(2000 * 2 ** attempt, 15_000)));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A temporary sign-in lives only while it is used: every open tab says
  // so once a minute, and when the last one closes it runs out on its own.
  const temporary = Boolean(user?.sessionTemporary);
  useEffect(() => {
    if (!temporary) return;
    const ping = () =>
      apiFetch<{ user: CurrentUser | null }>("/auth/me")
        .then((data) => {
          if (!data.user) setUser(null);
        })
        .catch(() => {});
    const timer = window.setInterval(ping, 60_000);
    const onVisible = () => document.visibilityState === "visible" && ping();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [temporary]);

  return <SessionContext.Provider value={{ user, loading, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
