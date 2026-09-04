import { default_element_colors } from '$lib/colors'
import { ELEM_SYMBOLS } from '$lib/labels'
import { colors } from '$lib/state.svelte'
import AtomLegend from '$lib/structure/AtomLegend.svelte'
import type { AtomColorConfig, AtomPropertyColors } from '$lib/structure/atom-properties'
import { DEFAULT_ATOM_COLOR_CONFIG } from '$lib/structure/atom-properties'
import type { ComponentProps } from 'svelte'
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, onTestFinished, test } from 'vitest'
import { doc_query } from '../setup'

let mounted_components: ReturnType<typeof mount>[] = []

type WithoutScale<Config> = Config extends AtomColorConfig ? Omit<Config, `scale`> : never
type AtomLegendTestProps = Omit<ComponentProps<typeof AtomLegend>, `atom_color_config`> & {
  atom_color_config?: WithoutScale<AtomColorConfig>
}

const mount_legend = (props: AtomLegendTestProps): ReturnType<typeof mount> => {
  const component_props = props as ComponentProps<typeof AtomLegend>
  if (props.atom_color_config) {
    component_props.atom_color_config = {
      scale: DEFAULT_ATOM_COLOR_CONFIG.scale,
      ...props.atom_color_config,
    }
  }
  const mounted = mount(AtomLegend, { target: document.body, props: component_props })
  mounted_components.push(mounted)
  return mounted
}

afterEach(async () => {
  await Promise.all(mounted_components.map((component) => unmount(component)))
  mounted_components = []
})

const PALETTE = [`#e41a1c`, `#377eb8`, `#4daf4a`, `#984ea3`, `#ff7f00`]
// Per-site property colors for `values`: duplicates share the color of their first
// occurrence and min/max are derived from the numeric values (as get_* producers do)
const prop_colors = (
  values: (number | string)[],
  site_colors?: string[],
): AtomPropertyColors => {
  const unique_values = [...new Set(values)]
  const nums = unique_values.filter((val): val is number => typeof val === `number`)
  return {
    colors:
      site_colors ?? values.map((val) => PALETTE[unique_values.indexOf(val) % PALETTE.length]),
    values,
    unique_values,
    ...(nums.length > 0 && { min_value: Math.min(...nums), max_value: Math.max(...nums) }),
  }
}
const coordination = (scale_type: `continuous` | `categorical`) =>
  ({ mode: `coordination`, scale_type }) as const

const open_mode_menu = async (): Promise<HTMLButtonElement[]> => {
  doc_query<HTMLButtonElement>(`button.mode-toggle`).click()
  await tick()
  return [...document.querySelectorAll<HTMLButtonElement>(`.mode-option`)]
}
const mode_option = async (text: string): Promise<HTMLButtonElement> => {
  const option = (await open_mode_menu()).find((opt) => opt.textContent?.includes(text))
  if (!option) throw new Error(`no mode option containing ${text}`)
  return option
}

const open_remap_menu = async (): Promise<HTMLInputElement> => {
  doc_query<HTMLLabelElement>(`label`).dispatchEvent(
    new MouseEvent(`contextmenu`, { bubbles: true }),
  )
  await tick()
  return doc_query<HTMLInputElement>(`.remap-search`)
}
const label_texts = (): (string | undefined)[] =>
  [...document.querySelectorAll(`label`)].map((label) => label.textContent?.trim())

describe(`AtomLegend Component`, () => {
  test.each([
    {
      desc: `basic rendering with default amounts`,
      props: { elements: { Fe: 2, O: 3, H: 1.5, C: 12.123456789 }, style: `margin: 20px;` },
      expected_labels: [`H 1.5`, `C 12.123`, `O 3`, `Fe 2`],
      check_styling: true,
    },
    {
      desc: `floating point precision`,
      props: { elements: { P: 1.4849999999999999, Ge: 0.515, S: 3 } },
      expected_labels: [`P 1.485`, `S 3`, `Ge 0.515`],
    },
  ])(`$desc`, ({ props, expected_labels, check_styling }) => {
    mount_legend(props)
    expect(label_texts()).toEqual(expected_labels)

    if (check_styling) {
      const iron_label = [...document.querySelectorAll(`label`)].find((label) =>
        label.textContent?.trim().startsWith(`Fe `),
      )
      if (!iron_label) throw new Error(`Expected Fe label to exist`)
      expect(iron_label.style.backgroundColor).toBe(colors.element.Fe)
      expect(document.querySelectorAll(`input[type="color"]`)).toHaveLength(
        expected_labels.length,
      )
      expect(iron_label.querySelector<HTMLInputElement>(`input[type="color"]`)?.value).toBe(
        colors.element.Fe,
      )
      expect(doc_query(`div`).getAttribute(`style`)).toBe(props.style)
    }
  })

  test(`color picker functionality`, () => {
    mount_legend({ elements: { Fe: 2 } })

    const color_input = doc_query<HTMLInputElement>(`input[type="color"]`)
    expect(color_input.title).toBe(`Double click to reset color`)

    color_input.value = `#ff0000`
    color_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    expect(colors.element.Fe).toBe(`#ff0000`)

    doc_query(`label`).dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    expect(colors.element.Fe).toBe(default_element_colors.Fe)
  })

  test.each([
    [{}, 0, undefined], // Empty elements
    [{ Fe: 0 }, 1, `Fe 0`], // Zero amount
    [{ Fe: 0.0001 }, 1, `Fe 0`], // Very small decimal (trimmed by .3~f format)
    // oxlint-disable-next-line no-unnecessary-type-assertion -- svelte-check needs it
    [{ Xx: 1 } as never, 1, `Xx 1`], // Non-existent element
  ])(`handles edge cases correctly`, (elements, expected_count, expected_text) => {
    mount_legend({ elements })

    const labels = document.querySelectorAll(`label`)
    expect(labels).toHaveLength(expected_count)

    if (expected_text) {
      expect(labels[0].textContent?.trim()).toBe(expected_text)
      // Test accessibility - label contains input
      expect(labels[0].querySelector(`input[type="color"]`)).toBeInstanceOf(HTMLElement)
    }
  })

  test(`uses white text for oxygen red and reacts to light color updates`, async () => {
    const original_oxygen_color = colors.element.O
    onTestFinished(() => {
      colors.element.O = original_oxygen_color
    })
    colors.element.O = default_element_colors.O
    mount_legend({ elements: { O: 1 } })
    const label = doc_query(`label`)
    expect(label.style.color).toBe(`white`)

    colors.element.O = `#ffff00`
    await tick()

    expect(label.style.color).toBe(`black`)
  })

  // The same toggle-visibility buttons serve the element legend and the categorical property
  // legend; each flips its accessible name and hides its label
  // oxfmt-ignore
  test.each([
    [`element`, false, `label`, [`Hide O atoms`, `Hide Fe atoms`], [`Show O atoms`, `Hide Fe atoms`]],
    [`property value`, true, `.category-label`, [`Hide 4`, `Hide 6`], [`Show 4`, `Hide 6`]],
  ])(`%s visibility toggle flips the button's accessible name`, async (_desc, categorical, label_selector, before, after) => {
    const property_props = {
      atom_color_config: coordination(`categorical`),
      property_colors: prop_colors([4, 6]),
      hidden_prop_vals: new Set<string | number>(),
    }
    mount_legend({ elements: { Fe: 2, O: 3 }, ...(categorical && property_props) })

    const toggle_buttons = document.querySelectorAll<HTMLButtonElement>(
      `button.toggle-visibility`,
    )
    const names = () => [...toggle_buttons].map((btn) => btn.getAttribute(`aria-label`))
    expect(names()).toEqual(before)
    toggle_buttons[0].click()
    await tick()

    expect(names()).toEqual(after)
    expect(doc_query(label_selector).classList.contains(`hidden`)).toBe(true)
  })

  describe(`Mode Selector`, () => {
    test(`dropdown opens with every mode, disables modes the structure cannot feed, and closes`, async () => {
      mount_legend({ elements: { Fe: 2 }, sym_data: null })

      const mode_toggle = doc_query<HTMLButtonElement>(`button.mode-toggle`)
      expect(document.querySelector(`.mode-dropdown`)).toBeNull()

      const options = await open_mode_menu()
      expect(mode_toggle.getAttribute(`aria-expanded`)).toBe(`true`)
      const option_for = (text: string) =>
        options.find((opt) => opt.textContent?.includes(text))
      for (const [text, reason] of [
        [`Wyckoff Position`, `symmetry`],
        [`Selective Dynamics`, `selective-dynamics`],
        [`Site Property`, `per-atom properties`],
      ]) {
        const option = option_for(text)
        expect(option?.disabled, text).toBe(true)
        expect(option?.textContent, text).toContain(reason)
        expect(option?.title, text).toContain(reason)
        const hint_id = option?.getAttribute(`aria-describedby`)
        expect(hint_id).toBeTypeOf(`string`)
        expect(document.querySelector(`[id="${hint_id}"]`)?.textContent).toContain(reason)
      }
      for (const text of [`Element`, `Coordination`]) {
        expect(option_for(text)?.disabled, text).toBe(false)
        expect(option_for(text)?.title ?? ``, text).toBe(``)
      }

      mode_toggle.click()
      await tick()
      expect(document.querySelector(`.mode-dropdown`)).toBeNull()
      expect(mode_toggle.getAttribute(`aria-expanded`)).toBe(`false`)
    })

    test(`clicking an option switches mode and clears hidden property values`, async () => {
      const hidden_prop_vals = new Set<string | number>([4, 6])
      mount_legend({
        elements: { Fe: 2, O: 3 },
        atom_color_config: coordination(`categorical`),
        property_colors: prop_colors([4, 6]),
        hidden_prop_vals,
      })
      expect(document.querySelector(`.property-legend`)).toBeInstanceOf(HTMLElement)

      ;(await mode_option(`Element`)).click()
      await tick()
      expect(document.querySelector(`.mode-dropdown`)).toBeNull()
      // the stale coordination-number filter must not survive into the new mode
      expect(hidden_prop_vals.size).toBe(0)
      expect(document.querySelector(`.element-legend`)).toBeInstanceOf(HTMLElement)
      expect(document.querySelector(`.property-legend`)).toBeNull()

      // Mode changes replace the config object rather than mutating it, so read the new
      // mode back off the UI instead of the caller's now-stale object.
      await open_mode_menu()
      expect(doc_query(`.mode-option.selected`).textContent?.trim()).toBe(`Element`)
    })
  })

  describe(`Property Legend - Continuous`, () => {
    test(`integer values render a titled discrete bar with one labeled segment per value`, () => {
      mount_legend({
        atom_color_config: coordination(`continuous`),
        property_colors: prop_colors(
          [2, 4, 6, 8],
          [`#440154`, `#31688e`, `#35b779`, `#fde724`],
        ),
      })

      expect(doc_query(`.property-legend h4.legend-header`).textContent).toBe(`Coordination`)
      // Integer (coordination) data renders a discrete bar, not a continuous gradient
      expect(document.querySelector(`.colorbar .bar`)).toBeNull()

      const segments = document.querySelectorAll<HTMLElement>(
        `.discrete-colorbar .discrete-segment`,
      )
      expect([...segments].map((seg) => seg.textContent?.trim())).toEqual([`2`, `4`, `6`, `8`])
      // Each segment carries the color for its value
      expect(segments[0].style.backgroundColor).toBe(`#440154`)
      expect(segments[3].style.backgroundColor).toBe(`#fde724`)
    })

    test(`renders continuous gradient for non-integer numeric values`, () => {
      mount_legend({
        atom_color_config: {
          mode: `custom`,
          scale_type: `continuous`,
          color_fn: () => `#000000`,
        },
        property_colors: prop_colors([0.5, 2.5]),
      })

      // Non-integer data keeps the smooth gradient ColorBar
      expect(document.querySelector(`.discrete-colorbar`)).toBeNull()
      expect(doc_query(`.colorbar .bar`)).toBeInstanceOf(HTMLElement)

      // Legend forwards min/max as gradient tick labels
      const tick_labels = [...document.querySelectorAll(`.colorbar .tick-label`)].map(
        (label) => label.textContent,
      )
      expect(tick_labels).toEqual([`0.5`, `2.5`])
    })

    // MAX_DISCRETE_SEGMENTS = 20: beyond it the segmented bar would be unreadable
    test.each([
      [1, true],
      [20, true],
      [25, false],
    ])(`%i integer values -> discrete bar: %s`, (n_values, discrete) => {
      const values = Array.from({ length: n_values }, (_, idx) => idx + 1)
      mount_legend({
        atom_color_config: coordination(`continuous`),
        property_colors: prop_colors(values),
      })

      expect(document.querySelector(`.colorbar .bar`) === null).toBe(discrete)
      expect(document.querySelectorAll(`.discrete-segment`)).toHaveLength(
        discrete ? n_values : 0,
      )
    })

    test(`integer property value visibility toggle on discrete bar`, async () => {
      mount_legend({
        atom_color_config: coordination(`continuous`),
        property_colors: prop_colors([4, 6]),
        hidden_prop_vals: new Set<string | number>(),
      })

      const segment = doc_query<HTMLButtonElement>(`.discrete-segment`)
      expect(segment.getAttribute(`aria-pressed`)).toBe(`false`)
      expect(segment.getAttribute(`aria-label`)).toBe(`Hide 4`)

      segment.click()
      await tick()
      expect(segment.getAttribute(`aria-pressed`)).toBe(`true`)
      expect(segment.getAttribute(`aria-label`)).toBe(`Show 4`)

      segment.click()
      await tick()
      expect(segment.getAttribute(`aria-pressed`)).toBe(`false`)
    })

    test(`applies custom HTML attributes via rest props`, () => {
      mount_legend({
        atom_color_config: coordination(`continuous`),
        property_colors: prop_colors([1, 2]),
        'data-testid': `test-legend`,
        style: `z-index: 100;`,
      })

      const legend = doc_query(`.atom-legend`)
      expect(legend.getAttribute(`data-testid`)).toBe(`test-legend`)
      expect(legend.getAttribute(`style`)).toContain(`z-index`)
    })

    test.each([
      [`empty unique_values`, [], [], []],
      [`single value`, [42], [`rgb(255, 128, 0)`], [`black`]],
      [`two values`, [1, 2], [`red`, `blue`], [`white`, `white`]],
      [
        `multiple values`,
        [1, 2, 3, 4],
        [`red`, `yellow`, `green`, `blue`],
        [`white`, `black`, `white`, `white`],
      ],
      // translucent override composites against the page backdrop (white in jsdom) rather
      // than throwing; a faint wash reads as a light cell, half black as mid grey
      [
        `translucent override`,
        [1, 2],
        [`rgba(0, 0, 0, 0.1)`, `rgba(0, 0, 0, 0.5)`],
        [`black`, `white`],
      ],
    ])(
      `handles %s without errors or NaN`,
      (_desc, unique_values, legend_colors, text_colors) => {
        // duplicated values: the legend must still render one segment per unique value
        const property_colors =
          unique_values.length > 0
            ? prop_colors([...unique_values, ...unique_values], legend_colors)
            : null
        mount_legend({ atom_color_config: coordination(`continuous`), property_colors })

        const legend = document.body.querySelector(`.property-legend`)
        if (unique_values.length === 0) {
          expect(legend).toBeNull() // no property colors -> no legend at all
        } else {
          expect(legend?.innerHTML).not.toContain(`NaN`)
          expect(legend?.innerHTML).not.toContain(`undefined`)
          const segments = [...document.querySelectorAll<HTMLElement>(`.discrete-segment`)]
          expect(segments.map((seg) => seg.style.color)).toEqual(text_colors)
        }
      },
    )
  })

  describe(`Property Legend - Categorical`, () => {
    test(`renders one item per unique value with its first site color`, () => {
      mount_legend({
        atom_color_config: coordination(`categorical`),
        property_colors: prop_colors(
          [2, 4, 4, 6],
          [`rgb(255, 0, 0)`, `rgb(0, 255, 0)`, `rgb(0, 0, 255)`, `rgba(0, 0, 0, 0.5)`],
        ),
      })

      const labels = [...document.querySelectorAll<HTMLElement>(`.category-label`)]
      expect(document.querySelectorAll(`.categorical-legend .legend-item`)).toHaveLength(3)
      expect(labels.map((label) => label.textContent?.trim())).toEqual([`2`, `4`, `6`])
      expect(labels.map((label) => label.style.backgroundColor)).toEqual([
        `rgb(255, 0, 0)`,
        `rgb(0, 255, 0)`,
        `rgba(0, 0, 0, 0.5)`,
      ])
      // translucent swatch composites against the page backdrop (white in jsdom) instead of
      // throwing, so half-transparent black reads as mid grey and takes white text
      expect(labels.map((label) => label.style.color)).toEqual([`white`, `black`, `white`])
    })

    test(`formats Wyckoff orbit IDs correctly`, () => {
      mount_legend({
        atom_color_config: { mode: `wyckoff`, scale_type: `categorical` },
        property_colors: prop_colors([`4e|Fe`, `4e|Fe`, `2a|O`]),
      })

      // Format: Element:multiplicity+letter (the orbit id carries the conventional-cell
      // multiplicity; displayed-atom counts would be inflated by supercells/image atoms)
      const labels = [...document.querySelectorAll(`.category-label`)].map((label) =>
        label.textContent?.trim(),
      )
      expect(labels).toEqual([`Fe:4e`, `O:2a`])
    })
  })

  describe(`Mode Switching Behavior`, () => {
    test.each([
      [`element`, { mode: `element`, scale_type: `continuous` } as const, null, true, false],
      [`coordination`, coordination(`continuous`), prop_colors([4]), false, true],
      [
        `element with no elements`,
        { mode: `element`, scale_type: `continuous` } as const,
        null,
        false,
        false,
        {},
      ],
    ])(
      `%s mode shows element legend=%s, property legend=%s`,
      (
        _desc,
        atom_color_config,
        property_colors,
        element_legend,
        property_legend,
        elements = { Fe: 2, O: 3 },
      ) => {
        mount_legend({ elements, atom_color_config, property_colors })

        expect(document.querySelector(`.element-legend`) !== null).toBe(element_legend)
        expect(document.querySelector(`.property-legend`) !== null).toBe(property_legend)
      },
    )
  })

  describe(`Element Remapping`, () => {
    test.each([
      [
        `remapped`,
        { H: `Na`, He: `Cl` } as const,
        `Sodium (remapped from H)`,
        [`Na 1`, `Cl 2`, `Li 3`],
        [true, true, false],
      ],
      [`not remapped`, undefined, `Hydrogen`, [`H 1`, `He 2`, `Li 3`], [false, false, false]],
    ])(
      `labels show the %s element's name, symbol, color and class`,
      (_desc, element_mapping, expected_title, expected_labels, remapped_flags) => {
        mount_legend({ elements: { H: 1, He: 2, Li: 3 }, element_mapping })
        const labels = [...document.querySelectorAll<HTMLLabelElement>(`label`)]
        expect(labels[0].title).toBe(expected_title)
        expect(labels[0].style.backgroundColor).toBe(colors.element[element_mapping?.H ?? `H`])
        expect(label_texts()).toEqual(expected_labels)
        expect(labels.map((label) => label.classList.contains(`remapped`))).toEqual(
          remapped_flags,
        )
      },
    )

    test(`right-click opens a searchable remap dropdown that Escape closes`, async () => {
      mount_legend({ elements: { H: 1 } })
      expect(document.querySelector(`.remap-dropdown`)).toBeNull()

      const search_input = await open_remap_menu()
      expect(search_input.placeholder).toBe(`Search elements...`)
      // unfiltered: one option per element, no reset row while H is still displayed as H
      expect(document.querySelectorAll(`.remap-option`)).toHaveLength(ELEM_SYMBOLS.length)

      search_input.value = `sodium`
      search_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      const filtered_options = document.querySelectorAll(`.remap-option`)
      expect(filtered_options).toHaveLength(1)
      expect(filtered_options[0].textContent?.replaceAll(/\s+/g, ` `).trim()).toBe(
        `11 Na Sodium`,
      )

      search_input.dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
      )
      await tick()
      expect(document.querySelector(`.remap-dropdown`)).toBeNull()
    })

    test.each([
      [`picking Na maps H to Na`, undefined, `.remap-option:has(b)`, `Na`, { H: `Na` }],
      [
        `reset removes the mapping`,
        { H: `Na` },
        `.remap-option.reset`,
        `Reset to H`,
        undefined,
      ],
    ] as const)(`%s`, async (_desc, initial, selector, option_text, expected) => {
      let element_mapping: Record<string, string> | undefined = initial
      mount_legend({
        elements: { H: 1 },
        get element_mapping() {
          return element_mapping
        },
        set element_mapping(val) {
          element_mapping = val
        },
      })
      await open_remap_menu()

      const option = [...document.querySelectorAll<HTMLButtonElement>(selector)].find((opt) =>
        opt.textContent?.includes(option_text),
      )
      if (!option) throw new Error(`no remap option ${option_text}`)
      option.click()
      await tick()

      expect(element_mapping).toEqual(expected) // empty mapping becomes undefined
      expect(document.querySelector(`.remap-dropdown`)).toBeNull() // Dropdown closes
    })
  })
})
