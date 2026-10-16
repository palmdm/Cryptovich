"use client";

import { apiFetch } from "./api";

/**
 * Passkeys in the browser: the two calls to navigator.credentials and the
 * base64url the API speaks. The fingerprint, face or PIN is the device's
 * own prompt; nothing biometric ever reaches this page or the server.
 */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && Boolean(navigator.credentials);
}

const toBytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const toB64url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

interface RegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout: number;
  attestation: AttestationConveyancePreference;
  authenticatorSelection: AuthenticatorSelectionCriteria;
  excludeCredentials: { type: "public-key"; id: string; transports?: AuthenticatorTransport[] }[];
}

/** Adds a passkey to the signed-in account: the device asks for the fingerprint, face or PIN. */
export async function addPasskey(): Promise<void> {
  const options = await apiFetch<RegistrationOptions>("/auth/passkeys/register/options", { method: "POST" });
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: toBytes(options.challenge),
      user: { ...options.user, id: toBytes(options.user.id) },
      excludeCredentials: options.excludeCredentials.map((c) => ({ ...c, id: toBytes(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("cancelled");
  const response = credential.response as AuthenticatorAttestationResponse;
  await apiFetch("/auth/passkeys/register", {
    method: "POST",
    body: JSON.stringify({
      rawId: toB64url(credential.rawId),
      response: {
        clientDataJSON: toB64url(response.clientDataJSON),
        attestationObject: toB64url(response.attestationObject),
        transports: typeof response.getTransports === "function" ? response.getTransports() : undefined,
      },
    }),
  });
}

interface LoginOptions {
  challengeId: string;
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: UserVerificationRequirement;
}

/** Signs in with a passkey this device holds for the site — no username needed. */
export async function signInWithPasskey(): Promise<void> {
  const options = await apiFetch<LoginOptions>("/auth/passkeys/login/options", { method: "POST" });
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: toBytes(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: options.userVerification,
      allowCredentials: [],
    },
  })) as PublicKeyCredential | null;
  await apiFetch("/auth/passkeys/login", { method: "POST", body: JSON.stringify({ challengeId: options.challengeId, ...assertionOf(credential) }) });
}

/** What the device signed, the way the API reads it. */
function assertionOf(credential: PublicKeyCredential | null) {
  if (!credential) throw new Error("cancelled");
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    rawId: toB64url(credential.rawId),
    response: {
      clientDataJSON: toB64url(response.clientDataJSON),
      authenticatorData: toB64url(response.authenticatorData),
      signature: toB64url(response.signature),
      userHandle: response.userHandle ? toB64url(response.userHandle) : null,
    },
  };
}

export type PasskeyAssertion = ReturnType<typeof assertionOf>;

interface ConfirmOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: UserVerificationRequirement;
  allowCredentials: { type: "public-key"; id: string; transports?: AuthenticatorTransport[] }[];
}

/**
 * A fresh fingerprint (or face, or PIN) from one of the signed-in
 * account's own passkeys, for a step that asks more than the session —
 * `optionsPath` is that step's challenge. The answer goes back to the
 * step's own route.
 */
export async function confirmWithPasskey(optionsPath: string): Promise<PasskeyAssertion> {
  const options = await apiFetch<ConfirmOptions>(optionsPath, { method: "POST" });
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: toBytes(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: options.userVerification,
      allowCredentials: options.allowCredentials.map((c) => ({ ...c, id: toBytes(c.id) })),
    },
  })) as PublicKeyCredential | null;
  return assertionOf(credential);
}

/** The browser's "the person closed the prompt" — not worth an error message. */
export function cancelledByPerson(err: unknown): boolean {
  if (err instanceof Error && err.message === "cancelled") return true;
  return err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");
}
