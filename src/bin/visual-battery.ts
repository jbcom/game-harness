#!/usr/bin/env node
import { runVisualBattery, VisualBatteryError } from '../visual-battery.js';

const args = process.argv.slice(2);
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
