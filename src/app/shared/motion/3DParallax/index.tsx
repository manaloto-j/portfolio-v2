"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  MOBILE_BREAKPOINT,
  DEFAULT_STRENGTH_X,
  DEFAULT_STRENGTH_Y,
  DEFAULT_LERP_FACTOR,
  DEFAULT_PLANE_SCALE,
} from "./constants";
import { getImageSrc, getAspectRatio } from "./imageUtils";
import { useWebGLRenderer } from "./useWebGLRenderer";
import { useInputHandlers } from "./useInputHandlers";
import type { ThreeDParallaxProps } from "./types";
import styles from "./styles.module.css";
export type { ThreeDParallaxImage, ThreeDParallaxProps } from "./types";

export function ThreeDParallax({
  image: { color, depth, alpha },
  strengthX = DEFAULT_STRENGTH_X,
  strengthY = DEFAULT_STRENGTH_Y,
  lerpFactor = DEFAULT_LERP_FACTOR,
  planeScale = DEFAULT_PLANE_SCALE,
  invertX = false,
  invertY = true,
  style,
  className,
  ...props
}: ThreeDParallaxProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const targetMouse = useRef({ x: 0, y: 0 });

  // Detect mobile/tablet: treat anything below 1024px as a non-WebGL device.
  // Default to true (mobile-first) so the WebGL effect never flashes before
  // the media query resolves on first render.
  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    setIsMobile(!mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const { webglFailed, wakeRenderRef } = useWebGLRenderer(
    mountRef,
    { color, depth, alpha },
    targetMouse,
    { strengthX, strengthY, lerpFactor, planeScale, isMobile },
  );

  useInputHandlers({ targetMouse, wakeRenderRef, invertX, invertY, isMobile });

  // Only pass the aspect ratio as a CSS custom property — NOT as a
  // presentational inline style — so Tailwind / CSS classes can freely
  // override `display` and `aspect-ratio` without needing `!important`.
  const parallaxStyle: CSSProperties = {
    ["--parallax-aspect" as string]: getAspectRatio(color),
    ...style,
  };

  return (
    <div
      ref={mountRef}
      style={parallaxStyle}
      className={[styles.threeDParallax, className].filter(Boolean).join(" ")}
      {...props}
    >
      {(isMobile || webglFailed) && (
        // Fallback image shown on mobile/tablet (no WebGL needed) or when the
        // desktop browser cannot initialise a WebGL context. Only the colour
        // image is fetched; depth and alpha maps are never downloaded.
        <img
          src={getImageSrc(color)}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover"
        />
      )}
    </div>
  );
}

export default ThreeDParallax;
