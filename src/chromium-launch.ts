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
  args: string[];
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
 * Builds the shared Chromium renderer and silence profile without deciding
 * whether the browser is headed. Callers own that explicit choice.
 */
export function createChromiumLaunchProfile(
  options: ChromiumLaunchProfileOptions = {},
): ChromiumLaunchProfile {
  const gpuMode = options.gpuMode ?? 'auto';
  const args = [
    ...new Set(
      [...GPU_ARGS[gpuMode], ...(options.args ?? [])].filter(
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
