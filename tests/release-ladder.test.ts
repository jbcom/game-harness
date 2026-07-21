import { describe, expect, it } from 'vitest';
import { verifyReleaseLadder } from '../src/release-ladder.js';

const noop = (): void => undefined;
const quiet = { log: noop, error: noop };

describe('verifyReleaseLadder', () => {
  it('runs all steps in order and reports ok on full success', async () => {
    const ran: string[] = [];
    const result = await verifyReleaseLadder(
      [
        {
          name: 'lint',
          run: () => {
            ran.push('lint');
          },
        },
        {
          name: 'test',
          run: () => {
            ran.push('test');
          },
        },
        {
          name: 'build',
          run: () => {
            ran.push('build');
          },
        },
      ],
      quiet,
    );

    expect(ran).toEqual(['lint', 'test', 'build']);
    expect(result).toEqual({ ok: true, ranSteps: ['lint', 'test', 'build'] });
  });

  it('stops at the first failing step and does not run subsequent steps', async () => {
    const ran: string[] = [];
    const result = await verifyReleaseLadder(
      [
        {
          name: 'lint',
          run: () => {
            ran.push('lint');
          },
        },
        {
          name: 'test',
          run: () => {
            throw new Error('boom');
          },
        },
        {
          name: 'build',
          run: () => {
            ran.push('build');
          },
        },
      ],
      quiet,
    );

    expect(ran).toEqual(['lint']);
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('test');
    expect(result.ranSteps).toEqual(['lint']);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('supports async steps', async () => {
    const ran: string[] = [];
    const result = await verifyReleaseLadder(
      [
        {
          name: 'async-step',
          run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            ran.push('async-step');
          },
        },
      ],
      quiet,
    );

    expect(ran).toEqual(['async-step']);
    expect(result.ok).toBe(true);
  });

  it('returns ok:true with an empty ranSteps for an empty ladder', async () => {
    const result = await verifyReleaseLadder([], quiet);
    expect(result).toEqual({ ok: true, ranSteps: [] });
  });

  it('catches async rejections the same as sync throws', async () => {
    const result = await verifyReleaseLadder(
      [
        {
          name: 'rejects',
          run: async () => {
            throw new Error('async boom');
          },
        },
      ],
      quiet,
    );

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('rejects');
  });
});
