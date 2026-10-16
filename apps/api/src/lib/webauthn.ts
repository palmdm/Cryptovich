import { constants, createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";

/**
 * Passkeys (WebAuthn) checked with Node's own crypto — no library: the
 * protocol is small and exact, and every step below is one the spec
 * requires (W3C Web Authentication, §7.1 registration, §7.2 assertion).
 *
 * What a browser sends is CBOR (attestationObject, the credential's COSE
 * public key) wrapped around JSON (clientDataJSON) and raw bytes
 * (authenticatorData, signature). The reader below handles the CBOR that
 * authenticators produce: definite-length integers, byte and text
 * strings, arrays, maps, tags and the simple values.
 */

export class WebAuthnError extends Error {}

type Cbor = number | bigint | string | Buffer | boolean | null | undefined | Cbor[] | Map<Cbor, Cbor>;

export function decodeCbor(data: Buffer, start = 0): { value: Cbor; end: number } {
  let pos = start;
  const need = (n: number) => {
    if (pos + n > data.length) throw new WebAuthnError("Truncated CBOR.");
  };
  const readLength = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) { need(1); return data[pos++]!; }
    if (info === 25) { need(2); const v = data.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { need(4); const v = data.readUInt32BE(pos); pos += 4; return v; }
    if (info === 27) {
      need(8);
      const v = data.readBigUInt64BE(pos);
      pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new WebAuthnError("CBOR length too large.");
      return Number(v);
    }
    throw new WebAuthnError("Indefinite or reserved CBOR lengths are not accepted.");
  };
  const item = (depth: number): Cbor => {
    if (depth > 16) throw new WebAuthnError("CBOR nested too deeply.");
    need(1);
    const initial = data[pos++]!;
    const major = initial >> 5;
    const info = initial & 0x1f;
    switch (major) {
      case 0:
        return readLength(info);
      case 1:
        return -1 - readLength(info);
      case 2: {
        const n = readLength(info);
        need(n);
        const bytes = data.subarray(pos, pos + n);
        pos += n;
        return Buffer.from(bytes);
      }
      case 3: {
        const n = readLength(info);
        need(n);
        const text = data.toString("utf8", pos, pos + n);
        pos += n;
        return text;
      }
      case 4: {
        const n = readLength(info);
        const list: Cbor[] = [];
        for (let i = 0; i < n; i += 1) list.push(item(depth + 1));
        return list;
      }
      case 5: {
        const n = readLength(info);
        const map = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i += 1) {
          const k = item(depth + 1);
          map.set(k, item(depth + 1));
        }
        return map;
      }
      case 6:
        readLength(info);
        return item(depth + 1);
      default:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new WebAuthnError("Unsupported CBOR value.");
    }
  };
  const value = item(0);
  return { value, end: pos };
}

export const FLAG_USER_PRESENT = 0x01;
export const FLAG_USER_VERIFIED = 0x04;
export const FLAG_ATTESTED_DATA = 0x40;

export interface AuthenticatorData {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  credentialId?: Buffer;
  credentialPublicKey?: Map<Cbor, Cbor>;
}

export function parseAuthenticatorData(data: Buffer): AuthenticatorData {
  if (data.length < 37) throw new WebAuthnError("Authenticator data is too short.");
  const parsed: AuthenticatorData = {
    rpIdHash: data.subarray(0, 32),
    flags: data[32]!,
    signCount: data.readUInt32BE(33),
  };
  if (parsed.flags & FLAG_ATTESTED_DATA) {
    let pos = 37 + 16; // after the AAGUID
    if (data.length < pos + 2) throw new WebAuthnError("Attested credential data is truncated.");
    const idLength = data.readUInt16BE(pos);
    pos += 2;
    if (idLength === 0 || idLength > 1023 || data.length < pos + idLength) throw new WebAuthnError("Bad credential id.");
    parsed.credentialId = data.subarray(pos, pos + idLength);
    pos += idLength;
    const { value } = decodeCbor(data, pos);
    if (!(value instanceof Map)) throw new WebAuthnError("The credential public key is not a COSE key.");
    parsed.credentialPublicKey = value;
  }
  return parsed;
}

export const COSE_ES256 = -7;
export const COSE_EDDSA = -8;
export const COSE_RS256 = -257;
export const SUPPORTED_ALGORITHMS = [COSE_ES256, COSE_EDDSA, COSE_RS256];

const b64url = (b: Buffer) => b.toString("base64url");

/** A COSE public key as a JWK, with its algorithm — refusing anything but ES256 on P-256, Ed25519 and RS256. */
export function coseToJwk(cose: Map<Cbor, Cbor>): { jwk: JsonWebKey; alg: number } {
  const kty = cose.get(1);
  const alg = cose.get(3);
  const bytes = (label: number): Buffer => {
    const v = cose.get(label);
    if (!Buffer.isBuffer(v)) throw new WebAuthnError("A COSE key parameter is missing.");
    return v;
  };
  if (kty === 2 && alg === COSE_ES256 && cose.get(-1) === 1) {
    const x = bytes(-2);
    const y = bytes(-3);
    if (x.length !== 32 || y.length !== 32) throw new WebAuthnError("Bad P-256 point.");
    return { jwk: { kty: "EC", crv: "P-256", x: b64url(x), y: b64url(y) }, alg };
  }
  if (kty === 1 && alg === COSE_EDDSA && cose.get(-1) === 6) {
    const x = bytes(-2);
    if (x.length !== 32) throw new WebAuthnError("Bad Ed25519 key.");
    return { jwk: { kty: "OKP", crv: "Ed25519", x: b64url(x) }, alg };
  }
  if (kty === 3 && alg === COSE_RS256) {
    const n = bytes(-1);
    if (n.length < 256) throw new WebAuthnError("RSA keys under 2048 bits are not accepted.");
    return { jwk: { kty: "RSA", n: b64url(n), e: b64url(bytes(-2)) }, alg };
  }
  throw new WebAuthnError("This kind of key is not supported.");
}

export function verifyAssertionSignature(jwk: JsonWebKey, alg: number, signed: Buffer, signature: Buffer): boolean {
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    if (alg === COSE_ES256) return verify("sha256", signed, { key, dsaEncoding: "der" }, signature);
    if (alg === COSE_RS256) return verify("sha256", signed, { key, padding: constants.RSA_PKCS1_PADDING }, signature);
    if (alg === COSE_EDDSA) return verify(null, signed, key, signature);
    return false;
  } catch {
    return false;
  }
}

export function sha256(data: Buffer | string): Buffer {
  return createHash("sha256").update(data).digest();
}

/** clientDataJSON: the ceremony, the one-time challenge and the page that asked must all be this server's. */
export function checkClientData(raw: Buffer, expected: { type: "webauthn.create" | "webauthn.get"; challenge: string; origin: string }) {
  let data: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    data = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new WebAuthnError("clientDataJSON is not JSON.");
  }
  if (data.type !== expected.type) throw new WebAuthnError("Wrong ceremony.");
  if (data.challenge !== expected.challenge) throw new WebAuthnError("The challenge does not match.");
  if (data.origin !== expected.origin) throw new WebAuthnError("The request came from another site.");
  if (data.crossOrigin === true) throw new WebAuthnError("Passkeys are not accepted from inside another site's frame.");
}

export function checkAuthenticatorData(data: AuthenticatorData, rpId: string) {
  if (!data.rpIdHash.equals(sha256(rpId))) throw new WebAuthnError("The passkey belongs to another site.");
  if (!(data.flags & FLAG_USER_PRESENT)) throw new WebAuthnError("The person was not present.");
  // A fingerprint, a face or the device PIN: what makes a passkey two factors.
  if (!(data.flags & FLAG_USER_VERIFIED)) throw new WebAuthnError("The device did not verify the person.");
}
