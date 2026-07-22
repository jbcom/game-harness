#!/usr/bin/env node
import { runVisualBattery, VisualBatteryError } from '../visual-battery.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: test-harness-visual-battery [harness-directory] [--ci]

Runs the configured Vitest browser harness and fails when committed screenshot
baselines drift. --ci also refuses to start from a dirty baseline directory.`);
  process.exit(0);
}

const ci = args.includes('--ci');
const harnessDirArg = args.find((a) => !a.startsWith('--')) ?? 'tests/harness';

try {
  runVisualBattery(harnessDirArg, { ci });
} catch (err) {
  if (err instanceof VisualBatteryError) {
    process.exit(1);
  }
  throw err;
}
