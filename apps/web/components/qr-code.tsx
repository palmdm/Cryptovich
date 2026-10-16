"use client";

import { useEffect, useState } from "react";

/** Renders a scannable QR code for a crypto payment address client-side — no
 * third-party image service, so a payment address is never sent anywhere
 * outside the browser tab that's about to pay it. */
export function QrCode({ value, size = 180, alt = "Scan to pay" }: { value: string; size?: number; alt?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Fetched when a code is drawn: the admin two-factor gate is in the
    // layout, and a static import put the encoder in every page's bundle.
    import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(value, { width: size, margin: 1 }))
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) return <div style={{ width: size, height: size, background: "var(--surface-2)", borderRadius: 8 }} />;
  // The QR itself must stay pure white regardless of theme — readers need
  // maximum contrast against its own black modules. On a light theme the
  // surrounding card is white too, so a border is what actually separates
  // the code from its container rather than the fill color.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt={alt}
      style={{ borderRadius: 8, background: "#fff", padding: 8, border: "1px solid var(--border)" }}
    />
  );
}
