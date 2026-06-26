"use client";
import { useEffect, useRef } from "react";

const SPACING = 10,
  RADIUS = 128,
  HEAD_RADIUS = 1.5,
  MAX_TAIL_LEN = 80;
const DECAY_ALPHA = 0.92,
  DECAY_SIZE = 0.6,
  DOT_BASE = 2,
  DOT_MAX = 1;
const LERP = 1,
  IDLE_MS = 300,
  DISSIPATE = 0.025,
  RESTORE = 0.12;
const ALPHA_LEVELS = 32,
  RADIUS_SQ = RADIUS * RADIUS;
const MAX_STEP_PX = 32,
  SEGMENT_ALPHA_CULL = 0.004,
  POOL_SIZE = 4096;

const ALPHA_DECAY = Float32Array.from({ length: MAX_TAIL_LEN }, (_, i) =>
  Math.pow(DECAY_ALPHA, i),
);
const SIZE_DECAY = Float32Array.from({ length: MAX_TAIL_LEN }, (_, i) =>
  Math.pow(DECAY_SIZE, i),
);

interface Dot {
  x: number;
  y: number;
  frame: number;
  maxA: number;
  maxS: number;
  headS: number;
}
interface Pos {
  x: number;
  y: number;
}
interface Seg {
  h0x: number;
  h0y: number;
  sdx: number;
  sdy: number;
  lenSq: number;
  invLenSq: number;
  minBX: number;
  maxBX: number;
  minBY: number;
  maxBY: number;
}
interface Entry {
  r: number;
  dot: Dot | null;
}

export default function DotGridCursor({
  color = "black",
}: { color?: string } = {}) {
  const cvs = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = cvs.current!;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;
    const ctx = canvas.getContext("2d")!;

    const s = {
      mouse: { x: -999, y: -999 } as Pos,
      smooth: { x: -999, y: -999 } as Pos,
      prev: { x: -999, y: -999 } as Pos,
      hist: Array.from({ length: MAX_TAIL_LEN }, () => ({
        x: -999,
        y: -999,
      })) as Pos[],
      hHead: 0,
      hLen: 0,
      buckets: [] as Dot[][],
      cols: 0,
      rows: 0,
      lastMove: 0,
      idle: 0,
      rafId: 0,
      animating: false,
      frame: 0,
      segs: Array.from({ length: MAX_TAIL_LEN }, () => ({
        h0x: 0,
        h0y: 0,
        sdx: 0,
        sdy: 0,
        lenSq: 0,
        invLenSq: 0,
        minBX: 0,
        maxBX: 0,
        minBY: 0,
        maxBY: 0,
      })) as Seg[],
      batches: Array.from({ length: ALPHA_LEVELS + 1 }, () => [] as Entry[]),
      cands: [] as Dot[],
      pool: Array.from({ length: POOL_SIZE }, () => ({
        r: 0,
        dot: null,
      })) as Entry[],
      pIdx: 0,
      dpr: 1,
    };

    const buildGrid = (W: number, H: number) => {
      const c = Math.ceil(W / RADIUS),
        r = Math.ceil(H / RADIUS);
      s.cols = c;
      s.rows = r;
      const b: Dot[][] = Array.from({ length: c * r }, () => []);
      const ox = (W % SPACING) / 2,
        oy = (H % SPACING) / 2;
      for (let x = ox; x < W; x += SPACING) {
        const bx = Math.floor(x / RADIUS);
        for (let y = oy; y < H; y += SPACING) {
          const by = Math.floor(y / RADIUS);
          if (bx >= 0 && bx < c && by >= 0 && by < r)
            b[bx * r + by].push({
              x,
              y,
              frame: -1,
              maxA: 0,
              maxS: 0,
              headS: 0,
            });
        }
      }
      s.buckets = b;
    };

    const resize = () => {
      s.dpr = window.devicePixelRatio || 1;
      const W = window.innerWidth,
        H = window.innerHeight;
      canvas.width = W * s.dpr;
      canvas.height = H * s.dpr;
      ctx.scale(s.dpr, s.dpr);
      buildGrid(W, H);
    };

    const alloc = (r: number, dot: Dot): Entry => {
      if (s.pIdx >= POOL_SIZE) return { r, dot };
      const e = s.pool[s.pIdx++];
      e.r = r;
      e.dot = dot;
      return e;
    };

    const animate = () => {
      s.pIdx = 0;
      s.frame++;
      const sm = s.smooth,
        m = s.mouse,
        pv = s.prev;
      pv.x = sm.x;
      pv.y = sm.y;
      sm.x += (m.x - sm.x) * LERP;
      sm.y += (m.y - sm.y) * LERP;

      const fdx = sm.x - pv.x,
        fdy = sm.y - pv.y,
        dist = Math.sqrt(fdx * fdx + fdy * fdy);
      if (dist > MAX_STEP_PX && pv.x > -900) {
        const steps = Math.ceil(dist / MAX_STEP_PX);
        for (let st = steps - 1; st >= 1; st--) {
          const t = st / steps;
          s.hHead = (s.hHead - 1 + MAX_TAIL_LEN) % MAX_TAIL_LEN;
          const sl = s.hist[s.hHead];
          sl.x = pv.x + fdx * (1 - t);
          sl.y = pv.y + fdy * (1 - t);
          if (s.hLen < MAX_TAIL_LEN) s.hLen++;
        }
      }
      s.hHead = (s.hHead - 1 + MAX_TAIL_LEN) % MAX_TAIL_LEN;
      const sl = s.hist[s.hHead];
      sl.x = sm.x;
      sl.y = sm.y;
      if (s.hLen < MAX_TAIL_LEN) s.hLen++;

      const isIdle = Date.now() - s.lastMove > IDLE_MS;
      s.idle = isIdle
        ? Math.max(0, s.idle - DISSIPATE)
        : Math.min(1, s.idle + RESTORE);

      const W = window.innerWidth,
        H = window.innerHeight;
      ctx.clearRect(0, 0, W, H);
      if (s.idle <= 0 && isIdle) {
        s.hLen = 0;
        s.hHead = 0;
        s.animating = false;
        return;
      }

      // Shrink-to-cursor: when idle, contract the effective influence radius
      // toward 0 proportional to idleStrength. Dots far from the cursor lose
      // influence first so the lit region visually collapses inward to the
      // cursor point, then vanishes — instead of a uniform fade-in-place.
      const activeRadius = RADIUS * s.idle;
      const activeRadiusSq = activeRadius * activeRadius;

      for (let i = 0; i <= ALPHA_LEVELS; i++) s.batches[i].length = 0;
      const out = s.cands;
      out.length = 0;
      const {
        hist: buf,
        hHead: head,
        hLen: len,
        rows,
        buckets: bkts,
        segs,
        frame: fr,
      } = s;

      // Pass 1: build segments
      for (let i = 0; i < len; i++) {
        const seg = segs[i];
        if (ALPHA_DECAY[i] < SEGMENT_ALPHA_CULL) {
          seg.lenSq = -1;
          continue;
        }
        const h0 = buf[(head + i) % MAX_TAIL_LEN];
        seg.h0x = h0.x;
        seg.h0y = h0.y;
        let minX = h0.x,
          maxX = h0.x,
          minY = h0.y,
          maxY = h0.y;
        if (i + 1 < len && ALPHA_DECAY[i + 1] >= SEGMENT_ALPHA_CULL) {
          const h1 = buf[(head + i + 1) % MAX_TAIL_LEN];
          const sx = h1.x - h0.x,
            sy = h1.y - h0.y,
            lsq = sx * sx + sy * sy;
          seg.sdx = sx;
          seg.sdy = sy;
          seg.lenSq = lsq;
          seg.invLenSq = lsq > 0 ? 1 / lsq : 0;
          if (h1.x < minX) minX = h1.x;
          else if (h1.x > maxX) maxX = h1.x;
          if (h1.y < minY) minY = h1.y;
          else if (h1.y > maxY) maxY = h1.y;
        } else {
          seg.lenSq = 0;
        }
        const ar = activeRadius;
        const iMinX = minX - ar,
          iMaxX = maxX + ar,
          iMinY = minY - ar,
          iMaxY = maxY + ar;
        if (iMaxX < 0 || iMinX > W || iMaxY < 0 || iMinY > H) {
          seg.lenSq = -1;
          continue;
        }
        seg.minBX = Math.max(0, Math.floor(iMinX / RADIUS));
        seg.maxBX = Math.min(s.cols - 1, Math.floor(iMaxX / RADIUS));
        seg.minBY = Math.max(0, Math.floor(iMinY / RADIUS));
        seg.maxBY = Math.min(rows - 1, Math.floor(iMaxY / RADIUS));
      }

      // Pass 2: collect candidates + influence
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
                dot.frame = fr;
                dot.maxA = 0;
                dot.maxS = 0;
                dot.headS = 0;
                out.push(dot);
              }
              let cx = seg.h0x,
                cy = seg.h0y;
              if (i + 1 < len && seg.lenSq > 0) {
                let t =
                  ((dot.x - seg.h0x) * seg.sdx + (dot.y - seg.h0y) * seg.sdy) *
                  seg.invLenSq;
                if (t < 0) t = 0;
                else if (t > 1) t = 1;
                cx = seg.h0x + t * seg.sdx;
                cy = seg.h0y + t * seg.sdy;
              }
              const ddx = dot.x - cx,
                ddy = dot.y - cy,
                dSq = ddx * ddx + ddy * ddy;
              // Use shrunk radius for influence test
              if (dSq >= activeRadiusSq) continue;
              const sp = 1 - Math.sqrt(dSq) / activeRadius;
              const ai = sp * ALPHA_DECAY[i],
                si = sp * SIZE_DECAY[i];
              if (ai > dot.maxA) dot.maxA = ai;
              if (si > dot.maxS) dot.maxS = si;
              if (i === 0 && si > dot.headS) dot.headS = si;
            }
          }
        }
      }

      // Pass 3: batch
      for (let j = 0; j < out.length; j++) {
        const dot = out[j];
        const as = dot.maxA;
        if (as < 0.01) continue;
        const ae = Math.pow(as, 1.6),
          se = Math.pow(dot.maxS, 1.6),
          he = Math.pow(dot.headS, 1.6);
        const ai = Math.min(
          ALPHA_LEVELS,
          Math.round((0.12 + 0.88 * ae) * ALPHA_LEVELS),
        );
        const r = Math.max(
          DOT_BASE + (HEAD_RADIUS - DOT_BASE) * he,
          DOT_BASE + (DOT_MAX - DOT_BASE) * se,
        );
        s.batches[ai].push(alloc(r, dot));
      }

      // Draw
      ctx.fillStyle = color;
      for (let i = 0; i <= ALPHA_LEVELS; i++) {
        const es = s.batches[i];
        if (!es.length) continue;
        ctx.globalAlpha = i / ALPHA_LEVELS;
        ctx.beginPath();
        for (let j = 0; j < es.length; j++) {
          const { r, dot } = es[j],
            d = dot!;
          ctx.moveTo(d.x + r, d.y);
          ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      s.rafId = requestAnimationFrame(animate);
    };

    const onPtr = (e: PointerEvent) => {
      s.mouse.x = e.clientX;
      s.mouse.y = e.clientY;
      s.lastMove = Date.now();
      if (!s.animating) {
        s.animating = true;
        s.rafId = requestAnimationFrame(animate);
      }
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      s.mouse.x = t.clientX;
      s.mouse.y = t.clientY;
      s.lastMove = Date.now();
      if (!s.animating) {
        s.animating = true;
        s.rafId = requestAnimationFrame(animate);
      }
    };
    const onMQ = (e: MediaQueryListEvent) => {
      if (e.matches) {
        cancelAnimationFrame(s.rafId);
        s.animating = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    resize();
    window.addEventListener("pointermove", onPtr);
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("resize", () => resize());
    mq.addEventListener("change", onMQ);

    return () => {
      cancelAnimationFrame(s.rafId);
      window.removeEventListener("pointermove", onPtr);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("resize", () => resize());
      mq.removeEventListener("change", onMQ);
      s.animating = false;
    };
  }, [color]);

  return (
    <canvas
      ref={cvs}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
        width: "100%",
        height: "100%",
      }}
    />
  );
}
