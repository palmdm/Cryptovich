"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "./locale-provider";
import { RotateIcon } from "./icons";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

export interface ImageEditOptions {
  /** A fixed shape (width ÷ height): 1 for an avatar, 3 for a cover. Without one, the author picks. */
  aspect?: number;
  /** Shows the crop as a circle — what an avatar becomes. */
  round?: boolean;
  /** The result's longest side, in pixels; the server re-encodes it anyway. */
  maxSide?: number;
  title?: TranslationKey;
}

/** The shapes offered when none is fixed; null is the picture's own. */
const PRESETS: { label: string; aspect: number | null }[] = [
  { label: "original", aspect: null },
  { label: "1:1", aspect: 1 },
  { label: "4:3", aspect: 4 / 3 },
  { label: "16:9", aspect: 16 / 9 },
  { label: "3:4", aspect: 3 / 4 },
];

const MAX_ZOOM = 5;

/** A GIF or WebP that moves: a canvas keeps only its first frame. */
async function isAnimated(file: File): Promise<boolean> {
  if (file.type !== "image/gif" && file.type !== "image/webp") return false;
  const head = new TextDecoder("latin1").decode(await file.slice(0, 64 * 1024).arrayBuffer());
  return file.type === "image/gif" ? head.includes("NETSCAPE2.0") || head.split("!ù\u0004").length > 2 : head.includes("ANIM");
}

/**
 * Lets an author place a picture before it uploads: drag to choose the
 * part that shows, zoom, turn it, centre it — the avatar as the circle it
 * will be, a cover in its banner's shape. `edit` resolves with the edited
 * file, the original ("as is"), or null when the author cancels. Nothing
 * leaves the browser until then.
 *
 * A picture that moves skips the editor and goes as it is: a canvas
 * draws one frame, and offering to "finish" it turned GIF avatars still
 * (the server keeps an animated avatar or cover animated).
 */
export function useImageEditor() {
  const [request, setRequest] = useState<{ file: File; options: ImageEditOptions; resolve: (file: File | null) => void } | null>(null);

  const edit = useCallback(async (file: File, options: ImageEditOptions = {}): Promise<File | null> => {
    // Only a still picture a canvas can draw; anything else goes on unchanged.
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return file;
    if (await isAnimated(file).catch(() => false)) return file;
    return new Promise<File | null>((resolve) => setRequest({ file, options, resolve }));
  }, []);

  const element = request ? (
    <ImageEditor
      file={request.file}
      options={request.options}
      onDone={(result) => {
        request.resolve(result);
        setRequest(null);
      }}
    />
  ) : null;

  return { edit, element };
}

function ImageEditor({ file, options, onDone }: { file: File; options: ImageEditOptions; onDone: (file: File | null) => void }) {
  const { t } = useLocale();
  // Made and released in one effect: a memoised URL was revoked by the
  // first cleanup and then reused, and the picture never loaded.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [rotation, setRotation] = useState(0); // quarter turns
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [preset, setPreset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState(520);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    if (!url) return;
    let current = true;
    const img = new Image();
    img.onload = () => current && setImage(img);
    img.onerror = () => current && setFailed(true);
    img.src = url;
    return () => {
      current = false;
    };
  }, [url]);

  // The frame fits the dialog's width, and the screen's height.
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => setRoom(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const natural = image ? { w: image.naturalWidth, h: image.naturalHeight } : { w: 1, h: 1 };
  const turned = rotation % 2 === 1 ? { w: natural.h, h: natural.w } : natural;
  const aspect = options.aspect ?? preset ?? turned.w / turned.h;
  const maxHeight = typeof window === "undefined" ? 420 : Math.max(200, Math.min(460, window.innerHeight * 0.5));
  let frameW = Math.max(160, room - 48);
  let frameH = frameW / aspect;
  if (frameH > maxHeight) {
    frameH = maxHeight;
    frameW = frameH * aspect;
  }
  // Fills the frame at zoom 1: the crop is never empty at an edge.
  const scale = Math.max(frameW / turned.w, frameH / turned.h) * zoom;

  const clamp = useCallback(
    (x: number, y: number) => {
      const spareX = Math.max(0, (turned.w * scale - frameW) / 2);
      const spareY = Math.max(0, (turned.h * scale - frameH) / 2);
      return { x: Math.min(spareX, Math.max(-spareX, x)), y: Math.min(spareY, Math.max(-spareY, y)) };
    },
    [turned.w, turned.h, scale, frameW, frameH],
  );

  // A zoom, turn or new shape can leave the picture short of an edge.
  useEffect(() => {
    setOffset((o) => {
      const c = clamp(o.x, o.y);
      return c.x === o.x && c.y === o.y ? o : c;
    });
  }, [clamp]);

  const zoomBy = useCallback((factor: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z * factor))), []);

  // The wheel zooms; it has to be a listener that may prevent scrolling.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy, image]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerMove(e: React.PointerEvent) {
    const previous = pointers.current.get(e.pointerId);
    if (!previous) return;
    const now = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 1) {
      setOffset((o) => clamp(o.x + now.x - previous.x, o.y + now.y - previous.y));
    } else if (pointers.current.size === 2) {
      // Two fingers: the change in their distance is the zoom.
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 0) zoomBy(after / before);
    }
    pointers.current.set(e.pointerId, now);
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      setOffset((o) => clamp(o.x + moves[e.key]![0], o.y + moves[e.key]![1]));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomBy(1.1);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomBy(1 / 1.1);
    }
  }

  async function finish() {
    if (!image) return;
    setBusy(true);
    try {
      const cropW = frameW / scale;
      const cropH = frameH / scale;
      const k = Math.min(1, (options.maxSide ?? 2560) / Math.max(cropW, cropH));
      const outW = Math.max(1, Math.round(cropW * k));
      const outH = Math.max(1, Math.round(cropH * k));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      // Output pixels per frame pixel, then the same placement the frame shows.
      const f = outW / frameW;
      ctx.translate(outW / 2 + offset.x * f, outH / 2 + offset.y * f);
      ctx.rotate((rotation * Math.PI) / 2);
      ctx.scale(scale * f, scale * f);
      ctx.drawImage(image, -natural.w / 2, -natural.h / 2);
      // A photograph stays JPEG; anything that may be see-through goes as
      // WebP (or PNG where a browser cannot write WebP).
      const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
      let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
      if (blob && blob.type !== type && type === "image/webp") blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("canvas");
      const ext = blob.type.split("/")[1]!.replace("jpeg", "jpg");
      onDone(new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "image"}.${ext}`, { type: blob.type }));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  // In <body>: opened from a card, and a card with a backdrop-filter (the
  // Liquid Glass themes) traps a fixed-position dialog inside itself — the
  // editor drew over the settings it was opened from.
  return createPortal(
    <div className="image-editor-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <div className="image-editor" role="dialog" aria-modal="true" aria-labelledby="image-editor-title" ref={shellRef}>
        <h2 id="image-editor-title">{t(options.title ?? "imageEditor.title")}</h2>
        {failed ? (
          <div className="error-banner">{t("imageEditor.failed")}</div>
        ) : (
          <>
            <div
              ref={stageRef}
              className="image-editor-stage"
              style={{ height: frameH + 32 }}
              tabIndex={0}
              aria-label={t("imageEditor.hint")}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
            >
              {image && url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  style={{
                    width: natural.w * scale,
                    height: natural.h * scale,
                    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation * 90}deg)`,
                  }}
                />
              )}
              <div className={`image-editor-frame${options.round ? " is-round" : ""}`} style={{ width: frameW, height: frameH }} />
            </div>
            <p className="meta image-editor-hint">{t("imageEditor.hint")}</p>

            <div className="image-editor-tools">
              <label className="image-editor-zoom">
                <span>{t("imageEditor.zoom")}</span>
                <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              </label>
              <button type="button" className="secondary" onClick={() => setRotation((r) => (r + 1) % 4)}>
                <RotateIcon size={16} />
                {t("imageEditor.rotate")}
              </button>
              <button type="button" className="secondary" onClick={() => setOffset({ x: 0, y: 0 })}>
                {t("imageEditor.center")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setZoom(1);
                  setRotation(0);
                  setOffset({ x: 0, y: 0 });
                  setPreset(null);
                }}
              >
                {t("imageEditor.reset")}
              </button>
            </div>

            {options.aspect === undefined && (
              <div className="image-editor-presets" role="radiogroup" aria-label={t("imageEditor.shape")}>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    role="radio"
                    aria-checked={preset === p.aspect}
                    className={`chip${preset === p.aspect ? " selected" : ""}`}
                    onClick={() => setPreset(p.aspect)}
                  >
                    {p.aspect === null ? t("imageEditor.original") : p.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="image-editor-actions">
          <button type="button" className="secondary" onClick={() => onDone(null)} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" className="secondary" onClick={() => onDone(file)} disabled={busy}>
            {t("imageEditor.asIs")}
          </button>
          <button type="button" className="primary" onClick={finish} disabled={busy || !image || failed}>
            {t("imageEditor.done")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
