import type { ChemicalElement } from '$lib'
import { DEFAULT_CATEGORY_COLORS, default_element_colors } from '$lib/colors'
import {
  colors,
  periodic_table_state,
  selected,
  theme_state,
  tooltip,
} from '$lib/state.svelte'
import { AUTO_THEME, COLOR_THEMES, THEME_TYPE } from '$lib/theme'
import { describe, expect, test } from 'vitest'

test(`theme_state has correct initial values`, () => {
  // This test checks the actual initial values without any beforeEach reset
  // to catch breaking changes to the default theme mode
  expect(theme_state.mode).toBe(AUTO_THEME)
  expect(theme_state.system_mode).toBe(COLOR_THEMES.light)
})

describe(`State Management`, () => {
  describe(`selected state`, () => {
    test(`allows category mutations`, () => {
      selected.category = `alkali metal`
      expect(selected.category).toBe(`alkali metal`)
    })

    test(`allows element mutations`, () => {
      const test_element = {
        symbol: `H`,
        name: `Hydrogen`,
        number: 1,
        category: `diatomic nonmetal`,
      } as Partial<ChemicalElement>
      selected.element = test_element as ChemicalElement
      expect(selected.element).toStrictEqual(test_element)
    })

    test(`allows heatmap_key mutations`, () => {
      selected.heatmap_key = `atomic_mass`
      expect(selected.heatmap_key).toBe(`atomic_mass`)
    })
  })

  describe(`colors state`, () => {
    test(`has correct initial values`, () => {
      expect(colors).toEqual({
        category: DEFAULT_CATEGORY_COLORS,
        element: default_element_colors,
      })
    })

    test.each([
      [`category`, `alkali metal`, `#ff0000`],
      [`element`, `H`, `#00ff00`],
    ])(`allows %s color mutations`, (type, key, color) => {
      colors[type as keyof typeof colors][key] = color
      expect(colors[type as keyof typeof colors][key]).toBe(color)
    })

    test(`preserves other colors when mutating specific ones`, () => {
      const orig_noble_gas = colors.category[`noble gas`]
      colors.category[`alkali metal`] = `#ff0000`
      expect(colors.category[`noble gas`]).toBe(orig_noble_gas)
    })
  })

  describe(`tooltip state`, () => {
    test(`allows show mutations`, () => {
      tooltip.show = true
      expect(tooltip.show).toBe(true)
    })

    test(`allows position mutations`, () => {
      tooltip.x = 100
      tooltip.y = 200
      expect(tooltip.x).toBe(100)
      expect(tooltip.y).toBe(200)
    })

    test(`allows items mutations`, () => {
      const test_items = [{ label: `Test`, value: `123`, color: `#ff0000` }, {
        label: `Another`,
        value: `456`,
      }]
      tooltip.items = test_items
      expect(tooltip.items).toEqual(test_items)
    })
  })

  describe(`periodic_table_state`, () => {
    test(`allows show_bonding_info mutations`, () => {
      periodic_table_state.show_bonding_info = true
      expect(periodic_table_state.show_bonding_info).toBe(true)
    })

    test(`allows highlighted_elements mutations`, () => {
      periodic_table_state.highlighted_elements = [`H`, `He`, `Li`]
      expect(periodic_table_state.highlighted_elements).toEqual([`H`, `He`, `Li`])
    })
  })

  describe(`theme_state`, () => {
    test(`handles localStorage errors gracefully`, async () => {
      // Mock localStorage to throw an error
      const orig_localStorage = globalThis.localStorage
      Object.defineProperty(globalThis, `localStorage`, {
        value: {
          getItem: () => {
            throw new Error(`localStorage not available`)
          },
        },
      })

      // Re-import the module to trigger the error handling
      const { theme_state: new_theme_state } = await import(`$lib/state.svelte`)

      // Should fall back to default values
      expect(new_theme_state.mode).toBe(AUTO_THEME)
      expect(new_theme_state.system_mode).toBe(COLOR_THEMES.light)

      // Restore original localStorage
      Object.defineProperty(globalThis, `localStorage`, {
        value: orig_localStorage,
        writable: true,
      })
    })

    test.each([[`mode`, COLOR_THEMES.dark], [`system_mode`, COLOR_THEMES.dark]] as const)(
      `allows %s mutations`,
      (key, value) => {
        theme_state[key] = value
        expect(theme_state[key]).toBe(value)
      },
    )

    describe(`type getter`, () => {
      test.each([
        [COLOR_THEMES.light, COLOR_THEMES.light, `light`],
        [COLOR_THEMES.dark, COLOR_THEMES.light, `dark`],
        [COLOR_THEMES.white, COLOR_THEMES.light, `light`],
        [COLOR_THEMES.black, COLOR_THEMES.light, `dark`],
        [AUTO_THEME, COLOR_THEMES.light, `light`],
        [AUTO_THEME, COLOR_THEMES.dark, `dark`],
      ])(
        `returns %s for mode %s with system_mode %s`,
        (mode, system_mode, expected_type) => {
          Object.assign(theme_state, { mode, system_mode })
          expect(theme_state.type).toBe(expected_type)
        },
      )

      test.each([
        [AUTO_THEME, `uses system_mode when mode is AUTO_THEME`],
        [COLOR_THEMES.black, `uses mode when mode is not AUTO_THEME`],
      ])(`correctly handles %s`, (mode, _description) => {
        theme_state.mode = mode
        theme_state.system_mode = COLOR_THEMES.dark
        const expected = mode === AUTO_THEME
          ? `dark`
          : THEME_TYPE[mode as keyof typeof THEME_TYPE]
        expect(theme_state.type).toBe(expected)
      })

      test(`handles all theme modes correctly`, () => {
        Object.entries(THEME_TYPE).forEach(([theme_mode, expected_type]) => {
          theme_state.mode = theme_mode as keyof typeof THEME_TYPE
          theme_state.system_mode = COLOR_THEMES.light
          expect(theme_state.type).toBe(expected_type)
        })
      })
    })
  })

  describe(`state isolation & reactivity`, () => {
    test(`mutating one state does not affect others`, () => {
      const initial_states = {
        selected: { ...selected },
        tooltip: { ...tooltip },
        periodic_table: { ...periodic_table_state },
      }

      colors.category[`alkali metal`] = `#ff0000`

      expect(selected).toEqual(initial_states.selected)
      expect(tooltip).toEqual(initial_states.tooltip)
      expect(periodic_table_state).toEqual(initial_states.periodic_table)
    })
  })
})
