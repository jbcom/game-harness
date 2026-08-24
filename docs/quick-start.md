---
title: Quick start
description: Wire up the silent runtime marker and your first Playwright config.
---

Activate the runtime-only mute before the application restores saved audio
preferences or creates anything that can play sound:

```ts
// src/silent-qa.ts
import { activateSilentQa } from '@jbdevprimary/game-harness/silent-qa';
import { Howler } from 'howler';

export const silentQaActive = activateSilentQa(() => Howler.mute(true));
```

Then use the shared Playwright config and open the game through the
fail-closed navigation helper:

```ts
// playwright.config.ts
import { definePlaywrightConfig } from '@jbdevprimary/game-harness/playwright';

export default definePlaywrightConfig({
  port: 4391,
  webServerCommand: (port) =>
    `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
});
```

```ts
// tests/e2e/boot.spec.ts
import { expect, test } from '@playwright/test';
import { openSilentGame } from '@jbdevprimary/game-harness/playwright';

test('boots the intended game silently', async ({ page }) => {
  await openSilentGame(page, '/my-game/', { scenario: 'new-game' });
  await expect(page.getByRole('heading', { name: 'My Game' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
});
```

The application marker is part of the contract: `openSilentGame()` does not
return until `<html data-audio-mode="muted-test">` exists.

Continue to [Entry points](/game-harness/entry-points/) for the full map of
subpath exports, or jump straight to the [Playwright guide](/game-harness/guides/playwright/).
