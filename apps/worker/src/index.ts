import { expireStalePayments } from "./jobs/expire-stale-payments.js";
import { APP_NAME } from "@platform/shared";
import { reportCrashes, runningVersion } from "@platform/shared/node";
import { expireLapsedSubscriptions, warnExpiringSubscriptions } from "./jobs/expire-subscriptions.js";
import { processFederationJobs } from "./jobs/process-federation-jobs.js";
import { deliverToFollowers } from "./jobs/deliver-to-followers.js";
import { ingestExternalFeeds } from "./jobs/ingest-external-feeds.js";
import { withJobLease } from "./lib/job-lock.js";
import { sendPushNotifications } from "./jobs/send-push-notifications.js";
import { processEmojiImports } from "./jobs/process-emoji-imports.js";
import { notifyBirthdays } from "./jobs/notify-birthdays.js";
import { cleanFilesWhenDue } from "./jobs/clean-files.js";
import { pollTelegram } from "./jobs/telegram-bridge.js";
import { sendTelegramPosts } from "./jobs/send-telegram-posts.js";
import { errorReporter, jobFailed } from "./lib/error-reporter.js";
import { markTick, serveHealth } from "./lib/health.js";

const RECONCILIATION_INTERVAL_MS = 30_000;
const IMPORT_POLL_INTERVAL_MS = 5_000;
const FEDERATION_POLL_INTERVAL_MS = 10_000;
const FEED_INGEST_POLL_INTERVAL_MS = 60_000;
// A notification should reach the browser about when it reaches the bell.
const PUSH_POLL_INTERVAL_MS = 5_000;
// Birthdays are a once-a-day matter; ten minutes late is on time.
const BIRTHDAY_INTERVAL_MS = 10 * 60_000;

// Each lease outlives its job's realistic worst case by a wide margin —
// a lapsed lease while the holder is still working is the one failure
// that reintroduces double-processing. Feed ingestion and federation
// delivery both make outbound HTTP calls, so theirs are the longest.
const RECONCILIATION_LEASE_MS = 60_000;
const IMPORT_LEASE_MS = 120_000;
const FEDERATION_LEASE_MS = 120_000;
const FEED_INGEST_LEASE_MS = 300_000;
const PUSH_LEASE_MS = 60_000;
const BIRTHDAY_LEASE_MS = 120_000;

async function reconciliationTick() {
  await withJobLease("reconciliation", RECONCILIATION_LEASE_MS, async () => {
  try {
    const payments = await expireStalePayments();
    if (payments > 0) console.log(`[worker] expired ${payments} stale payment(s)`);
  } catch (err) {
    jobFailed("payment reconciliation tick", err);
  }

  try {
    const subs = await expireLapsedSubscriptions();
    if (subs > 0) console.log(`[worker] lapsed ${subs} subscription(s)`);
  } catch (err) {
    jobFailed("subscription reconciliation tick", err);
  }

  try {
    const warned = await warnExpiringSubscriptions();
    if (warned > 0) console.log(`[worker] warned ${warned} subscriber(s) of an ending period`);
  } catch (err) {
    jobFailed("subscription expiry warning tick", err);
  }
  });
}

async function importTick() {
  await withJobLease("sticker-imports", IMPORT_LEASE_MS, async () => {
    // Sticker sets the administrator is bringing into the server's library.
    try {
      const count = await processEmojiImports();
      if (count > 0) console.log("[worker] ran a sticker library import");
    } catch (err) {
      jobFailed("sticker library import", err);
    }
  });
}

async function federationTick() {
  await withJobLease("federation-delivery", FEDERATION_LEASE_MS, async () => {
    try {
      const count = await processFederationJobs();
      if (count > 0) console.log(`[worker] processed ${count} federation delivery job(s)`);
    } catch (err) {
      jobFailed("federation tick", err);
    }

    // The deliveries a follower is waiting for: new posts to the inbox of
    // everyone who followed the author from another server.
    try {
      const count = await deliverToFollowers();
      if (count > 0) console.log(`[worker] handled ${count} follower delivery(ies)`);
    } catch (err) {
      jobFailed("follower delivery tick", err);
    }
  });
}

async function pushTick() {
  await withJobLease("push-notifications", PUSH_LEASE_MS, async () => {
    try {
      const count = await sendPushNotifications();
      if (count > 0) console.log(`[worker] pushed ${count} notification(s) to browsers`);
    } catch (err) {
      jobFailed("push tick", err);
    }
  });
}

async function birthdayTick() {
  await withJobLease("birthdays", BIRTHDAY_LEASE_MS, async () => {
    try {
      const count = await notifyBirthdays();
      if (count > 0) console.log(`[worker] told ${count} subscriber(s) about an author's birthday`);
    } catch (err) {
      jobFailed("birthday tick", err);
    }
  });
}

// The nightly clean-up of files nothing names any more (22:00 Moscow);
// checked every ten minutes, it runs once a day.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const CLEANUP_LEASE_MS = 30 * 60 * 1000;
async function cleanupTick() {
  await withJobLease("file-cleanup", CLEANUP_LEASE_MS, async () => {
    try {
      const done = await cleanFilesWhenDue();
      if (done) {
        console.log(
          `[worker] clean-up: ${done.filesRemoved} file(s) nothing used (${(done.bytesFreed / 1024 / 1024).toFixed(1)} MB), ${done.attachmentsRemoved} attachment(s) of deleted posts`,
        );
      }
    } catch (err) {
      jobFailed("file clean-up", err);
    }
  });
}

async function feedIngestTick() {
  await withJobLease("feed-ingestion", FEED_INGEST_LEASE_MS, async () => {
    try {
      const count = await ingestExternalFeeds();
      if (count > 0) console.log(`[worker] ingested ${count} external feed post(s)`);
    } catch (err) {
      jobFailed("feed ingestion tick", err);
    }
  });
}

/** New posts to members' Telegram chats (when the bridge is on). */
async function telegramPostsTick() {
  await withJobLease("telegram-posts", 2 * 60 * 1000, () => sendTelegramPosts());
}

/**
 * The Telegram bridge's own loop, not an interval: each round is a long
 * poll that waits for messages, and the next starts when it returns. The
 * lease keeps a second worker from polling the same bot (Telegram refuses
 * two at once); with the bridge off it only looks again every 15 seconds.
 */
async function telegramBridgeLoop() {
  for (;;) {
    let waitMs = 1000;
    try {
      const handled = await withJobLease("telegram-bridge", 90 * 1000, () => pollTelegram());
      if (handled === null || handled === -1) waitMs = 15_000;
    } catch (err) {
      jobFailed("telegram bridge", err);
      waitMs = 15_000;
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

console.log(
  `[worker] ${APP_NAME} v${runningVersion()} — starting background job loops (reconciliation every 30s, sticker imports every 5s, federation every 10s, feed ingestion every 60s, browser pushes every 5s, Telegram posts every 5s, birthdays every 10min, file clean-up daily at 22:00 Moscow)`,
);
// Every job takes a database lease first, so running more than one
// worker is safe: the others skip a tick already being handled rather
// than repeating it.
//
// A tick that cannot even take its lease — the database is down — is
// reported and tried again next time, rather than crashing the worker
// into a restart loop for as long as the outage lasts.
function every(name: string, intervalMs: number, tick: () => Promise<unknown>) {
  const run = () => tick().then(markTick, (err: unknown) => jobFailed(name, err));
  void run();
  setInterval(run, intervalMs);
}

reportCrashes(errorReporter, "worker");
serveHealth(Number(process.env.WORKER_HEALTH_PORT ?? 3006));
every("reconciliation", RECONCILIATION_INTERVAL_MS, reconciliationTick);
every("sticker imports", IMPORT_POLL_INTERVAL_MS, importTick);
every("federation", FEDERATION_POLL_INTERVAL_MS, federationTick);
every("feed ingestion", FEED_INGEST_POLL_INTERVAL_MS, feedIngestTick);
every("browser pushes", PUSH_POLL_INTERVAL_MS, pushTick);
every("birthdays", BIRTHDAY_INTERVAL_MS, birthdayTick);
every("file clean-up", CLEANUP_INTERVAL_MS, cleanupTick);
every("telegram posts", 5000, telegramPostsTick);
void telegramBridgeLoop();
