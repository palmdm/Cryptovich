-- Live streams are gone: they announced a link and nothing more, and
-- nothing here could actually broadcast. Their notifications go with them,
-- or they would show as blank entries.
DELETE FROM "Notification" WHERE "type" = 'STREAM_LIVE';
DROP TABLE "LiveStream";
DROP TYPE "LiveStreamStatus";
