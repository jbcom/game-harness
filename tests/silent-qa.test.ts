import type { Page, Response } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

const playwrightMocks = vi.hoisted(() => ({
  toHaveAttribute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@playwright/test', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@playwright/test')>();
  return {
    ...actual,
    expect: vi.fn(() => ({ toHaveAttribute: playwrightMocks.toHaveAttribute })),
  };
});

import { openSilentGame, silentTestUrl } from '../src/playwright-config.js';

describe('silent browser QA', () => {
  it('adds the mute mode while preserving and overriding query values', () => {
    expect(
      silentTestUrl('/chonkers/?muted=0&seed=old#boss', {
        seed: 'new',
        passAndPlay: true,
        players: 2,
      }),
    ).toBe('/chonkers/?muted=1&seed=new&passAndPlay=true&players=2#boss');
  });

  it('supports absolute URLs and custom legacy mute query names', () => {
    expect(
      silentTestUrl(
        'https://game.example.test/play?seed=alpha',
        {},
        { muteQueryParameter: 'silent', muteQueryValue: 'yes' },
      ),
    ).toBe('https://game.example.test/play?seed=alpha&silent=yes');
  });

  it('navigates silently and verifies the runtime marker before returning', async () => {
    const response = {} as Response;
    const locator = { name: 'html-locator' };
    const page = {
      goto: vi.fn().mockResolvedValue(response),
      locator: vi.fn().mockReturnValue(locator),
    } as unknown as Page;

    await expect(openSilentGame(page, '/chonkers/#play', { scenario: 'new-game' })).resolves.toBe(
      response,
    );
    expect(page.goto).toHaveBeenCalledWith('/chonkers/?scenario=new-game&muted=1#play', undefined);
    expect(page.locator).toHaveBeenCalledWith('html');
    expect(playwrightMocks.toHaveAttribute).toHaveBeenCalledWith('data-audio-mode', 'muted-test', {
      timeout: 5_000,
    });
  });

  it('supports a custom marker and navigation options for legacy adapters', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(null),
      locator: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await openSilentGame(
      page,
      './',
      {},
      {
        markerSelector: '[data-test-root]',
        markerAttribute: 'data-silent',
        markerValue: 'ready',
        markerTimeout: 10_000,
        navigationOptions: { waitUntil: 'domcontentloaded' },
      },
    );

    expect(page.goto).toHaveBeenCalledWith('./?muted=1', {
      waitUntil: 'domcontentloaded',
    });
    expect(page.locator).toHaveBeenCalledWith('[data-test-root]');
    expect(playwrightMocks.toHaveAttribute).toHaveBeenCalledWith('data-silent', 'ready', {
      timeout: 10_000,
    });
  });

  it('applies a custom mute query parameter and value when navigating', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(null),
      locator: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await openSilentGame(page, '/chonkers/', {}, { muteQueryParameter: 'silent' });
    expect(page.goto).toHaveBeenCalledWith('/chonkers/?silent=1', undefined);

    await openSilentGame(page, '/chonkers/', {}, { muteQueryValue: 'yes' });
    expect(page.goto).toHaveBeenCalledWith('/chonkers/?muted=yes', undefined);
  });
});
