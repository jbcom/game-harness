import { describe, expect, it } from 'vitest';
import { lighthouseAssertions } from '../src/lighthouse.js';

describe('lighthouseAssertions', () => {
  it('returns the game-default preset matching production lighthouserc.json', () => {
    const config = lighthouseAssertions('game-default');
    expect(config.ci.collect.staticDistDir).toBe('./dist');
    expect(config.ci.collect.url).toEqual(['http://localhost/index.html']);
    expect(config.ci.collect.numberOfRuns).toBe(3);
    expect(config.ci.collect.settings.preset).toBe('desktop');
    expect(config.ci.assert.preset).toBe('lighthouse:no-pwa');
    expect(config.ci.assert.assertions['categories:performance']).toEqual([
      'warn',
      { minScore: 0.6 },
    ]);
    expect(config.ci.assert.assertions['categories:accessibility']).toEqual([
      'warn',
      { minScore: 0.85 },
    ]);
    expect(config.ci.assert.assertions['categories:best-practices']).toEqual([
      'warn',
      { minScore: 0.7 },
    ]);
    expect(config.ci.assert.assertions['categories:seo']).toBe('off');
    expect(config.ci.upload.target).toBe('temporary-public-storage');
  });

  it('defaults to game-default when no preset name given', () => {
    const withDefault = lighthouseAssertions();
    const explicit = lighthouseAssertions('game-default');
    expect(withDefault).toEqual(explicit);
  });

  it('throws on an unknown preset name', () => {
    expect(() => lighthouseAssertions('does-not-exist')).toThrow(/unknown lighthouse preset/);
  });

  it('merges assertion overrides on top of the preset', () => {
    const config = lighthouseAssertions('game-default', {
      assertions: { 'categories:performance': ['error', { minScore: 0.9 }] },
    });
    expect(config.ci.assert.assertions['categories:performance']).toEqual([
      'error',
      { minScore: 0.9 },
    ]);
    // untouched assertions survive
    expect(config.ci.assert.assertions['categories:accessibility']).toEqual([
      'warn',
      { minScore: 0.85 },
    ]);
  });

  it('overrides staticDistDir/url/numberOfRuns when provided', () => {
    const config = lighthouseAssertions('game-default', {
      staticDistDir: './build',
      url: ['http://localhost/game.html'],
      numberOfRuns: 5,
    });
    expect(config.ci.collect.staticDistDir).toBe('./build');
    expect(config.ci.collect.url).toEqual(['http://localhost/game.html']);
    expect(config.ci.collect.numberOfRuns).toBe(5);
  });

  it('returns independent preset data on every call', () => {
    const first = lighthouseAssertions();
    first.ci.collect.url.push('http://localhost/mutated');
    first.ci.collect.settings.chromeFlags = '--mutated';
    (first.ci.assert.assertions['categories:performance'] as unknown[]).push('mutated');
    first.ci.upload.target = 'mutated';

    const second = lighthouseAssertions();
    expect(second.ci.collect.url).toEqual(['http://localhost/index.html']);
    expect(second.ci.collect.settings.chromeFlags).not.toBe('--mutated');
    expect(second.ci.assert.assertions['categories:performance']).toEqual([
      'warn',
      { minScore: 0.6 },
    ]);
    expect(second.ci.upload.target).toBe('temporary-public-storage');
  });

  it('rejects configurations that cannot collect a meaningful run', () => {
    expect(() => lighthouseAssertions('game-default', { staticDistDir: '  ' })).toThrow(
      /staticDistDir/,
    );
    expect(() => lighthouseAssertions('game-default', { url: [] })).toThrow(/url/);
    expect(() => lighthouseAssertions('game-default', { url: [''] })).toThrow(/url/);
    expect(() => lighthouseAssertions('game-default', { numberOfRuns: 0 })).toThrow(/numberOfRuns/);
    expect(() => lighthouseAssertions('game-default', { numberOfRuns: 1.5 })).toThrow(
      /numberOfRuns/,
    );
  });
});
