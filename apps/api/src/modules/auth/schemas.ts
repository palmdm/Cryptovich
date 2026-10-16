import { z } from "zod";

const username = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/, "Username can only contain lowercase letters, numbers and underscores.");

const password = z.string().min(10).max(200);

export const registerSchema = z.object({
  username,
  password,
  email: z.string().email().optional(),
  // Registration is invite-only. Optional in the schema rather than
  // required, because the very first account on a fresh installation is
  // created without one — the service decides, not the parser.
  inviteCode: z.string().max(120).optional(),
  // The answer to GET /auth/register/challenge (lib/registration-check.ts).
  challengeId: z.string().max(64).optional(),
  nonce: z.string().max(20).optional(),
});

export const loginSchema = z.object({
  identifier: z.string().min(1), // username or email
  password: z.string().min(1),
  code: z.string().length(6).optional(), // TOTP code, required only if the account has 2FA enabled
});

export const verify2faSchema = z.object({ code: z.string().length(6) });

// The phone approving a computer's sign-in: the number it was shown, and
// whether the computer should stay signed in or only until it is closed.
export const qrApproveSchema = z.object({ number: z.string().regex(/^\d{2}$/), temporary: z.boolean() });

const b64url = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/);

// What the browser's navigator.credentials.create() returned, in base64url.
export const passkeyRegisterSchema = z.object({
  rawId: b64url(1400),
  response: z.object({
    clientDataJSON: b64url(4096),
    attestationObject: b64url(32768),
    transports: z.array(z.string().max(20)).max(10).optional(),
  }),
  name: z.string().max(60).optional(),
});

// …and what navigator.credentials.get() returned, with the challenge's id.
export const passkeyAssertionSchema = z.object({
  rawId: b64url(1400),
  response: z.object({
    clientDataJSON: b64url(4096),
    authenticatorData: b64url(4096),
    signature: b64url(2048),
    userHandle: b64url(128).nullable().optional(),
  }),
});
export const passkeyLoginSchema = passkeyAssertionSchema.extend({ challengeId: z.string().max(64) });
// Disabling 2FA requires proving both factors — the password AND a
// current code — otherwise a leaked password alone strips the second
// factor exactly when it's meant to stop that.
export const disable2faSchema = z.object({ password: z.string().min(1), code: z.string().length(6) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1),
  // Same floor as registration — a reset must not be a way around it.
  password,
});

export const confirmEmailSchema = z.object({
  token: z.string().min(1),
});
