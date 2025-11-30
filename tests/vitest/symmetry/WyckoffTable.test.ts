import { WyckoffTable } from '$lib/symmetry'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`WyckoffTable`, () => {
  test.each([[], null, undefined] as const)(
    `renders nothing when wyckoff_positions is %s`,
    (wyckoff_positions) => {
      mount(WyckoffTable, {
        target: document.body,
        props: { wyckoff_positions: wyckoff_positions as never },
      })
      expect(document.querySelector(`table`)).toBeFalsy()
    },
  )
})
