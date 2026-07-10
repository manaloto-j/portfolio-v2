"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * FluidCursor
 * ------------------------------------------------------------------
 * A dependency-free, portable "fluid cursor" — a dithered, organic
 * noise trail that follows the mouse and fades away behind it.
 *
 * Unlike ShaderBackground's `hover` mode (which draws a full-screen
 * background and then *masks it away* around the cursor to reveal
 * whatever sits underneath), this component draws NOTHING by default.
 * It only ever paints the dithered trail itself, directly, wherever
 * the cursor has recently moved — a comet-tail of noisy ink rather
 * than a hole punched through a backdrop.
 *
 * Guarantees:
 *   - Starts completely blank. No dots/pattern are visible anywhere
 *     on screen until the pointer actually moves (the reveal/feed
 *     term starts at 0 and the trail buffer is cleared on init).
 *   - The trail decays every frame (uDecay), so once the cursor stops
 *     moving the tail shrinks and fades smoothly to nothing instead
 *     of freezing in place.
 *   - Pixels with ~zero trail density are discarded in the fragment
 *     shader, so there is never a faint dithered pattern sitting idle
 *     across the viewport — only where ink actually exists.
 *
 * Usage:
 *   <FluidCursor color="#ffffff" />
 *   Mount it once near the root of your app (it's a fixed, full-
 *   viewport, pointer-events:none overlay), and it will track the
 *   mouse anywhere on the page.
 * ------------------------------------------------------------------
 */

// ── Shared vertex shader ─────────────────────────────────────────
const VERT_SHADER = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// ── Trail update fragment shader ─────────────────────────────────
// Paints a velocity-elongated Gaussian blob at the cursor position
// each frame, then decays the whole buffer toward 0. Identical in
// spirit to a comet's head-and-tail: elongated along the direction
// of travel, fading uniformly over time via uDecay.
const TRAIL_FRAG = `
precision mediump float;
uniform sampler2D uPrevTrail;
uniform vec2 uMouse;
uniform vec2 uMouseDir;
uniform float uVelocity;
uniform float uDecay;
uniform float uBrushSize;
uniform float uAspect;
uniform float uReveal;
uniform float uElongation;
varying vec2 vUv;

void main() {
  float prev = texture2D(uPrevTrail, vUv).r * uDecay;

  vec2 delta = vUv - uMouse;
  delta.x *= uAspect;

  vec2 dir = length(uMouseDir) > 0.001 ? uMouseDir : vec2(0.0, 1.0);
  float along = dot(delta, dir);
  float perp = length(delta - along * dir);
  float elongation = 1.0 + uVelocity * uElongation;
  float blobDist = sqrt(along * along / elongation + perp * perp);
  float blob = exp(-blobDist * blobDist / (uBrushSize * uBrushSize)) * uReveal;

  gl_FragColor = vec4(min(prev + blob, 1.0), 0.0, 0.0, 1.0);
}
`;

// ── Display fragment shader ───────────────────────────────────────
// Renders a Bayer-dithered simplex-noise "ink" pattern, but ONLY
// where the trail texture has non-zero density. Nothing is drawn
// (the fragment is discarded) where density is ~0, so an idle cursor
// leaves the screen completely untouched — no residual dot grid.
const DITHER_FRAG = `
precision highp float;
uniform sampler2D uTrailTexture;
uniform vec2 uResolution;
uniform float uScale;
uniform float uTime;
uniform float uNoiseAmount;
uniform float uDensityFloor;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;

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
  float density = texture2D(uTrailTexture, vUv).r;

  // Nothing here — draw nothing. This is what keeps an idle cursor
  // (or a page that was never touched) perfectly blank.
  if (density <= uDensityFloor) {
    discard;
  }

  vec2 uv = vUv;
  uv.x *= uResolution.x / uResolution.y;

  float n = snoise(vec3(uv * 6.0, uTime));
  float wobble = (n * 0.5 + 0.5 - 0.5) * uNoiseAmount;
  float grayAdjusted = clamp(density + wobble, 0.0, 1.0);

  float d = step(Bayer32(gl_FragCoord.xy * uScale), grayAdjusted);

  // Soft-fade the very edge of the trail so it dissolves into
  // nothing rather than cutting off in a hard dithered ring.
  float edge = smoothstep(uDensityFloor, uDensityFloor + 0.12, density);

  float alpha = d * edge * uOpacity;
  gl_FragColor = vec4(uColor, alpha);
}
`;

// --- Constants ---
const TRAIL_TEXTURE_SIDE = 512;

// --- Pure helpers ---
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function compileShader(
  gl: WebGLRenderingContext,
  source: string,
  type: number,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(
  gl: WebGLRenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram | null {
  const vs = compileShader(gl, vsSource, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function createFBO(gl: WebGLRenderingContext, w: number, h: number) {
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
  return { fb, texture };
}

// Resolves CSS color strings (including var(--x) and oklch()) to normalized [r,g,b],
// using a live DOM element so getComputedStyle resolves variables against the active
// theme, then a 1x1 canvas to convert whatever color space the browser returns into
// sRGB bytes.
const probeCtx =
  typeof document !== "undefined"
    ? document.createElement("canvas").getContext("2d")
    : null;

function resolveColor(
  el: HTMLElement,
  colorStr: string,
): [number, number, number] {
  el.style.color = colorStr;
  const computed = getComputedStyle(el).color;
  if (!probeCtx) return [1, 1, 1];
  probeCtx.fillStyle = computed;
  probeCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

// --- WebGL engine (framework-agnostic) ---
interface EngineConfig {
  decay: number;
  brushSize: number;
  elongation: number;
  opacity: number;
  speedScale: number;
  scale: number;
  noiseAmount: number;
  densityFloor: number;
  trailResolution: number;
  // Milliseconds of no pointer movement after which the trail stops being
  // fed and is left to decay to nothing, instead of persisting forever at
  // the last mouse position.
  idleTimeout: number;
}

class FluidCursorEngine {
  private gl: WebGLRenderingContext;
  private trailProgram: WebGLProgram;
  private displayProgram: WebGLProgram;
  private positionBuffer: WebGLBuffer;
  private fboA: { fb: WebGLFramebuffer | null; texture: WebGLTexture | null };
  private fboB: { fb: WebGLFramebuffer | null; texture: WebGLTexture | null };
  private rafId = 0;
  private running = false;
  private config: EngineConfig;
  private startTime = performance.now();

  // Uniform locations — trail
  private tPosLoc: number;
  private tPrevLoc: WebGLUniformLocation | null;
  private tMouseLoc: WebGLUniformLocation | null;
  private tMouseDirLoc: WebGLUniformLocation | null;
  private tVelocityLoc: WebGLUniformLocation | null;
  private tDecayLoc: WebGLUniformLocation | null;
  private tBrushLoc: WebGLUniformLocation | null;
  private tAspectLoc: WebGLUniformLocation | null;
  private tRevealLoc: WebGLUniformLocation | null;
  private tElongationLoc: WebGLUniformLocation | null;

  // Uniform locations — display
  private dPosLoc: number;
  private dTrailLoc: WebGLUniformLocation | null;
  private dResLoc: WebGLUniformLocation | null;
  private dScaleLoc: WebGLUniformLocation | null;
  private dTimeLoc: WebGLUniformLocation | null;
  private dNoiseAmountLoc: WebGLUniformLocation | null;
  private dDensityFloorLoc: WebGLUniformLocation | null;
  private dColorLoc: WebGLUniformLocation | null;
  private dOpacityLoc: WebGLUniformLocation | null;

  // Animated state
  private width = 0;
  private height = 0;
  private dpr = 1;
  private aspect = 1;
  private mouseX = 0.5;
  private mouseY = 0.5;
  private prevX = 0.5;
  private prevY = 0.5;
  private dirX = 0;
  private dirY = 1;
  private velocity = 0;
  private reveal = 0; // starts at 0 — nothing is drawn until the pointer moves
  private colorRGB: [number, number, number] = [1, 1, 1];

  private pendingPointer: { clientX: number; clientY: number } | null = null;
  private lastActivity = -Infinity; // no activity yet — trail stays at 0

  constructor(canvas: HTMLCanvasElement, config: EngineConfig) {
    this.config = config;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;

    const trailProgram = linkProgram(gl, VERT_SHADER, TRAIL_FRAG);
    const displayProgram = linkProgram(gl, VERT_SHADER, DITHER_FRAG);
    if (!trailProgram || !displayProgram)
      throw new Error("Shader compilation failed");
    this.trailProgram = trailProgram;
    this.displayProgram = displayProgram;

    this.tPosLoc = gl.getAttribLocation(trailProgram, "position");
    this.tPrevLoc = gl.getUniformLocation(trailProgram, "uPrevTrail");
    this.tMouseLoc = gl.getUniformLocation(trailProgram, "uMouse");
    this.tMouseDirLoc = gl.getUniformLocation(trailProgram, "uMouseDir");
    this.tVelocityLoc = gl.getUniformLocation(trailProgram, "uVelocity");
    this.tDecayLoc = gl.getUniformLocation(trailProgram, "uDecay");
    this.tBrushLoc = gl.getUniformLocation(trailProgram, "uBrushSize");
    this.tAspectLoc = gl.getUniformLocation(trailProgram, "uAspect");
    this.tRevealLoc = gl.getUniformLocation(trailProgram, "uReveal");
    this.tElongationLoc = gl.getUniformLocation(trailProgram, "uElongation");

    this.dPosLoc = gl.getAttribLocation(displayProgram, "position");
    this.dTrailLoc = gl.getUniformLocation(displayProgram, "uTrailTexture");
    this.dResLoc = gl.getUniformLocation(displayProgram, "uResolution");
    this.dScaleLoc = gl.getUniformLocation(displayProgram, "uScale");
    this.dTimeLoc = gl.getUniformLocation(displayProgram, "uTime");
    this.dNoiseAmountLoc = gl.getUniformLocation(
      displayProgram,
      "uNoiseAmount",
    );
    this.dDensityFloorLoc = gl.getUniformLocation(
      displayProgram,
      "uDensityFloor",
    );
    this.dColorLoc = gl.getUniformLocation(displayProgram, "uColor");
    this.dOpacityLoc = gl.getUniformLocation(displayProgram, "uOpacity");

    const side = this.config.trailResolution;
    this.fboA = createFBO(gl, side, side);
    this.fboB = createFBO(gl, side, side);
    // Clear both trail buffers up front so there is never any stale
    // content — the very first frame renders completely blank.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA.fb);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fb);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const buf = gl.createBuffer();
    if (!buf) throw new Error("Buffer creation failed");
    this.positionBuffer = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    this.tick = this.tick.bind(this);
    this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  queuePointer(clientX: number, clientY: number) {
    this.pendingPointer = { clientX, clientY };
    this.lastActivity = performance.now();
  }

  // Marks the pointer inactive right away (left the window, tab lost
  // focus) instead of waiting out idleTimeout — the trail begins
  // fading on the very next frame.
  markInactive() {
    this.lastActivity = -Infinity;
  }

  // Instantly clears the trail and resets reveal to 0. Used when the
  // page is hidden/backgrounded so it comes back completely blank
  // instead of reappearing with a stale trail frozen mid-fade.
  hardReset() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA.fb);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fb);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.reveal = 0;
    this.lastActivity = -Infinity;
  }

  private applyPointer(clientX: number, clientY: number) {
    this.prevX = this.mouseX;
    this.prevY = this.mouseY;
    this.mouseX = clientX / this.width;
    this.mouseY = 1.0 - clientY / this.height;

    const dx = (this.mouseX - this.prevX) * this.aspect;
    const dy = this.mouseY - this.prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.velocity = Math.min(this.config.speedScale * dist, 1.0);
    if (dist > 1e-4) {
      this.dirX = dx / dist;
      this.dirY = dy / dist;
    }
  }

  resize(w: number, h: number, dpr: number) {
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.aspect = w / h || 1;
  }

  setColor(rgb: [number, number, number]) {
    this.colorRGB = rgb;
  }

  private tick() {
    if (!this.running) return;

    if (this.pendingPointer) {
      const { clientX, clientY } = this.pendingPointer;
      this.pendingPointer = null;
      this.applyPointer(clientX, clientY);
    }

    const gl = this.gl;
    const side = this.config.trailResolution;
    const idle =
      performance.now() - this.lastActivity > this.config.idleTimeout;

    // While idle, fade uReveal toward 0 so the shader stops adding new
    // ink each frame — only then does uDecay actually shrink the
    // existing trail down to nothing instead of holding steady.
    this.reveal = lerp(this.reveal, idle ? 0.0 : 1.0, idle ? 0.05 : 0.15);
    this.velocity *= 0.9;

    // Pass 1: update trail into FBO B
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fb);
    gl.viewport(0, 0, side, side);
    gl.useProgram(this.trailProgram);
    gl.enableVertexAttribArray(this.tPosLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(this.tPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboA.texture);
    gl.uniform1i(this.tPrevLoc, 0);
    gl.uniform2f(this.tMouseLoc, this.mouseX, this.mouseY);
    gl.uniform2f(this.tMouseDirLoc, this.dirX, this.dirY);
    gl.uniform1f(this.tVelocityLoc, this.velocity);
    gl.uniform1f(this.tDecayLoc, this.config.decay);
    gl.uniform1f(this.tBrushLoc, this.config.brushSize);
    gl.uniform1f(this.tAspectLoc, this.aspect);
    gl.uniform1f(this.tRevealLoc, this.reveal);
    gl.uniform1f(this.tElongationLoc, this.config.elongation);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const tmp = this.fboA;
    this.fboA = this.fboB;
    this.fboB = tmp;

    // Pass 2: render dithered ink to screen, wherever trail density > 0
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width * this.dpr, this.height * this.dpr);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.displayProgram);
    gl.enableVertexAttribArray(this.dPosLoc);
    gl.vertexAttribPointer(this.dPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboA.texture);
    gl.uniform1i(this.dTrailLoc, 0);
    gl.uniform2f(this.dResLoc, this.width * this.dpr, this.height * this.dpr);
    gl.uniform1f(this.dScaleLoc, this.config.scale);
    gl.uniform1f(this.dTimeLoc, (performance.now() - this.startTime) / 1000);
    gl.uniform1f(this.dNoiseAmountLoc, this.config.noiseAmount);
    gl.uniform1f(this.dDensityFloorLoc, this.config.densityFloor);
    gl.uniform3f(
      this.dColorLoc,
      this.colorRGB[0],
      this.colorRGB[1],
      this.colorRGB[2],
    );
    gl.uniform1f(this.dOpacityLoc, this.config.opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.rafId = requestAnimationFrame(this.tick);
  }

  destroy() {
    this.stop();
    const gl = this.gl;
    gl.deleteFramebuffer(this.fboA.fb);
    gl.deleteFramebuffer(this.fboB.fb);
    gl.deleteTexture(this.fboA.texture);
    gl.deleteTexture(this.fboB.texture);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteProgram(this.trailProgram);
    gl.deleteProgram(this.displayProgram);
  }
}

// --- React component ---
export interface FluidCursorProps {
  /** Color of the ink trail. Accepts any CSS color, including var(--x) and oklch(). */
  color?: string;
  /** Per-frame retention of the trail buffer (0-1). Closer to 1 = trail lingers longer. */
  decay?: number;
  /** Radius (UV-space, 0-1) of the ink blob painted at the cursor each frame. */
  brushSize?: number;
  /** How much the blob stretches into a comet tail based on cursor speed. */
  elongation?: number;
  /** Overall opacity multiplier of the rendered trail. */
  opacity?: number;
  /** Multiplier converting cursor UV-space speed into the 0-1 velocity uniform. */
  speedScale?: number;
  /** Size of the Bayer dithering cells — higher = coarser/grainier dots. */
  scale?: number;
  /** Amount of simplex-noise wobble applied to the dithered density. */
  noiseAmount?: number;
  /**
   * Trail density below which nothing is drawn at all. Keeps the very
   * edge of the trail (and any idle page) completely blank instead of
   * showing a faint dithered haze.
   */
  densityFloor?: number;
  /** Side length (in texels) of the square trail texture. */
  trailResolution?: number;
  /**
   * Milliseconds of no pointer movement before the trail starts fading
   * away instead of persisting at the last mouse position. Also
   * triggered immediately when the pointer leaves the window or the
   * tab loses focus.
   */
  idleTimeout?: number;
  /** z-index of the fixed full-viewport overlay. */
  zIndex?: number;
  className?: string;
}

export const FluidCursor: React.FC<FluidCursorProps> = ({
  color = "#fafafa",
  decay = 0.95,
  brushSize = 0.05,
  elongation = 2.5,
  opacity = 1.0,
  speedScale = 35.0,
  scale = 0.5,
  noiseAmount = 0.4,
  densityFloor = 0.02,
  trailResolution = TRAIL_TEXTURE_SIDE,
  idleTimeout = 500,
  zIndex = 9999,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<FluidCursorEngine | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setSupported(false);
      return;
    }

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let engine: FluidCursorEngine;
    try {
      engine = new FluidCursorEngine(canvas, {
        decay,
        brushSize,
        elongation,
        opacity,
        speedScale,
        scale,
        noiseAmount,
        densityFloor,
        trailResolution,
        idleTimeout,
      });
    } catch {
      setSupported(false);
      return;
    }
    engineRef.current = engine;
    engine.setColor(resolveColor(container, color));

    const onPointerMove = (e: PointerEvent) => {
      engine.queuePointer(e.clientX, e.clientY);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const onPointerLeaveWindow = () => engine.markInactive();
    document.addEventListener("mouseleave", onPointerLeaveWindow);
    window.addEventListener("blur", onPointerLeaveWindow);

    const ro = new ResizeObserver(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w <= 0 || h <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      engine.resize(w, h, dpr);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    });
    ro.observe(document.documentElement);
    // Trigger initial sizing immediately.
    {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      engine.resize(w, h, dpr);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        engine.hardReset();
        engine.stop();
      } else {
        engine.start();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      engine.destroy();
      engineRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("mouseleave", onPointerLeaveWindow);
      window.removeEventListener("blur", onPointerLeaveWindow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    decay,
    brushSize,
    elongation,
    opacity,
    speedScale,
    scale,
    noiseAmount,
    densityFloor,
    trailResolution,
    idleTimeout,
  ]);

  // Re-resolve color when the prop changes or a theme class toggles on <html>.
  useEffect(() => {
    const container = containerRef.current;
    const engine = engineRef.current;
    if (!container || !engine) return;
    const update = () => engine.setColor(resolveColor(container, color));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [color]);

  if (!supported) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={className}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100dvh",
        pointerEvents: "none",
        overflow: "hidden",
        zIndex,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};

export default FluidCursor;
