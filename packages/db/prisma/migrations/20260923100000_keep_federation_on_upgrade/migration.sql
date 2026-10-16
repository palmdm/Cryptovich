-- Federation became a server-wide switch (ServerSetting "federationEnabled")
-- that defaults to off. An installation where authors were already
-- federating would have gone silent on upgrade, with nothing on the page
-- saying why: every actor, WebFinger lookup and inbox started answering 404.
--
-- So an installation that was federating keeps federating. ON CONFLICT
-- leaves an explicit choice the administrator has already made alone.
INSERT INTO "ServerSetting" ("key", "value", "updatedAt")
SELECT 'federationEnabled', 'true', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "CreatorFederationSettings" WHERE "enabled" = true)
ON CONFLICT ("key") DO NOTHING;
