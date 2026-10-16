/**
 * Runs the migrations against TEST_DATABASE_URL instead of DATABASE_URL,
 * so the suite gets its own database and stops filling the development
 * one with fixture users. Reads the repo-root .env directly rather than
 * pulling in dotenv-cli and cross-env just for this one command.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../../.env");

function readEnvVar(name) {
  let contents;
  try {
    contents = readFileSync(envPath, "utf8");
  } catch {
    throw new Error(`Could not read ${envPath}. Copy .env.example to .env first.`);
  }
  for (const line of contents.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && match[1] === name) return match[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const testUrl = process.env.TEST_DATABASE_URL ?? readEnvVar("TEST_DATABASE_URL");
if (!testUrl) {
  console.error("TEST_DATABASE_URL is not set in .env — see .env.example for the expected value.");
  process.exit(1);
}

console.log(`Applying migrations to ${testUrl.replace(/:[^:@]+@/, ":****@")}`);
execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  stdio: "inherit",
  cwd: resolve(here, ".."),
  env: { ...process.env, DATABASE_URL: testUrl },
});
