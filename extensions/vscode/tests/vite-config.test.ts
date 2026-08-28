import { make_config } from 'svelte-widgets/vite-config'
import { expect, test } from 'vitest'

// vite.config.ts takes its cssTarget from this shared config, so the two builds cannot drift
// apart again — what is left to guard is the shared value itself. A target without native
// light-dark() makes LightningCSS downlevel app.css's theme tokens into an OS-preference
// polyfill that ignores the color-scheme the webview declares from VS Code's theme.
// (vite.config.ts is not imported here: it sits outside tsconfig's `include` and its
// pre-existing `.ts`-extension imports would fail `tsc --noEmit` from this file.)
test(`shared cssTarget keeps native light-dark()`, () => {
  expect(make_config().build.cssTarget).toBe(`esnext`)
})
