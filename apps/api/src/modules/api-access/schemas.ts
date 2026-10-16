import { z } from "zod";
import { Money, API_ACCESS_MIN_MINOR, API_ACCESS_MAX_MINOR, isApiAccessAmountInRange } from "@platform/shared";

export const requestApiAccessSchema = z.object({
  amountDecimal: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine(
      (value) => isApiAccessAmountInRange(Money.fromDecimalString(value, "USD").amountMinor),
      {
        message: `Contribute between $${Number(API_ACCESS_MIN_MINOR) / 100} and $${Number(API_ACCESS_MAX_MINOR) / 100}.`,
      },
    ),
  // How they sent it and anything the administrator needs to match the
  // payment to the request.
  note: z.string().max(500).optional(),
});

export const reviewApiAccessSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().max(500).optional(),
});

export type RequestApiAccessInput = z.infer<typeof requestApiAccessSchema>;
export type ReviewApiAccessInput = z.infer<typeof reviewApiAccessSchema>;
