import { create_collapsible_legend, ScatterPlot } from '$lib/plot'
import { flushSync } from 'svelte'
import { describe, expect, test } from 'vitest'
import { mount_sized, mouse } from '../setup'

describe(`create_collapsible_legend`, () => {
  // `scope` keeps a sibling figure's legend from counting as inside
  test(`clicks outside the figure's own legend re-collapse until cleanup`, () => {
    const { collapsed_groups, collapse_on_outside_click } = create_collapsible_legend([
      `Models`,
    ])
    document.body.innerHTML = `<div><svg></svg><div class="legend"><i></i></div></div>`.repeat(
      2,
    )
    const [own, sibling] = document.querySelectorAll<HTMLElement>(`body > div`)
    // SVG elements lack .click(), so dispatch the event the dismiss listener waits for
    const collapses = (selector: string, figure = own) => {
      collapsed_groups.clear()
      figure.querySelector(selector)?.dispatchEvent(mouse(`click`))
      return collapsed_groups.has(`Models`)
    }
    const cleanup = collapse_on_outside_click(own)
    expect([
      collapses(`svg`),
      collapses(`.legend i`),
      collapses(`.legend i`, sibling),
    ]).toEqual([true, false, true])
    if (typeof cleanup === `function`) cleanup()
    expect(collapses(`svg`)).toBe(false)
  })

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
    const n_shown = () => plot.querySelectorAll(`.legend-item:not(.hidden)`).length
    expect(n_shown()).toBe(1) // only Refs' item
    plot.querySelector<HTMLElement>(`.legend-group-header`)?.click() // Models
    flushSync()
    expect(collapsible.collapsed_groups.size).toBe(0)
    expect(n_shown()).toBe(3)
    document.body.dispatchEvent(mouse(`click`))
    flushSync()
    expect([...collapsible.collapsed_groups]).toEqual([`Models`])
    expect(n_shown()).toBe(1)
    if (typeof cleanup === `function`) cleanup()
  })
})
