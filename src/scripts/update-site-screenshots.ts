// deno-lint-ignore-file no-await-in-loop no-process-global
// Run: npx tsx src/scripts/update-site-screenshots.ts
// Requires: pnpm dev (server on port 3000), brew install webp (for cwebp)

import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'

const exec_file_async = promisify(execFile)
const PORT = process.env.PORT || 3000

// Derive default RELEASE_TAG from package.json version
const pkg_json = JSON.parse(await readFile(`package.json`, `utf-8`))
const RELEASE_TAG = process.env.RELEASE_TAG || `v${pkg_json.version}`
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
    // Use text selector for stability - won't break if dropdown order changes
    actions: [[`click`, `input[placeholder="Select a heatmap"]`], [
      `click`,
      `ul.options li:has-text("Atomic Mass")`,
    ]],
    wait: 1500,
  },
  { url: `/structure?file=Bi2Zr2O8-Fm3m.json`, name: `structure-viewer`, wait: 3000 },
  { url: `/gold`, name: `details-page`, wait: 1000 },
]

await mkdir(output_dir, { recursive: true })
const browser = await chromium.launch()
const output_paths: string[] = []

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
    const locator = page.locator(selector)
    await locator.waitFor({ timeout: 10000 })
    if (action === `click`) await locator.click()
    else await locator.hover()
    await page.waitForTimeout(300)
  }
  if (wait) await page.waitForTimeout(wait)

  const png_path = `${output_dir}/${today}-${name}.png`
  const webp_path = `${output_dir}/${today}-${name}.webp`
  await page.screenshot({ path: png_path })
  await page.close()
  await context.close()

  try {
    await exec_file_async(`cwebp`, [`-q`, `85`, png_path, `-o`, webp_path])
    await unlink(png_path)
    output_paths.push(webp_path)
  } catch (err) {
    console.warn(
      `  cwebp failed, keeping PNG: ${err instanceof Error ? err.message : err}`,
    )
    output_paths.push(png_path) // keep PNG if cwebp unavailable
  }
  console.log(`  -> ${output_paths.at(-1)}`)
}

await browser.close()
console.log(`\nSaved to: ${output_dir}`)

try { // Upload to GitHub release
  await exec_file_async(`gh`, [
    `release`,
    `upload`,
    RELEASE_TAG,
    ...output_paths,
    `--repo`,
    `janosh/matterviz`,
    `--clobber`,
  ])
  console.log(`\nUploaded to ${RELEASE_TAG}. README URLs:`)
  for (const path of output_paths) {
    const file = basename(path)
    console.log(
      `![${file}](https://github.com/janosh/matterviz/releases/download/${RELEASE_TAG}/${file})`,
    )
  }
} catch (err) {
  console.warn(`\nUpload failed: ${err instanceof Error ? err.message : err}`)
  console.log(
    `Run manually:\ngh release upload ${RELEASE_TAG} ${output_paths.join(` `)} --clobber`,
  )
}
