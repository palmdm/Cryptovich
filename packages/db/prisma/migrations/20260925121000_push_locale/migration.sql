-- The language the reader uses 4tip in, so a push arrives in it: the
-- service worker that shows it cannot see the page's language setting.
ALTER TABLE "PushSubscription" ADD COLUMN "locale" TEXT;
