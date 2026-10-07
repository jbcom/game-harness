/** Browser renderer policy for agent-controlled Chromium sessions. */
export type ChromiumGpuMode = 'auto' | 'software' | 'linux-hardware-vulkan';
export type ChromiumEnvironment = Record<string, string | undefined>;

export interface ChromiumLaunchProfileOptions {
  /**
   * `auto` leaves renderer selection to Chromium (Metal on macOS, the native
   * desktop stack elsewhere). `software` opts into SwiftShader explicitly.
   * `linux-hardware-vulkan` is a proven Mesa/ANGLE profile for a
   * Linux runner with `/dev/dri/renderD128` passed through.
   */
  gpuMode?: ChromiumGpuMode;
  /** Additional Chromium arguments, de-duplicated ahead of `--mute-audio`. */
  args?: readonly string[];
  /** Environment additions. The Linux hardware profile also sets `EGL_PLATFORM=surfaceless`. */
  env?: Readonly<ChromiumEnvironment>;
}

export interface ChromiumLaunchProfile {
  /**
   * De-duplicated Chromium launch arguments: the `gpuMode` renderer flags, the
   * {@link CHROMIUM_ANTI_THROTTLING_ARGS}, any caller `args`, and always
   * `--mute-audio` last.
   */
  args: string[];
  /** Present when `env` overrides were supplied or `gpuMode` is `linux-hardware-vulkan` (which also sets `EGL_PLATFORM`); merged on top of `process.env`. */
  env?: ChromiumEnvironment;
}

const GPU_ARGS: Readonly<Record<ChromiumGpuMode, readonly string[]>> = {
  auto: [],
  software: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  'linux-hardware-vulkan': [
    '--use-gpu-in-tests',
    '--use-gl=angle',
    '--use-angle=vulkan',
    '--ignore-gpu-blocklist',
  ],
};

/**
 * Keeps timers and rendering on schedule in pages Chromium considers
 * backgrounded. Several headed windows commonly run at once during a test
 * suite; without these switches a background tab's timers are coalesced to
 * one wake-up per second, and an occluded window or backgrounded renderer is
 * deprioritised, so suites time out for reasons unrelated to the game.
 * Page Visibility still reports `hidden`, so visibility handling stays
 * testable.
 */
export const CHROMIUM_ANTI_THROTTLING_ARGS: readonly string[] = Object.freeze([
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]);

/**
 * Builds the shared Chromium renderer, scheduling and silence profile without
 * deciding whether the browser is headed. Callers own that explicit choice.
 */
export function createChromiumLaunchProfile(
  options: ChromiumLaunchProfileOptions = {},
): ChromiumLaunchProfile {
  const gpuMode = options.gpuMode ?? 'auto';
  const args = [
    ...new Set(
      [...GPU_ARGS[gpuMode], ...CHROMIUM_ANTI_THROTTLING_ARGS, ...(options.args ?? [])].filter(
        (argument) => argument !== '--mute-audio',
      ),
    ),
    '--mute-audio',
  ];

  if (gpuMode === 'linux-hardware-vulkan') {
    return {
      args,
      env: {
        ...process.env,
        ...options.env,
        EGL_PLATFORM: options.env?.EGL_PLATFORM ?? 'surfaceless',
      },
    };
  }
  if (options.env) return { args, env: { ...process.env, ...options.env } };
  return { args };
}
