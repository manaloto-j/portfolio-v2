import { EXCLUDE_OFFSET } from "./constants";
import type { ExcludeRegion, InvertRegion } from "./types";

// ─── Colour Utilities ─────────────────────────────────────────────────────────

/**
 * Returns the bitwise-inverted CSS hex colour of the given hex string.
 * Supports both 3-digit (#RGB) and 6-digit (#RRGGBB) formats.
 */
export function invertHex(hex: string): string {
  let c = hex.startsWith("#") ? hex.slice(1) : hex;
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const num = parseInt(c, 16);
  return "#" + (0xffffff ^ num).toString(16).padStart(6, "0");
}

// ─── Invert-Region Snapshot ───────────────────────────────────────────────────

/**
 * Scans the DOM for every `[data-hover-invert]` element and captures its
 * visible shape into an offscreen canvas, producing an `InvertRegion` for
 * each one.
 *
 * For elements that contain (or are) an `<img>`, the image pixels are drawn
 * so that transparent areas (PNG cutouts, etc.) are faithfully represented.
 * Non-image elements fall back to a solid opaque fill covering the bounding
 * rect, which is equivalent to the old rect-clip behaviour.
 *
 * The resulting regions are used by `isInsideInvertRegion` to perform a
 * per-dot pixel-alpha test at draw time instead of relying on CSS clip-paths.
 */
export async function buildInvertRegions(): Promise<InvertRegion[]> {
  const els = Array.from(
    document.querySelectorAll<HTMLElement>("[data-hover-invert]"),
  );
  const regions: InvertRegion[] = [];

  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const w = Math.ceil(rect.width);
    const h = Math.ceil(rect.height);

    const oc = document.createElement("canvas");
    oc.width = w;
    oc.height = h;
    const oc2d = oc.getContext("2d");
    if (!oc2d) continue;

    // Prefer an <img> child (or the element itself when it is an <img>)
    const img =
      el instanceof HTMLImageElement
        ? el
        : el.querySelector<HTMLImageElement>("img");

    if (img && img.complete && img.naturalWidth > 0) {
      // Draw the image at its rendered position relative to the element origin
      const ir = img.getBoundingClientRect();
      oc2d.drawImage(img, ir.left - rect.left, ir.top - rect.top, ir.width, ir.height);
    } else {
      // Fallback: solid opaque rect — matches original rect-clip behaviour
      oc2d.fillStyle = "#ffffff";
      oc2d.fillRect(0, 0, w, h);
    }

    let imageData: ImageData;
    try {
      imageData = oc2d.getImageData(0, 0, w, h);
    } catch {
      // Cross-origin image — fall back to treating the full rect as opaque
      oc2d.fillStyle = "#ffffff";
      oc2d.fillRect(0, 0, w, h);
      imageData = oc2d.getImageData(0, 0, w, h);
    }

    regions.push({ imageData, rect });
  }

  return regions;
}

// ─── Per-Dot Region Test ──────────────────────────────────────────────────────

/**
 * Returns `true` when the viewport point `(x, y)` falls on a visible
 * (alpha > 10) pixel of any captured invert region.
 *
 * This is called for every active dot each animation frame, so it is kept
 * intentionally tight — no allocations, early exits on every miss.
 */
export function isInsideInvertRegion(
  x: number,
  y: number,
  regions: InvertRegion[],
): boolean {
  for (const { imageData, rect } of regions) {
    const lx = x - rect.left;
    const ly = y - rect.top;
    if (lx < 0 || ly < 0 || lx >= rect.width || ly >= rect.height) continue;

    const px = Math.floor(lx);
    const py = Math.floor(ly);
    const alphaIdx = (py * imageData.width + px) * 4 + 3;
    if (imageData.data[alphaIdx] > 10) return true;
  }
  return false;
}

export function buildExcludeRegions(): ExcludeRegion[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-dotgridcursor-exclude]"),
  )
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      left: rect.left - EXCLUDE_OFFSET,
      right: rect.right + EXCLUDE_OFFSET,
      top: rect.top - EXCLUDE_OFFSET,
      bottom: rect.bottom + EXCLUDE_OFFSET,
    }));
}

export function isInsideExcludeRegion(
  x: number,
  y: number,
  regions: ExcludeRegion[],
): boolean {
  for (const rect of regions) {
    if (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
      return true;
    }
  }
  return false;
}
