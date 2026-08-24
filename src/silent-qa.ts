export const SILENT_QA_QUERY_PARAMETER = 'muted';
export const SILENT_QA_QUERY_VALUE = '1';
export const SILENT_QA_MARKER_ATTRIBUTE = 'data-audio-mode';
export const SILENT_QA_MARKER_VALUE = 'muted-test';

export interface SilentQaMarkerTarget {
  setAttribute(name: string, value: string): void;
}

export interface ActivateSilentQaOptions {
  /** Query string to inspect. Defaults to `window.location.search` in a browser. */
  search?: string;
  /** Runtime-only mute parameter. Defaults to `muted`. */
  queryParameter?: string;
  /**
   * Element that owns the mute-ready marker. Defaults to `document.documentElement`.
   * Pass `null` for a non-DOM runtime.
   */
  markerTarget?: SilentQaMarkerTarget | null;
  /** Marker attribute set only after the audio engine's mute callback succeeds. */
  markerAttribute?: string;
  /** Marker value set only after the audio engine's mute callback succeeds. */
  markerValue?: string;
}

let silentQaActive = false;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function browserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

function browserMarkerTarget(): SilentQaMarkerTarget | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

/**
 * Detects a page-lifetime mute request by parameter presence.
 *
 * The value is intentionally ignored so stale links such as `?muted=0` cannot
 * make an agent-controlled session audible.
 */
export function isSilentQaRequested(
  search = browserSearch(),
  queryParameter = SILENT_QA_QUERY_PARAMETER,
): boolean {
  return new URLSearchParams(search).has(queryParameter);
}

/**
 * Activates runtime-only silent QA through a consumer-owned audio mute callback.
 *
 * The package stays audio-engine agnostic: consumers may mute Howler, WebAudio,
 * HTMLMediaElement, or another engine. The DOM marker is published only after
 * the callback returns successfully, allowing browser tests to fail closed.
 * This helper never reads or writes a player's persisted audio preference.
 */
export function activateSilentQa(mute: () => void, options: ActivateSilentQaOptions = {}): boolean {
  if (
    !isSilentQaRequested(
      options.search ?? browserSearch(),
      options.queryParameter ?? SILENT_QA_QUERY_PARAMETER,
    )
  ) {
    return false;
  }

  const result: unknown = mute();
  if (isPromiseLike(result)) {
    throw new TypeError(
      'activateSilentQa received an asynchronous mute callback; await activateSilentQaAsync instead',
    );
  }
  const markerTarget =
    options.markerTarget === undefined ? browserMarkerTarget() : options.markerTarget;
  markerTarget?.setAttribute(
    options.markerAttribute ?? SILENT_QA_MARKER_ATTRIBUTE,
    options.markerValue ?? SILENT_QA_MARKER_VALUE,
  );
  silentQaActive = true;
  return true;
}

/**
 * Asynchronous counterpart to {@link activateSilentQa}. The readiness marker
 * is not published until the consumer's mute promise fulfills.
 */
export async function activateSilentQaAsync(
  mute: () => void | PromiseLike<void>,
  options: ActivateSilentQaOptions = {},
): Promise<boolean> {
  if (
    !isSilentQaRequested(
      options.search ?? browserSearch(),
      options.queryParameter ?? SILENT_QA_QUERY_PARAMETER,
    )
  ) {
    return false;
  }

  await mute();
  const markerTarget =
    options.markerTarget === undefined ? browserMarkerTarget() : options.markerTarget;
  markerTarget?.setAttribute(
    options.markerAttribute ?? SILENT_QA_MARKER_ATTRIBUTE,
    options.markerValue ?? SILENT_QA_MARKER_VALUE,
  );
  silentQaActive = true;
  return true;
}

/** True after this module has successfully activated the page-lifetime override. */
export function isSilentQaActive(): boolean {
  return silentQaActive;
}

/** Test hook; production code must never disable a page-lifetime override. */
export function _resetSilentQaForTests(): void {
  silentQaActive = false;
}
