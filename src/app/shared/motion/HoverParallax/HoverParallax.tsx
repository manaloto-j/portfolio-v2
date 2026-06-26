"use client";

import { useLayoutEffect, useState } from "react";
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

export default function HoverParallax({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const [isMobile, setIsMobile] = useState(true);

  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsMobile(!mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useLayoutEffect(() => {
    if (isMobile || !window.matchMedia("(hover: hover)").matches) return;

    let isDisabledGlobally = false;
    let lastPointer: { x: number; y: number } | null = null;

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

    const allSelectors =
      CONFIG.map((c) => c.sel).join(", ") +
      ", [data-parallax-hover-x], [data-parallax-hover-y], [data-parallax-hover], [data-parallax-hover-lerp]";
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
        const val = parseFloat(el.getAttribute("data-parallax-hover-lerp") || "");
        if (!isNaN(val)) lerp = val;
      }

      return {
        el,
        trigger: (el.closest("section") ?? el) as HTMLElement,
        xTo: gsap.quickTo(el, "x", { duration: lerp, ease: "power3.out" }),
        yTo: gsap.quickTo(el, "y", { duration: lerp, ease: "power3.out" }),
        sx,
        sy,
        pressedKeys: new Set<string>(),
        elWidth: 0,
        elHeight: 0,
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
      let mx = t.sx * t.elWidth;
      let my = t.sy * t.elHeight;

      t.xTo(nx * mx);
      t.yTo(ny * my);
    };

    const updateTargetFromPointer = (
      t: (typeof targets)[0],
      cx: number,
      cy: number,
    ) => {
      if (t.pressedKeys.size > 0) return;
      
      applyDisplacement(
        t,
        (cx - window.innerWidth / 2) / (window.innerWidth / 2),
        (cy - window.innerHeight / 2) / (window.innerHeight / 2),
      );
    };

    const updateTargetFromKeys = (t: (typeof targets)[0]) => {
      if (t.pressedKeys.size === 0) {
        if (lastPointer)
          updateTargetFromPointer(t, lastPointer.x, lastPointer.y);
        else applyDisplacement(t, 0, 0);
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

      applyDisplacement(t, nx, ny);
    };

    const onMouseMove = (e: MouseEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      targets.forEach((t) => updateTargetFromPointer(t, e.clientX, e.clientY));
    };

    const onResize = () => {
      updateRects();
      if (lastPointer)
        targets.forEach((t) =>
          updateTargetFromPointer(t, lastPointer!.x, lastPointer!.y),
        );
    };

    const resetAll = () => {
      lastPointer = null;
      targets.forEach((t) => {
        t.pressedKeys.clear();
        applyDisplacement(t, 0, 0);
      });
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
      }
    };

    const onBlur = () => {
      isDisabledGlobally = false;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("resize", onResize);
    document.addEventListener("mouseleave", resetAll);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
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
