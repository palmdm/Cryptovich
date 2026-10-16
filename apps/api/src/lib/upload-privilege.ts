import type { PrismaClient } from "@platform/db";
import { Errors } from "./errors.js";

/**
 * Storing files costs the operator disk and bandwidth, so uploading to
 * this server is a privilege granted alongside API access when an
 * administrator confirms a contribution. Everyone else references files
 * hosted elsewhere — the post body takes links, and cover images are
 * already external URLs.
 *
 * Avatars are deliberately not gated: they are small, capped, and every
 * author needs one for the profile to work at all.
 */
export async function requireUploadPrivilege(prisma: PrismaClient, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { canUploadFiles: true, role: true },
  });
  // Administrators run the server; making them contribute to it would be
  // circular.
  if (user?.role === "ADMIN") return;
  if (!user?.canUploadFiles) {
    throw Errors.forbidden(
      "Uploading files to this server is available to supporters — contribute from your dashboard, or link to a file hosted elsewhere.",
    );
  }
}
