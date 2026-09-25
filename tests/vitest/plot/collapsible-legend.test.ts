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

  test(`collapse(group) adds one group, collapse() re-collapses every known group`, () => {
    const { collapsed_groups, toggle_group, collapse } = create_collapsible_legend([`a`])
    toggle_group(`a`) // expand initial group
    toggle_group(`b`) // collapse a group first seen via toggle
    toggle_group(`b`) // expand it again
    expect(collapsed_groups.size).toBe(0)
    collapse(`c`)
    expect([...collapsed_groups]).toEqual([`c`])
    collapse(`c`) // idempotent
    expect([...collapsed_groups]).toEqual([`c`])
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

  test(`spreads into PlotLegend: header click expands a collapsed group`, async () => {
    const collapsible = create_collapsible_legend([`Models`])
    const series_data: LegendItem[] = [0, 1].map((series_idx) => ({
      label: `model ${series_idx}`,
      visible: true,
      series_idx,
      legend_group: `Models`,
      display_style: {},
    }))
    const component = mount(PlotLegend, {
      target: document.body,
      props: { series_data, ...collapsible.legend },
    })
    const header = document.querySelector<HTMLElement>(`.legend-group-header`)
    expect(header?.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(document.querySelectorAll(`.legend-item`)).toHaveLength(0)
    header?.click()
    flushSync()
    expect(header?.getAttribute(`aria-expanded`)).toBe(`true`)
    expect(document.querySelectorAll(`.legend-item`)).toHaveLength(2)
    await unmount(component)
  })
})
