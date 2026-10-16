import { z } from "zod";

/**
 * Address shapes differ per chain, and validating each one properly needs
 * chain-specific checksum logic this platform deliberately does not carry
 * (it never touches a chain — see PaymentService). The check is therefore
 * a conservative character/length guard: enough to catch a truncated
 * paste or a pasted URL, not enough to claim the address is spendable.
 * The author is the one who has to get this right; it is their money.
 */
const ADDRESS_RULES: Record<string, { pattern: RegExp; hint: string }> = {
  BITCOIN: { pattern: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/, hint: "a Bitcoin address (bc1… or 1…/3…)" },
  ETHEREUM: { pattern: /^0x[a-fA-F0-9]{40}$/, hint: "an Ethereum address (0x…, 42 characters)" },
  POLYGON: { pattern: /^0x[a-fA-F0-9]{40}$/, hint: "a Polygon address (0x…, 42 characters)" },
  TRON: { pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, hint: "a TRON address (T…, 34 characters)" },
  // Standard (95-char) and integrated (106-char) mainnet addresses, both
  // starting with a primary-address or subaddress prefix. Monero has no
  // per-character checksum a regex can verify — same caveat as every
  // other network here.
  MONERO: { pattern: /^[48][1-9A-HJ-NP-Za-km-z]{94}([1-9A-HJ-NP-Za-km-z]{11})?$/, hint: "a Monero address (4… or 8…, 95 or 106 characters)" },
};

export const createWalletSchema = z
  .object({
    network: z.enum(["BITCOIN", "ETHEREUM", "POLYGON", "TRON", "MONERO"]),
    address: z.string().trim().min(10).max(120),
    label: z.string().trim().max(60).optional(),
  })
  .superRefine((value, ctx) => {
    const rule = ADDRESS_RULES[value.network];
    if (rule && !rule.pattern.test(value.address)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["address"],
        message: `That doesn't look like ${rule.hint}.`,
      });
    }
  });

export type CreateWalletInput = z.infer<typeof createWalletSchema>;
