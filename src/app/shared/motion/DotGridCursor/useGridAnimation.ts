import { useEffect, useRef } from "react";
import {
  SPACING, RADIUS, HEAD_RADIUS, MAX_TAIL_LEN,
  DOT_BASE, DOT_MAX, DOT_BASE_HOVER, DOT_MAX_HOVER,
  LERP, IDLE_MS, DISSIPATE, RESTORE,
  ALPHA_LEVELS, MAX_STEP_PX, SEGMENT_ALPHA_CULL, POOL_SIZE,
  ALPHA_DECAY, SIZE_DECAY,
} from "./constants";
import type { Dot, Pos, Seg, Entry, ExcludeRegion, InvertRegion } from "./types";
import {
  buildExcludeRegions,
  buildInvertRegions,
  isInsideExcludeRegion,
  isInsideInvertRegion,
} from "./invertRegions";
import type { IdleAnimationHandles } from "./useIdleAnimation";

// ─── Internal State Shape ─────────────────────────────────────────────────────

/** All mutable animation state, kept in a single plain object to avoid
 *  repeated closure captures and to make the data flow easy to trace. */
interface AnimState {
  mouse:     Pos;
  smooth:    Pos;
  prev:      Pos;
  hist:      Pos[];
  hHead:     number;
  hLen:      number;
  buckets:   Dot[][];
  cols:      number;
  rows:      number;
  lastMove:  number;
  idle:      number;
  rafId:     number;
  animating: boolean;
  frame:     number;
  segs:      Seg[];
  batches:   Entry[][];
  cands:     Dot[];
  pool:      Entry[];
  pIdx:      number;
  dpr:       number;
  idleWasActive: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Drives the entire dot-grid cursor animation.
 *
 * Attaches to two caller-provided canvas refs:
 * - `cvs1` — normal dots rendered in `color`
 * - `cvs2` — inverted dots rendered over `[data-hover-invert]` elements
 *
 * Returns nothing; all side-effects are cleaned up in the `useEffect` teardown.
 */
export function useGridAnimation(
  cvs1: React.RefObject<HTMLCanvasElement | null>,
  cvs2: React.RefObject<HTMLCanvasElement | null>,
  color: string,
  invertedColor: string,
  idleHandles?: IdleAnimationHandles,
  ignorePointer?: boolean,
): void {
  // Stable ref so the animation loop always reads the current colour without
  // needing to restart the effect when only the colour changes.
  const colorRef        = useRef(color);
  const invertedColorRef = useRef(invertedColor);
  colorRef.current        = color;
  invertedColorRef.current = invertedColor;

  useEffect(() => {
    const canvas1 = cvs1.current!;
    const ctx1    = canvas1.getContext("2d")!;
    const canvas2 = cvs2.current!;
    const ctx2    = canvas2.getContext("2d")!;

    // ── Invert-region management ─────────────────────────────────────────────
    let invertRegions: InvertRegion[] = [];
    let excludeRegions: ExcludeRegion[] = [];
    let regionsDirty = true;

    const markRegionsDirty = () => { regionsDirty = true; };

    const refreshRegions = async () => {
      if (!regionsDirty) return;
      regionsDirty = false;
      invertRegions = await buildInvertRegions();
      excludeRegions = buildExcludeRegions();
    };

    window.addEventListener("scroll", markRegionsDirty, { passive: true });
    window.addEventListener("resize", markRegionsDirty);
    const mutObs = new MutationObserver(markRegionsDirty);
    mutObs.observe(document.body, { childList: true, subtree: true, attributes: true });
    refreshRegions(); // initial snapshot

    // ── Animation state initialisation ───────────────────────────────────────
    const s: AnimState = {
      mouse:     { x: -999, y: -999 },
      smooth:    { x: -999, y: -999 },
      prev:      { x: -999, y: -999 },
      hist:      Array.from({ length: MAX_TAIL_LEN }, () => ({ x: -999, y: -999 })),
      hHead: 0, hLen: 0,
      buckets: [], cols: 0, rows: 0,
      lastMove: 0, idle: 0,
      rafId: 0, animating: false, frame: 0,
      segs: Array.from({ length: MAX_TAIL_LEN }, () => ({
        h0x: 0, h0y: 0, sdx: 0, sdy: 0,
        lenSq: 0, invLenSq: 0,
        minBX: 0, maxBX: 0, minBY: 0, maxBY: 0,
      })),
      batches: Array.from({ length: ALPHA_LEVELS + 1 }, () => [] as Entry[]),
      cands: [],
      pool: Array.from({ length: POOL_SIZE }, () => ({ r: 0, dot: null, invert: false })),
      pIdx: 0, dpr: 1, idleWasActive: false,
    };

    // ── Grid construction ────────────────────────────────────────────────────

    /**
     * Populates `s.buckets` with a uniform dot grid that covers the viewport.
     * Each bucket cell covers a RADIUS×RADIUS area for fast spatial lookup.
     */
    const buildGrid = (W: number, H: number) => {
      const c = Math.ceil(W / RADIUS);
      const r = Math.ceil(H / RADIUS);
      s.cols = c;
      s.rows = r;
      const b: Dot[][] = Array.from({ length: c * r }, () => []);
      const ox = (W % SPACING) / 2;
      const oy = (H % SPACING) / 2;
      for (let x = ox; x < W; x += SPACING) {
        const bx = Math.floor(x / RADIUS);
        for (let y = oy; y < H; y += SPACING) {
          const by = Math.floor(y / RADIUS);
          if (bx >= 0 && bx < c && by >= 0 && by < r)
            b[bx * r + by].push({ x, y, frame: -1, maxA: 0, maxS: 0, headS: 0 });
        }
      }
      s.buckets = b;
    };

    const resize = () => {
      s.dpr = window.devicePixelRatio || 1;
      const W = window.innerWidth;
      const H = window.innerHeight;
      canvas1.width  = W * s.dpr;
      canvas1.height = H * s.dpr;
      canvas2.width  = W * s.dpr;
      canvas2.height = H * s.dpr;
      ctx1.scale(s.dpr, s.dpr);
      ctx2.scale(s.dpr, s.dpr);
      buildGrid(W, H);
      markRegionsDirty();
    };

    // ── Object pool ──────────────────────────────────────────────────────────

    /** Grabs a recycled Entry from the pool (or allocates one when exhausted). */
    const alloc = (r: number, dot: Dot, invert: boolean): Entry => {
      if (s.pIdx >= POOL_SIZE) return { r, dot, invert };
      const e  = s.pool[s.pIdx++];
      e.r      = r;
      e.dot    = dot;
      e.invert = invert;
      return e;
    };

    // ── Animation loop ───────────────────────────────────────────────────────

    const animate = () => {
      refreshRegions(); // async — reads last good snapshot until the new one lands

      // Reset pool pointer each frame
      s.pIdx = 0;
      s.frame++;

      // ── Intro animation override ─────────────────────────────────────────
      // When the intro hook has a virtual position, feed it into the mouse
      // state so the existing trail/dot logic renders it just like real input.
      // Dashes are connected (no teleport), so trail history is never cleared —
      // all previous stroke trails remain visible as subsequent dashes play.
      if (idleHandles) {
        const idlePos = idleHandles.getIdlePos();

        if (idlePos) {
          if (!s.idleWasActive) {
            // Idle animation JUST started this frame.
            // Snap the cursor to the first keyframe and clear the old trail
            // to prevent a ghost dash from the user's idle mouse position.
            s.hLen     = 0;
            s.hHead    = 0;
            s.smooth.x = idlePos.x; s.smooth.y = idlePos.y;
            s.prev.x   = idlePos.x; s.prev.y   = idlePos.y;
          }
          s.mouse.x  = idlePos.x;
          s.mouse.y  = idlePos.y;
          s.lastMove = Date.now(); // keep the cursor active (prevent idle fade)
        } else if (s.idleWasActive && !idlePos) {
          // Idle anim JUST finished drawing this frame.
          // Force lastMove into the past so dissipation starts instantly,
          // skipping the IDLE_MS wait.
          s.lastMove = Date.now() - IDLE_MS;
        }
        
        s.idleWasActive = !!idlePos;
      }

      // ── Smooth cursor position ───────────────────────────────────────────
      const { smooth: sm, mouse: m, prev: pv } = s;
      pv.x = sm.x;
      pv.y = sm.y;
      sm.x += (m.x - sm.x) * LERP;
      sm.y += (m.y - sm.y) * LERP;

      // ── Sub-step interpolation (prevents gaps when cursor jumps fast) ─────
      const fdx  = sm.x - pv.x;
      const fdy  = sm.y - pv.y;
      const dist = Math.sqrt(fdx * fdx + fdy * fdy);
      if (dist > MAX_STEP_PX && pv.x > -900) {
        const steps = Math.ceil(dist / MAX_STEP_PX);
        for (let st = steps - 1; st >= 1; st--) {
          const t   = st / steps;
          s.hHead   = (s.hHead - 1 + MAX_TAIL_LEN) % MAX_TAIL_LEN;
          const sl  = s.hist[s.hHead];
          sl.x      = pv.x + fdx * (1 - t);
          sl.y      = pv.y + fdy * (1 - t);
          if (s.hLen < MAX_TAIL_LEN) s.hLen++;
        }
      }
      s.hHead      = (s.hHead - 1 + MAX_TAIL_LEN) % MAX_TAIL_LEN;
      s.hist[s.hHead].x = sm.x;
      s.hist[s.hHead].y = sm.y;
      if (s.hLen < MAX_TAIL_LEN) s.hLen++;

      // ── Idle / dissipation ───────────────────────────────────────────────
      const isIdle = Date.now() - s.lastMove > IDLE_MS;
      s.idle = isIdle
        ? Math.max(0, s.idle - DISSIPATE)
        : Math.min(1, s.idle + RESTORE);

      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx1.clearRect(0, 0, W, H);
      ctx2.clearRect(0, 0, W, H);

      if (s.idle <= 0 && isIdle) {
        s.hLen = 0; s.hHead = 0; s.animating = false;
        return; // nothing left to draw — stop the loop
      }

      // ── Shrink-to-cursor: contract influence radius as cursor idles ───────
      // Dots far from the cursor lose influence first, so the lit region
      // collapses inward toward the cursor point rather than fading uniformly.
      const activeRadius   = RADIUS * s.idle;
      const activeRadiusSq = activeRadius * activeRadius;

      for (let i = 0; i <= ALPHA_LEVELS; i++) s.batches[i].length = 0;
      const out = s.cands;
      out.length = 0;

      const { hist: buf, hHead: head, hLen: len, rows, buckets: bkts, segs, frame: fr } = s;

      // ── Pass 1: build trail segments ─────────────────────────────────────
      // Pre-compute each segment's geometry and bucket bounding range so the
      // dot-influence pass can skip whole sections of the grid cheaply.
      for (let i = 0; i < len; i++) {
        const seg = segs[i];
        if (ALPHA_DECAY[i] < SEGMENT_ALPHA_CULL) { seg.lenSq = -1; continue; }

        const h0 = buf[(head + i) % MAX_TAIL_LEN];
        seg.h0x = h0.x;
        seg.h0y = h0.y;
        let minX = h0.x, maxX = h0.x, minY = h0.y, maxY = h0.y;

        if (i + 1 < len && ALPHA_DECAY[i + 1] >= SEGMENT_ALPHA_CULL) {
          const h1  = buf[(head + i + 1) % MAX_TAIL_LEN];
          const sx  = h1.x - h0.x, sy = h1.y - h0.y;
          const lsq = sx * sx + sy * sy;
          seg.sdx = sx; seg.sdy = sy;
          seg.lenSq = lsq;
          seg.invLenSq = lsq > 0 ? 1 / lsq : 0;
          if (h1.x < minX) minX = h1.x; else if (h1.x > maxX) maxX = h1.x;
          if (h1.y < minY) minY = h1.y; else if (h1.y > maxY) maxY = h1.y;
        } else {
          seg.lenSq = 0;
        }

        const iMinX = minX - activeRadius, iMaxX = maxX + activeRadius;
        const iMinY = minY - activeRadius, iMaxY = maxY + activeRadius;
        if (iMaxX < 0 || iMinX > W || iMaxY < 0 || iMinY > H) { seg.lenSq = -1; continue; }

        seg.minBX = Math.max(0, Math.floor(iMinX / RADIUS));
        seg.maxBX = Math.min(s.cols - 1, Math.floor(iMaxX / RADIUS));
        seg.minBY = Math.max(0, Math.floor(iMinY / RADIUS));
        seg.maxBY = Math.min(rows - 1, Math.floor(iMaxY / RADIUS));
      }

      // ── Pass 2: collect candidates + accumulate influence ─────────────────
      for (let i = 0; i < len; i++) {
        const seg = segs[i];
        if (seg.lenSq === -1) continue;
        for (let bx = seg.minBX; bx <= seg.maxBX; bx++) {
          const co = bx * rows;
          for (let by = seg.minBY; by <= seg.maxBY; by++) {
            const bkt = bkts[co + by];
            for (let k = 0; k < bkt.length; k++) {
              const dot = bkt[k];
              if (dot.frame !== fr) {
                dot.frame = fr; dot.maxA = 0; dot.maxS = 0; dot.headS = 0;
                out.push(dot);
              }
              // Project dot onto the segment to find nearest point
              let cx = seg.h0x, cy = seg.h0y;
              if (i + 1 < len && seg.lenSq > 0) {
                let t = ((dot.x - seg.h0x) * seg.sdx + (dot.y - seg.h0y) * seg.sdy) * seg.invLenSq;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                cx = seg.h0x + t * seg.sdx;
                cy = seg.h0y + t * seg.sdy;
              }
              const ddx = dot.x - cx, ddy = dot.y - cy;
              const dSq = ddx * ddx + ddy * ddy;
              if (dSq >= activeRadiusSq) continue;

              const sp = 1 - Math.sqrt(dSq) / activeRadius;
              const ai = sp * ALPHA_DECAY[i];
              const si = sp * SIZE_DECAY[i];
              if (ai > dot.maxA) dot.maxA = ai;
              if (si > dot.maxS) dot.maxS = si;
              if (i === 0 && si > dot.headS) dot.headS = si;
            }
          }
        }
      }

      // ── Pass 3: batch by alpha level ─────────────────────────────────────
      for (let j = 0; j < out.length; j++) {
        const dot = out[j];
        if (dot.maxA < 0.01) continue;
        if (isInsideExcludeRegion(dot.x, dot.y, excludeRegions)) continue;

        const ae = Math.pow(dot.maxA,   1.6);
        const se = Math.pow(dot.maxS,   1.6);
        const he = Math.pow(dot.headS,  1.6);
        const ai = Math.min(ALPHA_LEVELS, Math.round((0.12 + 0.88 * ae) * ALPHA_LEVELS));

        const inv  = isInsideInvertRegion(dot.x, dot.y, invertRegions);
        const base = inv ? DOT_BASE_HOVER : DOT_BASE;
        const max  = inv ? DOT_MAX_HOVER  : DOT_MAX;
        const r    = Math.max(base + (HEAD_RADIUS - base) * he, base + (max - base) * se);

        s.batches[ai].push(alloc(r, dot, inv));
      }

      // ── Draw ─────────────────────────────────────────────────────────────
      // Normal dots go to canvas1, inverted dots to canvas2.
      // Both paths are batched per alpha level to minimise fill-style changes.
      for (let i = 0; i <= ALPHA_LEVELS; i++) {
        const es = s.batches[i];
        if (!es.length) continue;

        ctx1.fillStyle = colorRef.current;
        ctx2.fillStyle = invertedColorRef.current;
        ctx1.beginPath();
        ctx2.beginPath();

        for (let j = 0; j < es.length; j++) {
          const { r, dot, invert } = es[j];
          const d = dot!;
          if (!invert) {
            ctx1.moveTo(d.x + r, d.y);
            ctx1.arc(d.x, d.y, r, 0, Math.PI * 2);
          } else {
            ctx2.moveTo(d.x + r, d.y);
            ctx2.arc(d.x, d.y, r, 0, Math.PI * 2);
          }
        }
        ctx1.fill();
        ctx2.fill();
      }

      ctx1.globalAlpha = 1;
      ctx2.globalAlpha = 1;
      s.rafId = requestAnimationFrame(animate);
    };

    // ── Input handlers ───────────────────────────────────────────────────────

    const onPtr = (e: PointerEvent) => {
      s.mouse.x  = e.clientX;
      s.mouse.y  = e.clientY;
      s.lastMove = Date.now();
      if (!s.animating) { s.animating = true; s.rafId = requestAnimationFrame(animate); }
    };

    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      
      s.mouse.x  = t.clientX;
      s.mouse.y  = t.clientY;
      s.lastMove = Date.now();
      if (!s.animating) { s.animating = true; s.rafId = requestAnimationFrame(animate); }
    };

    const onResize = () => resize();

    resize();
    
    if (!ignorePointer) {
      window.addEventListener("pointermove", onPtr);
      window.addEventListener("touchmove", onTouch, { passive: true });
    }
    window.addEventListener("resize", onResize);

    // ── Idle Kick ────────────────────────────────────────────────────────────
    // Poll at 60 fps so the idle motion is picked up immediately
    const idleKick = () => {
      if (idleHandles?.getIdlePos() && !s.animating) {
        s.animating = true;
        s.rafId = requestAnimationFrame(animate);
      }
      idleKickTimer = requestAnimationFrame(idleKick);
    };
    let idleKickTimer = idleHandles ? requestAnimationFrame(idleKick) : -1;

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(s.rafId);
      if (idleKickTimer !== -1) cancelAnimationFrame(idleKickTimer);
      if (!ignorePointer) {
        window.removeEventListener("pointermove", onPtr);
        window.removeEventListener("touchmove", onTouch);
      }
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", markRegionsDirty);
      window.removeEventListener("resize", markRegionsDirty);
      mutObs.disconnect();
      s.animating = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs once; colour is read via ref so no restart needed
}
