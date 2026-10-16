import { createHash, createSign, generateKeyPairSync } from "node:crypto";

export interface ActorKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/** One RSA keypair per creator actor, generated once when federation is first enabled. */
export function generateActorKeyPair(): ActorKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

export type SignedRequestHeaders = Record<"Host" | "Date" | "Digest" | "Signature" | "Content-Type", string>;

/**
 * HTTP Signatures (draft-cavage), the scheme Mastodon/Sharkey/most of the
 * fediverse require on inbox deliveries. Without this, every real
 * instance drops the request — this is the part of ActivityPub delivery
 * that has to be genuinely correct, not mocked (spec rule #149: real
 * abstractions, not stubs pretending to be real).
 */
export function signRequest(params: {
  keyId: string;
  privateKeyPem: string;
  method: "POST" | "GET";
  targetUrl: string;
  body: string;
}): SignedRequestHeaders {
  const url = new URL(params.targetUrl);
  const date = new Date().toUTCString();
  const digest = `SHA-256=${createHash("sha256").update(params.body).digest("base64")}`;
  const requestTarget = `${params.method.toLowerCase()} ${url.pathname}${url.search}`;

  const signingString = [
    `(request-target): ${requestTarget}`,
    `host: ${url.host}`,
    `date: ${date}`,
    `digest: ${digest}`,
  ].join("\n");

  const signature = createSign("RSA-SHA256").update(signingString).sign(params.privateKeyPem, "base64");

  const signatureHeader = [
    `keyId="${params.keyId}"`,
    `algorithm="rsa-sha256"`,
    `headers="(request-target) host date digest"`,
    `signature="${signature}"`,
  ].join(",");

  return {
    Host: url.host,
    Date: date,
    Digest: digest,
    Signature: signatureHeader,
    "Content-Type": "application/activity+json",
  };
}

/** Headers to add to one outgoing GET, for the URL it is about to hit. */
export type RequestSigner = (url: string) => Record<string, string>;

/**
 * A signed GET, for reading from a server in "authorized fetch" (secure)
 * mode — mastodon.social and many self-hosted Mastodons among them — which
 * answers 401 to any unsigned request, even for a public actor. Unsigned,
 * this server cannot read a follower's key or inbox, so every Follow from
 * such a server is refused with nothing visibly wrong on either side.
 * Sharkey signs these fetches as a matter of course, which is why it
 * federated from the same host without trouble.
 *
 * Covers `(request-target) host date`, which is what Mastodon requires of
 * a GET: there is no body, so there is no digest.
 */
export function signGetRequest(params: {
  keyId: string;
  privateKeyPem: string;
  targetUrl: string;
}): Record<"Host" | "Date" | "Signature", string> {
  const url = new URL(params.targetUrl);
  const date = new Date().toUTCString();
  const signingString = [
    `(request-target): get ${url.pathname}${url.search}`,
    `host: ${url.host}`,
    `date: ${date}`,
  ].join("\n");
  const signature = createSign("RSA-SHA256").update(signingString).sign(params.privateKeyPem, "base64");
  return {
    Host: url.host,
    Date: date,
    Signature: [
      `keyId="${params.keyId}"`,
      `algorithm="rsa-sha256"`,
      `headers="(request-target) host date"`,
      `signature="${signature}"`,
    ].join(","),
  };
}

/** A `RequestSigner` that signs as the given key. */
export function getRequestSigner(keyId: string, privateKeyPem: string): RequestSigner {
  return (targetUrl) => signGetRequest({ keyId, privateKeyPem, targetUrl });
}
