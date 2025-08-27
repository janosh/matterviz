import WyckoffTable from '$lib/symmetry/WyckoffTable.svelte'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// Mock the colors store
vi.mock(`$lib/state.svelte`, () => ({
  colors: {
    element: {
      H: `#ffffff`,
      O: `#ff0000`,
      Fe: `#0000ff`,
    },
  },
}))

// Mock the contrast_color function to be a no-op
vi.mock(`$lib`, async () => {
  const actual = await vi.importActual(`$lib`)
  return {
    ...actual,
    contrast_color: () => () => {}, // No-op action that does nothing
  }
})

describe(`WyckoffTable`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  test(`renders nothing when wyckoff_positions is empty`, () => {
    mount(WyckoffTable, { target: document.body, props: { wyckoff_positions: [] } })
    expect(document.querySelector(`table`)).toBeFalsy()
  })

  test(`renders nothing when wyckoff_positions is null`, () => {
    mount(WyckoffTable, { target: document.body, props: { wyckoff_positions: null } })
    expect(document.querySelector(`table`)).toBeFalsy()
  })

  test(`component can be imported without errors`, () => {
    expect(WyckoffTable).toBeDefined()
    expect(typeof WyckoffTable).toBe(`function`)
  })
})
