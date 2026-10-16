import { APP_SLUG, createErrorReporter, type ErrorReporter } from "@platform/shared";
import { runningVersion } from "@platform/shared/node";

/** Error reports when SENTRY_DSN is set (see @platform/shared error-reporting). */
export const errorReporter: ErrorReporter = createErrorReporter({
  dsn: process.env.SENTRY_DSN,
  service: "worker",
  release: `${APP_SLUG}@${runningVersion()}`,
  environment: process.env.SENTRY_ENVIRONMENT || (process.env.NODE_ENV === "production" ? "production" : "development"),
});

/** A job that failed: in the log as before, and to the error server. */
export function jobFailed(job: string, error: unknown): void {
  console.error(`[worker] ${job} failed`, error);
  errorReporter.captureException(error, { tags: { job } });
}
