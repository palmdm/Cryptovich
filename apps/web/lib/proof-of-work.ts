/**
 * The browser's half of the sign-up check (apps/api/src/lib/registration-
 * check.ts): find a nonce whose SHA-256 of "<salt>:<nonce>" starts with
 * `bits` zero bits. Expected work is 2^bits hashes, so this is written to
 * be fast rather than general — the message always fits one 64-byte block
 * (32 hex characters of salt, a colon, at most 15 digits), and nothing is
 * allocated per attempt.
 */

// SHA-256's constants are the fractional parts of the cube roots (K) and
// square roots (H) of the first primes; computed rather than pasted.
const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every((p) => n % p !== 0)) PRIMES.push(n);
const frac32 = (x: number) => ((x - Math.floor(x)) * 0x100000000) >>> 0;
const K = Uint32Array.from(PRIMES, (p) => frac32(Math.cbrt(p)));
const H0 = Uint32Array.from(PRIMES.slice(0, 8), (p) => frac32(Math.sqrt(p)));

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 of one already-padded 64-byte block, into `out` (8 words). */
function compress(block: Uint32Array, w: Uint32Array, out: Uint32Array) {
  for (let i = 0; i < 16; i++) w[i] = block[i]!;
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15]!;
    const b = w[i - 2]!;
    const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
    const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
  }
  let a = H0[0]!, b = H0[1]!, c = H0[2]!, d = H0[3]!, e = H0[4]!, f = H0[5]!, g = H0[6]!, h = H0[7]!;
  for (let i = 0; i < 64; i++) {
    const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  out[0] = (H0[0]! + a) | 0;
  out[1] = (H0[1]! + b) | 0;
  out[2] = (H0[2]! + c) | 0;
  out[3] = (H0[3]! + d) | 0;
  out[4] = (H0[4]! + e) | 0;
  out[5] = (H0[5]! + f) | 0;
  out[6] = (H0[6]! + g) | 0;
  out[7] = (H0[7]! + h) | 0;
}

/** SHA-256 of a short ASCII string (at most 55 characters) — one block. */
export function sha256Short(text: string): Uint8Array {
  if (text.length > 55 || [...text].some((c) => c.charCodeAt(0) > 0x7f)) {
    throw new Error("sha256Short takes up to 55 ASCII characters");
  }
  const bytes = new Uint8Array(64);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  bytes[text.length] = 0x80;
  new DataView(bytes.buffer).setUint32(60, text.length * 8);
  const block = new Uint32Array(16);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 16; i++) block[i] = view.getUint32(i * 4);
  const out = new Uint32Array(8);
  compress(block, new Uint32Array(64), out);
  const digest = new Uint8Array(32);
  const dv = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, out[i]!);
  return digest;
}

function leadingZeroBitsOfWords(words: Uint32Array): number {
  let bits = 0;
  for (const word of words) {
    if (word === 0) {
      bits += 32;
      continue;
    }
    return bits + Math.clz32(word);
  }
  return bits;
}

export interface Challenge {
  id: string;
  salt: string;
  bits: number;
}

/**
 * The first nonce that meets the challenge. Yields to the page every few
 * thousand attempts so the form stays responsive while it works.
 */
export async function solveChallenge(challenge: Pick<Challenge, "salt" | "bits">): Promise<string> {
  const prefix = `${challenge.salt}:`;
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < prefix.length; i++) bytes[i] = prefix.charCodeAt(i);
  const block = new Uint32Array(16);
  const w = new Uint32Array(64);
  const out = new Uint32Array(8);

  for (let nonce = 0; nonce < Number.MAX_SAFE_INTEGER; nonce++) {
    const digits = String(nonce);
    let len = prefix.length;
    for (let i = 0; i < digits.length; i++) bytes[len++] = digits.charCodeAt(i);
    bytes[len] = 0x80;
    bytes.fill(0, len + 1, 60);
    view.setUint32(60, len * 8);
    for (let i = 0; i < 16; i++) block[i] = view.getUint32(i * 4);
    compress(block, w, out);
    if (leadingZeroBitsOfWords(out) >= challenge.bits) return digits;
    if (nonce % 20000 === 19999) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("No answer found");
}
