# 3D Parallax Component Guide

The `ThreeDParallax` component creates a stunning, interactive 2.5D depth effect using WebGL. It reacts to mouse movements and keyboard navigation, causing a foreground object to appear as if it's floating above its background.

## 1. Required Images

To use this effect on a new image, you need to prepare **three** separate image files. They must all have the exact same dimensions.

### A. Color Map (`image.jpg` or `image.png`)
This is the base image you want to display. It should contain both the foreground object and the background.

### B. Depth Map (`image_depth.png` or `image_depth.jpg`)
This is a grayscale image that tells the shader how far away each pixel is.
*   **Black (`#000000`)**: Background (furthest away). These pixels will remain stationary, anchoring the image.
*   **White (`#FFFFFF`)**: Foreground (closest to you). These pixels will move the most to simulate depth.
*   **Grays**: Elements in between will move proportionally.
*   *Tip*: Ensure smooth gradients on curved surfaces so the 3D depth feels natural.

### C. Alpha Map (`image_alpha.png` or `image_alpha.jpg`)
This is a grayscale mask used to separate the main subject from the background. This allows the shader to cleanly detach the foreground object and fill the edges properly when the parallax shifts.
*   **Black (`#000000`)**: The background.
*   **White (`#FFFFFF`)**: The solid foreground object.
*   *Tip*: A slightly softened/anti-aliased edge around the object works best to prevent harsh pixelated borders.

---

## 2. Basic Usage

First, import your three images into your Next.js/React component, and pass them to the `ThreeDParallax` component as an object.

```tsx
import { ThreeDParallax } from "@/app/shared/motion/3dparallax";
import myImage from "@/public/assets/my-image.jpg";
import myImageDepth from "@/public/assets/my-image_depth.jpg";
import myImageAlpha from "@/public/assets/my-image_alpha.jpg";

export default function MyComponent() {
  return (
    <div className="w-full max-w-md">
      <ThreeDParallax
        image={{
          color: myImage,
          depth: myImageDepth,
          alpha: myImageAlpha,
        }}
      />
    </div>
  );
}
```

*Note: The component automatically calculates and applies the correct `aspect-ratio` based on your color image. You do not need to hardcode heights.*

### Alternative Pattern: Pre-packaging Maps

For a cleaner component file, especially if you reuse the parallax effect across different components, it is recommended to pre-package the three map layers into a single exported object.

**1. Create a definition file for your image (e.g. `src/assets/profile/profile-parallax.ts`):**
```ts
import color from "./tooth.webp";
import depth from "./tooth-depth.webp";
import alpha from "./tooth-alpha.webp";

const toothParallax = { color, depth, alpha };

export default toothParallax;
```

**2. Import the bundled object directly into your component:**
```tsx
import { ThreeDParallax } from "@/app/shared/motion/3dparallax";
import toothParallax from "@/assets/profile/profile-parallax";

export default function MyComponent() {
  return (
    <ThreeDParallax
      image={toothParallax}
      strengthX={0.05}
      strengthY={0.08}
      className="h-full mx-auto mt-4"
    />
  );
}
```

---

## 3. Customizing the Effect

You can adjust how much the image moves by overriding the default strength props.

```tsx
<ThreeDParallax
  image={myImages}
  strengthX={0.05} // Horizontal movement intensity (Default is 0.02)
  strengthY={0.05} // Vertical movement intensity (Default is 0.03)
  lerpFactor={0.1} // How smoothly the image follows the mouse (lower = smoother/slower)
/>
```

### Available Props

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `image` | `{ color, depth, alpha }` | **Required** | The object containing the three image sources. |
| `strengthX` | `number` | `0.02` | Intensity of the horizontal parallax movement. |
| `strengthY` | `number` | `0.03` | Intensity of the vertical parallax movement. |
| `lerpFactor`| `number` | `0.1` | The smoothing factor for movement interpolation. |
| `invertX` | `boolean` | `false` | Inverts the horizontal movement direction. |
| `invertY` | `boolean` | `true` | Inverts the vertical movement direction. |
| `planeScale`| `number` | `1.05` | How much to over-scale the WebGL plane to hide edges during extreme displacement. |
| `data-3d-idle` | `boolean \| string` | `undefined` | Enables subtle vertical idle motion. |

When `data-3d-idle` is enabled, idle uses `20%` of the configured `strengthY`. Adjust `IDLE_AMPLITUDE` in `useInputHandlers.ts` to tune the idle strength.

## 4. Fallback Behaviour

On mobile devices (screens smaller than `1024px`), or on browsers where WebGL fails to initialize, the component will safely and automatically fall back to rendering just a standard `<img>` tag of the `color` map. The depth and alpha maps are skipped entirely to save bandwidth.
