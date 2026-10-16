"use client";

import Link from "next/link";
import { useLocale } from "./locale-provider";

/**
 * "Creating an account means accepting the usage policy", the link set
 * where each language puts it. Opens in a new tab, so reading the policy
 * does not lose the half-filled form.
 */
export function PolicyAgreement() {
  const { t } = useLocale();
  const [before, after = ""] = t("policy.agreement").split("{link}");
  return (
    <p className="meta policy-agreement">
      {before}
      <Link href="/policy" className="text-link" target="_blank">
        {t("policy.agreementLink")}
      </Link>
      {after}
    </p>
  );
}
