-- How a session was opened (password, QR from a phone, passkey), and
-- whether it is a temporary one that ends when the browser closes.
ALTER TABLE "Session" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'password',
ADD COLUMN "ephemeral" BOOLEAN NOT NULL DEFAULT false;
