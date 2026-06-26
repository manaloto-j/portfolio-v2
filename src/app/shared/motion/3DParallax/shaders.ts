export const vertexShader = /* glsl */ `
  attribute vec2 aPosition;
  attribute vec2 aUv;
  varying vec2 vUv;
  void main() {
    vUv = aUv;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uTexture;
  uniform sampler2D uDepthMap;
  uniform sampler2D uAlphaMap;
  uniform vec2      uMouse;
  uniform vec2      uTexelSize;
  uniform vec2      uStrength;

  varying vec2 vUv;

  const float DEPTH_EDGE_FEATHER_PX = 15.0;
  const float EDGE_FILL_PX = 2.0;
  const float OPAQUE_THRESHOLD = 0.9;

  float sampleAlpha(vec2 uv) {
    return texture2D(uAlphaMap, uv).r;
  }

  float sampleDepth(vec2 uv) {
    return texture2D(uDepthMap, uv).r;
  }

  // Returns how strongly we are on a silhouette boundary (0=interior, 1=edge).
  float getEdgeBlend(vec2 uv) {
    vec2 r = uTexelSize * DEPTH_EDGE_FEATHER_PX;
    float center = sampleAlpha(uv);
    float l  = sampleAlpha(uv + vec2(-r.x,  0.0));
    float ri = sampleAlpha(uv + vec2( r.x,  0.0));
    float u  = sampleAlpha(uv + vec2( 0.0, -r.y));
    float d  = sampleAlpha(uv + vec2( 0.0,  r.y));
    float alphaMin = min(center, min(min(l, ri), min(u, d)));
    float alphaMax = max(center, max(max(l, ri), max(u, d)));
    return smoothstep(0.0, 0.08, alphaMax - alphaMin);
  }

  // Weighted-blur depth only near silhouette edges, leaves interior sharp.
  float getEdgeAwareDepth(vec2 uv) {
    vec2 r = uTexelSize * DEPTH_EDGE_FEATHER_PX;
    float center  = sampleDepth(uv);
    float blurred = center * 4.0;
    blurred += sampleDepth(uv + vec2(-r.x,  0.0)) * 2.0;
    blurred += sampleDepth(uv + vec2( r.x,  0.0)) * 2.0;
    blurred += sampleDepth(uv + vec2( 0.0, -r.y)) * 2.0;
    blurred += sampleDepth(uv + vec2( 0.0,  r.y)) * 2.0;
    blurred += sampleDepth(uv + vec2(-r.x, -r.y));
    blurred += sampleDepth(uv + vec2( r.x, -r.y));
    blurred += sampleDepth(uv + vec2(-r.x,  r.y));
    blurred += sampleDepth(uv + vec2( r.x,  r.y));
    blurred /= 16.0;
    return mix(center, blurred, getEdgeBlend(uv));
  }

  // 3x3 Gaussian-weighted alpha blur.
  //
  // Sampling alpha at a single texel and applying smoothstep produces jagged
  // edges when the parallax displaces the UV at steep angles -- the raw texel
  // boundary becomes visible as staircase artefacts.
  //
  // Averaging 9 samples over a 1-texel grid spreads the silhouette transition
  // zone across multiple pixels, making the anti-aliasing angle-independent:
  // the blended coverage value is smooth regardless of which direction the UV
  // was displaced.
  //
  // Kernel (Gaussian 3x3, weights 1-2-1 / 2-4-2 / 1-2-1, sum = 16):
  float getSmoothedAlpha(vec2 uv) {
    vec2 r = uTexelSize * 2.0;
    float a;
    a  = sampleAlpha(uv + vec2(-r.x, -r.y)) * 1.0;
    a += sampleAlpha(uv + vec2( 0.0, -r.y)) * 2.0;
    a += sampleAlpha(uv + vec2( r.x, -r.y)) * 1.0;
    a += sampleAlpha(uv + vec2(-r.x,  0.0)) * 2.0;
    a += sampleAlpha(uv                   ) * 4.0;
    a += sampleAlpha(uv + vec2( r.x,  0.0)) * 2.0;
    a += sampleAlpha(uv + vec2(-r.x,  r.y)) * 1.0;
    a += sampleAlpha(uv + vec2( 0.0,  r.y)) * 2.0;
    a += sampleAlpha(uv + vec2( r.x,  r.y)) * 1.0;
    return a / 16.0;
  }

  // Background-agnostic silhouette edge fill.
  //
  // After parallax displacement, edge pixels may sample near the source image
  // background (grey for the tooth, white for a portrait, etc.). We cannot
  // unmatte that colour -- the formula differs per background colour.
  //
  // Only pixels whose alpha >= OPAQUE_THRESHOLD (truly solid object pixels)
  // contribute to the weighted average. Semi-transparent fringe pixels (which
  // carry background colour) are excluded entirely, so the fill always returns
  // real object surface colour with no background bleed.
  //
  // Loop unrolled: GLSL ES 1.0 forbids dynamic array indexing in loops.
  vec4 getEdgeFillColor(vec2 uv) {
    vec2 r1 = uTexelSize * (EDGE_FILL_PX * 0.5);
    vec2 r2 = uTexelSize * EDGE_FILL_PX;

    vec4  centerColor = texture2D(uTexture, uv);
    float centerAlpha = sampleAlpha(uv);

    float cw = step(OPAQUE_THRESHOLD, centerAlpha);
    vec4  accumColor  = centerColor * cw;
    float accumWeight = cw;

    vec2 nuv; float na; float nw;
    
    // Inner ring (Radius * 0.5)
    nuv = uv + vec2(-r1.x,  0.0); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( r1.x,  0.0); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( 0.0, -r1.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( 0.0,  r1.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2(-r1.x, -r1.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( r1.x, -r1.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2(-r1.x,  r1.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( r1.x,  r1.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;

    // Outer ring (Radius)
    nuv = uv + vec2(-r2.x,  0.0); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( r2.x,  0.0); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( 0.0, -r2.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( 0.0,  r2.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2(-r2.x, -r2.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( r2.x, -r2.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2(-r2.x,  r2.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;
    nuv = uv + vec2( r2.x,  r2.y); na = sampleAlpha(nuv); nw = step(OPAQUE_THRESHOLD, na); accumColor += texture2D(uTexture, nuv) * nw; accumWeight += nw;

    vec4 filledColor = accumWeight > 0.001 ? accumColor / accumWeight : centerColor;

    // Use the Gaussian-smoothed alpha to drive fillStrength so the fill
    // zone tracks the same anti-aliased boundary used for the final cutout.
    // Raw single-sample alpha is noisy at parallax angles and produces a
    // detached outline ring; the blurred value keeps the fill tight.
    float smoothedCenterAlpha = getSmoothedAlpha(uv);
    float fillStrength = smoothstep(OPAQUE_THRESHOLD, 0.0, smoothedCenterAlpha);
    return mix(centerColor, filledColor, fillStrength);
  }

  void main() {
    float depth         = getEdgeAwareDepth(vUv);
    float parallaxDepth = depth;

    // Damp parallax near the texture boundary to avoid empty-space artefacts.
    float edgeDamp = smoothstep(0.0, 0.05 , vUv.x) *
                     smoothstep(0.0, 0.05, 1.0 - vUv.x) *
                     smoothstep(0.0, 0.05, vUv.y) *
                     smoothstep(0.0, 0.05, 1.0 - vUv.y);

    vec2 offset      = -uMouse * parallaxDepth * uStrength * edgeDamp;
    vec2 displacedUV = vUv + offset;

    // Colour: opaque-only neighbor fill so no source background bleeds in.
    vec4 color = getEdgeFillColor(displacedUV);

    // Alpha: Gaussian-blurred coverage value fed through a centred smoothstep.
    // The blur spreads the edge transition zone across multiple pixels so it
    // stays smooth at every parallax angle -- not just at idle.
    float smoothedAlpha = getSmoothedAlpha(displacedUV);
    float alpha         = smoothstep(0.15, 0.85, smoothedAlpha);

    gl_FragColor = vec4(color.rgb, alpha);
  }
`;
