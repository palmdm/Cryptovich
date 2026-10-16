export type UserRole = "USER" | "CREATOR" | "ADMIN" | "MODERATOR";

export type DigitalProductType = "POST" | "BUNDLE" | "STICKER_PACK" | "DIGITAL_FILE";

export type ProductStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED" | "DISABLED";

export type ProductVisibility = "PUBLIC" | "SUBSCRIBERS" | "TIER" | "PURCHASED" | "PRIVATE" | "GOAL";

export type PricingType = "FREE" | "ONE_TIME" | "SUBSCRIPTION";

export type EntitlementSourceType =
  | "SUBSCRIPTION"
  | "PRODUCT_PURCHASE"
  | "BUNDLE_PURCHASE"
  | "MANUAL_GRANT";

export type PaymentStatus =
  | "CREATED"
  | "AWAITING_PAYMENT"
  | "DETECTED"
  | "CONFIRMING"
  | "CONFIRMED"
  | "EXPIRED"
  | "FAILED"
  | "UNDERPAID"
  | "OVERPAID"
  | "REFUNDED";

export type PurchaseStatus = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED" | "CANCELLED";

export interface AccessDecision {
  allowed: boolean;
  reason:
    | "PUBLIC"
    | "OWNER"
    | "PURCHASED"
    | "SUBSCRIBED"
    | "MANUAL_GRANT"
    | "GOAL_REACHED"
    | "NOT_ENTITLED"
    | "PRODUCT_NOT_FOUND"
    | "PRODUCT_DISABLED";
}
