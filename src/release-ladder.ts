export interface ReleaseLadderStep {
  /** Label logged before/after the step runs and used to identify it in a failure result. */
  name: string;
  /** The step's work. A thrown error or rejected promise stops the ladder at this step. */
  run: () => void | Promise<void>;
}

export interface ReleaseLadderResult {
  /** True only if every step completed without throwing. */
  ok: boolean;
  /** Names of steps that completed successfully, in order, up to (and excluding) any failure. */
  ranSteps: string[];
  /** Name of the step that threw, present only when `ok` is false. */
  failedStep?: string;
  /** The value thrown by `failedStep`'s `run()`, present only when `ok` is false. */
  error?: unknown;
}

export interface VerifyReleaseLadderOptions {
  /** Called before and after each step. Defaults to `console.log` prefixed with `[verify]`. */
  log?: (msg: string) => void;
  /** Called on step failure, once for the failure message and again with the error's message if it's an `Error`. Defaults to `console.error` prefixed with `[verify]`. */
  error?: (msg: string) => void;
}

/**
 * Thin orchestrator for a `verify:*` release ladder — an ordered list of
 * named steps (lint → typecheck → test → build → browser verifies →
 * screenshots → native sync, or whatever a given repo's ladder is), run in
 * sequence and stopped at the first failure with a labeled summary.
 *
 * Generalizes the reach-for-the-sky pattern of ~17 discrete
 * `node scripts/verify-X.mjs` files composed via a shell `&&` chain into a
 * single reusable primitive: each step is a plain function (sync or async),
 * so a repo can inline its logic or delegate to existing scripts via
 * `execSync`.
 *
 * Never throws — returns a result object so callers can decide how to
 * report/exit. The CLI convention is `process.exit(result.ok ? 0 : 1)`.
 */
export async function verifyReleaseLadder(
  steps: ReleaseLadderStep[],
  options: VerifyReleaseLadderOptions = {},
): Promise<ReleaseLadderResult> {
  const log = options.log ?? ((msg: string) => console.log(`[verify] ${msg}`));
  const error = options.error ?? ((msg: string) => console.error(`[verify] ${msg}`));

  const ranSteps: string[] = [];

  for (const step of steps) {
    log(`▶ ${step.name}`);
    try {
      await step.run();
      ranSteps.push(step.name);
      log(`✓ ${step.name}`);
    } catch (err) {
      error(`✗ ${step.name} failed`);
      if (err instanceof Error) {
        error(err.message);
      }
      return { ok: false, ranSteps, failedStep: step.name, error: err };
    }
  }

  log(`all ${ranSteps.length} step(s) passed.`);
  return { ok: true, ranSteps };
}
