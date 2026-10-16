"use client";

import { useId, type ReactNode } from "react";
import { isAvatarFrame, parseCustomFrame, type AvatarFrame, type CustomFrame } from "@platform/shared";
import { uploadedImageSrc } from "@/lib/uploaded-image";

export type AvatarSize = "sm" | "md" | "lg";

/**
 * An avatar, and — when its author picked one — the frame around it.
 *
 * Every place that shows a person's picture goes through this, so a frame
 * appears everywhere at once instead of on whichever page remembered it.
 * With no frame the markup is exactly the bare picture it always was.
 */
export function Avatar({
  url,
  name,
  frame,
  size,
  decorative = false,
}: {
  url: string | null | undefined;
  name: string;
  frame?: string | null;
  size: AvatarSize;
  /** The name is written beside the picture: leave it out of the reader's way. */
  decorative?: boolean;
}) {
  const className = `avatar avatar-${size}`;
  const src = url ? uploadedImageSrc(url) : null;
  const picture = src ? (
    // Lazy: a directory or a listing draws dozens, most of them below the
    // fold; one in view still loads at once.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={decorative ? "" : name} className={className} loading="lazy" decoding="async" />
  ) : (
    <span className={className} aria-hidden="true" />
  );
  return (
    <FrameWrap frame={frame} size={size}>
      {picture}
    </FrameWrap>
  );
}

/** Puts a frame around whatever picture it is given; with none it hands the picture back untouched. */
export function FrameWrap({ frame, size, children }: { frame?: string | null; size: AvatarSize; children: ReactNode }) {
  const custom = isAvatarFrame(frame) ? null : parseCustomFrame(frame);
  if (!isAvatarFrame(frame) && !custom) return <>{children}</>;
  return (
    <span className={`avatar-wrap avatar-wrap-${size}`}>
      {children}
      {custom ? <CustomFrameArt frame={custom} /> : <FrameArt frame={frame as AvatarFrame} />}
    </span>
  );
}

/** A leaf pointing away from the ring, its stalk on it. */
function Leaf({ angle, radius, size, fill, tilt = 0 }: { angle: number; radius: number; size: number; fill: string; tilt?: number }) {
  return (
    <g transform={`translate(50 50) rotate(${angle}) translate(0 ${-radius}) rotate(${tilt}) scale(${size / 22})`}>
      <path d="M0 0 C 10 -4 12 -15 0 -22 C -12 -15 -10 -4 0 0 Z" fill={fill} />
      <path d="M0 0 L0 -17" stroke="#000" strokeOpacity="0.28" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </g>
  );
}

function Blossom({ angle, radius, size }: { angle: number; radius: number; size: number }) {
  return (
    <g transform={`translate(50 50) rotate(${angle}) translate(0 ${-radius}) scale(${size / 12})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="0" cy="-4.6" rx="3.6" ry="5.2" fill="#f9b8cd" stroke="#e78aa8" strokeWidth="0.5" transform={`rotate(${a})`} />
      ))}
      <circle r="1.9" fill="#e2597f" />
    </g>
  );
}

function Crystal({ angle, radius, size }: { angle: number; radius: number; size: number }) {
  return (
    <g transform={`translate(50 50) rotate(${angle}) translate(0 ${-radius}) scale(${size / 14})`}>
      <path d="M0 0 L3.4 -7 L0 -14 L-3.4 -7 Z" fill="#eaf8ff" stroke="#6fb8ee" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M0 -1.5 L0 -12.5" stroke="#9fd4f7" strokeWidth="0.7" />
    </g>
  );
}

/** One side of a wreath: leaves up the ring from the bottom, each pointing the way the branch grows. */
function LaurelSide({ fill, side }: { fill: string; side: 1 | -1 }) {
  return (
    <g>
      {[162, 138, 114, 90, 66].map((a, i) => (
        <g key={a}>
          <Leaf angle={side * a} radius={50.5} size={19 - i * 1.5} fill={fill} tilt={-side * 34} />
          <Leaf angle={side * (a - 6)} radius={50.5} size={14 - i * 1.1} fill={fill} tilt={-side * 82} />
        </g>
      ))}
    </g>
  );
}

function FrameArt({ frame }: { frame: AvatarFrame }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const grad = `g${uid}`;
  const glow = `f${uid}`;
  let body: ReactNode;
  let defs: ReactNode = null;

  switch (frame) {
    case "autumn":
      defs = (
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2b134" />
          <stop offset="0.55" stopColor="#d9541e" />
          <stop offset="1" stopColor="#8c2f12" />
        </linearGradient>
      );
      body = (
        <>
          <circle cx="50" cy="50" r="51.5" fill="none" stroke={`url(#${grad})`} strokeWidth="3.6" />
          {[
            [140, "#e8892a", 17, 20],
            [156, "#d9541e", 24, -14],
            [174, "#f0a030", 20, 22],
            [192, "#b5341c", 26, -6],
            [211, "#e8c23a", 20, 30],
            [229, "#c2481a", 24, -20],
            [247, "#8c3b14", 18, 12],
            [24, "#e8892a", 21, 16],
            [46, "#b5341c", 25, -12],
            [68, "#f0b23a", 18, 26],
          ].map(([a, fill, size, tilt]) => (
            <Leaf key={String(a)} angle={a as number} radius={51} size={size as number} fill={fill as string} tilt={tilt as number} />
          ))}
        </>
      );
      break;
    case "sakura":
      defs = (
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbd0de" />
          <stop offset="1" stopColor="#ee8fb0" />
        </linearGradient>
      );
      body = (
        <>
          <circle cx="50" cy="50" r="51.5" fill="none" stroke={`url(#${grad})`} strokeWidth="3.4" />
          <Blossom angle={-38} radius={53} size={24} />
          <Blossom angle={22} radius={54} size={17} />
          <Blossom angle={150} radius={54} size={20} />
          <Blossom angle={205} radius={53} size={15} />
          {[[-8, 60], [52, 61], [100, 60], [178, 62], [250, 60]].map(([a, r]) => (
            <g key={a} transform={`translate(50 50) rotate(${a}) translate(0 ${-r})`}>
              <ellipse rx="2.3" ry="3.4" fill="#f9b8cd" transform="rotate(30)" />
            </g>
          ))}
        </>
      );
      break;
    case "frost":
      defs = (
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6f6ff" />
          <stop offset="0.5" stopColor="#8fd0fb" />
          <stop offset="1" stopColor="#4d9fe0" />
        </linearGradient>
      );
      body = (
        <>
          <circle cx="50" cy="50" r="51.5" fill="none" stroke={`url(#${grad})`} strokeWidth="3.4" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => (
            <Crystal key={a} angle={a} radius={51} size={i % 2 === 0 ? 22 : 14} />
          ))}
          {[[22, 63], [68, 62], [112, 62], [292, 63]].map(([a, r]) => (
            <circle key={a} transform={`translate(50 50) rotate(${a}) translate(0 ${-r})`} r="1.7" fill="#eaf8ff" stroke="#8fd0fb" strokeWidth="0.6" />
          ))}
        </>
      );
      break;
    case "laurel":
      defs = (
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6dd7a" />
          <stop offset="0.6" stopColor="#d9a637" />
          <stop offset="1" stopColor="#a8741b" />
        </linearGradient>
      );
      body = (
        <>
          <circle cx="50" cy="50" r="51.2" fill="none" stroke={`url(#${grad})`} strokeWidth="2.6" />
          <LaurelSide fill={`url(#${grad})`} side={1} />
          <LaurelSide fill={`url(#${grad})`} side={-1} />
        </>
      );
      break;
    case "neon":
      defs = (
        <>
          <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#23e6ff" />
            <stop offset="0.5" stopColor="#7a5cff" />
            <stop offset="1" stopColor="#ff3fb4" />
          </linearGradient>
          <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </>
      );
      body = (
        <>
          <circle cx="50" cy="50" r="52" fill="none" stroke={`url(#${grad})`} strokeWidth="5" filter={`url(#${glow})`} opacity="0.85" />
          <circle cx="50" cy="50" r="52" fill="none" stroke={`url(#${grad})`} strokeWidth="3" />
          <circle cx="50" cy="50" r="47.6" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" />
        </>
      );
      break;
    case "cat":
      defs = (
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7b877" />
          <stop offset="1" stopColor="#e58a45" />
        </linearGradient>
      );
      body = (
        <>
          {[-33, 33].map((rot) => (
            <g key={rot} transform={`rotate(${rot} 50 50)`}>
              <path d="M28 7 L37 -30 L66 4 Z" fill={`url(#${grad})`} stroke="#c56a2c" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M36 3 L39.5 -17 L57 2 Z" fill="#f7c4c0" />
            </g>
          ))}
          <circle cx="50" cy="50" r="51.5" fill="none" stroke={`url(#${grad})`} strokeWidth="3.6" />
        </>
      );
      break;
  }

  return (
    <svg className={`avatar-frame avatar-frame-${frame}`} viewBox="-22 -22 144 144" aria-hidden="true" focusable="false">
      {defs && <defs>{defs}</defs>}
      {body}
    </svg>
  );
}

/** Ring thickness in the 100-unit drawing, by the author's 1–3. */
const CUSTOM_WIDTH = { 1: 2.4, 2: 3.8, 3: 5.6 } as const;

function Star({ angle, radius, size, fill }: { angle: number; radius: number; size: number; fill: string }) {
  return (
    <path
      transform={`translate(50 50) rotate(${angle}) translate(0 ${-radius}) scale(${size / 20})`}
      d="M0 -10 L2.9 -4 L9.5 -3.1 L4.7 1.5 L5.9 8.1 L0 5 L-5.9 8.1 L-4.7 1.5 L-9.5 -3.1 L-2.9 -4 Z"
      fill={fill}
      stroke="#000"
      strokeOpacity="0.18"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />
  );
}

function Heart({ angle, radius, size, fill }: { angle: number; radius: number; size: number; fill: string }) {
  return (
    <path
      transform={`translate(50 50) rotate(${angle}) translate(0 ${-radius}) scale(${size / 20})`}
      d="M0 8 C -11 0 -10 -9 -4.6 -9 C -2 -9 -0.6 -7.2 0 -5.8 C 0.6 -7.2 2 -9 4.6 -9 C 10 -9 11 0 0 8 Z"
      fill={fill}
      stroke="#000"
      strokeOpacity="0.18"
      strokeWidth="0.8"
    />
  );
}

/**
 * An author's own frame, from its recipe: the ring in one of six styles,
 * two colours, three thicknesses, an ornament, and an optional slow turn.
 * Colours arrive as six hex digits (`parseCustomFrame` allows nothing
 * else), so they are safe to use as SVG paint.
 */
function CustomFrameArt({ frame }: { frame: CustomFrame }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const grad = `cg${uid}`;
  const glow = `cf${uid}`;
  const from = `#${frame.from}`;
  const to = `#${frame.to}`;
  const width = CUSTOM_WIDTH[frame.width];
  const r = 50 + width / 2;
  const paint = frame.style === "solid" ? from : `url(#${grad})`;
  const reach = r + width / 2;

  let ring: ReactNode;
  switch (frame.style) {
    case "double":
      ring = (
        <>
          <circle cx="50" cy="50" r={r} fill="none" stroke={from} strokeWidth={width} />
          <circle cx="50" cy="50" r={reach + 1.6 + width * 0.3} fill="none" stroke={to} strokeWidth={width * 0.6} />
        </>
      );
      break;
    case "dashed":
      ring = <circle cx="50" cy="50" r={r} fill="none" stroke={paint} strokeWidth={width} strokeDasharray="9 5" strokeLinecap="round" />;
      break;
    case "dotted":
      ring = <circle cx="50" cy="50" r={r + 0.6} fill="none" stroke={paint} strokeWidth={width * 1.5} strokeDasharray="0 7.2" strokeLinecap="round" />;
      break;
    case "glow":
      ring = (
        <>
          <circle cx="50" cy="50" r={r} fill="none" stroke={paint} strokeWidth={width + 2} filter={`url(#${glow})`} opacity="0.85" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={paint} strokeWidth={width} />
        </>
      );
      break;
    default:
      ring = <circle cx="50" cy="50" r={r} fill="none" stroke={paint} strokeWidth={width} />;
  }

  let ornament: ReactNode = null;
  const out = reach + 1;
  switch (frame.ornament) {
    case "stars":
      ornament = [
        [-38, 22],
        [-12, 13],
        [148, 18],
        [204, 14],
      ].map(([a, size]) => <Star key={a} angle={a!} radius={out + 1} size={size!} fill={to} />);
      break;
    case "hearts":
      ornament = [
        [-36, 20],
        [-8, 12],
        [150, 16],
        [200, 12],
      ].map(([a, size]) => <Heart key={a} angle={a!} radius={out + 1} size={size!} fill={to} />);
      break;
    case "dots":
      ornament = [0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => (
        <circle key={a} transform={`translate(50 50) rotate(${a}) translate(0 ${-(out + 4)})`} r={i % 2 === 0 ? 2.4 : 1.5} fill={to} />
      ));
      break;
    case "ears":
      ornament = [-33, 33].map((rot) => (
        <g key={rot} transform={`rotate(${rot} 50 50)`}>
          <path d="M28 7 L37 -30 L66 4 Z" fill={paint} stroke="#000" strokeOpacity="0.2" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M36 3 L39.5 -17 L57 2 Z" fill={to} opacity="0.55" />
        </g>
      ));
      break;
  }

  return (
    <svg className={`avatar-frame avatar-frame-custom${frame.spin ? " is-spinning" : ""}`} viewBox="-22 -22 144 144" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      {/* Ears stay upright while the ring turns. */}
      {frame.ornament === "ears" && ornament}
      <g className="avatar-frame-turn">
        {ring}
        {frame.ornament !== "ears" && ornament}
      </g>
    </svg>
  );
}
