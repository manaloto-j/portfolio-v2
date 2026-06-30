import { useEffect, useRef } from "react";
import {
  SPACING,
  RADIUS,
  MAX_TAIL_LEN,
  LERP,
  IDLE_MS,
  DISSIPATE,
  RESTORE,
  ALPHA_LEVELS,
  MAX_STEP_PX,
  SEGMENT_ALPHA_CULL,
  POOL_SIZE,
  ALPHA_DECAY,
} from "./constants";
import type {
  Dot,
  Pos,
  Seg,
  Entry,
  ExcludeRegion,
  InvertRegion,
} from "./types";
import {
  buildExcludeRegions,
  buildInvertRegions,
  isInsideExcludeRegion,
  isInsideInvertRegion,
} from "./invertRegions";
import type { IdleAnimationHandles } from "./useIdleAnimation";

interface AnimState {
  mouse: Pos;
  smooth: Pos;
  prev: Pos;
  hist: Pos[];
  hHead: number;
  hLen: number;
  buckets: Dot[][];
  cols: number;
  rows: number;
  lastMove: number;
  idle: number;
  rafId: number;
  animating: boolean;
  frame: number;
  segs: Seg[];
  batches: Entry[][];
  cands: Dot[];
  pool: Entry[];
  pIdx: number;
  dpr: number;
  idleWasActive: boolean;
}

export function useGridAnimation(
  cvs1: React.RefObject<HTMLCanvasElement | null>,
  cvs2: React.RefObject<HTMLCanvasElement | null>,
  color: string,
  invertedColor: string,
  idleHandles?: IdleAnimationHandles,
  ignorePointer?: boolean,
): void {
  const colorRef = useRef(color);
  const invertedColorRef = useRef(invertedColor);
  const canvas1Ref = useRef<HTMLCanvasElement | null>(null);
  const canvas2Ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    colorRef.current = color;
    invertedColorRef.current = invertedColor;
  }, [color, invertedColor]);

  useEffect(() => {
    canvas1Ref.current = cvs1.current;
    canvas2Ref.current = cvs2.current;
    const canvas1 = canvas1Ref.current;
    const canvas2 = canvas2Ref.current;
    if (!canvas1 || !canvas2) return;
    const ctx1 = canvas1.getContext("2d")!;
    const ctx2 = canvas2.getContext("2d")!;
    let invertRegions: InvertRegion[] = [];
    let excludeRegions: ExcludeRegion[] = [];
    let regionsDirty = true;
    const markRegionsDirty = () => (regionsDirty = true);
    const refreshRegions = async () => {
      if (!regionsDirty) return;
      regionsDirty = false;
      invertRegions = await buildInvertRegions();
      excludeRegions = buildExcludeRegions();
    };
    window.addEventListener("scroll", markRegionsDirty, { passive: true });
    window.addEventListener("resize", markRegionsDirty);
    const mutObs = new MutationObserver(markRegionsDirty);
    mutObs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    refreshRegions();

    const SQUARE_HALF = SPACING * 0.5;
    const s: AnimState = {
      mouse: { x: -999, y: -999 },
      smooth: { x: -999, y: -999 },
      prev: { x: -999, y: -999 },
      hist: Array.from({ length: MAX_TAIL_LEN }, () => ({ x: -999, y: -999 })),
      hHead: 0,
      hLen: 0,
      buckets: [],
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
      })),
      batches: Array.from({ length: ALPHA_LEVELS + 1 }, () => [] as Entry[]),
      cands: [],
      pool: Array.from({ length: POOL_SIZE }, () => ({
        r: 0,
        dot: null,
        invert: false,
      })),
      pIdx: 0,
      dpr: 1,
      idleWasActive: false,
    };

    const buildGrid = (W: number, H: number) => {
      const c = Math.ceil(W / RADIUS);
      const r = Math.ceil(H / RADIUS);
      s.cols = c;
      s.rows = r;
      const buckets: Dot[][] = Array.from({ length: c * r }, () => []);
      const ox = (W % SPACING) / 2;
      const oy = (H % SPACING) / 2;
      for (let x = ox; x < W; x += SPACING) {
        const bx = Math.floor(x / RADIUS);
        for (let y = oy; y < H; y += SPACING) {
          const by = Math.floor(y / RADIUS);
          if (bx >= 0 && bx < c && by >= 0 && by < r)
            buckets[bx * r + by].push({
              x,
              y,
              frame: -1,
              maxA: 0,
              maxS: 0,
              headS: 0,
            });
        }
      }
      s.buckets = buckets;
    };

    const resize = () => {
      s.dpr = window.devicePixelRatio || 1;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const c1 = canvas1Ref.current;
      const c2 = canvas2Ref.current;
      if (!c1 || !c2) return;
      c1.width = W * s.dpr;
      c1.height = H * s.dpr;
      c2.width = W * s.dpr;
      c2.height = H * s.dpr;
      ctx1.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx2.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      buildGrid(W, H);
      markRegionsDirty();
    };

    const alloc = (r: number, dot: Dot, invert: boolean) => {
      if (s.pIdx >= POOL_SIZE) return { r, dot, invert };
      const entry = s.pool[s.pIdx++];
      entry.r = r;
      entry.dot = dot;
      entry.invert = invert;
      return entry;
    };

    const animate = () => {
      refreshRegions();
      s.pIdx = 0;
      s.frame++;

      const idlePos = idleHandles?.getIdlePos();
      if (idlePos) {
        if (!s.idleWasActive) {
          s.hLen = 0;
          s.hHead = 0;
          s.smooth.x = idlePos.x;
          s.smooth.y = idlePos.y;
          s.prev.x = idlePos.x;
          s.prev.y = idlePos.y;
        }
        s.mouse.x = idlePos.x;
        s.mouse.y = idlePos.y;
        s.lastMove = Date.now();
      } else if (s.idleWasActive) {
        s.lastMove = Date.now() - IDLE_MS;
      }
      s.idleWasActive = !!idlePos;

      const { smooth: sm, mouse: m, prev: pv } = s;
      pv.x = sm.x;
      pv.y = sm.y;
      sm.x += (m.x - sm.x) * LERP;
      sm.y += (m.y - sm.y) * LERP;

      const fdx = sm.x - pv.x;
      const fdy = sm.y - pv.y;
      const dist = Math.sqrt(fdx * fdx + fdy * fdy);
      if (dist > MAX_STEP_PX && pv.x > -900) {
        const steps = Math.ceil(dist / MAX_STEP_PX);
        for (let st = steps - 1; st >= 1; st--) {
          const t = st / steps;
          s.hHead = (s.hHead - 1 + MAX_TAIL_LEN) % MAX_TAIL_LEN;
          const slot = s.hist[s.hHead];
          slot.x = pv.x + fdx * (1 - t);
          slot.y = pv.y + fdy * (1 - t);
          if (s.hLen < MAX_TAIL_LEN) s.hLen++;
        }
      }
      s.hHead = (s.hHead - 1 + MAX_TAIL_LEN) % MAX_TAIL_LEN;
      s.hist[s.hHead].x = sm.x;
      s.hist[s.hHead].y = sm.y;
      if (s.hLen < MAX_TAIL_LEN) s.hLen++;

      const isIdle = Date.now() - s.lastMove > IDLE_MS;
      s.idle = isIdle
        ? Math.max(0, s.idle - DISSIPATE)
        : Math.min(1, s.idle + RESTORE);
      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx1.clearRect(0, 0, W, H);
      ctx2.clearRect(0, 0, W, H);
      if (s.idle <= 0 && isIdle) {
        s.hLen = 0;
        s.hHead = 0;
        s.animating = false;
        return;
      }

      const activeRadius = RADIUS * s.idle;
      const activeRadiusSq = activeRadius * activeRadius;
      for (let i = 0; i <= ALPHA_LEVELS; i++) s.batches[i].length = 0;
      s.cands.length = 0;

      const {
        hist: buf,
        hHead: head,
        hLen: len,
        rows,
        buckets: bkts,
        segs,
        frame: fr,
      } = s;
      for (let i = 0; i < len; i++) {
        const seg = segs[i];
        if (ALPHA_DECAY[i] < SEGMENT_ALPHA_CULL) {
          seg.lenSq = -1;
          continue;
        }
        const h0 = buf[(head + i) % MAX_TAIL_LEN];
        seg.h0x = h0.x;
        seg.h0y = h0.y;
        let minX = h0.x;
        let maxX = h0.x;
        let minY = h0.y;
        let maxY = h0.y;
        if (i + 1 < len && ALPHA_DECAY[i + 1] >= SEGMENT_ALPHA_CULL) {
          const h1 = buf[(head + i + 1) % MAX_TAIL_LEN];
          const sdx = h1.x - h0.x;
          const sdy = h1.y - h0.y;
          const lenSq = sdx * sdx + sdy * sdy;
          seg.sdx = sdx;
          seg.sdy = sdy;
          seg.lenSq = lenSq;
          seg.invLenSq = lenSq > 0 ? 1 / lenSq : 0;
          if (h1.x < minX) minX = h1.x;
          else if (h1.x > maxX) maxX = h1.x;
          if (h1.y < minY) minY = h1.y;
          else if (h1.y > maxY) maxY = h1.y;
        } else {
          seg.lenSq = 0;
        }
        const iMinX = minX - activeRadius;
        const iMaxX = maxX + activeRadius;
        const iMinY = minY - activeRadius;
        const iMaxY = maxY + activeRadius;
        if (iMaxX < 0 || iMinX > W || iMaxY < 0 || iMinY > H) {
          seg.lenSq = -1;
          continue;
        }
        seg.minBX = Math.max(0, Math.floor(iMinX / RADIUS));
        seg.maxBX = Math.min(s.cols - 1, Math.floor(iMaxX / RADIUS));
        seg.minBY = Math.max(0, Math.floor(iMinY / RADIUS));
        seg.maxBY = Math.min(rows - 1, Math.floor(iMaxY / RADIUS));
      }

      for (let i = 0; i < len; i++) {
        const seg = segs[i];
        if (seg.lenSq === -1) continue;
        for (let bx = seg.minBX; bx <= seg.maxBX; bx++) {
          const off = bx * rows;
          for (let by = seg.minBY; by <= seg.maxBY; by++) {
            const bucket = bkts[off + by];
            for (let j = 0; j < bucket.length; j++) {
              const dot = bucket[j];
              if (dot.frame !== fr) {
                dot.frame = fr;
                dot.maxA = 0;
                dot.maxS = 0;
                dot.headS = 0;
                s.cands.push(dot);
              }
              let cx = seg.h0x;
              let cy = seg.h0y;
              if (i + 1 < len && seg.lenSq > 0) {
                let t =
                  ((dot.x - seg.h0x) * seg.sdx + (dot.y - seg.h0y) * seg.sdy) *
                  seg.invLenSq;
                if (t < 0) t = 0;
                else if (t > 1) t = 1;
                cx = seg.h0x + t * seg.sdx;
                cy = seg.h0y + t * seg.sdy;
              }
              const ddx = dot.x - cx;
              const ddy = dot.y - cy;
              const dSq = ddx * ddx + ddy * ddy;
              if (dSq >= activeRadiusSq) continue;
              const sp = 1 - Math.sqrt(dSq) / activeRadius;
              const ai = sp * ALPHA_DECAY[i];
              const si = sp * ALPHA_DECAY[i];
              if (ai > dot.maxA) dot.maxA = ai;
              if (si > dot.maxS) dot.maxS = si;
              if (i === 0 && si > dot.headS) dot.headS = si;
            }
          }
        }
      }

      for (let i = 0; i < s.cands.length; i++) {
        const dot = s.cands[i];
        if (
          dot.maxA < 0.01 ||
          isInsideExcludeRegion(dot.x, dot.y, excludeRegions)
        )
          continue;
        const boostedA = Math.pow(
          dot.maxA * (0.25 + 0.75 * Math.pow(dot.maxS, 0.5)),
          1.2,
        );
        const alphaIndex = Math.min(
          ALPHA_LEVELS,
          Math.round((0.05 + 0.95 * boostedA) * ALPHA_LEVELS),
        );
        s.batches[alphaIndex].push(
          alloc(
            SQUARE_HALF,
            dot,
            isInsideInvertRegion(dot.x, dot.y, invertRegions),
          ),
        );
      }

      for (let i = 0; i <= ALPHA_LEVELS; i++) {
        const batch = s.batches[i];
        if (!batch.length) continue;
        const alpha = i / ALPHA_LEVELS;
        ctx1.globalAlpha = alpha;
        ctx2.globalAlpha = alpha;
        ctx1.fillStyle = colorRef.current;
        ctx2.fillStyle = invertedColorRef.current;
        ctx1.beginPath();
        ctx2.beginPath();
        for (let j = 0; j < batch.length; j++) {
          const { dot, invert } = batch[j];
          const d = dot!;
          (invert ? ctx2 : ctx1).rect(
            d.x - SQUARE_HALF,
            d.y - SQUARE_HALF,
            SPACING,
            SPACING,
          );
        }
        ctx1.fill();
        ctx2.fill();
      }

      ctx1.globalAlpha = 1;
      ctx2.globalAlpha = 1;
      s.rafId = requestAnimationFrame(animate);
    };

    const setMouse = (x: number, y: number) => {
      s.mouse.x = x;
      s.mouse.y = y;
      s.lastMove = Date.now();
      if (!s.animating) {
        s.animating = true;
        s.rafId = requestAnimationFrame(animate);
      }
    };

    const onPtr = (e: PointerEvent) => setMouse(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) setMouse(t.clientX, t.clientY);
    };

    resize();
    if (!ignorePointer) {
      window.addEventListener("pointermove", onPtr);
      window.addEventListener("touchmove", onTouch, { passive: true });
    }
    window.addEventListener("resize", resize);

    let idleKickTimer = -1;
    if (idleHandles) {
      const idleKick = () => {
        if (idleHandles.getIdlePos() && !s.animating) {
          s.animating = true;
          s.rafId = requestAnimationFrame(animate);
        }
        idleKickTimer = requestAnimationFrame(idleKick);
      };
      idleKickTimer = requestAnimationFrame(idleKick);
    }

    return () => {
      cancelAnimationFrame(s.rafId);
      if (idleKickTimer !== -1) cancelAnimationFrame(idleKickTimer);
      if (!ignorePointer) {
        window.removeEventListener("pointermove", onPtr);
        window.removeEventListener("touchmove", onTouch);
      }
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", markRegionsDirty);
      window.removeEventListener("resize", markRegionsDirty);
      mutObs.disconnect();
      s.animating = false;
    };
  }, [cvs1, cvs2, idleHandles, ignorePointer]);
}
