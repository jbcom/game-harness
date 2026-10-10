import { describe, expect, it } from 'vitest';
import {
  CHROMIUM_ANTI_THROTTLING_ARGS,
  createChromiumLaunchProfile,
} from '../src/chromium-launch.js';

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
    expect(profile.env).not.toHaveProperty('EGL_PLATFORM');
  });

  it('merges caller environment with process.env outside the Linux hardware profile', () => {
    const profile = createChromiumLaunchProfile({
      gpuMode: 'auto',
      env: { TEST_SENTINEL: 'retained' },
    });
    expect(profile.env).toEqual(expect.objectContaining({ TEST_SENTINEL: 'retained' }));
    expect(profile.env).not.toHaveProperty('EGL_PLATFORM');
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
