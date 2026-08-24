#!/usr/bin/env node
import { runVisualBattery, VisualBatteryError } from '../visual-battery.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: game-harness-visual-battery [harness-directory] [--ci]

Runs the configured Vitest browser harness and fails when committed screenshot
baselines drift. --ci also refuses to start from a dirty baseline directory.

Arguments:
  harness-directory  Directory containing *.browser.test.ts(x) files
                     (default: tests/harness)

Options:
  --ci                Fail on drift and refuse a dirty starting state
  -h, --help          Show this help

The legacy executable name test-harness-visual-battery remains available.`);
  process.exit(0);
}

const unknownFlags = args.filter((argument) => argument.startsWith('-') && argument !== '--ci');
if (unknownFlags.length > 0) {
  console.error(`Unknown option(s): ${unknownFlags.join(', ')}. Use --help for usage.`);
  process.exit(2);
}

const positionalArgs = args.filter((argument) => !argument.startsWith('-'));
if (positionalArgs.length > 1) {
  console.error('Expected at most one harness-directory. Use --help for usage.');
  process.exit(2);
}

const ci = args.includes('--ci');
const harnessDirArg = positionalArgs[0] ?? 'tests/harness';

try {
  runVisualBattery(harnessDirArg, { ci });
} catch (err) {
  if (err instanceof VisualBatteryError) {
    process.exit(1);
  }
  throw err;
}
