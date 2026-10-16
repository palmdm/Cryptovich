import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { APP_NAME } from "@platform/shared";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

/** RFC 4648 base32 (no padding) — the encoding TOTP secrets/QR URIs use. */
export function base32Encode(buffer: Buffer): string {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP — plain node:crypto HMAC-SHA1, no external dependency. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return (binCode % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export function generateTotp(secret: string, at: Date = new Date()): string {
  return hotp(secret, Math.floor(at.getTime() / 1000 / STEP_SECONDS));
}

/** Constant-time digit-string comparison — a plain `===` here would let an
 * attacker who can send tightly-timed requests use response-time
 * differences to narrow down the correct code faster than brute force. */
function codesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Accepts the current and adjacent 30s windows to tolerate minor clock drift. */
export function verifyTotp(secret: string, token: string, at: Date = new Date()): boolean {
  const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS);
  let matched = false;
  for (const drift of [-1, 0, 1]) {
    // Check every window rather than short-circuiting on the first match,
    // so the function's timing doesn't itself reveal which window matched.
    if (codesMatch(hotp(secret, counter + drift), token)) matched = true;
  }
  return matched;
}

export function totpAuthUri(secret: string, accountLabel: string, issuer = APP_NAME): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
