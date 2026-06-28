import { useEffect, useRef } from "react";
import type { Pos } from "./types";

// ─── Timing ──────────────────────────────────────────────────────────────────

/** Idle time before the screensaver kicks in */
const IDLE_TIMEOUT_MS = 4000;
/** Duration (ms) of a single dash stroke */
const DASH_DURATION_MS = 300;
/** Hold (ms) at the shared endpoint between consecutive dashes */
const HOLD_DURATION_MS = 0;

// ─── Path definition ─────────────────────────────────────────────────────────

const WAYPOINTS: [number, number][] = [
  [0, 0],  // P0 – top-left
  [1, 0.25],  // P1 – upper-right
  [0, 0.5],  // P2 – mid-left
  [1, 0.75],  // P3 – lower-right
  [-0.10, 1],  // P4 – bottom-left
];

const NUM_DASHES = WAYPOINTS.length - 1;

const TOTAL_DURATION_MS =
  NUM_DASHES * DASH_DURATION_MS +
  (NUM_DASHES - 1) * HOLD_DURATION_MS;

type Phase =
  | { kind: "dash";       dashIdx: number; t: number } // t ∈ [0, 1]
  | { kind: "hold";       dashIdx: number }             // inter-dash hold
  | { kind: "done" };

function resolvePhase(elapsed: number): Phase {
  if (elapsed >= TOTAL_DURATION_MS) return { kind: "done" };

  let rem = elapsed;
  for (let i = 0; i < NUM_DASHES; i++) {
    if (rem < DASH_DURATION_MS) {
      return { kind: "dash", dashIdx: i, t: rem / DASH_DURATION_MS };
    }
    rem -= DASH_DURATION_MS;

    if (i < NUM_DASHES - 1) {
      if (rem < HOLD_DURATION_MS) {
        return { kind: "hold", dashIdx: i };
      }
      rem -= HOLD_DURATION_MS;
    }
  }

  return { kind: "done" };
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface IdleAnimationHandles {
  idleActiveRef: React.MutableRefObject<boolean>;
  getIdlePos: () => Pos | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useIdleAnimation(): IdleAnimationHandles {
  const idleActiveRef       = useRef<boolean>(false);
  const idlePosRef          = useRef<Pos | null>(null);
  
  const startTimerRef = useRef<() => void>(() => {});

  const getIdlePos = (): Pos | null => idlePosRef.current;

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    const visibleIdleTargets = new Set<Element>();

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visibleIdleTargets.add(entry.target);
        } else {
          visibleIdleTargets.delete(entry.target);
        }
      }
    }, { threshold: 0.1 });

    const attachObservers = () => {
      document
        .querySelectorAll<Element>("[data-gridcursor-idle]")
        .forEach((el) => observer.observe(el));
    };

    attachObservers();
    const mutObs = new MutationObserver(attachObservers);
    mutObs.observe(document.body, { childList: true, subtree: true });

    const clearAnimation = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      idleActiveRef.current = false;
      idlePosRef.current = null;
    };

    const playIdle = () => {
      clearAnimation(); // just in case
      
      const targets = Array.from(visibleIdleTargets);
      if (targets.length === 0) return; // No idle target in view, do nothing

      const el = targets[0];
      const rect = el.getBoundingClientRect();
      const { left: l, top: t, width: w, height: h } = rect;

      // Convert fractional waypoints to element pixel positions.
      const pts = WAYPOINTS.map(([xf, yf]): Pos => ({
        x: l + xf * w,
        y: t + yf * h,
      }));

      idleActiveRef.current = true;
      idlePosRef.current    = { ...pts[0] };

      const startMs = performance.now();

      const tick = (now: number) => {
        const elapsed = now - startMs;
        const phase   = resolvePhase(elapsed);

        if (phase.kind === "done") {
          idlePosRef.current      = null;
          idleActiveRef.current   = false;
          rafId                   = null;
          
          // Re-trigger the timer immediately so it can loop after 3s of continued idle
          startTimerRef.current();
          
          return;
        }

        let pos: Pos;

        if (phase.kind === "dash") {
          const p0 = pts[phase.dashIdx];
          const p1 = pts[phase.dashIdx + 1];
          pos = {
            x: p0.x + (p1.x - p0.x) * phase.t,
            y: p0.y + (p1.y - p0.y) * phase.t,
          };
        } else {
          pos = { ...pts[phase.dashIdx + 1] };
        }

        idlePosRef.current = pos;
        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
    };

    startTimerRef.current = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer = null;
        playIdle();
      }, IDLE_TIMEOUT_MS);
    };

    const onPointerMove = () => startTimerRef.current();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("touchmove", onPointerMove, { passive: true });

    // Kick off initial timer
    startTimerRef.current();

    return () => {
      observer.disconnect();
      mutObs.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onPointerMove);
      if (idleTimer !== null) clearTimeout(idleTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return { idleActiveRef, getIdlePos };
}
