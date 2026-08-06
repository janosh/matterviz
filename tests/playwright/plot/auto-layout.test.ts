import { expect, test, type Locator } from '@playwright/test'

type RenderedLabel = {
  text: string
  aria_label: string | null
  left: number
  right: number
  top: number
  bottom: number
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
      return [
        {
          text: element.textContent ?? ``,
          aria_label: element.getAttribute(`aria-label`),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        },
      ]
    }),
  )

const overlap_count = (labels: readonly RenderedLabel[], tolerance = 0.5): number => {
  let overlaps = 0
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
        overlaps += 1
      }
    }
  }
  return overlaps
}

const stable_labels = async (axis: Locator): Promise<RenderedLabel[]> => {
  let previous_signature = ``
  let latest: RenderedLabel[] = []
  await expect
    .poll(async () => {
      latest = await rendered_labels(axis)
      const signature = JSON.stringify(
        latest.map(({ text, left, right, top, bottom }) => [
          text,
          Math.round(left * 10),
          Math.round(right * 10),
          Math.round(top * 10),
          Math.round(bottom * 10),
        ]),
      )
      const stable = latest.length > 0 && signature === previous_signature
      previous_signature = signature
      return stable
    })
    .toBe(true)
  return latest
}

const assert_readable = (labels: readonly RenderedLabel[]): void => {
  expect(labels.length).toBeGreaterThanOrEqual(3)
  for (const { text, aria_label } of labels) {
    const visible_text = text.replaceAll(/[\s\u200B-\u200D\u2060]/gu, ``)
    expect(visible_text).not.toBe(``)
    expect(visible_text).not.toMatch(/^…+$/u)
    expect(aria_label?.trim()).not.toBe(``)
  }
}

const assert_readable_non_overlapping = (labels: readonly RenderedLabel[]): void => {
  assert_readable(labels)
  expect(overlap_count(labels), JSON.stringify(labels)).toBe(0)
}

test(`adaptive demo stays readable after fonts and narrow/wide resizes`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/plot/bar-plot`, { waitUntil: `networkidle` })

  const demo = page.locator(`[data-testid="adaptive-tick-demo"]`)
  await demo.scrollIntoViewIfNeeded()
  await expect(demo).toBeVisible()
  await expect(demo.locator(`.bar-plot`)).toBeVisible()
  expect(
    await page.evaluate(async () => {
      await document.fonts.ready
      return document.fonts.status
    }),
  ).toBe(`loaded`)

  const width_slider = demo.locator(`input[type="range"]`)
  const x_axis = demo.locator(`.bar-plot g.x-axis`)
  const set_chart_width = async (width: number): Promise<RenderedLabel[]> => {
    await width_slider.fill(String(width))
    return stable_labels(x_axis)
  }

  const minimum_width_labels = await set_chart_width(280)
  // Minimum width exercises readable fallback; 740px and 840px exercise feasible box geometry.
  assert_readable(minimum_width_labels)
  const narrow_labels = await set_chart_width(740)
  assert_readable_non_overlapping(narrow_labels)
  const wide_labels = await set_chart_width(840)
  assert_readable_non_overlapping(wide_labels)
  expect(wide_labels.length).toBeLessThanOrEqual(narrow_labels.length)

  const repeated_narrow_labels = await set_chart_width(740)
  assert_readable_non_overlapping(repeated_narrow_labels)
  expect(repeated_narrow_labels).toEqual(narrow_labels)
})
