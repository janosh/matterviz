// deno-lint-ignore-file no-await-in-loop no-process-global
// Run: npx tsx src/scripts/update-site-screenshots.ts
// Requires: pnpm dev (server on port 3000), brew install webp (for cwebp)

import { chromium } from '@playwright/test'
import { exec } from 'node:child_process'
import { mkdir, unlink } from 'node:fs/promises'
import { promisify } from 'node:util'

const exec_async = promisify(exec)
const PORT = process.env.PORT || 3000
const RELEASE_TAG = process.env.RELEASE_TAG || `v0.2.2`
const today = new Date().toISOString().slice(0, 10)
const output_dir = `/tmp/matterviz-screenshots`

type PageConfig = {
  url: string
  name: string
  actions?: [`click` | `hover`, string][]
  wait?: number
  scroll?: number
}

const pages: PageConfig[] = [
  { url: `/`, name: `landing-page`, wait: 3000, scroll: 100 },
  {
    url: `/periodic-table`,
    name: `heatmap`,
    actions: [[`click`, `input[placeholder="Select a heatmap"]`], [
      `click`,
      `ul.options li:nth-child(2)`,
    ]],
    wait: 1500,
  },
  { url: `/structure?file=Bi2Zr2O8-Fm3m.json`, name: `structure-viewer`, wait: 3000 },
  { url: `/gold`, name: `details-page`, wait: 1000 },
]

await mkdir(output_dir, { recursive: true })
const browser = await chromium.launch()
const webp_paths: string[] = []

for (const { url, name, actions, wait, scroll = 200 } of pages) {
  console.log(`Capturing: ${name}`)
  const context = await browser.newContext({
    viewport: { width: 1200, height: 700 },
    deviceScaleFactor: 3,
  })
  const page = await context.newPage()

  await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: `networkidle` })
  await page.evaluate((px) => globalThis.scrollBy(0, px), scroll)
  await page.waitForTimeout(300)

  for (const [action, selector] of actions ?? []) {
    await page.waitForSelector(selector, { timeout: 10000 })
    if (action === `click`) await page.click(selector)
    else await page.hover(selector)
    await page.waitForTimeout(300)
  }
  if (wait) await page.waitForTimeout(wait)

  const png_path = `${output_dir}/${today}-${name}.png`
  const webp_path = `${output_dir}/${today}-${name}.webp`
  await page.screenshot({ path: png_path })
  await context.close()

  try {
    await exec_async(`cwebp -q 85 "${png_path}" -o "${webp_path}"`)
    await unlink(png_path)
    webp_paths.push(webp_path)
  } catch (err) {
    console.warn(
      `  cwebp failed, keeping PNG: ${err instanceof Error ? err.message : err}`,
    )
    webp_paths.push(png_path) // keep PNG if cwebp unavailable
  }
  console.log(`  -> ${webp_paths.at(-1)}`)
}

await browser.close()
console.log(`\nSaved to: ${output_dir}`)

// Upload to GitHub release
try {
  await exec_async(
    `gh release upload ${RELEASE_TAG} ${
      webp_paths.join(` `)
    } --repo janosh/matterviz --clobber`,
  )
  console.log(`\nUploaded to ${RELEASE_TAG}. README URLs:`)
  for (const path of webp_paths) {
    const file = path.split(`/`).pop()
    console.log(
      `![${file}](https://github.com/janosh/matterviz/releases/download/${RELEASE_TAG}/${file})`,
    )
  }
} catch (err) {
  console.warn(`\nUpload failed: ${err instanceof Error ? err.message : err}`)
  console.log(
    `Run manually:\ngh release upload ${RELEASE_TAG} ${webp_paths.join(` `)} --clobber`,
  )
}
