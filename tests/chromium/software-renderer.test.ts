import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { createChromiumLaunchProfile } from '../../src/chromium-launch.js';

/**
 * A 64 px WebGL canvas cleared to transparent with one opaque square drawn in
 * its middle: the exact pixels a software-rendered subject picture must keep.
 */
const KNOWN_PIXELS_PAGE = `<!doctype html><body style="margin:0"><canvas id="c" width="64" height="64" style="display:block"></canvas><script>
  const gl = document.getElementById('c').getContext('webgl', { alpha: true, premultipliedAlpha: true });
  const debug = gl && gl.getExtension('WEBGL_debug_renderer_info');
  window.renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'none';
  if (gl) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(16, 16, 32, 32);
    gl.clearColor(0.5, 0.25, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
</script></body>`;

function pixel(png: PNG, x: number, y: number): number[] {
  const offset = (y * png.width + x) * 4;
  return Array.from(png.data.subarray(offset, offset + 4));
}

describe('the software renderer profile in a real browser', () => {
  it('renders WebGL through SwiftShader with transparency intact', async () => {
    const profile = createChromiumLaunchProfile({ gpuMode: 'software' });
    const browser = await chromium.launch({
      args: profile.args,
      // Headless under heavy-slot (HEAVY_BROWSER_HEADLESS=1); headed under the
      // CI display server, which exercises the path CI actually runs.
      headless: process.env.HEAVY_BROWSER_HEADLESS === '1',
    });
    try {
      const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
      await page.setContent(KNOWN_PIXELS_PAGE);

      expect(
        await page.evaluate(() => (window as unknown as { renderer: string }).renderer),
      ).toMatch(/swiftshader/i);

      const png = PNG.sync.read(await page.screenshot({ omitBackground: true }));
      expect([png.width, png.height]).toEqual([64, 64]);
      expect(pixel(png, 1, 1)).toEqual([0, 0, 0, 0]);
      const centre = pixel(png, 32, 32);
      expect(centre[3]).toBe(255);
      expect(Math.abs((centre[0] ?? 0) - 128)).toBeLessThanOrEqual(1);
      expect(Math.abs((centre[1] ?? 0) - 64)).toBeLessThanOrEqual(1);
      expect(Math.abs((centre[2] ?? 0) - 26)).toBeLessThanOrEqual(1);
    } finally {
      await browser.close();
    }
  });
});
