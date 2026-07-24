import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetSilentQaForTests,
  activateSilentQa,
  isSilentQaActive,
  isSilentQaRequested,
  SILENT_QA_MARKER_ATTRIBUTE,
  SILENT_QA_MARKER_VALUE,
} from '../src/silent-qa.js';

describe('application-side silent QA', () => {
  afterEach(() => {
    _resetSilentQaForTests();
    vi.unstubAllGlobals();
  });

  it('recognizes the fleet query by presence, including stale false-like values', () => {
    expect(isSilentQaRequested('?fixture=title&muted=1')).toBe(true);
    expect(isSilentQaRequested('?muted=0')).toBe(true);
    expect(isSilentQaRequested('?fixture=title')).toBe(false);
  });

  it('mutes before publishing the fail-closed runtime marker', () => {
    const events: string[] = [];
    const markerTarget = {
      setAttribute(name: string, value: string) {
        events.push(`marker:${name}=${value}`);
      },
    };

    expect(
      activateSilentQa(() => events.push('mute'), {
        search: '?muted=1',
        markerTarget,
      }),
    ).toBe(true);
    expect(events).toEqual([
      'mute',
      `marker:${SILENT_QA_MARKER_ATTRIBUTE}=${SILENT_QA_MARKER_VALUE}`,
    ]);
    expect(isSilentQaActive()).toBe(true);
  });

  it('does not publish readiness when the consumer mute callback fails', () => {
    const markerTarget = { setAttribute: vi.fn() };

    expect(() =>
      activateSilentQa(
        () => {
          throw new Error('audio engine unavailable');
        },
        { search: '?muted=1', markerTarget },
      ),
    ).toThrow('audio engine unavailable');
    expect(markerTarget.setAttribute).not.toHaveBeenCalled();
    expect(isSilentQaActive()).toBe(false);
  });

  it('leaves normal player sessions and persisted preferences to the consumer', () => {
    const mute = vi.fn();
    const markerTarget = { setAttribute: vi.fn() };

    expect(activateSilentQa(mute, { search: '?fixture=title', markerTarget })).toBe(false);
    expect(mute).not.toHaveBeenCalled();
    expect(markerTarget.setAttribute).not.toHaveBeenCalled();
    expect(isSilentQaActive()).toBe(false);
  });

  it('supports a legacy query and marker adapter without a framework dependency', () => {
    const setAttribute = vi.fn();

    expect(
      activateSilentQa(vi.fn(), {
        search: '?silent=yes',
        queryParameter: 'silent',
        markerTarget: { setAttribute },
        markerAttribute: 'data-silent',
        markerValue: 'ready',
      }),
    ).toBe(true);
    expect(setAttribute).toHaveBeenCalledWith('data-silent', 'ready');
  });
});
