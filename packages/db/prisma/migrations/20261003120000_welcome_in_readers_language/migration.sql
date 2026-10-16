-- Welcome notifications used to carry an English sentence made by the
-- server when the author had written none. They now carry the kind of
-- event and the author's name, worded in the reader's language when shown;
-- the stored English defaults are turned into that form. An author's own
-- welcome text is left exactly as it is.
UPDATE "Notification"
SET payload = (payload - 'message') || jsonb_build_object('kind', 'NEW_SUBSCRIBER', 'creatorName', substring(payload->>'message' from '^Thanks for subscribing to (.*)!$'))
WHERE type = 'WELCOME_MESSAGE' AND payload->>'message' ~ '^Thanks for subscribing to .*!$';

UPDATE "Notification"
SET payload = (payload - 'message') || jsonb_build_object('kind', 'RENEWAL', 'creatorName', substring(payload->>'message' from '^Thanks for renewing your subscription to (.*)!$'))
WHERE type = 'WELCOME_MESSAGE' AND payload->>'message' ~ '^Thanks for renewing your subscription to .*!$';

UPDATE "Notification"
SET payload = (payload - 'message') || jsonb_build_object('kind', 'DONOR', 'creatorName', substring(payload->>'message' from '^Thank you so much for supporting (.*)!$'))
WHERE type = 'WELCOME_MESSAGE' AND payload->>'message' ~ '^Thank you so much for supporting .*!$';
