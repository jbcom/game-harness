import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  admittedGpuMode,
  CHROMIUM_ANTI_THROTTLING_ARGS,
  type ChromiumGpuMode,
  createChromiumLaunchProfile,
} from '../src/chromium-launch.js';

describe('admittedGpuMode', () => {
  const platforms = ['linux', 'darwin', 'win32'] as const;
  const gpuValues = [
    'linux-hardware-vulkan',
    'macos-hardware-metal',
    'auto',
    'software',
    '',
    undefined,
  ] as const;
  const muteValues = ['1', '0', '', 'true', undefined] as const;

  const admitted: Readonly<Record<string, ChromiumGpuMode>> = {
    'linux/linux-hardware-vulkan': 'linux-hardware-vulkan',
    'darwin/macos-hardware-metal': 'macos-hardware-metal',
  };

  for (const platform of platforms) {
    for (const gpu of gpuValues) {
      for (const mute of muteValues) {
        const expected = mute === '1' ? admitted[`${platform}/${gpu}`] : undefined;
        const label = `${platform} gpu=${String(gpu)} mute=${String(mute)}`;
        if (expected) {
          it(`admits ${label} as ${expected}`, () => {
            expect(
              admittedGpuMode({
                platform,
                env: { HEAVY_BROWSER_GPU: gpu, HEAVY_BROWSER_MUTE: mute },
              }),
            ).toBe(expected);
          });
        } else if (mute !== '1') {
          it(`rejects ${label} as not muted`, () => {
            expect(() =>
              admittedGpuMode({
                platform,
                env: { HEAVY_BROWSER_GPU: gpu, HEAVY_BROWSER_MUTE: mute },
              }),
            ).toThrow(/HEAVY_BROWSER_MUTE=1/u);
          });
        } else {
          it(`rejects ${label} as not admitted`, () => {
            expect(() =>
              admittedGpuMode({
                platform,
                env: { HEAVY_BROWSER_GPU: gpu, HEAVY_BROWSER_MUTE: mute },
              }),
            ).toThrow(/not an admitted hardware GPU host/u);
          });
        }
      }
    }
  }

  it('names the platform and GPU value in the not-admitted message', () => {
    expect(() =>
      admittedGpuMode({
        platform: 'win32',
        env: { HEAVY_BROWSER_GPU: 'linux-hardware-vulkan', HEAVY_BROWSER_MUTE: '1' },
      }),
    ).toThrow(/platform "win32".*HEAVY_BROWSER_GPU="linux-hardware-vulkan"/u);
    expect(() => admittedGpuMode({ platform: 'linux', env: { HEAVY_BROWSER_MUTE: '1' } })).toThrow(
      /platform "linux".*HEAVY_BROWSER_GPU=<unset>/u,
    );
  });

  it('checks the mute flag before the platform, so a silent run is never traded for a GPU one', () => {
    expect(() =>
      admittedGpuMode({
        platform: 'win32',
        env: { HEAVY_BROWSER_GPU: 'auto', HEAVY_BROWSER_MUTE: '0' },
      }),
    ).toThrow(/HEAVY_BROWSER_MUTE=1/u);
  });

  describe('with the process defaults', () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

    afterEach(() => {
      vi.unstubAllEnvs();
      if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
    });

    it('reads process.env and process.platform when no options are given', () => {
      vi.stubEnv('HEAVY_BROWSER_GPU', 'macos-hardware-metal');
      vi.stubEnv('HEAVY_BROWSER_MUTE', '1');
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      expect(admittedGpuMode()).toBe('macos-hardware-metal');
      expect(admittedGpuMode({})).toBe('macos-hardware-metal');
    });

    it('lets an explicit platform override process.platform while still reading process.env', () => {
      vi.stubEnv('HEAVY_BROWSER_GPU', 'linux-hardware-vulkan');
      vi.stubEnv('HEAVY_BROWSER_MUTE', '1');
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      expect(() => admittedGpuMode()).toThrow(/not an admitted hardware GPU host/u);
      expect(admittedGpuMode({ platform: 'linux' })).toBe('linux-hardware-vulkan');
    });

    it('lets an explicit env override process.env while still reading process.platform', () => {
      vi.stubEnv('HEAVY_BROWSER_GPU', 'linux-hardware-vulkan');
      vi.stubEnv('HEAVY_BROWSER_MUTE', '0');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      expect(() => admittedGpuMode()).toThrow(/HEAVY_BROWSER_MUTE=1/u);
      expect(
        admittedGpuMode({
          env: { HEAVY_BROWSER_GPU: 'linux-hardware-vulkan', HEAVY_BROWSER_MUTE: '1' },
        }),
      ).toBe('linux-hardware-vulkan');
    });
  });
});

describe('createChromiumLaunchProfile', () => {
  it('defaults to native renderer selection, background scheduling and silent output', () => {
    expect(createChromiumLaunchProfile()).toEqual({
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--mute-audio',
      ],
    });
  });

  it('keeps the anti-throttling switches in every gpu mode', () => {
    for (const gpuMode of [
      'auto',
      'software',
      'linux-hardware-vulkan',
      'macos-hardware-metal',
    ] as const) {
      expect(createChromiumLaunchProfile({ gpuMode }).args).toEqual(
        expect.arrayContaining([...CHROMIUM_ANTI_THROTTLING_ARGS]),
      );
    }
  });

  it('exposes the anti-throttling switches as an immutable list', () => {
    expect(Object.isFrozen(CHROMIUM_ANTI_THROTTLING_ARGS)).toBe(true);
  });

  it('de-duplicates args, including repeated anti-throttling switches, and keeps mute last', () => {
    expect(
      createChromiumLaunchProfile({
        args: ['--custom', '--mute-audio', '--custom', '--disable-renderer-backgrounding'],
      }).args,
    ).toEqual([...CHROMIUM_ANTI_THROTTLING_ARGS, '--custom', '--mute-audio']);
  });

  it('preserves explicit environment values in the Linux hardware profile', () => {
    const profile = createChromiumLaunchProfile({
      gpuMode: 'linux-hardware-vulkan',
      env: { EGL_PLATFORM: 'device', TEST_SENTINEL: 'retained' },
    });
    expect(profile.env).toEqual(
      expect.objectContaining({
        EGL_PLATFORM: 'device',
        TEST_SENTINEL: 'retained',
      }),
    );
  });

  it('selects ANGLE Metal without any software-renderer switch in the macOS hardware profile', () => {
    const profile = createChromiumLaunchProfile({ gpuMode: 'macos-hardware-metal' });
    expect(profile).toEqual({
      args: [
        '--use-angle=metal',
        '--ignore-gpu-blocklist',
        ...CHROMIUM_ANTI_THROTTLING_ARGS,
        '--mute-audio',
      ],
    });
    expect(profile.args.join(' ')).not.toMatch(/swiftshader/i);
  });

  it('keeps caller args and env on top of the macOS hardware profile', () => {
    const profile = createChromiumLaunchProfile({
      gpuMode: 'macos-hardware-metal',
      args: ['--custom'],
      env: { TEST_SENTINEL: 'retained' },
    });
    expect(profile.args).toEqual([
      '--use-angle=metal',
      '--ignore-gpu-blocklist',
      ...CHROMIUM_ANTI_THROTTLING_ARGS,
      '--custom',
      '--mute-audio',
    ]);
    expect(profile.env).toEqual(expect.objectContaining({ TEST_SENTINEL: 'retained' }));
    // The profile adds no EGL_PLATFORM of its own; whatever the host set passes through.
    expect(profile.env?.EGL_PLATFORM).toBe(process.env.EGL_PLATFORM);
  });

  it('merges caller environment with process.env outside the Linux hardware profile', () => {
    const profile = createChromiumLaunchProfile({
      gpuMode: 'auto',
      env: { TEST_SENTINEL: 'retained' },
    });
    expect(profile.env).toEqual(expect.objectContaining({ TEST_SENTINEL: 'retained' }));
    expect(profile.env?.EGL_PLATFORM).toBe(process.env.EGL_PLATFORM);
  });

  it('omits env entirely when no environment overrides and no hardware profile are requested', () => {
    expect(createChromiumLaunchProfile({ gpuMode: 'software' })).toEqual({
      args: [
        '--use-gl=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        ...CHROMIUM_ANTI_THROTTLING_ARGS,
        '--mute-audio',
      ],
    });
  });
});
