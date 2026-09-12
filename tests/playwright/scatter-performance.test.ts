import { expect, type Page, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

type Operation = `pan` | `zoom` | `color` | `size`

const reset = async (page: Page) => {
  await page.getByRole(`button`, { name: `Reset`, exact: true }).click()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}

// Completed-gesture redraw latency: dispatch through two animation frames allows
// Svelte's flush and a paint opportunity, including scheduling, not display latency.
const sample = (page: Page, operation_name: Operation, sample_count: number) =>
  page.evaluate(
    async ({ operation, count }) => {
      const svg = document.querySelector<SVGSVGElement>(`svg[role="application"]`)
      const state = document.querySelector(`[data-testid="scatter-state"]`)
      const button = Array.from(document.querySelectorAll(`button`)).find(
        (candidate) => candidate.textContent?.trim().toLowerCase() === operation,
      )
      if (!svg || !state) throw new Error(`Scatter benchmark is not mounted`)
      const bounds = svg.getBoundingClientRect()
      const center_x = bounds.x + bounds.width / 2
      const center_y = bounds.y + bounds.height / 2
      const pointer = { buttons: 1, clientX: center_x, clientY: center_y }
      const frame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const times: number[] = []
      for (let idx = 0; idx < count; idx++) {
        const previous = state.textContent
        const direction = idx % 2 ? -1 : 1
        const start = performance.now()
        if (operation === `pan`) {
          svg.dispatchEvent(
            new MouseEvent(`mousedown`, {
              ...pointer,
              bubbles: true,
              shiftKey: true,
            }),
          )
          window.dispatchEvent(
            new MouseEvent(`mousemove`, {
              ...pointer,
              clientX: center_x + direction * 40,
            }),
          )
          window.dispatchEvent(new MouseEvent(`mouseup`))
        } else if (operation === `zoom`) {
          const touch = (type: string, span = 0) =>
            svg.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                touches: span
                  ? [-1, 1].map(
                      (side, identifier) =>
                        new Touch({
                          identifier,
                          target: svg,
                          clientX: center_x + (side * span) / 2,
                          clientY: center_y,
                        }),
                    )
                  : [],
              }),
            )
          touch(`touchstart`, 100)
          touch(`touchmove`, direction === 1 ? 125 : 80)
          touch(`touchend`)
        } else {
          if (!button) throw new Error(`Missing ${operation} button`)
          button.click()
        }
        await frame()
        await frame()
        times.push(performance.now() - start)
        if (state.textContent === previous)
          throw new Error(`${operation} did not change state`)
        const { view } = JSON.parse(state.textContent ?? `{}`) as {
          view: { x: [number, number]; y: [number, number] }
        }
        if ([view.x, view.y].some(([lower, upper]) => lower > 0 || upper < 1))
          throw new Error(`${operation} clipped points: ${JSON.stringify(view)}`)
      }
      return times
    },
    { operation: operation_name, count: sample_count },
  )

test.describe(`Scatter interaction benchmarks`, () => {
  test.skip(process.env.MATTERVIZ_PERF !== `1`, `Opt-in browser performance measurements`)
  test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 })
  test.setTimeout(180_000)

  for (const points of [100_000, 500_000]) {
    test(`${points} canvas points`, async ({ page, browser }, test_info) => {
      const attach_json = async (name: string, value: unknown) => {
        const path = test_info.outputPath(name)
        await writeFile(path, JSON.stringify(value, null, 2))
        await test_info.attach(name, { path, contentType: `application/json` })
      }
      await page.goto(`/test/scatter-performance?points=${points}`)
      const canvas = page.locator(`canvas.marker-canvas`)
      await expect(canvas).toBeVisible({ timeout: 60_000 })
      await expect(page.getByTestId(`scatter-state`)).toContainText(`"points":${points}`)
      await reset(page)
      const { mode, view: initial_view } = await page.getByTestId(`scatter-state`).evaluate(
        (element) =>
          JSON.parse(element.textContent ?? `{}`) as {
            mode: string
            view: { x: [number, number]; y: [number, number] }
          },
      )
      const session = await page.context().newCDPSession(page)
      const results = []
      for (const operation of [`pan`, `zoom`, `color`, `size`] as const) {
        await reset(page)
        // Check actual pixels before profiling; state-only no-ops must not benchmark well.
        const before = await canvas.evaluate((element: HTMLCanvasElement) =>
          element.toDataURL(),
        )
        await sample(page, operation, 3) // warm both directions, finish on a changed image
        expect(
          await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()),
        ).not.toBe(before)
        await reset(page)
        const latency_ms = await sample(page, operation, 12)
        const sorted = latency_ms.toSorted((left, right) => left - right)
        // Separate allocation and latency passes: sampling overhead is excluded from timings.
        await reset(page)
        await session.send(`HeapProfiler.startSampling`, {
          samplingInterval: 32768,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true,
        })
        await sample(page, operation, 6)
        const { profile } = await session.send(`HeapProfiler.stopSampling`)
        results.push({
          operation,
          latency_ms,
          median_ms: (sorted[5] + sorted[6]) / 2,
          p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
          sampled_allocation_bytes_per_update:
            profile.samples.reduce((total, entry) => total + entry.size, 0) / 6,
        })
        await attach_json(`${operation}-allocations.heapprofile`, profile)
      }
      await expect(canvas).toBeVisible()
      await session.detach()
      const report = {
        points,
        seed: 20260912,
        browser: browser.version(),
        mode,
        initial_view,
        metric: `completed-gesture redraw latency`,
        viewport: { width: 1200, height: 800 },
        device_scale_factor: 1,
        results,
      }
      console.info(JSON.stringify(report))
      await attach_json(`scatter-performance.json`, report)
    })
  }
})
