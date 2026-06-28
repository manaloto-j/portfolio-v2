"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";

const CONFIG = [
  // Default Values
  { sel: "[data-parallax-hover]", sx: -0.025, sy: 0.025, lerp: 1 },
];

const KEY_MAP: Record<string, string> = {
  keyw: "keyw",
  arrowup: "keyw",
  w: "keyw",
  keys: "keys",
  arrowdown: "keys",
  s: "keys",
  keya: "keya",
  arrowleft: "keya",
  a: "keya",
  keyd: "keyd",
  arrowright: "keyd",
  d: "keyd",
};

const IDLE_PERIOD_MS = 2400;
const IDLE_STRENGTH = 0.15;
const DESKTOP_QUERY = "(min-width: 1024px)";

const getIsMobileSnapshot = () =>
  typeof window === "undefined" || !window.matchMedia(DESKTOP_QUERY).matches;

const subscribeToDesktopQuery = (onStoreChange: () => void) => {
  if (typeof window === "undefined") return () => {};

  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
};

export default function HoverParallax({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isMobile = useSyncExternalStore(
    subscribeToDesktopQuery,
    getIsMobileSnapshot,
    () => true,
  );

  useLayoutEffect(() => {
    if (isMobile || !window.matchMedia("(hover: hover)").matches) return;

    let isDisabledGlobally = false;
    let lastPointer: { x: number; y: number } | null = null;
    let idleRaf = 0;
    let idleStartedAt = 0;

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

    const allSelectors =
      CONFIG.map((c) => c.sel).join(", ") +
      ", [data-parallax-hover-x], [data-parallax-hover-y], [data-parallax-hover], [data-parallax-hover-idle], [data-parallax-hover-lerp]";
    const elements = Array.from(
      new Set(gsap.utils.toArray<HTMLElement>(allSelectors)),
    );

    const targets = elements.map((el) => {
      if (el.parentElement) el.parentElement.style.overflow = "hidden";

      // Default to medium strength
      let sx = -0.025;
      let sy = 0.025;
      let lerp = 1;

      // Check presets
      for (const config of CONFIG) {
        if (el.matches(config.sel)) {
          sx = config.sx;
          sy = config.sy;
          if (config.lerp !== undefined) lerp = config.lerp;
          break;
        }
      }

      // Check for explicit custom values
      if (el.hasAttribute("data-parallax-hover-x")) {
        const val = parseFloat(el.getAttribute("data-parallax-hover-x") || "");
        if (!isNaN(val)) sx = val;
      }
      if (el.hasAttribute("data-parallax-hover-y")) {
        const val = parseFloat(el.getAttribute("data-parallax-hover-y") || "");
        if (!isNaN(val)) sy = val;
      }
      if (el.hasAttribute("data-parallax-hover-lerp")) {
        const val = parseFloat(
          el.getAttribute("data-parallax-hover-lerp") || "",
        );
        if (!isNaN(val)) lerp = val;
      }

      return {
        el,
        trigger: (el.closest("section") ?? el) as HTMLElement,
        xTo: gsap.quickTo(el, "x", { duration: lerp, ease: "power3.out" }),
        yTo: gsap.quickTo(el, "y", { duration: lerp, ease: "power3.out" }),
        sx,
        sy,
        idleEnabled:
          el.hasAttribute("data-parallax-hover-idle") &&
          el.getAttribute("data-parallax-hover-idle") !== "false",
        pressedKeys: new Set<string>(),
        elWidth: 0,
        elHeight: 0,
        currentNx: 0,
        currentNy: 0,
      };
    });

    const updateRects = () => {
      targets.forEach((t) => {
        t.elWidth = t.el.offsetWidth;
        t.elHeight = t.el.offsetHeight;
      });
    };

    // Initial calculation
    updateRects();

    const applyDisplacement = (
      t: (typeof targets)[0],
      nx: number,
      ny: number,
    ) => {
      if (isDisabledGlobally || t.el.dataset.parallaxDisabled === "true") {
        t.xTo(0);
        t.yTo(0);
        return;
      }
      const mx = t.sx * t.elWidth;
      const my = t.sy * t.elHeight;

      t.xTo(nx * mx);
      t.yTo(ny * my);
    };

    const setTargetDisplacement = (
      t: (typeof targets)[0],
      nx: number,
      ny: number,
    ) => {
      t.currentNx = nx;
      t.currentNy = ny;
      applyDisplacement(t, nx, ny);
    };

    const stopIdle = () => {
      if (idleRaf) {
        cancelAnimationFrame(idleRaf);
        idleRaf = 0;
      }
    };

    const runIdle = (timestamp: number) => {
      if (!idleStartedAt) idleStartedAt = timestamp;

      const ny = Math.sin(
        ((timestamp - idleStartedAt) / IDLE_PERIOD_MS) * Math.PI * 2,
      );

      targets.forEach((t) => {
        if (!t.idleEnabled || t.pressedKeys.size > 0) return;
        applyDisplacement(t, t.currentNx, t.currentNy + ny * IDLE_STRENGTH);
      });

      idleRaf = requestAnimationFrame(runIdle);
    };

    const scheduleIdle = () => {
      stopIdle();
      if (!targets.some((t) => t.idleEnabled) || isDisabledGlobally) return;
      if (targets.some((t) => t.pressedKeys.size > 0)) return;

      idleStartedAt = 0;
      idleRaf = requestAnimationFrame(runIdle);
    };

    const updateTargetFromPointer = (
      t: (typeof targets)[0],
      cx: number,
      cy: number,
    ) => {
      if (t.pressedKeys.size > 0) return;

      setTargetDisplacement(
        t,
        (cx - window.innerWidth / 2) / (window.innerWidth / 2),
        (cy - window.innerHeight / 2) / (window.innerHeight / 2),
      );
    };

    const updateTargetFromKeys = (t: (typeof targets)[0]) => {
      if (t.pressedKeys.size === 0) {
        if (lastPointer)
          updateTargetFromPointer(t, lastPointer.x, lastPointer.y);
        else setTargetDisplacement(t, 0, 0);
        return;
      }

      let nx = 0,
        ny = 0;

      if (t.pressedKeys.has("keya") && !t.pressedKeys.has("keyd")) {
        nx = -1;
      } else if (t.pressedKeys.has("keyd") && !t.pressedKeys.has("keya")) {
        nx = 1;
      }

      if (t.pressedKeys.has("keyw") && !t.pressedKeys.has("keys")) {
        ny = -1;
      } else if (t.pressedKeys.has("keys") && !t.pressedKeys.has("keyw")) {
        ny = 1;
      }

      setTargetDisplacement(t, nx, ny);
    };

    const onMouseMove = (e: MouseEvent) => {
      stopIdle();
      lastPointer = { x: e.clientX, y: e.clientY };
      targets.forEach((t) => updateTargetFromPointer(t, e.clientX, e.clientY));
      scheduleIdle();
    };

    const onResize = () => {
      updateRects();
      if (lastPointer)
        targets.forEach((t) =>
          updateTargetFromPointer(t, lastPointer!.x, lastPointer!.y),
        );
    };

    const resetAll = () => {
      stopIdle();
      lastPointer = null;
      targets.forEach((t) => {
        t.pressedKeys.clear();
        setTargetDisplacement(t, 0, 0);
      });
      scheduleIdle();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "KeyX" &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !isTypingTarget(e.target)
      ) {
        isDisabledGlobally = true;
        resetAll();
        return;
      }
      if (isDisabledGlobally || isTypingTarget(e.target)) return;

      const mapped =
        KEY_MAP[e.code.toLowerCase()] || KEY_MAP[e.key.toLowerCase()];
      if (mapped) {
        stopIdle();
        targets.forEach((t) => {
          t.pressedKeys.add(mapped);
          updateTargetFromKeys(t);
        });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "KeyX") {
        isDisabledGlobally = false;
        return;
      }
      const mapped =
        KEY_MAP[e.code.toLowerCase()] || KEY_MAP[e.key.toLowerCase()];
      if (mapped) {
        targets.forEach((t) => {
          t.pressedKeys.delete(mapped);
          updateTargetFromKeys(t);
        });
        scheduleIdle();
      }
    };

    const onBlur = () => {
      isDisabledGlobally = false;
      scheduleIdle();
    };

    scheduleIdle();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("resize", onResize);
    document.addEventListener("mouseleave", resetAll);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      stopIdle();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mouseleave", resetAll);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      targets.forEach((t) => gsap.set(t.el, { x: 0, y: 0 }));
    };
  }, [pathname, isMobile]);

  return children;
}
