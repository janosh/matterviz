import { expect, type Page, test } from '@playwright/test'
import { globSync } from 'node:fs'
import process from 'node:process'

// Payload budget per demo route: bytes and requests a visitor downloads on load plus scrolling
// to the bottom so every LazyDemo mounts. Catches demos that ship far more data than they need
// (/convex-hull downloaded 192 MB before its hull datasets were compacted in #494).
// Bytes are encoded response bodies: `vp preview` gzips like GitHub Pages does, so they track
// what users download. Data only fetched on a click (e.g. the quinary stats dataset) is excluded.

// The dev server serves unbundled, uncompressed modules, so its numbers mean nothing here
test.skip(
  process.env.MATTERVIZ_E2E_MODE !== `preview`,
  `payload budgets apply to the production build (MATTERVIZ_E2E_MODE=preview)`,
)

// Every demo route, from the same +page files src/site/state.svelte.ts globs for the nav:
// (hide) routes and group segments dropped; /test, /404 and the [slug] element pages aren't demos.
const demo_routes = globSync(`**/+page.{svelte,md}`, {
  cwd: `${import.meta.dirname}/../../src/routes`,
})
  .filter((file) => !file.includes(`(hide)`))
  .map((file) => {
    const segments = file.split(`/`).slice(0, -1)
    return `/${segments.filter((segment) => !segment.startsWith(`(`)).join(`/`)}`
  })
  .filter((route) => !/^\/(?:test|404|\[slug\])(?:\/|$)/.test(route))
  .toSorted()

// Budget = HEADROOM x MB measured at af92e264 (production build, Chromium, 1280x720). Routes
// not listed measured at most 1 MB and get BASELINE. When a deliberate change outgrows its
// budget, re-measure (the failure prints the numbers) and update. Bytes only: request counts
// swing with the environment (/acknowledgements made 162 requests locally, 255 in CI, mostly
// element photos loading as the page scrolls), so the failure lists them but they don't gate.
const HEADROOM = 1.5
const BASELINE = 1
// oxfmt-ignore
const measured: Record<string, number> = {
  '/': 3.68,
  '/acknowledgements': 1.93,
  '/convex-hull': 2.85,
  '/convex-hull/chempot-diagram': 1.86,
  '/convex-hull/synthesis-planning': 1.59,
  '/how-to/hook-up-to-external-api': 1.98,
  '/neb': 2.26,
  '/phase-diagram/ternary': 1.14,
  '/plot/binned-scatter': 1.5,
  '/plot/scatter-plot': 1.07,
  '/plot/scatter-plot-3d': 1.1,
  '/reciprocal/bands': 1.74,
  '/reciprocal/bands-and-dos': 1.75,
  '/reciprocal/brillouin-bands-dos': 1.83,
  '/reciprocal/brillouin-zone': 2.01,
  '/reciprocal/dos': 1.32,
  '/reciprocal/fermi-surface': 1.42,
  '/reciprocal/fermi-surface-bands': 1.57,
  '/reciprocal/ir-raman': 1.68,
  '/reciprocal/phonon-mode-explorer': 1.66,
  '/structure': 2.36,
  '/structure/bond-angles': 2.32,
  '/structure/coordination': 2.32,
  '/structure/gallery': 2.33,
  '/structure/host-tool': 2.35,
  '/structure/interface': 2.25,
  '/structure/isosurface': 2.27,
  '/structure/multi-volume': 3.37,
  '/structure/polyhedra': 2.32,
  '/structure/rdf': 2.33,
  '/structure/slab': 2.25,
  '/structure/symmetry': 2.32,
  '/structure/vectors': 2.25,
  '/structure/xrd': 2.35,
  '/trajectory': 2.99,
  '/trajectory/render': 1.59,
}

test(`payload: demo routes are enumerated and every measurement names one`, () => {
  expect(demo_routes).toContain(`/convex-hull`)
  expect(demo_routes.length).toBeGreaterThan(50)
  expect(Object.keys(measured).filter((route) => !demo_routes.includes(route))).toEqual([])
})

// Bring each still-unloaded LazyDemo into view in turn, then end at the bottom for any other
// lazy content. A fixed-step scroll can pass a demo while a busy main thread delays its
// IntersectionObserver callback, leaving that demo unloaded for good once the scroll moves on.
const load_all_demos = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(() => {
          const pending = document.querySelector(`.lazy-demo > .placeholder`)
          if (pending) {
            pending.scrollIntoView({ block: `center` })
            return false
          }
          globalThis.scrollTo(0, document.documentElement.scrollHeight)
          return true
        }),
      { intervals: [250], timeout: 60_000 },
    )
    .toBe(true)

// oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each.
for (const route of demo_routes) {
  test(`payload: ${route}`, async ({ page }) => {
    // context-level events also cover requests from web workers
    const context = page.context()
    const in_flight = new Set<unknown>()
    let last_activity = performance.now()
    const responses: Promise<{ url: string; bytes: number }>[] = []
    context.on(`request`, (request) => {
      in_flight.add(request)
      last_activity = performance.now()
    })
    context.on(`requestfailed`, (request) => {
      in_flight.delete(request)
      last_activity = performance.now()
    })
    context.on(`requestfinished`, (request) => {
      in_flight.delete(request)
      last_activity = performance.now()
      if (!request.url().startsWith(`http`)) return // data: and blob: URLs download nothing
      const url = request.url()
      responses.push(request.sizes().then((sizes) => ({ url, bytes: sizes.responseBodySize })))
    })
    // nothing in flight for a full second
    const network_quiet = () =>
      expect
        .poll(() => in_flight.size === 0 && performance.now() - last_activity > 1000, {
          intervals: [250],
          timeout: 60_000,
        })
        .toBe(true)

    // a route missing from the build would pass on its small 404 page
    const response = await page.goto(route)
    expect(response?.ok(), `${route} answered ${response?.status()}`).toBe(true)
    await network_quiet()
    await load_all_demos(page)
    await network_quiet()
    // a demo whose import failed swaps its placeholder for this alert and downloads nothing
    await expect(page.locator(`.lazy-demo > p[role="alert"]`)).toHaveCount(0)

    const finished = await Promise.all(responses)
    const total_mb = finished.reduce((sum, { bytes }) => sum + bytes, 0) / 1e6
    const measured_mb = measured[route] ?? BASELINE
    const largest = finished
      .toSorted((resp_a, resp_b) => resp_b.bytes - resp_a.bytes)
      .slice(0, 10)
      .map(({ url, bytes }) => `${(bytes / 1e6).toFixed(2)} MB ${url}`)
      .join(`\n`)
    const summary = `${route}: ${total_mb.toFixed(2)} MB in ${finished.length} requests. Largest:\n${largest}`
    expect(total_mb, summary).toBeLessThanOrEqual(HEADROOM * measured_mb)
  })
}
