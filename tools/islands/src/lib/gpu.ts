// WebGL here is decoration. On a software renderer (SwiftShader, llvmpipe: no
// usable GPU) a WebGL scene costs seconds of main-thread time, so those
// visitors keep the static, server-rendered version instead.
// `failIfMajorPerformanceCaveat` is the standard signal, but current Chrome
// still hands out SwiftShader contexts with it set, hence the renderer check.
const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

export function hardwareWebGL2(canvas: HTMLCanvasElement, attrs: WebGLContextAttributes = {}): WebGL2RenderingContext | null {
  const gl = canvas.getContext("webgl2", { ...attrs, failIfMajorPerformanceCaveat: true });
  if (!gl) return null;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  if (SOFTWARE.test(name)) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  return gl;
}

let cached: boolean | undefined;
/** Cheap, cached answer, so the loader can skip downloading a WebGL island at all. */
export function hasHardwareWebGL(): boolean {
  if (cached === undefined) {
    const gl = hardwareWebGL2(document.createElement("canvas"));
    cached = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return cached;
}
