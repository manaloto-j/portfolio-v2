import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { NAV_KEYS } from "./constants";

interface UseInputHandlersOptions {
  targetMouse: MutableRefObject<{ x: number; y: number }>;
  wakeRenderRef: MutableRefObject<() => void>;
  invertX: boolean;
  invertY: boolean;
  isMobile: boolean;
  idleEnabled: boolean;
}

const IDLE_AMPLITUDE = 0.2;
const IDLE_PERIOD_MS = 2400;

/**
 * Registers mouse, keyboard, and blur event listeners that drive the parallax
 * target position. Inactive on mobile (where WebGL is not used).
 *
 * Calls `wakeRenderRef.current()` to restart the idle RAF loop whenever the
 * target position changes.
 */
export function useInputHandlers({
  targetMouse,
  wakeRenderRef,
  invertX,
  invertY,
  isMobile,
  idleEnabled,
}: UseInputHandlersOptions) {
  useEffect(() => {
    if (isMobile) return;

    const keysPressed = new Set<string>();
    let idleRaf = 0;
    let idleStartedAt = 0;
    let idleBaseX = 0;
    let idleBaseY = 0;

    const wakeRender = () => wakeRenderRef.current();

    const stopIdle = () => {
      if (idleRaf) {
        cancelAnimationFrame(idleRaf);
        idleRaf = 0;
      }
    };

    const runIdle = (timestamp: number) => {
      if (!idleStartedAt) idleStartedAt = timestamp;
      const progress = (timestamp - idleStartedAt) / IDLE_PERIOD_MS;
      targetMouse.current.x = idleBaseX;
      targetMouse.current.y =
        idleBaseY +
        (invertY ? -1 : 1) * Math.sin(progress * Math.PI * 2) * IDLE_AMPLITUDE;
      wakeRender();
      idleRaf = requestAnimationFrame(runIdle);
    };

    const scheduleIdle = () => {
      stopIdle();
      if (!idleEnabled || keysPressed.size > 0) return;

      idleStartedAt = 0;
      idleBaseX = targetMouse.current.x;
      idleBaseY = targetMouse.current.y;
      idleRaf = requestAnimationFrame(runIdle);
    };

    const reset = () => {
      stopIdle();
      keysPressed.clear();
      targetMouse.current.x = 0;
      targetMouse.current.y = 0;
      wakeRender();
      scheduleIdle();
    };

    const updateTargetFromKeys = () => {
      if (keysPressed.size === 0) return;

      let x = 0;
      let y = 0;
      if (keysPressed.has("arrowleft") || keysPressed.has("a")) x -= 0.5;
      if (keysPressed.has("arrowright") || keysPressed.has("d")) x += 0.5;
      if (keysPressed.has("arrowup") || keysPressed.has("w")) y -= 0.5;
      if (keysPressed.has("arrowdown") || keysPressed.has("s")) y += 0.5;

      targetMouse.current.x = (invertX ? -1 : 1) * x;
      targetMouse.current.y = (invertY ? -1 : 1) * y;
      wakeRender();
    };

    const onMouseMove = (event: MouseEvent) => {
      stopIdle();
      if (keysPressed.size > 0) return;
      targetMouse.current.x =
        (invertX ? -1 : 1) * (event.clientX / window.innerWidth - 0.5);
      targetMouse.current.y =
        (invertY ? -1 : 1) * (event.clientY / window.innerHeight - 0.5);
      wakeRender();
      scheduleIdle();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const isTyping =
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
      if (isTyping) return;

      const key = event.key.toLowerCase();
      if (NAV_KEYS.has(key)) {
        stopIdle();
        keysPressed.add(key);
        updateTargetFromKeys();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!NAV_KEYS.has(key)) return;

      keysPressed.delete(key);
      if (keysPressed.size === 0) {
        targetMouse.current.x = 0;
        targetMouse.current.y = 0;
        wakeRender();
        scheduleIdle();
      } else updateTargetFromKeys();
    };

    scheduleIdle();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("mouseleave", reset);
    window.addEventListener("blur", reset);

    return () => {
      stopIdle();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mouseleave", reset);
      window.removeEventListener("blur", reset);
    };
  }, [idleEnabled, invertX, invertY, isMobile, targetMouse, wakeRenderRef]);
}
