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
});
