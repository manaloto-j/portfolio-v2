import React, { useRef, useEffect, useState } from "react";

/**
 * ShaderBackground
 * ------------------------------------------------------------------
 * A dependency-free, portable animated dithered-noise background.
 * Renders full-screen using raw WebGL (no p5.js, no external libs).
 *
 * NEW — hover prop:
 *   When `hover` is true, moving the mouse over the component
 *   dissipates (erases) the background around the cursor, revealing
 *   whatever sits beneath the component. The effect uses the same
 *   Bayer-dithered GLSL as the background itself, driven by a
 *   ping-pong FBO trail with a head-and-tail shape (elongated along
 *   the movement direction, leaving a fading wake behind it).
 *
 *   Tune the size of the dissipation area with HOVER_RADIUS below.
 *
 * Props:
 *   hover        - boolean, default false. Enables mouse dissipation.
 *   className, style, scale, speed, color, background, position,
 *   zIndex, density, noiseAmount, negative / data-background-negative
 *   — all unchanged from the original.
 * ------------------------------------------------------------------
 */

// ── Hover dissipation tuning ─────────────────────────────────────
// Radius of the dissipation brush in UV-space (0–1).
// Larger = bigger clear area around the cursor.
const HOVER_RADIUS = 0.05;

// How much the trail elongates along the movement direction.
// 1 = round blob; higher = more stretched teardrop / comet tail.
const HOVER_ELONGATION_SCALE = 2.5;

// Per-frame decay of the trail texture (0–1).
// Values closer to 1 keep the tail visible longer.
const HOVER_DECAY = 0.96;

// Side length (in texels) of the ping-pong trail texture.
const HOVER_TRAIL_SIDE = 512;

// ── Vertex shader (shared) ───────────────────────────────────────
const VERT_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// ── Main background fragment shader ──────────────────────────────
// When u_useTrail is 1, samples the trail texture and drives alpha to
// 0 where the trail is hot (dissipation / reveal-through effect).
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
uniform sampler2D u_trail;
uniform int u_useTrail;

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

  float wobble = (gray - 0.5) * u_noiseAmount;
  float grayAdjusted = clamp(u_density + wobble, 0.0, 1.0);

  float d = step(Bayer32(gl_FragCoord.xy * u_scale), grayAdjusted);
  vec3 col = mix(u_background, u_color, d);

  // Hover dissipation: use the trail value to cut alpha, punching a
  // dithered hole through the background where the cursor has been.
  float alpha = 1.0;
  if (u_useTrail == 1) {
    float trail = texture2D(u_trail, vUv).r;
    // Dither the edge of the dissipation so it matches the background grain.
    float ditheredTrail = step(Bayer32(gl_FragCoord.xy * u_scale), 1.0 - trail);
    alpha = ditheredTrail;
  }

  gl_FragColor = vec4(col, alpha);
}
`;

// ── Trail update fragment shader ─────────────────────────────────
// Paints a velocity-elongated Gaussian blob at the cursor position
// each frame, then decays the whole buffer toward 0.
const TRAIL_FRAG_SRC = `
#ifdef GL_ES
precision mediump float;
#endif

varying vec2 vUv;
uniform sampler2D u_prevTrail;
uniform vec2 u_mouse;
uniform vec2 u_mouseDir;
uniform float u_velocity;
uniform float u_decay;
uniform float u_brushSize;
uniform float u_aspect;
uniform float u_reveal;

void main() {
  float prev = texture2D(u_prevTrail, vUv).r * u_decay;

  vec2 delta = vUv - u_mouse;
  delta.x *= u_aspect;

  // Elongate the blob along the movement direction (head shape).
  vec2 dir = length(u_mouseDir) > 0.001 ? u_mouseDir : vec2(0.0, 1.0);
  float along = dot(delta, dir);
  float perp = length(delta - along * dir);
  float elongation = 1.0 + u_velocity * ${HOVER_ELONGATION_SCALE.toFixed(1)};
  float blobDist = sqrt(along * along / elongation + perp * perp);
  float blob = exp(-blobDist * blobDist / (u_brushSize * u_brushSize)) * u_reveal;

  gl_FragColor = vec4(min(prev + blob, 1.0), 0.0, 0.0, 1.0);
}
`;

// ── Colour parsing ───────────────────────────────────────────────
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

// ── WebGL helpers ────────────────────────────────────────────────
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

function createFBO(gl, w, h) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, texture };
}

// ── Component ────────────────────────────────────────────────────
export default function ShaderBackground({
  className = "",
  style = {},
  scale = 0.5,
  speed = 0.5,
  color = "#ffffff",
  background = "#000000",
  position = "fixed",
  zIndex = -1,
  density,
  noiseAmount = 0.4,
  "data-background-negative": dataNegative = false,
  negative = false,
  // ── New prop ─────────────────────────────────────────────────
  // When true, the background dissipates around the mouse cursor,
  // revealing whatever is stacked beneath this component.
  hover = false,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  const isNegative = Boolean(negative || dataNegative);
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

    // Request alpha so the canvas can be transparent where dissipated.
    const gl =
      canvas.getContext("webgl", {
        antialias: false,
        alpha: true,
        premultipliedAlpha: false,
      }) ||
      canvas.getContext("experimental-webgl", {
        antialias: false,
        alpha: true,
        premultipliedAlpha: false,
      });

    if (!gl) {
      setError("WebGL is not supported in this browser");
      return;
    }

    let bgProgram, trailProgram;
    let positionBuffer;
    let rafId;
    let startTime = performance.now();
    let destroyed = false;

    // ── Background program uniforms
    let uResolution,
      uTime,
      uScale,
      uDensity,
      uNoiseAmount,
      uColor,
      uBackground,
      uTrail,
      uUseTrail;

    // ── Trail program uniforms
    let tPrevTrail,
      tMouse,
      tMouseDir,
      tVelocity,
      tDecay,
      tBrushSize,
      tAspect,
      tReveal;

    // ── Ping-pong FBOs (only allocated when hover = true)
    let fboA = null;
    let fboB = null;

    // ── Mouse tracking state
    let mouseX = 0.5;
    let mouseY = 0.5;
    let prevMouseX = 0.5;
    let prevMouseY = 0.5;
    let dirX = 0.0;
    let dirY = 1.0;
    let velocity = 0.0;
    let reveal = 0.0;
    let lastActivity = -Infinity;
    let pendingPointer = null;

    const colorRgb = cssColorToRgb01(color, [1, 1, 1]);
    const backgroundRgb = cssColorToRgb01(background, [0, 0, 0]);

    // ── Pointer handler (queues, applied once per frame)
    const onPointerMove = (e) => {
      pendingPointer = { clientX: e.clientX, clientY: e.clientY };
      lastActivity = performance.now();
    };
    const onPointerLeave = () => {
      lastActivity = -Infinity;
    };

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

    function applyPointer(clientX, clientY) {
      const rect = container.getBoundingClientRect();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      prevMouseX = mouseX;
      prevMouseY = mouseY;
      mouseX = (clientX - rect.left) / w;
      mouseY = 1.0 - (clientY - rect.top) / h;

      const aspect = w / (h || 1);
      const dx = (mouseX - prevMouseX) * aspect;
      const dy = mouseY - prevMouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      velocity = Math.min(35.0 * dist, 1.0);
      if (dist > 1e-4) {
        dirX = dx / dist;
        dirY = dy / dist;
      }
    }

    function init() {
      // Compile programs
      bgProgram = createProgram(gl, VERT_SRC, FRAG_SRC);
      if (hover) {
        trailProgram = createProgram(gl, VERT_SRC, TRAIL_FRAG_SRC);
      }

      // Shared full-screen quad
      const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

      // Background program — cache uniform locations
      uResolution = gl.getUniformLocation(bgProgram, "u_resolution");
      uTime = gl.getUniformLocation(bgProgram, "u_time");
      uScale = gl.getUniformLocation(bgProgram, "u_scale");
      uDensity = gl.getUniformLocation(bgProgram, "u_density");
      uNoiseAmount = gl.getUniformLocation(bgProgram, "u_noiseAmount");
      uColor = gl.getUniformLocation(bgProgram, "u_color");
      uBackground = gl.getUniformLocation(bgProgram, "u_background");
      uTrail = gl.getUniformLocation(bgProgram, "u_trail");
      uUseTrail = gl.getUniformLocation(bgProgram, "u_useTrail");

      // Trail program — cache uniform locations
      if (hover && trailProgram) {
        tPrevTrail = gl.getUniformLocation(trailProgram, "u_prevTrail");
        tMouse = gl.getUniformLocation(trailProgram, "u_mouse");
        tMouseDir = gl.getUniformLocation(trailProgram, "u_mouseDir");
        tVelocity = gl.getUniformLocation(trailProgram, "u_velocity");
        tDecay = gl.getUniformLocation(trailProgram, "u_decay");
        tBrushSize = gl.getUniformLocation(trailProgram, "u_brushSize");
        tAspect = gl.getUniformLocation(trailProgram, "u_aspect");
        tReveal = gl.getUniformLocation(trailProgram, "u_reveal");

        // Allocate ping-pong FBOs and clear them
        fboA = createFBO(gl, HOVER_TRAIL_SIDE, HOVER_TRAIL_SIDE);
        fboB = createFBO(gl, HOVER_TRAIL_SIDE, HOVER_TRAIL_SIDE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.fb);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.fb);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

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
      const w = canvas.width;
      const h = canvas.height;
      const aspect = w / (h || 1);

      // ── Apply queued pointer ─────────────────────────────────
      if (pendingPointer) {
        applyPointer(pendingPointer.clientX, pendingPointer.clientY);
        pendingPointer = null;
      }

      // ── Pass 1: update trail FBO (only when hover enabled) ───
      if (hover && trailProgram && fboA && fboB) {
        const idle = performance.now() - lastActivity > 500;
        reveal = reveal + (idle ? -0.05 : 0.1) * (idle ? reveal : 1.0 - reveal);
        reveal = Math.max(0, Math.min(1, reveal));
        velocity *= 0.9;

        gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.fb);
        gl.viewport(0, 0, HOVER_TRAIL_SIDE, HOVER_TRAIL_SIDE);

        gl.useProgram(trailProgram);
        const tPosLoc = gl.getAttribLocation(trailProgram, "aPosition");
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(tPosLoc);
        gl.vertexAttribPointer(tPosLoc, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboA.texture);
        gl.uniform1i(tPrevTrail, 0);
        gl.uniform2f(tMouse, mouseX, mouseY);
        gl.uniform2f(tMouseDir, dirX, dirY);
        gl.uniform1f(tVelocity, velocity);
        gl.uniform1f(tDecay, HOVER_DECAY);
        gl.uniform1f(tBrushSize, HOVER_RADIUS);
        gl.uniform1f(tAspect, aspect);
        gl.uniform1f(tReveal, reveal);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Swap ping-pong buffers
        const tmp = fboA;
        fboA = fboB;
        fboB = tmp;
      }

      // ── Pass 2: render background to screen ──────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(bgProgram);
      const bPosLoc = gl.getAttribLocation(bgProgram, "aPosition");
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(bPosLoc);
      gl.vertexAttribPointer(bPosLoc, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(uResolution, w, h);
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

      if (hover && fboA) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboA.texture);
        gl.uniform1i(uTrail, 0);
        gl.uniform1i(uUseTrail, 1);
      } else {
        gl.uniform1i(uUseTrail, 0);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      rafId = requestAnimationFrame(render);
    }

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(container);

    if (hover) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("mouseleave", onPointerLeave);
      window.addEventListener("blur", onPointerLeave);
    }

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
      if (hover) {
        window.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("mouseleave", onPointerLeave);
        window.removeEventListener("blur", onPointerLeave);
      }
      if (gl) {
        if (positionBuffer) gl.deleteBuffer(positionBuffer);
        if (bgProgram) gl.deleteProgram(bgProgram);
        if (trailProgram) gl.deleteProgram(trailProgram);
        if (fboA) {
          gl.deleteFramebuffer(fboA.fb);
          gl.deleteTexture(fboA.texture);
        }
        if (fboB) {
          gl.deleteFramebuffer(fboB.fb);
          gl.deleteTexture(fboB.texture);
        }
      }
    };
  }, [scale, speed, color, background, effectiveDensity, noiseAmount, hover]);

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

      {/* Inversion overlay — only mounted when `negative` is set */}
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
