"use client";

import { useSyncExternalStore } from "react";
import { canInstall, subscribeInstall } from "@/lib/pwa";

/** Whether the browser offers to install Cryptovich right now (the "More" menu and the offer use it). */
export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribeInstall, canInstall, () => false);
}
