/** Browser renderer policy for agent-controlled Chromium sessions. */
export type ChromiumGpuMode =
  'auto' | 'software' | 'linux-hardware-vulkan' | 'macos-hardware-metal';
export type ChromiumEnvironment = Record<string, string | undefined>;

export interface ChromiumLaunchProfileOptions {
  /**
   * `auto` leaves renderer selection to Chromium (Metal on macOS in a headed
   * window, the native desktop stack elsewhere). `software` opts into
   * SwiftShader explicitly.
   * `linux-hardware-vulkan` is a proven Mesa/ANGLE profile for a
   * Linux runner with `/dev/dri/renderD128` passed through.
   * `macos-hardware-metal` asks ANGLE for its Metal backend, which gives a
   * headless Chromium on an Apple Silicon Mac (no window session needed) the
   * real GPU instead of SwiftShader.
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

export interface AdmittedGpuModeOptions {
  /** Environment to read the heavy-slot contract from. Defaults to `process.env`. */
  env?: Readonly<ChromiumEnvironment>;
  /** Platform to admit against (`process.platform` values). Defaults to `process.platform`. */
  platform?: string;
}

/** The hardware GPU mode each admitted platform may request through `HEAVY_BROWSER_GPU`. */
const ADMITTED_HARDWARE_GPU: Readonly<Record<string, ChromiumGpuMode>> = {
  linux: 'linux-hardware-vulkan',
  darwin: 'macos-hardware-metal',
};

/**
 * Admits a hardware-GPU run from the heavy-slot environment contract and
 * returns the `ChromiumGpuMode` to launch with.
 *
 * A host is admitted only when `HEAVY_BROWSER_MUTE=1` and the platform
 * matches the requested hardware profile: `linux` with
 * `HEAVY_BROWSER_GPU=linux-hardware-vulkan`, or `darwin` with
 * `HEAVY_BROWSER_GPU=macos-hardware-metal`. Anything else throws, so a
 * hardware-gated suite can never fall back to a software renderer or run
 * audibly. The mute flag is checked first: an audible run is refused
 * whatever the platform.
 *
 * Admission is a launch-time gate only; use `requireHardwareWebGL()` from
 * `game-harness/production-runtime` in the journey to prove the renderer the
 * browser actually received.
 */
export function admittedGpuMode(options: AdmittedGpuModeOptions = {}): ChromiumGpuMode {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const gpu = env.HEAVY_BROWSER_GPU;

  if (env.HEAVY_BROWSER_MUTE !== '1') {
    throw new Error(
      `Hardware GPU runs must be muted: set HEAVY_BROWSER_MUTE=1 (got ${describeValue(env.HEAVY_BROWSER_MUTE)}).`,
    );
  }
  const admitted = ADMITTED_HARDWARE_GPU[platform];
  if (admitted === undefined || gpu !== admitted) {
    throw new Error(
      `This is not an admitted hardware GPU host: platform "${platform}" with HEAVY_BROWSER_GPU=${describeValue(gpu)}. ` +
        'Admitted hosts are linux with HEAVY_BROWSER_GPU="linux-hardware-vulkan" and darwin with HEAVY_BROWSER_GPU="macos-hardware-metal".',
    );
  }
  return admitted;
}

function describeValue(value: string | undefined): string {
  return value === undefined ? '<unset>' : JSON.stringify(value);
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
  'macos-hardware-metal': ['--use-angle=metal', '--ignore-gpu-blocklist'],
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
