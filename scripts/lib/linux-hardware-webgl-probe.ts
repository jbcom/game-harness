const ANGLE_VULKAN_ARGS = Object.freeze([
  '--use-gpu-in-tests',
  '--use-gl=angle',
  '--use-angle=vulkan',
  '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--mute-audio',
] as const);

export interface LinuxHardwareWebGLProbeRow {
  readonly id: 'baseline' | 'angle-vulkan-no-egl' | 'angle-vulkan-surfaceless';
  readonly args: readonly string[];
  readonly eglPlatform: 'surfaceless' | undefined;
  /** Matches production-runtime when a consumer does not supply browserLaunchOptions.headless. */
  readonly headless: false;
}

export interface LinuxHardwareWebGLProbeResult {
  readonly context: 'webgl2' | null;
  readonly isContextLost: boolean;
  readonly error: number | null;
  readonly renderer: string;
  readonly unmasked: boolean;
  readonly pixel: readonly number[];
}

const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|software rasterizer|microsoft basic render driver|angle.*(?:warp|software)/i;

/**
 * Fresh-browser launch rows for the Linux GPU canary. The first row mirrors
 * the known-good plain Playwright launch; the second and third isolate the
 * ANGLE/Vulkan flags from the profile's EGL_PLATFORM=surfaceless override.
 */
export const LINUX_HARDWARE_WEBGL_PROBE_ROWS: readonly LinuxHardwareWebGLProbeRow[] = Object.freeze(
  [
    Object.freeze({
      id: 'baseline',
      args: Object.freeze(['--mute-audio']),
      eglPlatform: undefined,
      headless: false,
    }),
    Object.freeze({
      id: 'angle-vulkan-no-egl',
      args: ANGLE_VULKAN_ARGS,
      eglPlatform: undefined,
      headless: false,
    }),
    Object.freeze({
      id: 'angle-vulkan-surfaceless',
      args: ANGLE_VULKAN_ARGS,
      eglPlatform: 'surfaceless',
      headless: false,
    }),
  ],
);

/**
 * Makes each row independent of any outer EGL_PLATFORM so the canary can
 * attribute a lost context to the selected row rather than inherited state.
 */
export function launchOptionsForLinuxHardwareWebGLProbe(
  row: LinuxHardwareWebGLProbeRow,
  environment: NodeJS.ProcessEnv = process.env,
): { args: string[]; env: NodeJS.ProcessEnv; headless: false } {
  const env = { ...environment };
  if (row.eglPlatform === undefined) delete env.EGL_PLATFORM;
  else env.EGL_PLATFORM = row.eglPlatform;
  return { args: [...row.args], env, headless: row.headless };
}

/**
 * Keeps diagnostic output to declared renderer settings; the actual Chromium
 * argv comes from DEBUG=pw:browser because a launch environment can carry CI secrets.
 */
export function launchEvidenceForLinuxHardwareWebGLProbe(row: LinuxHardwareWebGLProbeRow): {
  args: string[];
  eglPlatform: 'surfaceless' | undefined;
  headless: false;
} {
  return {
    args: [...row.args],
    eglPlatform: row.eglPlatform,
    headless: row.headless,
  };
}

/** Requires a real GPU renderer after the fixture completes its draw/readback cycle. */
export function isHardwareWebGLProbeResultHealthy(result: LinuxHardwareWebGLProbeResult): boolean {
  return (
    result.context === 'webgl2' &&
    result.isContextLost === false &&
    result.error === null &&
    result.unmasked === true &&
    result.renderer.trim().length > 0 &&
    !SOFTWARE_RENDERER_PATTERN.test(result.renderer) &&
    result.pixel.slice(0, 3).some((channel) => channel !== 0)
  );
}
