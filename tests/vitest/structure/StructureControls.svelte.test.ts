import { StructureControls } from '$lib/structure'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { bind_props, simple_structure } from '../setup'

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

  test(`polyhedra center checkbox tracks configured intent, not just render state`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const state = $state({
      scene_props: {
        show_polyhedra: `crystals` as const,
        polyhedra_included_elements: [`O`],
        polyhedra_excluded_elements: [] as string[],
      },
    })

    mount(StructureControls, {
      target,
      props: bind_props(
        // nothing rendered yet (e.g. O blocked by CN cap), but O is force-included
        { structure: simple_structure, controls_open: true, polyhedra_rendered_elements: [] },
        state,
      ),
    })
    await tick()

    const center_checkbox = (symbol: string) =>
      [...target.querySelectorAll(`label`)]
        .find((label) => label.textContent?.trim() === symbol)
        ?.querySelector<HTMLInputElement>(`input[type="checkbox"]`)

    // force-included element shows checked even when not (yet) rendered
    expect(center_checkbox(`O`)?.checked).toBe(true)
    // a non-included, non-rendered element stays unchecked
    expect(center_checkbox(`H`)?.checked).toBe(false)

    // toggling the force-included element off must be reversible from the same control
    center_checkbox(`O`)?.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(state.scene_props.polyhedra_included_elements).not.toContain(`O`)
    expect(center_checkbox(`O`)?.checked).toBe(false)
  })

  test(`renders multi-character element symbols as single center checkboxes`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    // flatMap only flattens arrays, not strings, so 2-letter symbols like Fe must
    // stay intact (not split into F + e). Guards against a flatMap -> spread regression.
    const fe_oxide = {
      id: `test_fe_oxide`,
      sites: [
        {
          species: [{ element: `Fe`, occu: 1, oxidation_state: 3 }],
          xyz: [0, 0, 0],
          abc: [0, 0, 0],
          label: `Fe1`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
          xyz: [1.5, 0, 0],
          abc: [0.15, 0, 0],
          label: `O1`,
          properties: {},
        },
      ],
    } as typeof simple_structure
    const state = $state({ scene_props: { show_polyhedra: `crystals` as const } })

    mount(StructureControls, {
      target,
      props: bind_props({ structure: fe_oxide, controls_open: true }, state),
    })
    await tick()

    const center_label = (symbol: string) =>
      [...target.querySelectorAll(`label`)].find(
        (label) => label.textContent?.trim() === symbol,
      )

    expect(center_label(`Fe`)).toBeDefined()
    expect(center_label(`O`)).toBeDefined()
    // no split-character artifacts from string iteration
    expect(center_label(`F`)).toBeUndefined()
    expect(center_label(`e`)).toBeUndefined()
  })
})
