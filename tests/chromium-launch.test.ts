import { describe, expect, it } from 'vitest';
import { createChromiumLaunchProfile } from '../src/chromium-launch.js';

describe('createChromiumLaunchProfile', () => {
  it('defaults to native renderer selection and silent output', () => {
    expect(createChromiumLaunchProfile()).toEqual({ args: ['--mute-audio'] });
  });

  it('de-duplicates args and keeps mute last', () => {
    expect(
      createChromiumLaunchProfile({ args: ['--custom', '--mute-audio', '--custom'] }).args,
    ).toEqual(['--custom', '--mute-audio']);
  });

  it('preserves explicit environment values in the Linux hardware profile', () => {
    const profile = createChromiumLaunchProfile({
      gpuMode: 'linux-hardware-vulkan',
      env: { EGL_PLATFORM: 'device', TEST_SENTINEL: 'retained' },
    });
    expect(profile.env).toEqual(
      expect.objectContaining({ EGL_PLATFORM: 'device', TEST_SENTINEL: 'retained' }),
    );
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
      args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--mute-audio'],
    });
  });
});
