import type { ParallaxImageSource } from "./types";

export const getImageSrc = (image: ParallaxImageSource) =>
  typeof image === "string" ? image : image.src;

export const getAspectRatio = (image: ParallaxImageSource) =>
  typeof image === "string" ? undefined : `${image.width} / ${image.height}`;

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
