import type { Instrumentation } from "next";
import { APP_SLUG, APP_VERSION, createErrorReporter, type ErrorReporter } from "@platform/shared";

let reporter: ErrorReporter | null = null;

/**
 * An error while the web server renders a page or runs a route goes to
 * the error server when SENTRY_DSN is set (see @platform/shared
 * error-reporting) — by the route's pattern (`/[username]/posts/[id]`),
 * never the address a reader opened, their cookies or headers.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  reporter ??= createErrorReporter({
    dsn: process.env.SENTRY_DSN,
    service: "web",
    release: `${APP_SLUG}@${process.env.APP_VERSION || APP_VERSION}`,
    environment: process.env.SENTRY_ENVIRONMENT || (process.env.NODE_ENV === "production" ? "production" : "development"),
  });
  if (!reporter.enabled) return;
  reporter.captureException(error, { tags: { route: context.routePath, kind: context.routeType, method: request.method } });
  await reporter.flush(2000);
};
