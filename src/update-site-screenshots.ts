// deno-lint-ignore-file no-await-in-loop
import puppeteer from 'npm:puppeteer'

// to run this script: deno run --allow-all src/update-site-screenshots.ts
// requires brew install deno

const today = new Date().toISOString().slice(0, 10)

const pages = [
  { url: `/`, name: `landing-page`, actions: [[`hover`, `a[href*="selenium"]`]] },
  {
    url: `/`,
    name: `heatmap`,
    actions: [
      [`click`, `input[placeholder="Select a heat map"]`],
      [`click`, `ul.options > li:nth-child(2)`],
      [`click`, `h1`], // close dropdown
      [`hover`, `a[href*="radon"]`],
    ],
  },
  { url: `/radon`, name: `details-page`, actions: [] },
] as const

const browser = await puppeteer.launch()

for (const { url, name, actions } of pages) {
  console.log(name)
  const page = await browser.newPage()
  // increase screenshot resolution
  await page.setViewport({ width: 1200, height: 700, deviceScaleFactor: 3 })

  await page.goto(`http://localhost:3000${url}`, { waitUntil: `networkidle2` })
  for (const [action, selector] of actions) {
    await page.waitForSelector(selector)
    await page[action](selector)
  }
  await page.screenshot({ path: `static/${today}-${name}.webp` })
}

await browser.close()
