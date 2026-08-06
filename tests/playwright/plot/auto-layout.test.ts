import { expect, test, type Locator } from '@playwright/test'

type RenderedLabel = {
  text: string
  aria_label: string | null
  left: number
  right: number
  top: number
  bottom: number
  // Furthest the label reaches outside its plot's <svg>, 0 when fully contained.
  spill: number
}

const rendered_labels = (axis: Locator): Promise<RenderedLabel[]> =>
  axis.locator(`.tick text`).evaluateAll((elements) =>
    elements.flatMap((element) => {
      const style = globalThis.getComputedStyle(element)
      const box = element.getBoundingClientRect()
      if (
        style.display === `none` ||
        style.visibility === `hidden` ||
        Number(style.opacity) === 0 ||
        box.width === 0 ||
        box.height === 0
      ) {
        return []
      }
      const svg = element.closest(`svg`)?.getBoundingClientRect()
      return [
        {
          text: element.textContent ?? ``,
          aria_label: element.getAttribute(`aria-label`),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          spill: svg
            ? Math.max(
                0,
                svg.left - box.left,
                box.right - svg.right,
                svg.top - box.top,
                box.bottom - svg.bottom,
              )
            : 0,
        },
      ]
    }),
  )

const overlapping_pairs = (labels: readonly RenderedLabel[], tolerance = 0.5): string[] => {
  const pairs: string[] = []
  for (let first_idx = 0; first_idx < labels.length; first_idx++) {
    const first = labels[first_idx]
    for (let second_idx = first_idx + 1; second_idx < labels.length; second_idx++) {
      const second = labels[second_idx]
      if (
        first.left + tolerance < second.right &&
        second.left + tolerance < first.right &&
        first.top + tolerance < second.bottom &&
        second.top + tolerance < first.bottom
      ) {
        pairs.push(`${first.text.trim()} <-> ${second.text.trim()}`)
      }
    }
  }
  return pairs
}

const layout_signature = (labels: readonly RenderedLabel[]) => {
  const first = labels[0]
  if (!first) return []
  return labels.map(({ text, left, right, top, bottom }) => [
    text,
    ...[right - left, bottom - top, left - first.left, top - first.top].map((value) =>
      Math.round(value * 10),
    ),
  ])
}

const stable_labels = async (axis: Locator): Promise<RenderedLabel[]> => {
  let previous_signature = ``
  let stable_samples = 0
  let latest: RenderedLabel[] = []
  await expect
    .poll(
      async () => {
        latest = await rendered_labels(axis)
        const signature = JSON.stringify(layout_signature(latest))
        stable_samples =
          latest.length > 0 && signature === previous_signature ? stable_samples + 1 : 0
        previous_signature = signature
        return stable_samples >= 2
      },
      {
        message: `tick layout never held still for three consecutive polls`,
        timeout: 15_000,
      },
    )
    .toBe(true)
  return latest
}

const assert_readable = (labels: readonly RenderedLabel[]): void => {
  // The demo pins min_visible_ticks to 3, so anything fewer means thinning overshot.
  expect(labels.length).toBeGreaterThanOrEqual(3)
  for (const { text, aria_label, spill } of labels) {
    const visible_text = text.replaceAll(/[\s\u200B-\u200D\u2060]/gu, ``)
    expect(visible_text).not.toBe(``)
    expect(visible_text).not.toMatch(/^…+$/u)
    // Missing aria-labels yield undefined, which `not.toBe('')` would accept.
    expect(aria_label?.trim(), `aria-label for ${visible_text}`).toBeTruthy()
    expect(spill, `${visible_text} spills outside the plot`).toBeLessThanOrEqual(0.5)
  }
}

const assert_readable_non_overlapping = (labels: readonly RenderedLabel[]): void => {
  assert_readable(labels)
  expect(overlapping_pairs(labels)).toEqual([])
}

test(`adaptive demo stays readable after fonts and narrow/wide resizes`, async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/plot/bar-plot`, { waitUntil: `domcontentloaded` })

  const demo = page.locator(`[data-testid="adaptive-tick-demo"]`)
  await demo.scrollIntoViewIfNeeded()
  await expect(demo.locator(`.bar-plot`)).toBeVisible()
  const width_slider = demo.locator(`input[type="range"]`)
  const x_axis = demo.locator(`.bar-plot g.x-axis`)
  // Wait for Svelte to attach the slider handler, otherwise only the DOM input moves.
  await expect(x_axis.locator(`.tick text`).first()).toBeVisible({ timeout: 45_000 })
  await page.evaluate(async () => void (await document.fonts.ready))

  const set_chart_width = async (width: number): Promise<RenderedLabel[]> => {
    await width_slider.fill(String(width))
    return stable_labels(x_axis)
  }

  // Exercise the minimum, feasible geometry, slider maximum, then hysteresis.
  assert_readable(await set_chart_width(280))
  const narrow_labels = await set_chart_width(740)
  assert_readable_non_overlapping(narrow_labels)
  assert_readable_non_overlapping(await set_chart_width(900))

  expect(layout_signature(await set_chart_width(740))).toEqual(layout_signature(narrow_labels))
})
