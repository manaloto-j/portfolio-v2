import { vertexShader, fragmentShader } from "./shaders";

export const createShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader.");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader) ?? "Unknown shader error.";
    gl.deleteShader(shader);
    throw new Error(error);
  }

  return shader;
};

export const createProgram = (gl: WebGLRenderingContext) => {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create WebGL program.");

  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader);

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // Shaders are only needed at link time — delete them immediately to free GPU memory.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program) ?? "Unknown program error.";
    gl.deleteProgram(program);
    throw new Error(error);
  }

  return program;
};

export const createTexture = (
  gl: WebGLRenderingContext,
  image: HTMLImageElement,
  useMipmaps: boolean,
  anisoExt: EXT_texture_filter_anisotropic | null,
  maxAniso: number,
) => {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Unable to create WebGL texture.");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

  if (useMipmaps) {
    // LINEAR_MIPMAP_LINEAR (trilinear) gives the best quality at all display
    // scales. generateMipmap() is a one-time GPU cost at texture upload.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    if (anisoExt && maxAniso > 1) {
      gl.texParameterf(
        gl.TEXTURE_2D,
        anisoExt.TEXTURE_MAX_ANISOTROPY_EXT,
        maxAniso,
      );
    }
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }

  return texture;
};
