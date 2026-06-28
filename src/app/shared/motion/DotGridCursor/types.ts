/** A single dot in the spatial grid */
export interface Dot {
  x: number;
  y: number;
  /** Animation frame this dot was last touched (used for deduplication) */
  frame: number;
  /** Peak alpha influence received this frame */
  maxA: number;
  /** Peak size influence received this frame */
  maxS: number;
  /** Size influence specifically from the cursor head segment */
  headS: number;
}

/** A 2-D position */
export interface Pos {
  x: number;
  y: number;
}

/**
 * A pre-computed trail segment between two consecutive history positions.
 * Stores the cached bounding-bucket ranges so dot lookup stays O(1).
 */
export interface Seg {
  h0x: number;
  h0y: number;
  /** Direction vector (h1 - h0) */
  sdx: number;
  sdy: number;
  /** Squared length of the segment (−1 signals "culled") */
  lenSq: number;
  /** 1 / lenSq, cached to avoid division inside inner loops */
  invLenSq: number;
  /** Bucket index bounds for fast spatial lookup */
  minBX: number;
  maxBX: number;
  minBY: number;
  maxBY: number;
}

/** A pooled draw-call entry that pairs a dot with its computed radius */
export interface Entry {
  r: number;
  dot: Dot | null;
  /** True when this dot should be drawn with the inverted colour */
  invert: boolean;
}

/**
 * Pixel data snapshot of a single [data-hover-invert] element.
 * Used at draw time to decide — per dot — whether it overlaps a
 * visible (non-transparent) pixel of the element.
 */
export interface InvertRegion {
  imageData: ImageData;
  rect: DOMRect;
}

/** Viewport rectangle where dot-grid cursor dots should not render */
export interface ExcludeRegion {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
