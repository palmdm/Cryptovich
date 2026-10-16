import { APP_SLUG, createErrorReporter, type ErrorReporter } from "@platform/shared";
import { runningVersion } from "@platform/shared/node";
export { reportCrashes } from "@platform/shared/node";
import { config } from "../config.js";

/**
 * Error reports to a Sentry-compatible server when SENTRY_DSN is set —
 * sentry.io, a self-hosted Sentry or GlitchTip — and nothing at all
 * otherwise. What goes: an error this API did not expect (a 500), with
 * its stack and route pattern; never who asked or what they sent.
 */
export const errorReporter: ErrorReporter = createErrorReporter({
  dsn: process.env.SENTRY_DSN,
  service: "api",
  release: `${APP_SLUG}@${runningVersion()}`,
  environment: process.env.SENTRY_ENVIRONMENT || (config.isProduction ? "production" : "development"),
});
