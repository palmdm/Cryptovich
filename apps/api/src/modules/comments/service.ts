import { assertMayWriteWith } from "../rewards/service.js";
import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { EntitlementService } from "../entitlements/service.js";
import { NotificationService } from "../notifications/service.js";
import { MAX_COMMENT_DEPTH, type CreateCommentInput } from "./schemas.js";

/** One comment as the API returns it, with its replies nested underneath. */
export interface CommentNode {
  id: string;
  userId: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
  parentId: string | null;
  user: { username: string };
  replies: CommentNode[];
}

export class CommentService {
  private readonly entitlements: EntitlementService;
  private readonly notifications: NotificationService;

  constructor(private readonly prisma: PrismaClient) {
    this.entitlements = new EntitlementService(prisma);
    this.notifications = new NotificationService(prisma);
  }

  /**
   * Comments are gated by the exact same rule as the post content itself —
   * whoever can see a post can comment on and read its comments, nothing
   * looser (spec rule #13/#61's "EntitlementService is the sole
   * authority" extends here rather than growing a second access check).
   */
  async create(userId: string, productId: string, input: CreateCommentInput) {
    const decision = await this.entitlements.canAccessProduct(userId, productId);
    if (!decision.allowed) throw Errors.forbidden();

    const parentId = input.parentId ? await this.resolveParent(productId, input.parentId) : null;
    await assertMayWriteWith(this.prisma, input.body, userId);

    const comment = await this.prisma.comment.create({
      data: { productId, userId, body: input.body, parentId },
      include: { user: { select: { username: true } } },
    });

    const product = await this.prisma.digitalProduct.findUnique({
      where: { id: productId },
      include: { creator: { select: { userId: true } } },
    });
    if (product && product.creator.userId !== userId) {
      await this.notifications.notify(product.creator.userId, "NEW_COMMENT", { productId, commentId: comment.id });
    }

    // A reply notifies the person being replied to as well — being
    // answered is the thing you want to hear about, and the post's author
    // already heard about it above.
    if (parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: parentId }, select: { userId: true } });
      if (parent && parent.userId !== userId && parent.userId !== product?.creator.userId) {
        await this.notifications.notify(parent.userId, "NEW_COMMENT", { productId, commentId: comment.id });
      }
    }

    return comment;
  }

  /**
   * Validates a claimed parent and clamps the depth. A reply to a comment
   * on a different post would graft one thread onto another, so it is
   * refused rather than silently re-homed; a reply past the depth limit
   * attaches to the deepest ancestor still inside it.
   */
  private async resolveParent(productId: string, parentId: string): Promise<string> {
    const parent = await this.prisma.comment.findUnique({
      where: { id: parentId },
      select: { id: true, productId: true, parentId: true, deletedAt: true },
    });
    if (!parent || parent.productId !== productId) throw Errors.notFound("Comment");
    if (parent.deletedAt) throw Errors.validation("That comment was deleted.");

    // Walk up to find this parent's depth, bounded by the limit itself so
    // a cycle introduced by hand in the database cannot spin here.
    let depth = 1;
    let cursor = parent.parentId;
    let deepestWithinLimit = parent.id;
    const seen = new Set<string>([parent.id]);

    while (cursor && depth < MAX_COMMENT_DEPTH + 2) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const ancestor: { id: string; parentId: string | null } | null = await this.prisma.comment.findUnique({
        where: { id: cursor },
        select: { id: true, parentId: true },
      });
      if (!ancestor) break;
      depth += 1;
      if (depth <= MAX_COMMENT_DEPTH) deepestWithinLimit = parent.id;
      cursor = ancestor.parentId;
    }

    if (depth >= MAX_COMMENT_DEPTH) {
      // At the limit: attach alongside the parent instead of below it, so
      // the reply is still in the conversation without deepening it.
      return parent.parentId ?? parent.id;
    }
    return deepestWithinLimit;
  }

  /**
   * The whole thread for a post, nested. Deleted comments that still have
   * visible replies are returned as tombstones with their body removed —
   * dropping them entirely would orphan every reply underneath and make
   * the conversation unreadable.
   */
  async list(userId: string | null, productId: string): Promise<CommentNode[]> {
    const decision = await this.entitlements.canAccessProduct(userId, productId);
    if (!decision.allowed) throw Errors.forbidden();

    const rows = await this.prisma.comment.findMany({
      where: { productId },
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: "asc" },
    });

    const nodes = new Map<string, CommentNode>();
    for (const row of rows) {
      nodes.set(row.id, {
        id: row.id,
        userId: row.userId,
        body: row.deletedAt ? "" : row.body,
        createdAt: row.createdAt,
        deletedAt: row.deletedAt,
        parentId: row.parentId,
        user: { username: row.deletedAt ? "" : row.user.username },
        replies: [],
      });
    }

    const roots: CommentNode[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id)!;
      const parent = row.parentId ? nodes.get(row.parentId) : undefined;
      if (parent) parent.replies.push(node);
      else roots.push(node);
    }

    // A deleted leaf is simply gone; a deleted comment holding up replies
    // stays as a tombstone.
    const prune = (list: CommentNode[]): CommentNode[] =>
      list
        .map((node) => ({ ...node, replies: prune(node.replies) }))
        .filter((node) => !node.deletedAt || node.replies.length > 0);

    return prune(roots);
  }

  /** The comment's own author, or the post's creator moderating their own post, may remove it. */
  async remove(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { product: { include: { creator: { select: { userId: true } } } } },
    });
    if (!comment || comment.deletedAt) throw Errors.notFound("Comment");
    if (comment.userId !== userId && comment.product.creator.userId !== userId) throw Errors.forbidden();

    // Soft delete only: the row stays so its replies keep their parent and
    // the thread does not collapse (the schema's NoAction on the self
    // relation is what makes this the only option).
    return this.prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
  }
}
