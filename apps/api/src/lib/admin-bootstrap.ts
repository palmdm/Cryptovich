import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@platform/db";
import { hashPassword } from "./password.js";
import { withScopeLock } from "./scope-lock.js";
import { isUsernameAvailable } from "./username-history.js";

/**
 * Creates the administrator on first start, so a fresh installation is
 * never left waiting for whoever registers first to become admin.
 *
 * Configured by ADMIN_USERNAME / ADMIN_PASSWORD. With no ADMIN_PASSWORD a
 * password is generated and printed once to the API's log — the same
 * "shown once" rule scripts/manage-users.sh follows. Set
 * ADMIN_BOOTSTRAP=false to fall back to the old behaviour (the first
 * registered account becomes admin).
 *
 * Runs only when there is no active administrator, so restarts and a
 * later change to ADMIN_PASSWORD never touch an existing account: after
 * the first start the password is changed with
 * `./scripts/manage-users.sh set-admin-password`.
 */

// Shared with registration's "first account becomes admin" decision in
// modules/auth/service.ts, so the two can never both create an admin.
export const BOOTSTRAP_LOCK_KEY = "invite:bootstrap";

const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;
const MIN_PASSWORD_LENGTH = 10;

export type AdminBootstrapResult =
  | { status: "disabled" }
  | { status: "exists" }
  | { status: "created"; username: string; generatedPassword: string | null }
  | { status: "skipped"; reason: string };

interface Env {
  ADMIN_BOOTSTRAP?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
}

function hasActiveAdmin(client: PrismaClient | Prisma.TransactionClient) {
  return client.user.count({ where: { role: "ADMIN", deletedAt: null } }).then((n) => n > 0);
}

function generatePassword(): string {
  // 24 characters of base64url: 144 bits, no characters a shell or a
  // .env file would need quoting for.
  return randomBytes(18).toString("base64url");
}

/**
 * The check-and-create itself, run under the bootstrap lock. Split out so
 * a test can run it inside a transaction it rolls back.
 */
export async function createAdminIfMissing(
  tx: Prisma.TransactionClient,
  username: string,
  passwordHash: string,
): Promise<"created" | "exists"> {
  if (await hasActiveAdmin(tx)) return "exists";
  await tx.user.create({
    data: {
      username,
      passwordHash,
      role: "ADMIN",
      // Every account is publishable from the start — see registration.
      creatorProfile: { create: { displayName: username } },
    },
  });
  return "created";
}

/** Validates ADMIN_USERNAME / ADMIN_PASSWORD without touching the database. */
export function readAdminSettings(
  env: Env,
): { username: string; configuredPassword: string } | { error: string } {
  const username = (env.ADMIN_USERNAME || "admin").trim();
  if (!USERNAME_PATTERN.test(username)) {
    return { error: `ADMIN_USERNAME='${username}' isn't a valid username (3-32 lowercase letters, digits or underscores)` };
  }
  const configuredPassword = env.ADMIN_PASSWORD ?? "";
  if (configuredPassword && configuredPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  return { username, configuredPassword };
}

export async function ensureAdmin(prisma: PrismaClient, env: Env = process.env): Promise<AdminBootstrapResult> {
  if (env.ADMIN_BOOTSTRAP === "false") return { status: "disabled" };

  // The common case — every start after the first — costs one count.
  if (await hasActiveAdmin(prisma)) return { status: "exists" };

  const settings = readAdminSettings(env);
  if ("error" in settings) return { status: "skipped", reason: settings.error };
  const { username, configuredPassword: configured } = settings;

  // A regular account already holding the name is not promoted: turning
  // someone's existing account into the administrator because of an
  // environment variable would be a silent privilege grant.
  if (!(await isUsernameAvailable(prisma, username))) {
    return {
      status: "skipped",
      reason: `the username '${username}' is already taken by a non-admin account — promote it with ./scripts/manage-users.sh promote ${username}, or choose another ADMIN_USERNAME`,
    };
  }

  const password = configured || generatePassword();
  // Hashed before taking the lock — see withScopeLock.
  const passwordHash = await hashPassword(password);

  const outcome = await withScopeLock(prisma, BOOTSTRAP_LOCK_KEY, (tx) =>
    createAdminIfMissing(tx, username, passwordHash),
  );
  if (outcome === "exists") return { status: "exists" };

  return { status: "created", username, generatedPassword: configured ? null : password };
}

/** Prints the outcome for the operator. Plain console output on purpose:
 * a generated password has to be readable in `docker compose logs api`. */
export function reportAdminBootstrap(result: AdminBootstrapResult): void {
  if (result.status === "skipped") {
    console.warn(`[admin] No administrator exists and none was created: ${result.reason}.`);
    return;
  }
  if (result.status !== "created") return;

  if (result.generatedPassword === null) {
    console.log(
      `[admin] Created administrator '${result.username}' with the password from ADMIN_PASSWORD. First sign-in asks for an authenticator app.`,
    );
    return;
  }
  console.log(
    [
      "",
      "==================================================================",
      `  Administrator '${result.username}' created.`,
      `  Password (shown once): ${result.generatedPassword}`,
      "  Change it: ./scripts/manage-users.sh set-admin-password",
      "  First sign-in asks for an authenticator app (two-factor sign-in).",
      "==================================================================",
      "",
    ].join("\n"),
  );
}
