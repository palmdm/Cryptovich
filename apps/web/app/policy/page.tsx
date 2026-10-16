import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readPolicy } from "@/lib/policy";
import { PolicyView } from "./policy-view";

/** The usage policy, word for word from policy.md (see lib/policy.ts). */
export function generateMetadata(): Metadata {
  return { title: readPolicy()?.title ?? "Usage policy" };
}

export default function PolicyPage() {
  const policy = readPolicy();
  if (!policy) notFound();
  return <PolicyView title={policy.title} body={policy.body} />;
}
