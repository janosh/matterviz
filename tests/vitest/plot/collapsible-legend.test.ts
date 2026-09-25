// @vitest-environment happy-dom
import { create_collapsible_legend, type LegendItem, PlotLegend } from '$lib/plot'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

afterEach(() => document.body.replaceChildren())

// Two sibling figures, each wrapping controls, a plot area and a `.legend`
const make_figures = () => {
  const figures = [0, 1].map(() => {
    const figure = document.createElement(`div`)
    figure.innerHTML = `<button class="control"></button><svg class="plot"></svg><div class="legend"><span class="item"></span></div>`
    document.body.append(figure)
    return figure
  })
  // SVG elements lack .click(), so dispatch the event the dismiss listener waits for
  const click = (idx: number, selector: string) => {
    const el = figures[idx].querySelector(selector)
    if (!el) throw new Error(`no ${selector} in figure ${idx}`)
    el.dispatchEvent(new MouseEvent(`click`, { bubbles: true, composed: true }))
  }
  return { figures, click }
}

describe(`create_collapsible_legend`, () => {
  test(`starts with the given groups collapsed and toggles them`, () => {
    const { collapsed_groups, legend, toggle_group } = create_collapsible_legend([`Models`])
    expect([...collapsed_groups]).toEqual([`Models`])
    expect(legend.collapsed_groups).toBe(collapsed_groups)
    toggle_group(`Models`)
    expect(collapsed_groups.has(`Models`)).toBe(false)
    legend.on_group_toggle(`Models`, [0, 1])
    expect(collapsed_groups.has(`Models`)).toBe(true)
  })

  test(`collapse(group) adds one group, collapse() restores the initially collapsed ones`, () => {
    const { collapsed_groups, toggle_group, collapse } = create_collapsible_legend([`a`])
    toggle_group(`a`) // expand initial group
    toggle_group(`b`) // collapse a group that started expanded
    collapse(`c`)
    collapse(`c`) // idempotent
    expect(new Set(collapsed_groups)).toEqual(new Set([`b`, `c`]))
    collapse()
    expect(new Set(collapsed_groups)).toEqual(new Set([`a`, `b`, `c`]))
  })

  test.each([
    [`.plot`, true],
    [`.control`, true],
    [`.legend`, false],
    [`.legend .item`, false],
  ])(`click on own figure's %s collapses: %s`, (selector, collapses) => {
    const { toggle_group, collapsed_groups, collapse_on_outside_click } =
      create_collapsible_legend([`Models`])
    const { figures, click } = make_figures()
    const cleanup = collapse_on_outside_click(figures[0])
    toggle_group(`Models`)
    click(0, selector)
    expect(collapsed_groups.has(`Models`)).toBe(collapses)
    if (typeof cleanup === `function`) cleanup()
  })

  test(`scope: a click on a sibling figure's legend still collapses`, () => {
    const { toggle_group, collapsed_groups, collapse_on_outside_click } =
      create_collapsible_legend([`Models`])
    const { figures, click } = make_figures()
    const cleanup = collapse_on_outside_click(figures[0])
    toggle_group(`Models`)
    click(1, `.legend .item`)
    expect(collapsed_groups.has(`Models`)).toBe(true)
    // after cleanup, outside clicks no longer collapse
    toggle_group(`Models`)
    if (typeof cleanup === `function`) cleanup()
    click(0, `.plot`)
    expect(collapsed_groups.has(`Models`)).toBe(false)
  })

  test(`in PlotLegend, outside click restores initial groups however they were toggled`, async () => {
    const collapsible = create_collapsible_legend([`Models`])
    const series_data: LegendItem[] = [`Models`, `Models`, `Refs`, `Other`].map(
      (legend_group, series_idx) => ({
        label: `series ${series_idx}`,
        visible: true,
        series_idx,
        legend_group,
        display_style: {},
      }),
    )
    const component = mount(PlotLegend, {
      target: document.body,
      props: { series_data, ...collapsible.legend },
    })
    const cleanup = collapsible.collapse_on_outside_click(document.body)
    const header = (group: string) => {
      const el = document.querySelector<HTMLElement>(`[aria-label="Toggle group ${group}"]`)
      if (!el) throw new Error(`no header for group ${group}`)
      return el
    }
    const chevron = (group: string) =>
      header(group).querySelector<HTMLElement>(`.group-chevron`)
    expect(header(`Models`).getAttribute(`aria-expanded`)).toBe(`false`)
    expect(document.querySelectorAll(`.legend-item`)).toHaveLength(2) // Refs + Other
    header(`Models`).click() // expand via on_group_toggle
    header(`Refs`).click() // collapse via on_group_toggle...
    chevron(`Refs`)?.click() // ...and expand via chevron, bypassing on_group_toggle
    chevron(`Other`)?.click() // collapse and expand via chevron only
    chevron(`Other`)?.click()
    flushSync()
    expect(collapsible.collapsed_groups.size).toBe(0)
    expect(document.querySelectorAll(`.legend-item`)).toHaveLength(4)
    document.body.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    flushSync()
    expect([...collapsible.collapsed_groups]).toEqual([`Models`])
    expect(document.querySelectorAll(`.legend-item`)).toHaveLength(2)
    if (typeof cleanup === `function`) cleanup()
    await unmount(component)
  })
})
