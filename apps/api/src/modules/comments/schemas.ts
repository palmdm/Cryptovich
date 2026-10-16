import { z } from "zod";

/**
 * How deep a thread may nest. A reply to a reply is a conversation; a
 * reply at depth twenty is a rendering problem and, once federated, an
 * unbounded `inReplyTo` chain for every consumer. Replies past the limit
 * still attach — to the deepest ancestor within it — so nothing is
 * refused for being late to a thread.
 */
export const MAX_COMMENT_DEPTH = 6;

export const createCommentSchema = z.object({
  // Kept whole: the body is stored exactly as written and rendered as
  // text, so code, punctuation and markup all survive round-tripping.
  body: z.string().min(1).max(10_000),
  // Null or absent is a top-level comment; a uuid makes it a reply.
  parentId: z.string().uuid().optional(),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
