/**
 * User-facing errors carry a message safe to show directly in the UI
 * (spec rule #99 — never leak stack traces / internals to the client).
 * Anything unexpected is logged with full detail and surfaced to the
 * client as a generic message.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly userMessage: string,
    public readonly code: string,
  ) {
    super(userMessage);
  }
}

export const Errors = {
  unauthorized: () => new AppError(401, "You need to sign in to continue.", "UNAUTHORIZED"),
  forbidden: (message = "You don't have permission to do that.") =>
    new AppError(403, message, "FORBIDDEN"),
  notFound: (what = "This item") => new AppError(404, `${what} could not be found.`, "NOT_FOUND"),
  invalidCredentials: () =>
    new AppError(401, "That username or password is incorrect.", "INVALID_CREDENTIALS"),
  usernameTaken: () =>
    new AppError(409, "That username is already taken.", "USERNAME_TAKEN"),
  emailTaken: () =>
    new AppError(409, "That email is already registered.", "EMAIL_TAKEN"),
  validation: (message: string) => new AppError(400, message, "VALIDATION_ERROR"),
  paymentNotReady: () =>
    new AppError(
      409,
      "We couldn't confirm your payment yet. Your transaction may still be waiting for confirmation.",
      "PAYMENT_NOT_READY",
    ),
  // A distinct code (not VALIDATION_ERROR) so the web client can show
  // this in the reader's language rather than the English message.
  notPayable: () =>
    new AppError(400, "This author hasn't set up a way to pay them yet.", "AUTHOR_NOT_PAYABLE"),
  rateLimited: () =>
    new AppError(429, "Too many attempts. Please wait a moment and try again.", "RATE_LIMITED"),
  twoFactorRequired: () =>
    new AppError(401, "Enter your two-factor authentication code to continue.", "TWO_FACTOR_REQUIRED"),
  invalidTwoFactorCode: () => new AppError(401, "That code is incorrect or has expired.", "INVALID_2FA_CODE"),
  // The parameters page opens with a fresh two-factor code, never with a
  // session alone (modules/parameters).
  parametersLocked: () => new AppError(403, "Enter a code from your authenticator app to open the parameters.", "PARAMETERS_LOCKED"),
  twoFactorSetupNeeded: () =>
    new AppError(403, "Set up two-factor sign-in first: the parameters open only with a code from it.", "TWO_FACTOR_SETUP_NEEDED"),
  tooManyTwoFactorAttempts: () =>
    new AppError(429, "Too many wrong codes for this account. Wait 15 minutes, then try again.", "TOO_MANY_2FA_ATTEMPTS"),
  // An administrator signs in with a second factor or not at all: the
  // admin API refuses until one is set up (see lib/admin-two-factor.ts).
  adminTwoFactorRequired: () =>
    new AppError(403, "Set up two-factor sign-in to use the admin area.", "ADMIN_2FA_REQUIRED"),
  // A third party (Spotify) did not answer; the widget says so and offers the link.
  embedUnavailable: () =>
    new AppError(502, "Spotify did not answer just now. Try again in a moment.", "EMBED_UNAVAILABLE"),
  // Its own code so the web client can say it in the reader's language.
  rewardNotHeld: () =>
    new AppError(403, "This sticker is a reward: only an author who was given it can react with it.", "REWARD_NOT_HELD"),
  rewardNotHeldInText: () =>
    new AppError(403, "This text has a reward sticker you were not given. Only an author who was given it can use it.", "REWARD_NOT_HELD"),
  accountSuspended: () =>
    new AppError(403, "This account has been suspended. Contact support if you believe this is a mistake.", "ACCOUNT_SUSPENDED"),
};
