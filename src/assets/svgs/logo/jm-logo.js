// ─── CONFIG ──────────────────────────────────────────────────────────────────
const LOTTIE_CONFIG = {
  duration: 800,
  holdMs: 0,
};
// ─────────────────────────────────────────────────────────────────────────────

const lottieContainer = document.getElementById("lottie-container");

if (lottieContainer && typeof lottie !== "undefined") {
  let currentIndex = 0;
  const animationPaths = [
    "./jm-logo-animation.json",
    "./jm-logo-animation-reverse.json",
  ];
  let anim;
  let rafId;

  function power3out(t) {
    return 1 - Math.pow(1 - t, 1.25);
  }

  function playWithEase(onComplete) {
    const start = performance.now();

    function tick(now) {
      const t = Math.min((now - start) / LOTTIE_CONFIG.duration, 1);
      const eased = power3out(t);
      anim.goToAndStop(eased * anim.totalFrames, true);

      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        onComplete();
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  function loadAnimation(path) {
    if (anim) {
      cancelAnimationFrame(rafId);
      anim.destroy();
    }

    anim = lottie.loadAnimation({
      container: lottieContainer,
      renderer: "svg",
      loop: false,
      autoplay: false,
      path,
    });

    anim.addEventListener("DOMLoaded", () => {
      playWithEase(() => {
        setTimeout(() => {
          currentIndex = (currentIndex + 1) % animationPaths.length;
          loadAnimation(animationPaths[currentIndex]);
        }, LOTTIE_CONFIG.holdMs);
      });
    });
  }

  loadAnimation(animationPaths[currentIndex]);
}
