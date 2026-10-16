/**
 * Development/test seed data ONLY. Never run against production —
 * seeded rows are recognizable via the `demo-` username/slug prefixes
 * so they can never be mistaken for real revenue/subscriber data
 * (see spec rule #146 — no fake data in production UI).
 *
 * Seeds enough of a platform to exercise the UI end to end: several
 * authors so the public directory has something in it, posts at every
 * visibility so the locked states are reachable, tiers, public tips and
 * comments so the engagement rows are not all zero.
 */
import { PrismaClient } from "../generated/client/index.js";
import { hashPassword } from "../../../apps/api/src/lib/password.js";

const prisma = new PrismaClient();

const PASSWORD = "DemoPassw0rd!";

interface SeedPost {
  category?: string;
  tags?: string[];
  slug: string;
  title: string;
  description: string;
  content: string;
  visibility: "PUBLIC" | "PURCHASED" | "SUBSCRIBERS";
  priceMinor: bigint;
  viewCount: number;
  daysAgo: number;
}

interface SeedAuthor {
  username: string;
  displayName: string;
  bio: string;
  showDonations: boolean;
  showSubscriberCount: boolean;
  // Checkout refuses until an author has published a way to be paid, so
  // seeded authors get one — otherwise none of the demo data is buyable.
  paymentInstructions: string;
  wallets: { network: "BITCOIN" | "ETHEREUM" | "POLYGON" | "TRON"; address: string; label: string }[];
  emoji: { shortcode: string; url: string }[];
  categories: string[];
  tiers: { name: string; description: string; amountMinor: bigint }[];
  posts: SeedPost[];
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const AUTHORS: SeedAuthor[] = [
  {
    username: "demo-annas-notebook",
    displayName: "Anna's Notebook",
    bio: "Longform notes on typography, printing and the things that go wrong in between. New piece most weeks.",
    showDonations: true,
    showSubscriberCount: true,
    paymentInstructions: "Bank transfer: DE00 0000 0000 0000 — put your username in the reference, or use an address below.",
    wallets: [{ network: "ETHEREUM", address: "0x52908400098527886E0F7030069857D2E4169EE7", label: "Main" }],
    emoji: [{ shortcode: "inkwell", url: "https://demo.invalid/emoji/inkwell.png" }],
    categories: ["Process", "Long reads"],
    tiers: [
      { name: "Reader", description: "Every post as it lands, plus the archive.", amountMinor: 300n },
      { name: "Studio", description: "Everything in Reader, plus monthly working files and process notes.", amountMinor: 900n },
    ],
    posts: [
      {
        category: "Long reads",
        tags: ["typography", "process"],
        slug: "demo-what-a-typeface-costs",
        title: "What a typeface actually costs to make",
        description: "Six months of drawing, and the invoice still surprises people.",
        content:
          "People ask why a font licence costs what it does, so here is the arithmetic from the last family I shipped.\n\nThe roman took eleven weeks. Not eleven weeks of drawing — eleven weeks of drawing, printing, staring, and undoing. The italic took another six, and it is the italic that decides whether anyone will actually set text in the thing.\n\nThen the boring half: spacing and kerning across four weights, Cyrillic coverage, hinting, and a fortnight of testing at sizes nobody designs for but everybody reads at.",
        visibility: "PUBLIC",
        priceMinor: 0n,
        viewCount: 1284,
        daysAgo: 2,
      },
      {
        category: "Process",
        tags: ["process"],
        slug: "demo-printing-the-first-proof",
        title: "Printing the first proof",
        description: "The moment the screen stops being able to tell you anything useful.",
        content:
          "There is a point in every project where the monitor has said everything it can say, and the only way forward is ink on paper.\n\nThis is the part of the process I keep for supporters, because it is the part where I am most obviously wrong in public.",
        visibility: "SUBSCRIBERS",
        priceMinor: 0n,
        viewCount: 431,
        daysAgo: 6,
      },
      {
        category: "Process",
        tags: ["typography"],
        slug: "demo-spacing-masterclass",
        title: "Spacing: the two-hour masterclass",
        description: "The full session, with the working files.",
        content:
          "The complete recording, plus the source files at every stage, and the checklist I use before calling a family finished.",
        visibility: "PURCHASED",
        priceMinor: 1900n,
        viewCount: 96,
        daysAgo: 13,
      },
    ],
  },
  {
    username: "demo-fieldnotes",
    displayName: "Field Notes",
    bio: "A working naturalist writing about what is actually outside, not what the guidebooks say should be.",
    showDonations: true,
    showSubscriberCount: false,
    paymentInstructions: "PayPal: fieldnotes@example.test",
    wallets: [{ network: "BITCOIN", address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", label: "Cold wallet" }],
    emoji: [],
    categories: ["Surveys"],
    tiers: [{ name: "Supporter", description: "Weekly notes and the full photo sets.", amountMinor: 500n }],
    posts: [
      {
        category: "Surveys",
        tags: ["restoration", "rivers"],
        slug: "demo-the-river-came-back",
        title: "The river came back",
        description: "Four years after the culvert was pulled out, the fish returned on their own.",
        content:
          "Nobody stocked it. Nobody planted anything. The culvert came out in spring, and by the third summer there were fish above the old crossing for the first time in forty years.\n\nThe lesson keeps repeating: most restoration is just removing the thing that was in the way, then waiting longer than anyone wants to wait.",
        visibility: "PUBLIC",
        priceMinor: 0n,
        viewCount: 2740,
        daysAgo: 1,
      },
      {
        category: "Surveys",
        tags: ["restoration"],
        slug: "demo-full-survey-notes",
        title: "March survey: the complete notes",
        description: "Every transect, with the photographs and the counts that did not make the summary.",
        content: "Full transect data, photographs, and the counts I left out of the public write-up because they need another season to mean anything.",
        visibility: "SUBSCRIBERS",
        priceMinor: 0n,
        viewCount: 187,
        daysAgo: 9,
      },
    ],
  },
  {
    username: "demo-slow-code",
    displayName: "Slow Code",
    bio: "One database, one process, no framework. Notes on building software that is boring on purpose.",
    showDonations: false,
    showSubscriberCount: true,
    paymentInstructions: "Invoice on request — email slowcode@example.test",
    wallets: [],
    emoji: [],
    categories: [],
    tiers: [],
    posts: [
      {
        tags: ["architecture", "databases"],
        slug: "demo-you-do-not-need-a-queue",
        title: "You probably do not need a queue yet",
        description: "A table and a loop will carry you further than the architecture diagrams suggest.",
        content:
          "Every system I have been called in to rescue had a message broker in it before it had a hundred users.\n\nA table with a status column and a process that polls it is not elegant, but it is debuggable at three in the morning, which elegance is not.",
        visibility: "PUBLIC",
        priceMinor: 0n,
        viewCount: 5310,
        daysAgo: 4,
      },
    ],
  },
];

/**
 * A fixed, unlimited-use code so a fresh dev database is immediately
 * usable — registration is invite-only, and without this there would be
 * no way to create an account without minting one through the admin UI
 * first. Every character is from the Crockford alphabet the real
 * generator uses, so it round-trips through canonicalizeInviteCode.
 */
const DEMO_INVITE_CODE = "4TIP-DEM0S-EED45-6789A-BCDEF-GHJKM-NPQRS";

async function main() {
  const passwordHash = await hashPassword(PASSWORD);

  await prisma.inviteCode.upsert({
    where: { code: DEMO_INVITE_CODE },
    update: { revokedAt: null, maxUses: null, expiresAt: null },
    create: { code: DEMO_INVITE_CODE, note: "Seeded development invite", maxUses: null },
  });

  // An administrator for the moderation and admin screens.
  await prisma.user.upsert({
    where: { username: "demo-admin" },
    update: { role: "ADMIN" },
    create: {
      username: "demo-admin",
      email: "demo-admin@example.test",
      passwordHash,
      role: "ADMIN",
      emailVerifiedAt: new Date(),
    },
  });

  // Readers, used as tip senders and comment authors below.
  const readers = [];
  for (const name of ["demo-fan", "demo-reader", "demo-lurker"]) {
    readers.push(
      await prisma.user.upsert({
        where: { username: name },
        update: {},
        create: {
          username: name,
          email: `${name}@example.test`,
          passwordHash,
          role: "USER",
          emailVerifiedAt: new Date(),
        },
      }),
    );
  }

  for (const author of AUTHORS) {
    const profileFields = {
      displayName: author.displayName,
      bio: author.bio,
      showDonations: author.showDonations,
      showSubscriberCount: author.showSubscriberCount,
      manualPaymentInstructions: author.paymentInstructions,
    };

    const user = await prisma.user.upsert({
      where: { username: author.username },
      // Re-seeding converges an existing author onto the current data
      // rather than leaving whatever an earlier version wrote.
      update: { creatorProfile: { update: profileFields } },
      create: {
        username: author.username,
        email: `${author.username}@example.test`,
        passwordHash,
        role: "CREATOR",
        emailVerifiedAt: new Date(),
        creatorProfile: { create: profileFields },
      },
      include: { creatorProfile: true },
    });
    const creatorId = user.creatorProfile!.id;

    for (const wallet of author.wallets) {
      await prisma.wallet.upsert({
        where: { userId_network_address: { userId: user.id, network: wallet.network, address: wallet.address } },
        update: {},
        create: { userId: user.id, network: wallet.network, address: wallet.address, label: wallet.label },
      });
    }

    for (const emoji of author.emoji) {
      await prisma.customEmoji.upsert({
        where: { creatorId_shortcode: { creatorId, shortcode: emoji.shortcode } },
        update: {},
        create: { creatorId, shortcode: emoji.shortcode, url: emoji.url },
      });
    }

    const categoryIds = new Map<string, string>();
    for (const [position, name] of author.categories.entries()) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const category = await prisma.productCategory.upsert({
        where: { creatorId_slug: { creatorId, slug } },
        update: {},
        create: { creatorId, name, slug, position },
      });
      categoryIds.set(name, category.id);
    }

    for (const tier of author.tiers) {
      const existing = await prisma.subscriptionTier.findFirst({ where: { creatorId, name: tier.name } });
      if (!existing) {
        await prisma.subscriptionTier.create({
          data: { creatorId, name: tier.name, description: tier.description, currency: "USD", amountMinor: tier.amountMinor, period: "MONTH" },
        });
      }
    }

    for (const post of author.posts) {
      const created = await prisma.digitalProduct.upsert({
        where: { creatorId_slug: { creatorId, slug: post.slug } },
        update: {},
        create: {
          creatorId,
          type: "POST",
          title: post.title,
          slug: post.slug,
          description: post.description,
          status: "PUBLISHED",
          visibility: post.visibility,
          publishedAt: daysAgo(post.daysAgo),
          viewCount: post.viewCount,
          prices: {
            create: [
              {
                currency: "USD",
                amountMinor: post.priceMinor,
                pricingType: post.priceMinor === 0n ? "FREE" : "ONE_TIME",
              },
            ],
          },
          post: { create: { content: post.content } },
        },
      });

      const categoryId = post.category ? categoryIds.get(post.category) : undefined;
      if (categoryId) {
        await prisma.productCategoryItem.upsert({
          where: { productId_categoryId: { productId: created.id, categoryId } },
          update: {},
          create: { productId: created.id, categoryId },
        });
      }

      for (const name of post.tags ?? []) {
        const tag = await prisma.productTag.upsert({ where: { name }, update: {}, create: { name } });
        await prisma.productTagItem.upsert({
          where: { productId_tagId: { productId: created.id, tagId: tag.id } },
          update: {},
          create: { productId: created.id, tagId: tag.id },
        });
      }

      // A couple of comments on the open posts, so the engagement row on
      // the feed card is not uniformly zero.
      if (post.visibility === "PUBLIC") {
        const existing = await prisma.comment.count({ where: { productId: created.id } });
        if (existing === 0) {
          await prisma.comment.createMany({
            data: [
              { productId: created.id, userId: readers[0]!.id, body: "This answered a question I've had for years. Thank you." },
              { productId: created.id, userId: readers[1]!.id, body: "Sending this to my whole team." },
            ],
          });
        }
      }
    }

    if (author.showDonations) {
      const existing = await prisma.donation.count({ where: { creatorId } });
      if (existing === 0) {
        await prisma.donation.createMany({
          data: [
            { creatorId, senderUserId: readers[0]!.id, amountMinor: 1000n, currency: "USD", message: "For the proof-printing post.", isPublic: true, status: "COMPLETED" },
            { creatorId, senderUserId: null, amountMinor: 2500n, currency: "USD", message: "Keep going.", isPublic: true, status: "COMPLETED" },
            { creatorId, senderUserId: readers[2]!.id, amountMinor: 500n, currency: "USD", message: null, isPublic: true, status: "COMPLETED" },
          ],
        });
      }
    }
  }

  const authors = await prisma.creatorProfile.count();
  const posts = await prisma.digitalProduct.count({ where: { status: "PUBLISHED" } });
  console.log(`Seeded ${authors} authors and ${posts} published posts.`);
  console.log(`Every demo account uses the password: ${PASSWORD}`);
  console.log("Admin: demo-admin");
  console.log(`Invite code for registering new accounts: ${DEMO_INVITE_CODE}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
