"use client";

import { useEffect, useRef, useState } from "react";
import lottie, { AnimationItem } from "lottie-web";
import logoAnimData from "./jm-logo-animation.json";
import logoAnimReverseData from "./jm-logo-animation-reverse.json";

interface JMLogoProps {
  className?: string;
  width?: number | string;
  height?: number | string;
}

export default function JMLogo({ className = "", width, height }: JMLogoProps) {
  const [isMounted, setIsMounted] = useState(false);
  const containerForwardRef = useRef<HTMLDivElement>(null);
  const containerReverseRef = useRef<HTMLDivElement>(null);

  const animForward = useRef<AnimationItem | null>(null);
  const animReverse = useRef<AnimationItem | null>(null);

  const [activeAnim, setActiveAnim] = useState<"forward" | "reverse">(
    "forward",
  );
  const isHovering = useRef(false);
  const isPlaying = useRef(false);
  const hasTriggeredThisHover = useRef(false);
  const needsReplay = useRef(false);
  const rafId = useRef<number | null>(null);

  // Mark mounted on client-side
  useEffect(() => {
    setIsMounted(true);
    return () => {
      // Cleanup on unmount
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      if (animForward.current) {
        animForward.current.destroy();
      }
      if (animReverse.current) {
        animReverse.current.destroy();
      }
    };
  }, []);

  // Custom easing function: power3out
  const power3out = (t: number) => 1 - Math.pow(1 - t, 1.25);

  // Play animation using custom ease
  const playWithEase = (
    anim: AnimationItem,
    duration: number,
    onComplete: () => void,
  ) => {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
    }
    const start = performance.now();
    const totalFrames = anim.totalFrames;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = power3out(t);
      anim.goToAndStop(eased * totalFrames, true);

      if (t < 1) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        rafId.current = null;
        onComplete();
      }
    };

    // Run first frame immediately to avoid 1-frame startup lag
    tick(start);
  };

  // Speed up duration to 1.5x (800ms / 1.5)
  const DURATION = 800 / 1.5;

  const runForwardAnim = (onDone: () => void) => {
    setActiveAnim("forward");
    if (animForward.current) {
      animForward.current.goToAndStop(0, true);
      isPlaying.current = true;
      playWithEase(animForward.current, DURATION, () => {
        isPlaying.current = false;
        onDone();
      });
    } else {
      onDone();
    }
  };

  const runReverseAnim = (onDone: () => void) => {
    setActiveAnim("reverse");
    if (animReverse.current) {
      animReverse.current.goToAndStop(0, true);
      isPlaying.current = true;
      playWithEase(animReverse.current, DURATION, () => {
        isPlaying.current = false;
        onDone();
      });
    } else {
      onDone();
    }
  };

  const startHoverCycle = () => {
    if (isPlaying.current) return;

    runReverseAnim(() => {
      runForwardAnim(() => {
        if (needsReplay.current) {
          needsReplay.current = false;
          startHoverCycle();
        }
      });
    });
  };

  // Initialize animations once mounted on client side
  useEffect(() => {
    if (!isMounted) return;

    if (containerForwardRef.current && containerReverseRef.current) {
      animForward.current = lottie.loadAnimation({
        container: containerForwardRef.current,
        renderer: "svg",
        loop: false,
        autoplay: false,
        animationData: logoAnimData,
      });

      animReverse.current = lottie.loadAnimation({
        container: containerReverseRef.current,
        renderer: "svg",
        loop: false,
        autoplay: false,
        animationData: logoAnimReverseData,
      });

      // Play initial forward animation on page load
      const onDomLoaded = () => {
        runForwardAnim(() => {
          // Check if user hovered during the initial loading animation
          if (needsReplay.current) {
            needsReplay.current = false;
            startHoverCycle();
          }
        });
      };

      animForward.current.addEventListener("DOMLoaded", onDomLoaded);

      return () => {
        if (animForward.current) {
          animForward.current.removeEventListener("DOMLoaded", onDomLoaded);
        }
      };
    }
  }, [isMounted]);

  const handleMouseEnter = () => {
    isHovering.current = true;
    if (!hasTriggeredThisHover.current) {
      hasTriggeredThisHover.current = true;
      if (isPlaying.current) {
        needsReplay.current = true;
      } else {
        startHoverCycle();
      }
    }
  };

  const handleMouseLeave = () => {
    isHovering.current = false;
    hasTriggeredThisHover.current = false;
  };

  // Static SVG fallback for SSR & initial hydration
  const fallbackSvg = (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 128 128"
      fill="#FAFAFA"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M81.4547 126.545C81.4547 127.348 80.8035 128 80 128H7.2728C3.256 128 0 124.743 0 120.727V82.9092C0 82.1057 0.651199 81.4545 1.45467 81.4545H33.4547C34.2579 81.4545 34.9091 82.1057 34.9091 82.9092V91.6363C34.9091 92.4393 35.5603 93.0909 36.3637 93.0909H45.0909C45.8941 93.0909 46.5453 92.4393 46.5453 91.6363V58.1818C46.5453 57.3786 47.1965 56.7272 48 56.7272H80C80.8035 56.7272 81.4547 57.3786 81.4547 58.1818V126.545ZM64 11.6364C67.5659 4.5048 74.8547 0 82.828 0H120.727C124.744 0 128 3.25605 128 7.27279V120.727C128 124.743 124.744 128 120.727 128H94.5453C93.7421 128 93.0909 127.348 93.0909 126.545V36.3637C93.0909 35.5602 92.4397 34.9091 91.6363 34.9091H82.9091C82.1059 34.9091 81.4547 35.5602 81.4547 36.3637V43.6362C81.4547 44.4397 80.8035 45.0908 80 45.0908H48C47.1965 45.0908 46.5453 44.4397 46.5453 43.6362V36.3637C46.5453 35.5602 45.8941 34.9091 45.0909 34.9091H36.3637C35.5603 34.9091 34.9091 35.5602 34.9091 36.3637V68.3636C34.9091 69.1671 34.2579 69.8182 33.4547 69.8182H1.45467C0.651199 69.8182 0 69.1671 0 68.3636L0 7.27279C0 3.25605 3.256 0 7.2728 0H45.172C53.1453 0 60.4341 4.5048 64 11.6364Z"
        fill="#FAFAFA"
      />
    </svg>
  );

  // If not mounted yet (SSR phase), render the fallback SVG to avoid layout shift
  if (!isMounted) {
    return (
      <div
        className={`w-6 h-6 flex items-center justify-center ${className}`}
        style={{ width, height }}
      >
        {fallbackSvg}
      </div>
    );
  }

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative select-none w-6 h-6 ${className}`}
      style={{ width, height }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .lottie-logo-container svg path {
          fill: #FAFAFA !important;
        }
      `,
        }}
      />
      <div
        ref={containerForwardRef}
        className={`lottie-logo-container absolute inset-0 w-full h-full ${
          activeAnim === "forward" ? "block z-10" : "hidden z-0"
        }`}
      />
      <div
        ref={containerReverseRef}
        className={`lottie-logo-container absolute inset-0 w-full h-full ${
          activeAnim === "reverse" ? "block z-10" : "hidden z-0"
        }`}
      />
    </div>
  );
}
