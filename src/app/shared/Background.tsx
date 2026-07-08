import React, { useRef, useEffect, useState } from "react";

/**
 * ShaderBackground
 * ------------------------------------------------------------------
 * A dependency-free, portable animated dithered-noise background.
 * Renders full-screen using raw WebGL (no p5.js, no external libs),
 * so it can drop into any React app (CRA, Vite, Next.js, Remix, etc).
 *
 * Usage (full-screen, default):
 *   Drop it anywhere in your tree — no wrapper needed. It pins itself to
 *   the viewport regardless of any parent's margin/padding/max-width.
 *
 *     <ShaderBackground color="#111111" background="#FAFAFA" />
 *     <YourPageContent />   // renders above it automatically (zIndex: -1)
 *
 * Usage (contained inside a specific box, e.g. a hero section):
 *   Use position="absolute" and give the parent `position: relative;
 *   overflow: hidden;`. It will now fill and be clipped by that box only.
 *
 *     <div style={{ position: "relative", overflow: "hidden", height: 400 }}>
 *       <ShaderBackground position="absolute" />
 *       <div style={{ position: "relative", zIndex: 1 }}>Hero content</div>
 *     </div>
 *
 * Props:
 *   className              - optional class applied to the wrapping container
 *   style                  - optional extra styles merged onto the container (highest priority)
 *   scale                  - dither cell scale (bayerScale uniform), default 0.5
 *   speed                  - animation speed multiplier, default 0.5
 *   color                  - CSS color string for the "on" dither pixels, default "#ffffff"
 *                            accepts hex (with or without "#"), rgb(), hsl(), named colors, etc.
 *   background             - CSS color string for the "off" pixels, default "#000000"
 *   position               - "fixed" (default, viewport-filling) or "absolute" (fills nearest
 *                            positioned ancestor)
 *   zIndex                 - stacking order, default -1 (sits behind normal content)
 *   density                - fraction (0–1) of the canvas covered by `color` vs `background`,
 *                            default 0.5 (roughly even split). Lower = more background showing,
 *                            higher = more foreground `color` showing. If omitted AND `negative`
 *                            is on, defaults to 0.3 instead of 0.5 — see below.
 *   noiseAmount            - how much the animated noise wobbles coverage around `density`,
 *                            0–1, default 0.4. Higher = more organic/chaotic movement;
 *                            lower keeps the dot grid steady and evenly spaced while still
 *                            animating gently. 0 = a perfectly static, evenly-spaced grid.
 *   negative               - boolean prop alias for data-background-negative
 *   data-background-negative - when present (or truthy), inverts the rendered output.
 *
 * ── How "negative" works now ────────────────────────────────────────
 * Instead of pre-inverting the color/background uniforms (which relied on
 * parsing arbitrary CSS color strings through a scratch canvas, then doing
 * RGB math — fragile, and silently falls back to "not inverted" if parsing
 * ever misbehaves), the shader always renders its true colors. When
 * `negative` is set, a second, transparent layer is stacked directly on
 * top of the canvas using `backdrop-filter: invert(1)`. That layer inverts
 * whatever pixels are rendered beneath it, the same way a CSS
 * `filter: invert(1)` would, but scoped only to this component instead of
 * the whole page. This is simpler, can't drift out of sync with the
 * shader's actual colors, and has no failure mode that quietly no-ops.
 *
 * Note on density: with a ~50/50 color/background split, inverting the
 * colors alone can look deceptively similar to the non-inverted version —
 * two roughly-balanced colors swapped still read as "roughly balanced."
 * To make the effect actually read as different, `negative` also shifts
 * the default `density` down to 0.3, so background visibly dominates the
 * canvas instead of just trading places with the foreground color. Pass
 * an explicit `density` prop to override this in either mode.
 *
 * Negative color examples (visually, after the invert layer):
 *   #111111 → looks like #EEEEEE   (near-black becomes near-white)
 *   #FAFAFA → looks like #050505   (near-white becomes near-black)
 *   #FF0000 → looks like #00FFFF   (red becomes cyan)
 * ------------------------------------------------------------------
 */

const VERT_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAG_SRC = `
#ifdef GL_ES
precision highp float;
#endif

varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_density;
uniform float u_noiseAmount;
uniform vec3 u_color;
uniform vec3 u_background;

// Simplex noise (Ashima Arts)
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0,1.0/3.0);
  const vec4 D = vec4(0.0,0.5,1.0,2.0);
  vec3 i = floor(v + dot(v,C.yyy));
  vec3 x0 = v - i + dot(i,C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i,289.0);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0,i1.z,i2.z,1.0))
    + i.y + vec4(0.0,i1.y,i2.y,1.0))
    + i.x + vec4(0.0,i1.x,i2.x,1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x/2.0 + a.y*a.y*0.75);
}
#define Bayer4(a)  (Bayer2(0.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a)  (Bayer4(0.5*(a))*0.25 + Bayer2(a))
#define Bayer16(a) (Bayer8(0.5*(a))*0.25 + Bayer2(a))
#define Bayer32(a) (Bayer16(0.5*(a))*0.25 + Bayer2(a))

void main() {
  vec2 uv = vUv;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.5;
  float n1 = snoise(vec3(uv, t));
  float n2 = snoise(vec3(uv + 5.0, t * 1.2));
  float gray = mix(n1, n2, 0.5) * 0.5 + 0.5;

  // Anchor coverage at u_density (this is what keeps the dot grid evenly
  // spaced and stable) and let the noise field only nudge it up/down by a
  // small, controlled amount — enough to animate/twinkle, not enough to
  // swing whole spatially-correlated patches of the noise above or below
  // threshold together (that swinging is what read as "random dots"
  // clustering unevenly instead of a steady, evenly-spaced sparkle).
  float wobble = (gray - 0.5) * u_noiseAmount;
  float grayAdjusted = clamp(u_density + wobble, 0.0, 1.0);

  float d = step(Bayer32(gl_FragCoord.xy * u_scale), grayAdjusted);
  gl_FragColor = vec4(mix(u_background, u_color, d), 1.0);
}
`;

let _colorCanvas = null;
let _colorCtx = null;

function cssColorToRgb01(input, fallback = [1, 1, 1]) {
  if (typeof input !== "string" || input.trim() === "") return fallback;

  let value = input.trim();
  if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(value)) {
    value = "#" + value;
  }

  try {
    if (!_colorCanvas) {
      _colorCanvas = document.createElement("canvas");
      _colorCanvas.width = 1;
      _colorCanvas.height = 1;
      _colorCtx = _colorCanvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = _colorCtx;
    if (!ctx) return fallback;

    ctx.fillStyle = "#010203";
    ctx.fillStyle = value;
    const normalized = ctx.fillStyle;
    if (normalized === "#010203") {
      console.warn(
        `ShaderBackground: "${input}" is not a valid CSS color, using fallback.`,
      );
      return fallback;
    }

    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0] / 255, data[1] / 255, data[2] / 255];
  } catch (e) {
    console.warn("ShaderBackground: color parsing failed, using fallback.", e);
    return fallback;
  }
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("Shader compile error: " + info);
  }
  return shader;
}

function createProgram(gl, vertSrc, fragSrc) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error("Program link error: " + info);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

export default function ShaderBackground({
  className = "",
  style = {},
  scale = 0.5,
  speed = 0.5,
  color = "#ffffff",
  background = "#000000",
  position = "fixed",
  zIndex = -1,
  // fraction of canvas covered by `color` vs `background`. Left undefined
  // by default so we can tell "user didn't set it" apart from "user set
  // it to 0.5" — see effectiveDensity below.
  density,
  // how much the animated noise wobbles coverage around `density`
  // (0 = perfectly static grid, 1 = old fully noise-driven behavior).
  // Lower values keep the dot grid evenly spaced while still animating.
  noiseAmount = 0.4,
  // ── negative mode ─────────────────────────────────────────────────
  // Accept both the data-attribute form and a plain boolean prop.
  // Either one being truthy activates inversion.
  //   <ShaderBackground data-background-negative />
  //   <ShaderBackground negative />
  //   <ShaderBackground negative={true} />
  "data-background-negative": dataNegative = false,
  negative = false,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  // Resolve once — both spellings mean the same thing.
  const isNegative = Boolean(negative || dataNegative);

  // If the caller didn't pass an explicit density, default to 0.3 when
  // negative mode is on (so background visibly dominates) and 0.5
  // otherwise (roughly even split). Explicit `density` always wins.
  const effectiveDensity = Math.min(
    1,
    Math.max(0, density !== undefined ? density : isNegative ? 0.3 : 0.5),
  );

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const gl =
      canvas.getContext("webgl", { antialias: false }) ||
      canvas.getContext("experimental-webgl", { antialias: false });

    if (!gl) {
      setError("WebGL is not supported in this browser");
      return;
    }

    let program, positionBuffer, positionLoc;
    let uResolution, uTime, uScale, uDensity, uNoiseAmount, uColor, uBackground;
    let rafId;
    let startTime = performance.now();
    let destroyed = false;

    // The shader always renders its TRUE colors. Inversion (if requested)
    // is handled entirely by the backdrop-filter overlay layer below, not
    // here — so this parsing can never silently break "negative" mode.
    const colorRgb = cssColorToRgb01(color, [1, 1, 1]);
    const backgroundRgb = cssColorToRgb01(background, [0, 0, 0]);

    const handleContextLost = (e) => {
      e.preventDefault();
      if (rafId) cancelAnimationFrame(rafId);
    };
    const handleContextRestored = () => {
      try {
        init();
      } catch (e) {
        setError("Failed to restore WebGL context: " + e.message);
      }
    };
    canvas.addEventListener("webglcontextlost", handleContextLost, false);
    canvas.addEventListener(
      "webglcontextrestored",
      handleContextRestored,
      false,
    );

    function init() {
      program = createProgram(gl, VERT_SRC, FRAG_SRC);
      gl.useProgram(program);

      const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

      positionLoc = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      uResolution = gl.getUniformLocation(program, "u_resolution");
      uTime = gl.getUniformLocation(program, "u_time");
      uScale = gl.getUniformLocation(program, "u_scale");
      uDensity = gl.getUniformLocation(program, "u_density");
      uNoiseAmount = gl.getUniformLocation(program, "u_noiseAmount");
      uColor = gl.getUniformLocation(program, "u_color");
      uBackground = gl.getUniformLocation(program, "u_background");

      resize();
      startTime = performance.now();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(render);
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(container.clientWidth * dpr));
      const h = Math.max(1, Math.floor(container.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    function render(now) {
      if (destroyed) return;
      resize();

      const t = ((now - startTime) / 1000) * speed;

      gl.useProgram(program);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uScale, scale);
      gl.uniform1f(uDensity, effectiveDensity);
      gl.uniform1f(uNoiseAmount, noiseAmount);
      gl.uniform3f(uColor, colorRgb[0], colorRgb[1], colorRgb[2]);
      gl.uniform3f(
        uBackground,
        backgroundRgb[0],
        backgroundRgb[1],
        backgroundRgb[2],
      );

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      rafId = requestAnimationFrame(render);
    }

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(container);

    try {
      init();
    } catch (e) {
      console.error("ShaderBackground init error:", e);
      setError("Failed to initialize WebGL: " + e.message);
    }

    return () => {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      if (gl && positionBuffer) gl.deleteBuffer(positionBuffer);
      if (gl && program) gl.deleteProgram(program);
    };
  }, [scale, speed, color, background, effectiveDensity, noiseAmount]);

  const isFixed = position === "fixed";

  return (
    <div
      ref={containerRef}
      className={`shader-bg ${className}`}
      role="img"
      aria-label="Procedural noise shader background"
      style={{
        position: isFixed ? "fixed" : "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        margin: 0,
        padding: 0,
        maxWidth: "none",
        width: isFixed ? "100vw" : "100%",
        height: isFixed ? "100dvh" : "100%",
        overflow: "hidden",
        pointerEvents: "none",
        zIndex,
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />

      {/* Inversion overlay — a transparent layer stacked on top of the
          canvas whose only job is to invert whatever is rendered beneath
          it via backdrop-filter. Only mounted when `negative` is set, so
          there's zero cost (no extra compositing layer) in the default case. */}
      {isNegative && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backdropFilter: "invert(1)",
            WebkitBackdropFilter: "invert(1)",
            pointerEvents: "none",
          }}
        />
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            background: "rgba(200,0,0,0.75)",
            padding: "8px 12px",
            borderRadius: 4,
            color: "white",
            fontSize: 12,
            fontFamily: "monospace",
            zIndex: 1000,
          }}
        >
          Shader Error: {error}
        </div>
      )}
    </div>
  );
}
