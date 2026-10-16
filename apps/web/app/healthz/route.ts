/**
 * The web server is up — for the status page (apps/status). Answers
 * without asking the API, so a fallen API does not read as a fallen site.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
