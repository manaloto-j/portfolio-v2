"use client";

/**
 * useIdleAnimation
 * ================================================================
 * A "screensaver" for HalftoneTrail (or anything else that reacts to real
 * mouse movement). When the user is inactive — no mouse or touch movement
 * for IDLE_TIMEOUT_MS — this hook scripts a virtual cursor along a fixed
 * dash path across a target element, and dispatches genuine `pointermove`
 * events on `window` at each animation frame. It then loops: once the
 * dash sequence finishes, it waits out another IDLE_TIMEOUT_MS and plays
 * again, for as long as the page stays idle.
 *
 * Because HalftoneTrail already listens for `pointermove` on `window`, it
 * animates automatically — no changes to halftone-trail.tsx are required.
 *
 * USAGE
 * -----
 * 1. Mark the element you want the idle path traced across with a
 *    `data-halftone-idle` attribute. This is usually the same container
 *    HalftoneTrail is absolutely-positioned inside of:
 *
 *      <div data-halftone-idle style={{ position: "relative", height: "60vh" }}>
 *        <HalftoneTrail />
 *      </div>
 *
 * 2. Mount the hook once, anywhere in your component tree — it renders
 *    nothing and only dispatches events as a side effect:
 *
 *      function App() {
 *        useIdleAnimation();
 *        return <YourPage />;
 *      }
 *
 * That's the whole integration. Move your mouse, wait ~4 seconds, and
 * watch the trail trace the path on its own.
 *
 * NOTES
 * -----
 * - If several elements have `data-halftone-idle`, only the first one
 *   currently visible in the viewport (per IntersectionObserver) is used.
 *   New matching elements added to the DOM later are picked up too.
 * - HalftoneTrail's own `idleTimeout` prop (default 500ms) is a separate,
 *   shorter timer that fades the trail out from plain inactivity. If
 *   IDLE_TIMEOUT_MS below is longer than that (it is, by default), the
 *   trail will fade out first and then fade back in once the screensaver
 *   starts moving it — this reads as an intentional "waking up" beat, not
 *   a bug.
 * - `idleActiveRef` / `getIdlePos()` are exposed only if you want to know
 *   whether the screensaver is currently playing (e.g. to hide a "move
 *   your mouse" hint elsewhere on the page). You don't need either one
 *   just to make the trail animate.
 * - To point this at a completely different visual effect instead of
 *   HalftoneTrail, anything that listens for window `pointermove` will
 *   work unmodified, since real events are dispatched, not a private API.
 * ================================================================
 */

import { useEffect, useRef } from "react";

export interface Pos {
  x: number;
  y: number;
}

// ─── Timing ──────────────────────────────────────────────────────────────────

/** Idle time (ms) before the screensaver kicks in. */
const IDLE_TIMEOUT_MS = 2500;
/** Duration (ms) of a single dash stroke. */
const DASH_DURATION_MS = 300;
/** Hold (ms) at the shared endpoint between consecutive dashes. */
const HOLD_DURATION_MS = 0;

/** CSS attribute selector marking valid idle-path target elements. */
const IDLE_TARGET_SELECTOR = "[data-halftone-idle]";

// ─── Path definition ─────────────────────────────────────────────────────────
// Fractional [x, y] waypoints (0–1) relative to the target element's box.

const WAYPOINTS: [number, number][] = [
  [-0.2, 0], // P0 – top-left
  [1.2, 0.25], // P1 – upper-right
  [0, 0.5], // P2 – mid-left
  [1.2, 0.75], // P3 – lower-right
  [-0.2, 1], // P4 – bottom-left
];

function usesViewportFrame(el: Element) {
  for (
    let current: Element | null = el;
    current instanceof HTMLElement;
    current = current.parentElement
  ) {
    const { overflowX, overflowY } = getComputedStyle(current);
    if (
      overflowX === "hidden" ||
      overflowX === "clip" ||
      overflowY === "hidden" ||
      overflowY === "clip"
    ) {
      return true;
    }
  }

  return false;
}

const NUM_DASHES = WAYPOINTS.length - 1;

const TOTAL_DURATION_MS =
  NUM_DASHES * DASH_DURATION_MS + (NUM_DASHES - 1) * HOLD_DURATION_MS;

type Phase =
  | { kind: "dash"; dashIdx: number; t: number } // t ∈ [0, 1]
  | { kind: "hold"; dashIdx: number } // inter-dash hold
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

// Marks events this hook dispatches itself, so its own idle timer isn't
// reset by its own synthetic movement (only genuine user input should
// postpone the next screensaver playback).
const SYNTHETIC_FLAG = "__halftoneIdleSynthetic";

function dispatchSyntheticPointerMove(pos: Pos) {
  const EventCtor: typeof PointerEvent | typeof MouseEvent =
    typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  const evt = new EventCtor("pointermove", {
    clientX: pos.x,
    clientY: pos.y,
    bubbles: true,
    cancelable: true,
  });
  (evt as unknown as Record<string, boolean>)[SYNTHETIC_FLAG] = true;
  window.dispatchEvent(evt);
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface IdleAnimationHandles {
  idleActiveRef: React.MutableRefObject<boolean>;
  getIdlePos: () => Pos | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useIdleAnimation(): IdleAnimationHandles {
  const idleActiveRef = useRef<boolean>(false);
  const idlePosRef = useRef<Pos | null>(null);

  const startTimerRef = useRef<() => void>(() => {});

  const getIdlePos = (): Pos | null => idlePosRef.current;

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    const visibleIdleTargets = new Set<Element>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleIdleTargets.add(entry.target);
          } else {
            visibleIdleTargets.delete(entry.target);
          }
        }
      },
      { threshold: 0.1 },
    );

    const attachObservers = () => {
      document
        .querySelectorAll<Element>(IDLE_TARGET_SELECTOR)
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
      const rect = usesViewportFrame(el)
        ? {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight,
          }
        : el.getBoundingClientRect();
      const { left: l, top: t, width: w, height: h } = rect;

      // Convert fractional waypoints to element pixel positions.
      const pts = WAYPOINTS.map(
        ([xf, yf]): Pos => ({
          x: l + xf * w,
          y: t + yf * h,
        }),
      );

      idleActiveRef.current = true;
      idlePosRef.current = { ...pts[0] };
      dispatchSyntheticPointerMove(pts[0]);

      const startMs = performance.now();

      const tick = (now: number) => {
        const elapsed = now - startMs;
        const phase = resolvePhase(elapsed);

        if (phase.kind === "done") {
          idlePosRef.current = null;
          idleActiveRef.current = false;
          rafId = null;

          // Re-trigger the timer immediately so it can loop after
          // IDLE_TIMEOUT_MS of continued idle.
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
        dispatchSyntheticPointerMove(pos);
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

    const onPointerMove = (e: Event) => {
      // Ignore movement we generated ourselves — only real input should
      // postpone the next screensaver playback.
      if ((e as unknown as Record<string, boolean>)[SYNTHETIC_FLAG]) return;
      startTimerRef.current();
    };
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
