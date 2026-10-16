import type { PrismaClient } from "@platform/db";
import { SettingsService } from "../modules/settings/service.js";

/**
 * Administrators sign in with two factors. An administrator without one
 * can still sign in — that is how they get to set it up, with the QR code
 * shown straight away — but every admin route refuses them until it is on.
 *
 * The `adminRequire2fa` setting (default: ADMIN_REQUIRE_2FA in .env) turns
 * this off — the test suite does, so its fixture administrators need no
 * authenticator; `admin-two-factor.test.ts` turns it back on.
 */
/** Whether this account must set up two-factor sign-in before anything else. */
export async function needsTwoFactorSetup(prisma: PrismaClient, user: { role: string; twoFactorEnabled: boolean }): Promise<boolean> {
  return user.role === "ADMIN" && !user.twoFactorEnabled && (await new SettingsService(prisma).adminRequiresTwoFactor());
}
