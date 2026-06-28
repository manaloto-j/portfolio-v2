import type { HTMLAttributes } from "react";
import type { StaticImageData } from "next/image";

export type ParallaxImageSource = StaticImageData | string;

export type ThreeDParallaxImage = {
  color: ParallaxImageSource;
  depth: ParallaxImageSource;
  alpha: ParallaxImageSource;
};

export type ThreeDParallaxProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  image: ThreeDParallaxImage;
  strengthX?: number;
  strengthY?: number;
  lerpFactor?: number;
  planeScale?: number;
  invertX?: boolean;
  invertY?: boolean;
  "data-3d-idle"?: boolean | string;
};
