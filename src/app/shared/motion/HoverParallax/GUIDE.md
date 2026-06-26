# Hover Parallax Guide

The `HoverParallax` component provides an elegant 2D hover parallax effect driven by GSAP. Unlike individual wrappers, this is designed as a **Provider** that listens to global mouse and keyboard events and applies the effect to _any_ element inside it that has the correct `data-` attributes.

## 1. Setup

Wrap your page or section with the `<HoverParallax>` provider.

```tsx
import HoverParallax from "@/app/shared/motion/HoverParallax/HoverParallax";

export default function MyPage() {
  return (
    <HoverParallax>
      {/* Your page content goes here */}
      <MyHeroSection />
    </HoverParallax>
  );
}
```

## 2. Basic Usage

To apply the parallax effect to an element, simply add the `data-parallax-hover` attribute to it. The element will now smoothly shift its position when the user moves their mouse or uses keyboard navigation (WASD/Arrows).

```tsx
<div data-parallax-hover>...</div>
```

## 3. Custom Strengths

If the default strength (which is `sx: -0.025`, `sy: 0.025`) doesn't fit your needs, you can provide exact movement strengths per-element using custom data attributes.

- The value represents the percentage of the element's own dimensions it will travel.
- A negative value means it moves _opposite_ to the mouse (foreground effect).
- A positive value means it moves _with_ the mouse (background effect).

```tsx
<div
  data-parallax-hover
  data-parallax-hover-x="-0.15"
  data-parallax-hover-y="0.08"
>
  I move 15% of my width left when the mouse goes right, and 8% of my height
  down when the mouse goes down.
</div>
```

## 4. Custom Lerp (Smoothness)

You can control the animation duration (lerp) for each element to change how "heavy" or "snappy" it feels. The default duration is `1` second. 

- Use a smaller value (e.g., `0.1`) for snappy, instant tracking.
- Use a larger value (e.g., `3`) for a floaty, delayed follow effect.

```tsx
<!-- Fast tracking -->
<div data-parallax-hover data-parallax-hover-lerp="0.1">...</div>

<!-- Slow, floaty tracking -->
<div data-parallax-hover data-parallax-hover-lerp="2">...</div>
```
