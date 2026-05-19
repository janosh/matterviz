import { StructureControls } from '$lib/structure'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, simple_structure } from '../setup'

vi.mock(`$lib/io/export`, () => ({
  export_canvas_as_png: vi.fn(),
}))

describe(`StructureControls reactive props`, () => {
  test(`syncs site label controls from external scene prop updates`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const state = $state({
      scene_props: {
        show_site_labels: true,
        site_label_color: `#111111`,
        site_label_bg_color: `color-mix(in srgb, #000000 20%, transparent)`,
      },
    })

    mount(StructureControls, {
      target,
      props: bind_props({ structure: simple_structure, controls_open: true }, state),
    })

    state.scene_props = {
      ...state.scene_props,
      site_label_color: `#00ff00`,
      site_label_bg_color: `color-mix(in srgb, #123456 70%, transparent)`,
    }
    await tick()

    const label_color_input = target.querySelector<HTMLInputElement>(
      `input[aria-label="Site label color"]`,
    )
    const label_bg_color_input = target.querySelector<HTMLInputElement>(
      `input[aria-label="Site label background color"]`,
    )
    const label_bg_opacity_input = target.querySelector<HTMLInputElement>(
      `input[aria-label="Site label background opacity"]`,
    )
    expect(label_color_input?.value).toBe(`#00ff00`)
    expect(label_bg_color_input?.value).toBe(`#123456`)
    expect(label_bg_opacity_input?.valueAsNumber).toBe(0.7)
  })
})
