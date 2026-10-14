import { describe, expect, it } from 'vitest';
import {
  LINUX_HARDWARE_WEBGL_PROBE_ROWS,
  isHardwareWebGLProbeResultHealthy,
  launchEvidenceForLinuxHardwareWebGLProbe,
  launchOptionsForLinuxHardwareWebGLProbe,
} from '../scripts/lib/linux-hardware-webgl-probe.js';

describe('LINUX_HARDWARE_WEBGL_PROBE_ROWS', () => {
  it('isolates the headed Xvfb EGL override from the exact ANGLE/Vulkan flags', () => {
    expect(LINUX_HARDWARE_WEBGL_PROBE_ROWS).toEqual([
      {
        id: 'baseline',
        args: ['--mute-audio'],
        eglPlatform: undefined,
        headless: false,
      },
      {
        id: 'angle-vulkan-no-egl',
        args: [
          '--use-gpu-in-tests',
          '--use-gl=angle',
          '--use-angle=vulkan',
          '--ignore-gpu-blocklist',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--mute-audio',
        ],
        eglPlatform: undefined,
        headless: false,
      },
      {
        id: 'angle-vulkan-surfaceless',
        args: [
          '--use-gpu-in-tests',
          '--use-gl=angle',
          '--use-angle=vulkan',
          '--ignore-gpu-blocklist',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--mute-audio',
        ],
        eglPlatform: 'surfaceless',
        headless: false,
      },
    ]);
  });

  it('clears inherited EGL_PLATFORM for the no-EGL rows while keeping the Xvfb display', () => {
    const noEglRow = LINUX_HARDWARE_WEBGL_PROBE_ROWS[1];
    if (!noEglRow) throw new Error('missing no-EGL probe row');

    expect(
      launchOptionsForLinuxHardwareWebGLProbe(noEglRow, {
        DISPLAY: ':99',
        EGL_PLATFORM: 'surfaceless',
      }),
    ).toEqual({
      args: [...noEglRow.args],
      env: { DISPLAY: ':99' },
      headless: false,
    });
  });

  it('sets surfaceless only for the profile row that explicitly selects it', () => {
    const surfacelessRow = LINUX_HARDWARE_WEBGL_PROBE_ROWS[2];
    if (!surfacelessRow) throw new Error('missing surfaceless probe row');

    expect(launchOptionsForLinuxHardwareWebGLProbe(surfacelessRow, { DISPLAY: ':99' })).toEqual({
      args: [...surfacelessRow.args],
      env: { DISPLAY: ':99', EGL_PLATFORM: 'surfaceless' },
      headless: false,
    });
  });

  it('redacts unrelated environment variables from printed launch evidence', () => {
    const surfacelessRow = LINUX_HARDWARE_WEBGL_PROBE_ROWS[2];
    if (!surfacelessRow) throw new Error('missing surfaceless probe row');

    expect(
      launchEvidenceForLinuxHardwareWebGLProbe(surfacelessRow, {
        DISPLAY: ':99',
        GITHUB_TOKEN: 'never-log-this',
      }),
    ).toEqual({
      args: [...surfacelessRow.args],
      display: ':99',
      eglPlatform: 'surfaceless',
      headless: false,
    });
  });

  it('rejects software renderers even when the stress scene drew pixels', () => {
    expect(
      isHardwareWebGLProbeResultHealthy({
        context: 'webgl2',
        isContextLost: false,
        error: null,
        renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)',
        unmasked: true,
        pixel: [20, 30, 40, 255],
      }),
    ).toBe(false);
    expect(
      isHardwareWebGLProbeResultHealthy({
        context: 'webgl2',
        isContextLost: false,
        error: null,
        renderer: 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)',
        unmasked: true,
        pixel: [20, 30, 40, 255],
      }),
    ).toBe(true);
  });

  it('requires a non-black RGB readback rather than the always-opaque alpha channel', () => {
    expect(
      isHardwareWebGLProbeResultHealthy({
        context: 'webgl2',
        isContextLost: false,
        error: null,
        renderer: 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)',
        unmasked: true,
        pixel: [0, 0, 0, 255],
      }),
    ).toBe(false);
  });

  it('reports a missing WebGL2 context as an unhealthy probe result', () => {
    expect(
      isHardwareWebGLProbeResultHealthy({
        context: null,
        isContextLost: false,
        error: null,
        renderer: '',
        unmasked: false,
        pixel: [],
      }),
    ).toBe(false);
  });
});
