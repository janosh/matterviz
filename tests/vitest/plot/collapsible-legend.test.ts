// @vitest-environment happy-dom
import { create_collapsible_legend, ScatterPlot } from '$lib/plot'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { mount_sized } from '../setup'

afterEach(() => document.body.replaceChildren())

describe(`create_collapsible_legend`, () => {
  // Only a figure's own legend counts as inside; `scope` keeps a sibling figure's from counting
  test.each([
    [`own plot`, 0, `.plot`, true],
    [`own control`, 0, `.control`, true],
    [`own legend`, 0, `.legend`, false],
    [`own legend item`, 0, `.legend .item`, false],
    [`sibling legend item`, 1, `.legend .item`, true],
  ])(
    `click on %s in figure %i (%s) collapses: %s`,
    (_desc, figure_idx, selector, collapses) => {
      const { collapsed_groups, collapse_on_outside_click } = create_collapsible_legend([
        `Models`,
      ])
      const figures = [0, 1].map(() => {
        const figure = document.createElement(`div`)
        figure.innerHTML = `<button class="control"></button><svg class="plot"></svg><div class="legend"><span class="item"></span></div>`
        document.body.append(figure)
        return figure
      })
      // SVG elements lack .click(), so dispatch the event the dismiss listener waits for
      const click = () =>
        figures[figure_idx]
          .querySelector(selector)
          ?.dispatchEvent(new MouseEvent(`click`, { bubbles: true, composed: true }))
      const cleanup = collapse_on_outside_click(figures[0])
      collapsed_groups.delete(`Models`)
      click()
      expect(collapsed_groups.has(`Models`)).toBe(collapses)
      // after cleanup, clicks no longer collapse
      collapsed_groups.delete(`Models`)
      if (typeof cleanup === `function`) cleanup()
      click()
      expect(collapsed_groups.has(`Models`)).toBe(false)
    },
  )

  // Charts wire header clicks to group visibility; the helper's header must only expand, and
  // an outside click re-collapses the initial groups however header or chevron toggled them
  test(`in ScatterPlot, headers expand without hiding series and outside clicks re-collapse`, async () => {
    const collapsible = create_collapsible_legend([`Models`])
    const plot = await mount_sized(
      ScatterPlot,
      {
        series: [`Models`, `Models`, `Refs`].map((legend_group, idx) => ({
          x: [1, 2, 3],
          y: [1, 2, 3],
          label: `S${idx}`,
          legend_group,
        })),
        legend: { ...collapsible.legend },
      },
      { selector: `.scatter` },
    )
    const cleanup = collapsible.collapse_on_outside_click(document.body)
    const header = (group: string) => {
      const el = [...plot.querySelectorAll<HTMLElement>(`.legend-group-header`)].find((node) =>
        node.textContent?.includes(group),
      )
      if (!el) throw new Error(`no header for group ${group}`)
      return el
    }
    const items_hidden = () =>
      [...plot.querySelectorAll(`.legend-item`)].map((item) =>
        item.classList.contains(`hidden`),
      )
    expect(header(`Models`).getAttribute(`aria-expanded`)).toBe(`false`)
    expect(items_hidden()).toEqual([false]) // only Refs' item
    header(`Models`).click() // expand via the header
    header(`Refs`).click() // collapse via the header...
    header(`Refs`).querySelector<HTMLElement>(`.group-chevron`)?.click() // ...expand via its chevron
    flushSync()
    expect(collapsible.collapsed_groups.size).toBe(0)
    expect(header(`Models`).getAttribute(`aria-expanded`)).toBe(`true`)
    expect(header(`Models`).classList.contains(`hidden`)).toBe(false)
    expect(items_hidden()).toEqual([false, false, false])
    document.body.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    flushSync()
    expect([...collapsible.collapsed_groups]).toEqual([`Models`])
    expect(items_hidden()).toEqual([false])
    if (typeof cleanup === `function`) cleanup()
  })
})
