// ─── Grid & Cursor Geometry ───────────────────────────────────────────────────
export const SPACING       = 10;
export const RADIUS        = 128;
export const HEAD_RADIUS   = 1.5;
export const MAX_TAIL_LEN  = 80;

// ─── Dot Sizes ────────────────────────────────────────────────────────────────
/** Default dot radius (base and maximum growth) */
export const DOT_BASE      = 3;
export const DOT_MAX       = 3;

/** Enlarged dot radius when inside a data-hover-invert element */
export const DOT_BASE_HOVER = 5;
export const DOT_MAX_HOVER  = 5;

// ─── Trail Decay ──────────────────────────────────────────────────────────────
export const DECAY_ALPHA   = 0.92;
export const DECAY_SIZE    = 0.6;

/** Pre-computed per-segment alpha & size decay tables (avoids pow() per frame) */
export const ALPHA_DECAY = Float32Array.from(
  { length: MAX_TAIL_LEN },
  (_, i) => Math.pow(DECAY_ALPHA, i),
);
export const SIZE_DECAY = Float32Array.from(
  { length: MAX_TAIL_LEN },
  (_, i) => Math.pow(DECAY_SIZE, i),
);

// ─── Animation Timing ─────────────────────────────────────────────────────────
/** Lerp factor for smooth cursor following (1 = instant) */
export const LERP       = 1;
/** Milliseconds of no movement before the cursor is considered idle */
export const IDLE_MS    = 300;
/** How fast idleness grows (dissipation rate per frame) */
export const DISSIPATE  = 0.025;
/** How fast activity recovers after movement resumes */
export const RESTORE    = 0.12;

// ─── Rendering ────────────────────────────────────────────────────────────────
/** Number of discrete alpha buckets used for batching draw calls */
export const ALPHA_LEVELS       = 16;
/** Maximum distance a cursor can jump in one frame before sub-steps are added */
export const MAX_STEP_PX        = 32;
/** Segments whose alpha has decayed below this threshold are culled early */
export const SEGMENT_ALPHA_CULL = 0.004;
/** Fixed-size object pool to avoid per-frame GC pressure */
export const POOL_SIZE          = 4096;
