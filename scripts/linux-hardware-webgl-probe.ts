import { chromium } from '@playwright/test';
import {
  LINUX_HARDWARE_WEBGL_PROBE_ROWS,
  isHardwareWebGLProbeResultHealthy,
  launchOptionsForLinuxHardwareWebGLProbe,
} from './lib/linux-hardware-webgl-probe.ts';

if (!process.env.DISPLAY) {
  throw new Error('Linux WebGL probe requires a headed display; run it through xvfb-run.');
}

function formatResult(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

async function runRow(row: (typeof LINUX_HARDWARE_WEBGL_PROBE_ROWS)[number]) {
  const launchOptions = launchOptionsForLinuxHardwareWebGLProbe(row);
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    return await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      document.body.append(canvas);
      const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
      if (!gl) return { context: null };

      const compile = (kind: number, source: string) => {
        const shader = gl.createShader(kind);
        if (!shader) throw new Error('failed to allocate shader');
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compilation failed');
        }
        return shader;
      };

      const vertex = compile(
        gl.VERTEX_SHADER,
        `#version 300 es
        precision highp float;
        out vec3 vColor;
        const vec2 corners[6] = vec2[6](
          vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
          vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0)
        );
        void main() {
          int cell = gl_VertexID / 6;
          vec2 grid = vec2(64.0, 64.0);
          vec2 cellPosition = vec2(float(cell % 64), float(cell / 64));
          vec2 position = (cellPosition + corners[gl_VertexID % 6]) / grid;
          gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
          vColor = vec3(position, 0.3 + 0.7 * sin(float(cell) * 0.17));
        }`,
      );
      const fragment = compile(
        gl.FRAGMENT_SHADER,
        `#version 300 es
        precision highp float;
        in vec3 vColor;
        out vec4 color;
        void main() { color = vec4(vColor, 1.0); }`,
      );
      const program = gl.createProgram();
      if (!program) throw new Error('failed to allocate program');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? 'program linking failed');
      }
      gl.useProgram(program);
      gl.viewport(0, 0, canvas.width, canvas.height);
      for (let frame = 0; frame < 120; frame += 1) {
        gl.clearColor(0.02, 0.03, frame / 120, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 64 * 64 * 6);
      }
      gl.finish();

      const pixels = new Uint8Array(4);
      gl.readPixels(640, 360, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
      const vendor = gl.getParameter(extension?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR);
      const error = gl.getError();
      return {
        context: 'webgl2' as const,
        dimensions: [canvas.width, canvas.height] as const,
        isContextLost: gl.isContextLost(),
        error: error === gl.NO_ERROR ? null : error,
        renderer: String(renderer),
        vendor: String(vendor),
        unmasked: extension !== null,
        pixel: [...pixels],
      };
    });
  } finally {
    await browser.close();
  }
}

console.log(
  `Linux WebGL probe display=${process.env.DISPLAY} debug=${process.env.DEBUG ?? '<unset>'} rows=${LINUX_HARDWARE_WEBGL_PROBE_ROWS.map((row) => row.id).join(',')}`,
);

const results = [];
for (const row of LINUX_HARDWARE_WEBGL_PROBE_ROWS) {
  const result = await runRow(row);
  const healthy = isHardwareWebGLProbeResultHealthy(result);
  const report = {
    id: row.id,
    launch: launchOptionsForLinuxHardwareWebGLProbe(row),
    result,
    healthy,
  };
  results.push(report);
  console.log(formatResult(report));
}

if (results.some((report) => !report.healthy)) {
  throw new Error(`Linux WebGL probe failed:\n${formatResult(results)}`);
}
