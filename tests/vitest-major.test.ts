import { afterEach, describe, expect, it, vi } from 'vitest';

describe('vitestMajor', () => {
  afterEach(() => {
    vi.doUnmock('vitest/node');
    vi.resetModules();
  });

  async function majorOf(version: string) {
    vi.doMock('vitest/node', () => ({ version }));
    const { vitestMajor } = await import('../src/vitest-major.js');
    return vitestMajor;
  }

  it('reads the major from the installed Vitest', async () => {
    expect((await majorOf('5.0.3'))()).toBe(5);
    vi.resetModules();
    expect((await majorOf('4.1.10'))()).toBe(4);
  });

  it('refuses a version it cannot read rather than guessing where options go', async () => {
    const vitestMajor = await majorOf('next');
    expect(() => vitestMajor()).toThrow(/unrecognised Vitest version: next/);
  });
});
