"use client";
import { useRef } from "react";
import { invertHex } from "./invertRegions";
import { useGridAnimation } from "./useGridAnimation";
import { useIdleAnimation, type IdleAnimationHandles } from "./useIdleAnimation";

function DotGridLayer({
  color,
  idleHandles,
  ignorePointer
}: {
  color: string;
  idleHandles?: IdleAnimationHandles;
  ignorePointer?: boolean;
}) {
  const cvs1 = useRef<HTMLCanvasElement>(null);
  const cvs2 = useRef<HTMLCanvasElement>(null);

  useGridAnimation(cvs1, cvs2, color, invertHex(color), idleHandles, ignorePointer);

  return (
    <>
      {/* canvas1: normal dots rendered in `color` */}
      <canvas
        ref={cvs1}
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
      {/*
        canvas2: inverted/coloured dots drawn only where a dot's position
        overlaps a visible pixel of a [data-hover-invert] element.
        No CSS clip-path needed — per-dot pixel sampling handles the masking.
      */}
      <canvas
        ref={cvs2}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 999999,
          width: "100%",
          height: "100%",
        }}
      />
    </>
  );
}

/**
 * DotGridCursor
 *
 * Renders a reactive dot-grid cursor effect across the full viewport.
 * Now mounts two separate instances: one for normal mouse tracking, 
 * and one isolated layer specifically for the idle screensaver animation.
 *
 * @param color - Base dot colour (default: white). The inverted colour is
 *                derived automatically.
 */
export default function DotGridCursor({
  color = "#FFFFFF",
}: { color?: string } = {}) {
  const idleHandles = useIdleAnimation();

  return (
    <>
      {/* Normal cursor layer: tracks physical mouse, no idle hijacking */}
      <DotGridLayer color={color} />
      
      {/* Idle screensaver layer: ignores mouse, driven entirely by idle timer */}
      <DotGridLayer color={color} idleHandles={idleHandles} ignorePointer={true} />
    </>
  );
}
