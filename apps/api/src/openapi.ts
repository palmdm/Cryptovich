/**
 * The prose half of the API reference at /docs. The reference itself is
 * generated from the registered routes (lib/openapi-generate.ts) — every
 * endpoint, its path parameters, the body its zod schema accepts, who may
 * call it. What a route cannot say about itself lives here: summaries,
 * descriptions, response shapes, tag descriptions, the security schemes.
 * An entry is laid over the generated one with the same method and path;
 * an entry for a route that no longer exists is simply not shown.
 */

const errorResponse = {
  description: "Error",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: { code: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
  },
};

function jsonBody(schema: object) {
  return { required: true, content: { "application/json": { schema } } };
}

function ok(description: string, schema?: object) {
  return { description, ...(schema ? { content: { "application/json": { schema } } } : {}) };
}

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Cryptovich API",
    version: "1.0.0",
    description:
      "Cryptovich's API. To try it on this page, press **Authorize** and paste a Cryptovich token (Dashboard → API tokens; it starts with `pat_`) — nothing else is needed. Signed in to Cryptovich in this browser, the page also sends your session by itself. From your own scripts: `Authorization: Bearer pat_…`.",
  },
  components: {
    // The token only. A signed-in browser's session cookie works too, but
    // it is sent by the browser, never pasted: listed here, it showed as a
    // second field under Authorize and read as one more thing required.
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "A Cryptovich token (Dashboard → API tokens), starting with pat_." },
    },
    responses: { Error: errorResponse },
    schemas: {
      Money: { type: "string", description: "Minor-unit integer as a decimal string, e.g. \"1050\" for $10.50." },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Auth" },
    { name: "Tokens", description: "Personal access tokens — the mini-API for automation." },
    { name: "Creators" },
    { name: "Products" },
    { name: "Store" },
    { name: "Payments" },
    { name: "Donations" },
    { name: "Subscriptions" },
    { name: "Comments" },
    { name: "Notifications" },
    { name: "Feed Sources", description: "Second-feed ingestion from RSS/Atom, Mastodon or Sharkey." },
    { name: "Wallets", description: "Payout addresses an author publishes so supporters can pay them directly." },
    { name: "Taxonomy", description: "Author-scoped sections and global tags." },
    { name: "Files", description: "Files sold as products, gated by entitlement on every download." },
    { name: "Emoji", description: "Author-scoped :shortcode: emoji used in posts and comments." },
    { name: "Invites", description: "Registration codes. Admin-only to mint; required to register." },
    {
      name: "Embeds",
      description:
        "Spotify widgets: the title and cover this server reads from Spotify (once a day per item), so a reader's browser contacts Spotify only when they load the player.",
    },
    {
      name: "Rewards",
      description:
        "Server stickers a supporter buys for an author — alone, or in the same payment as a tip or a subscription. Settled when the author confirms the payment; only an author who holds one may react with it.",
    },
    { name: "Library" },
    { name: "Admin" },
  ],
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Create an account",
        security: [],
        requestBody: jsonBody({
          type: "object",
          required: ["username", "password"],
          properties: { username: { type: "string" }, password: { type: "string" }, email: { type: "string" } },
        }),
        responses: { "201": ok("Registered and signed in"), "400": errorResponse, "409": errorResponse },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Sign in",
        security: [],
        requestBody: jsonBody({
          type: "object",
          required: ["identifier", "password"],
          properties: { identifier: { type: "string" }, password: { type: "string" }, code: { type: "string", description: "6-digit 2FA code, if enabled" } },
        }),
        responses: { "200": ok("Signed in"), "401": errorResponse },
      },
    },
    "/auth/me": {
      get: { tags: ["Auth"], summary: "Current session/token identity", responses: { "200": ok("{ user: CurrentUser | null }") } },
    },
    "/tokens": {
      post: {
        tags: ["Tokens"],
        summary: "Create a personal access token",
        description: "The raw token is returned exactly once, in this response, and is never recoverable afterward.",
        requestBody: jsonBody({ type: "object", required: ["name"], properties: { name: { type: "string" } } }),
        responses: { "201": ok("{ token, id, name, createdAt } — copy `token` now", { type: "object" }), "401": errorResponse },
      },
    },
    "/tokens/mine": {
      get: { tags: ["Tokens"], summary: "List your active tokens (never includes the raw value or hash)", responses: { "200": ok("{ tokens: [] }") } },
    },
    "/tokens/{id}": {
      delete: {
        tags: ["Tokens"],
        summary: "Revoke a token",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ ok: true }"), "404": errorResponse },
      },
    },
    "/creators": {
      get: {
        tags: ["Creators"],
        summary: "Public author directory — every author with something published (no session required)",
        responses: { "200": ok("{ creators: [] }") },
      },
      post: {
        tags: ["Creators"],
        summary: "Become a creator (idempotent)",
        requestBody: jsonBody({ type: "object", required: ["displayName"], properties: { displayName: { type: "string" }, bio: { type: "string" } } }),
        responses: { "201": ok("Creator profile") },
      },
    },
    "/creators/me": {
      patch: {
        tags: ["Creators"],
        summary: "Update your creator profile",
        requestBody: jsonBody({
          type: "object",
          properties: {
            displayName: { type: "string" },
            bio: { type: "string" },
            manualPaymentInstructions: { type: "string", description: "Empty string disables the manual payment method." },
            welcomeMessageNewSubscriber: { type: "string" },
            welcomeMessageRenewal: { type: "string" },
            welcomeMessageDonor: { type: "string" },
          },
        }),
        responses: { "200": ok("Updated profile") },
      },
      get: { tags: ["Creators"], summary: "Your own full profile, including private fields", responses: { "200": ok("Creator profile") } },
    },
    "/creators/{username}": {
      get: {
        tags: ["Creators"],
        security: [],
        summary: "Public creator profile",
        parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("Public profile"), "404": errorResponse },
      },
    },
    "/creators/me/avatar": {
      post: {
        tags: ["Creators"],
        summary: "Upload an avatar (PNG/JPEG/GIF/WebP, no SVG)",
        requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } } },
        responses: { "200": ok("Updated profile"), "400": errorResponse },
      },
    },
    "/products/posts": {
      post: {
        tags: ["Products"],
        summary: "Create a post (draft)",
        requestBody: jsonBody({
          type: "object",
          required: ["title", "content", "visibility", "currency", "priceDecimal"],
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            visibility: { type: "string", enum: ["PUBLIC", "PURCHASED", "SUBSCRIBERS", "TIER"] },
            requiredTierId: { type: "string" },
            currency: { type: "string", enum: ["USD", "EUR"] },
            priceDecimal: { type: "string", example: "5.00" },
          },
        }),
        responses: { "201": ok("Created product") },
      },
    },
    "/products/{id}/publish": {
      post: {
        tags: ["Products"],
        summary: "Publish a draft/archived product",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("Published product") },
      },
    },
    "/products/{id}/unpublish": {
      post: {
        tags: ["Products"],
        summary: "Archive a published product",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("Archived product") },
      },
    },
    "/products/mine": { get: { tags: ["Products"], summary: "Your own products, any status", responses: { "200": ok("{ products: [] }") } } },
    "/products/{id}/attachments": {
      post: {
        tags: ["Products"],
        summary: "Upload a file/video/audio/image attachment to a post (≤5MB)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } } },
        responses: { "201": ok("Created attachment"), "400": errorResponse },
      },
    },
    "/products/{id}/attachments/{attachmentId}": {
      delete: {
        tags: ["Products"],
        summary: "Remove an attachment",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "attachmentId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": ok("{ ok: true }") },
      },
    },
    "/products/{id}/attachments/{attachmentId}/file": {
      get: {
        tags: ["Products"],
        security: [],
        summary: "Download/stream an attachment — gated by entitlement on every request",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "attachmentId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "The file" }, "403": errorResponse },
      },
    },
    "/store/{username}": {
      get: {
        tags: ["Store"],
        security: [],
        summary: "Published products for a creator",
        parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ products: [] }") },
      },
    },
    "/store/{username}/{slug}": {
      get: {
        tags: ["Store"],
        security: [],
        summary: "A single product, with content only if entitled",
        parameters: [
          { name: "username", in: "path", required: true, schema: { type: "string" } },
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": ok("{ product, access, content, attachments }"), "404": errorResponse },
      },
    },
    "/previews/profile/{username}": {
      get: {
        tags: ["Store"],
        security: [],
        summary: "Link-preview card for an author's page — what a signed-out reader sees",
        parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ preview }"), "404": errorResponse },
      },
    },
    "/previews/post/{username}/{ref}": {
      get: {
        tags: ["Store"],
        security: [],
        summary: "Link-preview card for a post; a gated post's body and pictures are never part of it",
        parameters: [
          { name: "username", in: "path", required: true, schema: { type: "string" } },
          { name: "ref", in: "path", required: true, schema: { type: "string" }, description: "The post's id, or its older slug" },
        ],
        responses: { "200": ok("{ preview }"), "404": errorResponse },
      },
    },
    "/previews/folder/{username}/{slug}": {
      get: {
        tags: ["Store"],
        security: [],
        summary: "Link-preview card for an author's folder",
        parameters: [
          { name: "username", in: "path", required: true, schema: { type: "string" } },
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": ok("{ preview }"), "404": errorResponse },
      },
    },
    "/payments/checkout": {
      post: {
        tags: ["Payments"],
        summary: "Start (or resume) checkout for a product purchase",
        requestBody: jsonBody({
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string" } },
        }),
        responses: { "201": ok("{ payment, purchase, manualInstructions }"), "400": errorResponse },
      },
    },
    "/payments/{id}": {
      get: {
        tags: ["Payments"],
        summary: "Payment status",
        description: "No auth required if the payment has no owning user (anonymous donation) — the id is the capability token.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ payment }"), "404": errorResponse },
      },
    },
    "/payments/{id}/confirm": {
      post: {
        tags: ["Payments"],
        summary: "Confirm a payment as its recipient — the core of the automation mini-API",
        description: "The only way a payment completes. Requires the caller to be the payment's recipient (the product's author, the tier's author, or the donation's author).",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ payment }"), "403": errorResponse },
      },
    },
    "/payments/{id}/reject": {
      post: {
        tags: ["Payments"],
        summary: "Reject a payment as its recipient",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ payment }"), "403": errorResponse },
      },
    },
    "/payments/{id}/mark-paid": {
      post: {
        tags: ["Payments"],
        security: [],
        summary: "Payer's informational \"I've sent it\" flag — never authoritative on its own",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ payment }") },
      },
    },
    "/payments/pending": {
      get: {
        tags: ["Payments"],
        summary: "Your pending-confirmations queue — everything awaiting your confirm/reject",
        responses: { "200": ok("{ items: [] }") },
      },
    },
    "/donations/checkout": {
      post: {
        tags: ["Donations"],
        security: [],
        summary: "Start a donation — no account required",
        requestBody: jsonBody({
          type: "object",
          required: ["creatorUsername", "amountDecimal"],
          properties: {
            creatorUsername: { type: "string" },
            amountDecimal: { type: "string", example: "5.00" },
            currency: { type: "string", enum: ["USD", "EUR"] },
            message: { type: "string" },
            isPublic: { type: "boolean" },
          },
        }),
        responses: { "201": ok("{ payment, donation, manualInstructions }") },
      },
    },
    "/donations/public/{username}": {
      get: {
        tags: ["Donations"],
        security: [],
        summary: "Recent public donations for a creator",
        parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ donations: [] }") },
      },
    },
    "/subscriptions/tiers": {
      post: {
        tags: ["Subscriptions"],
        summary: "Create a subscription tier (priceDecimal \"0\" = free follow tier)",
        requestBody: jsonBody({
          type: "object",
          required: ["name", "period", "currency", "priceDecimal"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            period: { type: "string", enum: ["MONTH", "YEAR"] },
            currency: { type: "string", enum: ["USD", "EUR"] },
            priceDecimal: { type: "string" },
          },
        }),
        responses: { "201": ok("Created tier") },
      },
    },
    "/subscriptions/checkout": {
      post: {
        tags: ["Subscriptions"],
        summary: "Subscribe to a tier",
        requestBody: jsonBody({
          type: "object",
          required: ["tierId"],
          properties: { tierId: { type: "string" }, discountCode: { type: "string" } },
        }),
        responses: { "201": ok("{ payment, subscription, manualInstructions } — payment is null for a free tier") },
      },
    },
    "/subscriptions/mine": { get: { tags: ["Subscriptions"], summary: "Your subscriptions", responses: { "200": ok("{ subscriptions: [] }") } } },
    "/subscriptions/mine/export": {
      get: {
        tags: ["Subscriptions"],
        summary: "Download your subscriptions",
        description:
          "CSV of your current subscriptions (UTF-8 with BOM). `format=mastodon` gives a following list in Mastodon's import format instead — the authors this server federates, as user@host.",
        parameters: [{ name: "format", in: "query", required: false, schema: { type: "string", enum: ["csv", "mastodon"] } }],
        responses: { "200": { description: "text/csv attachment" } },
      },
    },
    "/subscriptions/subscribers/export": {
      get: {
        tags: ["Subscriptions"],
        summary: "Download your subscribers",
        description: "CSV of the people subscribed to you: username, name, tier, price and dates. No email or payment details.",
        responses: { "200": { description: "text/csv attachment" } },
      },
    },
    "/subscriptions/{id}/cancel": {
      post: {
        tags: ["Subscriptions"],
        summary: "Cancel at period end",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("Updated subscription") },
      },
    },
    "/subscriptions/discount-codes": {
      post: {
        tags: ["Subscriptions"],
        summary: "Create a discount code",
        requestBody: jsonBody({
          type: "object",
          required: ["code", "type", "value"],
          properties: {
            code: { type: "string" },
            type: { type: "string", enum: ["PERCENT_OFF", "AMOUNT_OFF"] },
            value: { type: "integer" },
            maxRedemptions: { type: "integer" },
            expiresAt: { type: "string", format: "date-time" },
          },
        }),
        responses: { "201": ok("Created code") },
      },
    },
    "/subscriptions/discount-codes/mine": { get: { tags: ["Subscriptions"], summary: "Your discount codes", responses: { "200": ok("{ discountCodes: [] }") } } },
    "/subscriptions/discount-codes/{id}/deactivate": {
      post: {
        tags: ["Subscriptions"],
        summary: "Deactivate a discount code",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("Updated code") },
      },
    },
    "/products/{id}/comments": {
      post: {
        tags: ["Comments"],
        summary: "Comment on a post you can access",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({ type: "object", required: ["body"], properties: { body: { type: "string" } } }),
        responses: { "201": ok("Created comment"), "403": errorResponse },
      },
      get: {
        tags: ["Comments"],
        security: [],
        summary: "List comments on a post you can access",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ comments: [] }"), "403": errorResponse },
      },
    },
    "/comments/{id}": {
      delete: {
        tags: ["Comments"],
        summary: "Delete a comment (author or the post's creator)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ ok: true }") },
      },
    },
    "/notifications": { get: { tags: ["Notifications"], summary: "Your 50 most recent notifications", responses: { "200": ok("{ notifications, unreadCount }") } } },
    "/notifications/unread": {
      get: { tags: ["Notifications"], summary: "How many notifications are unread, and the kind and time of the newest ten", responses: { "200": ok("{ unreadCount, latest: [{ type, createdAt }] }") } },
    },
    "/notifications/{id}/read": {
      post: {
        tags: ["Notifications"],
        summary: "Mark one notification read",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ notification }") },
      },
    },
    "/notifications/read-all": { post: { tags: ["Notifications"], summary: "Mark every unread notification read", responses: { "200": ok("{ ok: true }") } } },
    "/feed-sources": {
      post: {
        tags: ["Feed Sources"],
        summary: "Connect an RSS/Atom feed or fediverse account as a second feed",
        description: "Verifies the actor resolves (and isn't a private/internal address) before persisting.",
        requestBody: jsonBody({
          type: "object",
          required: ["platform", "actorUrl"],
          properties: { platform: { type: "string", enum: ["MASTODON", "SHARKEY"] }, actorUrl: { type: "string", format: "uri" } },
        }),
        responses: { "201": ok("Created feed source"), "400": errorResponse },
      },
    },
    "/admin/stats": { get: { tags: ["Admin"], summary: "Platform counts for the admin overview", responses: { "200": ok("{ stats }") } } },
    "/products/files": { post: { tags: ["Files"], summary: "Create a file product (DRAFT until a file is attached)", responses: { "201": ok("{ product }"), "400": errorResponse } } },
    "/products/{id}/categories": { put: { tags: ["Taxonomy"], summary: "Replace a post's sections — refuses ids belonging to another author", responses: { "200": ok("{ categories, tags }"), "404": errorResponse } } },
    "/categories": { post: { tags: ["Taxonomy"], summary: "Create a section", responses: { "201": ok("{ category }") } } },
    "/wallets": { post: { tags: ["Wallets"], summary: "Publish a payout address", responses: { "201": ok("{ wallet }"), "400": errorResponse } } },
    "/emoji": { post: { tags: ["Emoji"], summary: "Add a custom emoji", responses: { "201": ok("{ emoji }"), "400": errorResponse } } },
    "/wallets/mine": { get: { tags: ["Wallets"], summary: "Your payout addresses", responses: { "200": ok("{ wallets: [] }") } } },
    "/wallets/{username}": { get: { tags: ["Wallets"], summary: "An author's published payout addresses (public)", responses: { "200": ok("{ wallets: [] }") } } },
    "/categories/mine": { get: { tags: ["Taxonomy"], summary: "Your sections", responses: { "200": ok("{ categories: [] }") } } },
    "/categories/{username}": { get: { tags: ["Taxonomy"], summary: "An author's sections that have published posts (public)", responses: { "200": ok("{ categories: [] }") } } },
    "/products/{id}/tags": { put: { tags: ["Taxonomy"], summary: "Replace a post's tags", responses: { "200": ok("{ categories, tags }") } } },
    "/products/{id}/file": {
      get: { tags: ["Files"], summary: "Download a sold file — re-checks entitlement on every request", responses: { "200": ok("file bytes"), "403": errorResponse } },
      post: { tags: ["Files"], summary: "Upload or replace the file (multipart, author only)", responses: { "201": ok("{ file }"), "400": errorResponse } },
    },
    "/emoji/{username}": { get: { tags: ["Emoji"], summary: "An author's custom emoji (public — needed to render their text)", responses: { "200": ok("{ emoji: [] }") } } },
    "/admin/invites": {
      get: { tags: ["Invites"], summary: "List invite codes (admin)", responses: { "200": ok("{ invites: [] }") } },
      post: { tags: ["Invites"], summary: "Mint a code (admin). Omit maxUses for single-use, null for unlimited", responses: { "201": ok("{ invite }") } },
    },
    "/admin/invites/{id}/revoke": { post: { tags: ["Invites"], summary: "Revoke a code (admin)", responses: { "200": ok("{ ok: true }") } } },
    "/feed-sources/mine": { get: { tags: ["Feed Sources"], summary: "Your connected accounts", responses: { "200": ok("{ feedSources: [] }") } } },
    "/feed-sources/{id}": {
      delete: {
        tags: ["Feed Sources"],
        summary: "Disconnect a feed source",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok("{ ok: true }") },
      },
    },
    "/library": { get: { tags: ["Library"], summary: "Every product you're entitled to", responses: { "200": ok("{ entitlements: [] }") } } },
    "/admin/users": {
      get: {
        tags: ["Admin"],
        summary: "List users (cursor-paginated)",
        parameters: [{ name: "cursor", in: "query", schema: { type: "string" } }],
        responses: { "200": ok("{ users: [] }"), "403": errorResponse },
      },
    },
    "/admin/payments": {
      get: {
        tags: ["Admin"],
        summary: "List payments (cursor-paginated)",
        parameters: [{ name: "cursor", in: "query", schema: { type: "string" } }],
        responses: { "200": ok("{ payments: [] }"), "403": errorResponse },
      },
    },
    "/admin/reports": {
      get: {
        tags: ["Admin"],
        summary: "List moderation reports",
        parameters: [{ name: "status", in: "query", schema: { type: "string" } }],
        responses: { "200": ok("{ reports: [] }"), "403": errorResponse },
      },
    },
    "/admin/users/{id}/suspend": {
      post: {
        tags: ["Admin"],
        summary: "Suspend a user",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({ type: "object", required: ["reason"], properties: { reason: { type: "string" } } }),
        responses: { "200": ok("{ user }"), "403": errorResponse },
      },
    },
    "/admin/audit-log": {
      get: {
        tags: ["Admin"],
        summary: "Audit log entries (cursor-paginated)",
        parameters: [{ name: "cursor", in: "query", schema: { type: "string" } }],
        responses: { "200": ok("{ entries: [] }"), "403": errorResponse },
      },
    },
  },
};
