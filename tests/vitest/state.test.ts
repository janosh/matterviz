import type { ChemicalElement } from '$lib'
import { default_category_colors, default_element_colors } from '$lib/colors'
import {
  colors,
  periodic_table_state,
  selected,
  theme_state,
  tooltip,
} from '$lib/state.svelte'
import { AUTO_THEME, COLOR_THEMES, THEME_TYPE } from '$lib/theme'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// Mock localStorage for theme state tests
const local_storage_mock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

Object.defineProperty(globalThis, `localStorage`, {
  value: local_storage_mock,
  writable: true,
})

describe(`State Management`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset all states to initial values
    Object.assign(selected, {
      category: null,
      element: null,
      last_element: null,
      heatmap_key: null,
    })
    Object.assign(colors, {
      category: { ...default_category_colors },
      element: { ...default_element_colors },
    })
    Object.assign(tooltip, { show: false, x: 0, y: 0, title: ``, items: [] })
    Object.assign(periodic_table_state, {
      show_bonding_info: false,
      show_oxidation_state: false,
      highlighted_elements: [],
    })
    Object.assign(theme_state, { mode: AUTO_THEME, system_mode: COLOR_THEMES.light })
  })

  describe(`selected state`, () => {
    test(`has correct initial values`, () => {
      expect(selected).toEqual({
        category: null,
        element: null,
        last_element: null,
        heatmap_key: null,
      })
    })

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

    test(`allows last_element mutations`, () => {
      const test_element = {
        symbol: `He`,
        name: `Helium`,
        number: 2,
        category: `noble gas`,
      } as Partial<ChemicalElement>
      selected.last_element = test_element as ChemicalElement
      expect(selected.last_element).toStrictEqual(test_element)
    })

    test(`allows heatmap_key mutations`, () => {
      selected.heatmap_key = `atomic_mass`
      expect(selected.heatmap_key).toBe(`atomic_mass`)
    })
  })

  describe(`colors state`, () => {
    test(`has correct initial values`, () => {
      expect(colors).toEqual({
        category: default_category_colors,
        element: default_element_colors,
      })
    })

    test.each([
      [`category`, `alkali-metal`, `#ff0000`],
      [`element`, `H`, `#00ff00`],
    ])(`allows %s color mutations`, (type, key, color) => {
      colors[type as keyof typeof colors][key] = color
      expect(colors[type as keyof typeof colors][key]).toBe(color)
    })

    test(`preserves other colors when mutating specific ones`, () => {
      const original_noble_gas = colors.category[`noble-gas`]
      colors.category[`alkali-metal`] = `#ff0000`
      expect(colors.category[`noble-gas`]).toBe(original_noble_gas)
    })
  })

  describe(`tooltip state`, () => {
    test(`has correct initial values`, () => {
      expect(tooltip).toEqual({ show: false, x: 0, y: 0, title: ``, items: [] })
    })

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

    test(`allows title mutations`, () => {
      tooltip.title = `Test Tooltip`
      expect(tooltip.title).toBe(`Test Tooltip`)
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
    test(`has correct initial values`, () => {
      expect(periodic_table_state).toEqual({
        show_bonding_info: false,
        show_oxidation_state: false,
        highlighted_elements: [],
      })
    })

    test(`allows show_bonding_info mutations`, () => {
      periodic_table_state.show_bonding_info = true
      expect(periodic_table_state.show_bonding_info).toBe(true)
    })

    test(`allows show_oxidation_state mutations`, () => {
      periodic_table_state.show_oxidation_state = true
      expect(periodic_table_state.show_oxidation_state).toBe(true)
    })

    test(`allows highlighted_elements mutations`, () => {
      periodic_table_state.highlighted_elements = [`H`, `He`, `Li`]
      expect(periodic_table_state.highlighted_elements).toEqual([`H`, `He`, `Li`])
    })

    test(`allows adding individual elements to highlighted_elements`, () => {
      periodic_table_state.highlighted_elements.push(`H`)
      expect(periodic_table_state.highlighted_elements).toContain(`H`)
    })
  })

  describe(`theme_state`, () => {
    test(`has correct initial values`, () => {
      expect(theme_state).toEqual({
        mode: AUTO_THEME,
        system_mode: COLOR_THEMES.light,
        type: `light`,
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

      colors.category[`alkali-metal`] = `#ff0000`

      expect(selected).toEqual(initial_states.selected)
      expect(tooltip).toEqual(initial_states.tooltip)
      expect(periodic_table_state).toEqual(initial_states.periodic_table)
    })

    test.each(
      [
        [`selected.category`, () => {
          selected.category = `alkali metal`
        }, () => selected.category === `alkali metal`] as const,
        [`tooltip.show`, () => {
          tooltip.show = true
        }, () => tooltip.show === true] as const,
        [`theme_state.mode`, () => {
          theme_state.mode = COLOR_THEMES.dark
        }, () => theme_state.mode === COLOR_THEMES.dark] as const,
        [`colors.category mutation`, () => {
          colors.category[`new-category`] = `#abcdef`
        }, () => colors.category[`new-category`] === `#abcdef`] as const,
      ],
    )(
      `state changes are immediately reflected for %s`,
      (_description, mutate, verify) => {
        mutate()
        expect(verify()).toBe(true)
      },
    )
  })
})
