import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import { createProgram, createTexture } from "./webgl";
import { loadImage, getImageSrc } from "./imageUtils";
import type { ThreeDParallaxImage } from "./types";

interface UseWebGLRendererOptions {
  strengthX: number;
  strengthY: number;
  lerpFactor: number;
  planeScale: number;
  isMobile: boolean;
}

interface UseWebGLRendererResult {
  webglFailed: boolean;
  wakeRenderRef: MutableRefObject<() => void>;
}

/**
 * Manages the full WebGL lifecycle for the 3D parallax effect:
 * - Async texture loading
 * - WebGL context creation (WebGL 2 preferred, WebGL 1 fallback)
 * - Shader program compilation and linking
 * - Idle-aware RAF render loop with lerp convergence detection
 * - ResizeObserver for element resizes
 * - window resize listener for browser-zoom DPR changes
 * - Full GPU resource cleanup on unmount / prop change
 *
 * Returns `webglFailed` (show image fallback) and `wakeRenderRef` (callable
 * by input handlers to restart the loop after it goes idle).
 */
export function useWebGLRenderer(
  mountRef: RefObject<HTMLDivElement | null>,
  image: ThreeDParallaxImage,
  targetMouse: MutableRefObject<{ x: number; y: number }>,
  { strengthX, strengthY, lerpFactor, planeScale, isMobile }: UseWebGLRendererOptions,
): UseWebGLRendererResult {
  const [webglFailed, setWebglFailed] = useState(false);

  // Shared with useInputHandlers — assigned once init() completes.
  // Starts as a no-op so early input events before init are safely ignored.
  const wakeRenderRef = useRef<() => void>(() => {});

  const { color, depth, alpha } = image;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Skip all WebGL work on mobile/tablet: no shader compilation, no texture
    // downloads, no canvas — just let the <img> fallback render below.
    if (isMobile) return;

    let isDestroyed = false;
    let canvas: HTMLCanvasElement | undefined;
    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | undefined;
    let positionBuffer: WebGLBuffer | undefined;
    let uvBuffer: WebGLBuffer | undefined;
    let textures: WebGLTexture[] = [];

    const LERP_EPSILON = 1e-5;
    let rafId = 0;
    let isIdle = false;

    // Assigned inside init() and used for cleanup.
    let cleanupWindowResize = () => {};

    const init = async () => {
      const [colorImage, depthImage, alphaImage] = await Promise.all([
        loadImage(getImageSrc(color)),
        loadImage(getImageSrc(depth)),
        loadImage(getImageSrc(alpha)),
      ]);
      if (isDestroyed) return;

      canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      mount.appendChild(canvas);

      // Prefer WebGL 2: it natively supports mipmaps on non-power-of-two
      // (NPOT) textures. WebGL 1 silently ignores generateMipmap() for NPOT.
      gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
      }) as WebGLRenderingContext | null;
      const isWebGL2 = gl !== null;
      if (!gl) {
        gl = canvas.getContext("webgl", {
          alpha: true,
          antialias: true,
          premultipliedAlpha: false,
        });
      }
      if (!gl) {
        // WebGL unavailable on this desktop browser — remove the blank canvas
        // so it does not leave an invisible hole, then show the image fallback.
        if (mount.contains(canvas)) mount.removeChild(canvas);
        setWebglFailed(true);
        return;
      }

      // Anisotropic filtering — improves sharpness when the texture is sampled
      // at a reduced scale. Queried once; zero per-frame overhead.
      const anisoExt = gl.getExtension("EXT_texture_filter_anisotropic");
      const maxAniso = anisoExt
        ? Math.min(
            gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number,
            4,
          )
        : 0;

      program = createProgram(gl);
      gl.useProgram(program);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // ── Geometry ──────────────────────────────────────────────────────────
      positionBuffer = gl.createBuffer() ?? undefined;
      if (!positionBuffer) return;

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -planeScale, -planeScale,
           planeScale, -planeScale,
          -planeScale,  planeScale,
          -planeScale,  planeScale,
           planeScale, -planeScale,
           planeScale,  planeScale,
        ]),
        gl.STATIC_DRAW,
      );

      const positionLocation = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      uvBuffer = gl.createBuffer() ?? undefined;
      if (!uvBuffer) return;

      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
        gl.STATIC_DRAW,
      );

      const uvLocation = gl.getAttribLocation(program, "aUv");
      gl.enableVertexAttribArray(uvLocation);
      gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);

      // ── Textures ──────────────────────────────────────────────────────────
      const texColor = createTexture(gl, colorImage, isWebGL2, anisoExt, maxAniso);
      const texDepth = createTexture(gl, depthImage, isWebGL2, anisoExt, maxAniso);
      const texAlpha = createTexture(gl, alphaImage, isWebGL2, anisoExt, maxAniso);
      textures = [texColor, texDepth, texAlpha];

      // ── Uniforms (cached up-front — zero per-frame getUniformLocation) ────
      const uMouse    = gl.getUniformLocation(program, "uMouse");
      const uStrength = gl.getUniformLocation(program, "uStrength");
      const uTexelSize = gl.getUniformLocation(program, "uTexelSize");
      const uTexture  = gl.getUniformLocation(program, "uTexture");
      const uDepthMap = gl.getUniformLocation(program, "uDepthMap");
      const uAlphaMap = gl.getUniformLocation(program, "uAlphaMap");

      gl.uniform2f(uStrength, strengthX, strengthY);
      gl.uniform2f(
        uTexelSize,
        1 / colorImage.naturalWidth,
        1 / colorImage.naturalHeight,
      );

      (
        [
          [uTexture, texColor],
          [uDepthMap, texDepth],
          [uAlphaMap, texAlpha],
        ] as const
      ).forEach(([loc, tex], index) => {
        gl!.activeTexture(gl!.TEXTURE0 + index);
        gl!.bindTexture(gl!.TEXTURE_2D, tex);
        gl!.uniform1i(loc, index);
      });

      // ── Render loop ───────────────────────────────────────────────────────
      const currentMouse = { x: 0, y: 0 };

      const scheduleRender = () => {
        if (isIdle && !isDestroyed) {
          isIdle = false;
          rafId = requestAnimationFrame(animate);
        }
      };

      const animate = () => {
        if (isDestroyed || !gl || !canvas) return;

        const dx = targetMouse.current.x - currentMouse.x;
        const dy = targetMouse.current.y - currentMouse.y;
        currentMouse.x += dx * lerpFactor;
        currentMouse.y += dy * lerpFactor;

        gl.uniform2f(uMouse, currentMouse.x, currentMouse.y);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (Math.abs(dx) < LERP_EPSILON && Math.abs(dy) < LERP_EPSILON) {
          isIdle = true; // lerp converged — stop the loop
        } else {
          rafId = requestAnimationFrame(animate);
        }
      };
      animate();

      // Expose scheduleRender so useInputHandlers can wake the loop.
      wakeRenderRef.current = scheduleRender;

      // ── Resize handling ───────────────────────────────────────────────────
      const resizeObserver = new ResizeObserver(([entry]) => {
        if (isDestroyed || !gl || !canvas) return;
        const box = entry.contentBoxSize[0];
        const pixelRatio = Math.min(window.devicePixelRatio, 2);
        canvas.width = Math.max(1, Math.round(box.inlineSize * pixelRatio));
        canvas.height = Math.max(1, Math.round(box.blockSize * pixelRatio));
        gl.viewport(0, 0, canvas.width, canvas.height);
        scheduleRender();
      });
      resizeObserver.observe(mount);

      // Re-evaluate canvas size when the browser zoom level changes.
      // Zooming alters window.devicePixelRatio without resizing CSS elements,
      // so the ResizeObserver above never fires — leaving the canvas blurry
      // until the next element resize.
      const onWindowResize = () => {
        if (isDestroyed || !gl || !canvas) return;
        const pixelRatio = Math.min(window.devicePixelRatio, 2);
        const w = Math.max(1, Math.round(mount.clientWidth * pixelRatio));
        const h = Math.max(1, Math.round(mount.clientHeight * pixelRatio));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, canvas.width, canvas.height);
          scheduleRender();
        }
      };
      window.addEventListener("resize", onWindowResize);
      cleanupWindowResize = () =>
        window.removeEventListener("resize", onWindowResize);

      return resizeObserver;
    };

    const resizeObserverPromise = init().catch(() => undefined);

    return () => {
      isDestroyed = true;
      wakeRenderRef.current = () => {};
      cancelAnimationFrame(rafId);
      cleanupWindowResize();

      resizeObserverPromise.then((resizeObserver) =>
        resizeObserver?.disconnect(),
      );

      if (gl) {
        textures.forEach((texture) => gl?.deleteTexture(texture));
        if (positionBuffer) gl.deleteBuffer(positionBuffer);
        if (uvBuffer) gl.deleteBuffer(uvBuffer);
        if (program) gl.deleteProgram(program);
      }
      if (canvas && mount.contains(canvas)) {
        mount.removeChild(canvas);
      }
    };
  // Refs (mountRef, targetMouse, wakeRenderRef) are intentionally excluded —
  // refs are stable and do not trigger re-runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, color, depth, alpha, strengthX, strengthY, lerpFactor, planeScale]);

  return { webglFailed, wakeRenderRef };
}
