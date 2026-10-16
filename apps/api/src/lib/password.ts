import argon2 from "argon2";

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

let decoy: Promise<string> | null = null;

/**
 * The same work as checking a real password, for a sign-in naming no
 * account. Answering at once there and after a hash elsewhere told anyone
 * timing the reply which email addresses have an account here.
 */
export async function verifyAgainstDecoy(plain: string): Promise<false> {
  decoy ??= hashPassword("decoy password that no account has");
  await verifyPassword(await decoy, plain);
  return false;
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
