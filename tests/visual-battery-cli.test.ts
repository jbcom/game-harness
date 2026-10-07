import { afterEach, expect, it, vi } from 'vitest';
import { runVisualBattery } from '../src/visual-battery.js';

vi.mock('../src/visual-battery.js', () => ({
  runVisualBattery: vi.fn(),
  VisualBatteryError: class extends Error {},
}));

const originalArgs = process.argv;
afterEach(() => {
  process.argv = originalArgs;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function invoke(args: string[]): Promise<void> {
  vi.resetModules();
  process.argv = ['node', 'visual-battery', ...args];
  await import('../src/bin/visual-battery.js');
}

it('passes both threshold flags to the API', async () => {
  await invoke([
    'harness',
    '--ci',
    '--max-channel-delta',
    '0',
    '--max-different-pixel-ratio',
    '0.01',
  ]);
  expect(runVisualBattery).toHaveBeenCalledWith('harness', {
    ci: true,
    maxChannelDelta: 0,
    maxDifferentPixelRatio: 0.01,
  });
});

it.each([
  ['--max-channel-delta'],
  ['--max-channel-delta', 'wat'],
  ['--max-different-pixel-ratio', 'Infinity'],
])('rejects missing or nonnumeric thresholds: %j', async (...args) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit');
  });
  await expect(invoke(args)).rejects.toThrow('exit');
  expect(process.exit).toHaveBeenCalledWith(2);
  expect(runVisualBattery).not.toHaveBeenCalled();
});
