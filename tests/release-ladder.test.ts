import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyReleaseLadder } from '../src/release-ladder.js';

const noop = (): void => undefined;
const quiet = { log: noop, error: noop };

describe('verifyReleaseLadder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to console.log/console.error when no logger is supplied', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await verifyReleaseLadder([{ name: 'lint', run: () => undefined }]);

    expect(result.ok).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('lint'));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs a failure through the default console.error when no logger is supplied', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await verifyReleaseLadder([
      {
        name: 'test',
        run: () => {
          throw new Error('boom');
        },
      },
    ]);

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('test'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('reports a failed step even when the thrown value is not an Error instance', async () => {
    const result = await verifyReleaseLadder(
      [
        {
          name: 'lint',
          run: () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'a plain string failure';
          },
        },
      ],
      quiet,
    );

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('lint');
    expect(result.error).toBe('a plain string failure');
  });

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
