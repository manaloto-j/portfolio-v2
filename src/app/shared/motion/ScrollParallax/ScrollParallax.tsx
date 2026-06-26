"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

type ScrollParallaxProviderProps = {
  children: React.ReactNode;
};

type ScrollParallaxConfig = {
  selector: string;
  strength: number;
};

const SCROLL_PARALLAX_CONFIG = [
  // Default Values
  { selector: "[data-parallax-scroll]", strength: 0.1 },
];

export default function ScrollParallaxProvider({
  children,
}: ScrollParallaxProviderProps) {
  const pathname = usePathname();

  useLayoutEffect(() => {
    // Removed the check for contentVisible

    const parallaxContext = gsap.context(() => {
      const allSelectors = SCROLL_PARALLAX_CONFIG.map(c => c.selector).join(", ") + 
        ", [data-parallax-scroll-strength]";
      const elements = Array.from(new Set(gsap.utils.toArray<HTMLElement>(allSelectors)));

      elements.forEach((el) => {
        // Default to medium strength
        let strength = 0.1;

        // Check presets
        for (const config of SCROLL_PARALLAX_CONFIG) {
          if (el.matches(config.selector)) {
            strength = config.strength;
            break;
          }
        }

        // Check for explicit custom value
        if (el.hasAttribute("data-parallax-scroll-strength")) {
          const val = parseFloat(el.getAttribute("data-parallax-scroll-strength") || "");
          if (!isNaN(val)) strength = val;
        }

        gsap.fromTo(
          el,
          { y: () => window.innerHeight * -strength },
          {
            y: () => window.innerHeight * strength,
            ease: "none",
            scrollTrigger: {
              trigger: el.closest("section") ?? el,
              start: "top bottom",
              end: "bottom top",
              scrub: true,
              invalidateOnRefresh: true,
            },
          },
        );
      });
    });

    const refreshScrollTrigger = () => ScrollTrigger.refresh();
    const refreshId = requestAnimationFrame(refreshScrollTrigger);
    window.addEventListener("load", refreshScrollTrigger);

    return () => {
      cancelAnimationFrame(refreshId);
      window.removeEventListener("load", refreshScrollTrigger);
      parallaxContext.revert();
    };
  }, [pathname]); // Removed contentVisible from dependencies

  return children;
}
