# Scroll Parallax Guide

The `ScrollParallaxProvider` uses GSAP and ScrollTrigger to create smooth, performant vertical parallax effects as the user scrolls down the page. Like the Hover Parallax, it works globally by targeting specific `data-` attributes.

## 1. Setup

Wrap your page, layout, or section with the `<ScrollParallaxProvider>`.

```tsx
import ScrollParallaxProvider from "@/app/shared/motion/ScrollParallax/ScrollParallax";

export default function MyPage() {
  return (
    <ScrollParallaxProvider>
      {/* Your scrollable content here */}
      <MyLongSection />
    </ScrollParallaxProvider>
  );
}
```

## 2. Basic Usage

To make an element scroll at a different speed than the page, simply add the `data-parallax-scroll` attribute.

* Positive strengths make the element move *faster* than the scroll (great for foreground elements).
* A negative strength makes the element move *slower* than the scroll (great for backgrounds).

```tsx
<img src="..." data-parallax-scroll />
```

## 3. Custom Strengths

If the default strength (which is `0.1`) isn't quite right for your layout, you can set the exact parallax strength on any element using the `data-parallax-scroll-strength` attribute.

The value represents how far the element will travel vertically relative to the window's height. E.g., `0.5` means the element will shift by 50% of the screen height over the duration it takes to scroll past it.

```tsx
<div 
  data-parallax-scroll 
  data-parallax-scroll-strength="0.15"
>
  Custom scroll speed!
</div>
```
