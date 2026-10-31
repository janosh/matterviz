// The private viewer the agent CLIs (movie, snapshot) drive: a Vite dev server on this
// checkout, unless `url` names a running one, and Chromium with a GPU adapter.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { CHROMIUM_GPU_ARGS } from './chromium-args.mjs'

const root = fileURLToPath(new URL(`../../`, import.meta.url))

export async function start_viewer({ url, headed, viewport, color_scheme }) {
  let server
  let browser
  try {
    if (!url) {
      // SvelteKit resolves its configuration from cwd, even with an explicit Vite root, so
      // callers resolve their input and output paths before this.
      process.chdir(root)
      const { createServer } = await import(`vite`)
      server = await createServer({
        root,
        logLevel: `silent`,
        cacheDir: `.svelte-kit/agent-vite`,
        server: { host: `127.0.0.1`, port: 0, open: false },
      })
      await server.listen()
      const address = server.httpServer?.address()
      if (!address || typeof address === `string`)
        throw new Error(`Viewer server did not start`)
      url = `http://127.0.0.1:${address.port}`
    }
    browser = await chromium.launch({
      channel: `chromium`,
      headless: !headed,
      args: CHROMIUM_GPU_ARGS,
    })
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: 1,
      colorScheme: color_scheme,
    })
    return { url: url.replace(/\/$/, ``), browser, page, server }
  } catch (error) {
    // the caller never receives these handles, so it cannot close them
    await browser?.close()
    await server?.close()
    throw error
  }
}
