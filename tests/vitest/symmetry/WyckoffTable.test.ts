import { WyckoffTable } from '$lib/symmetry'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`WyckoffTable`, () => {
  test.each([[], null, undefined])(
    `renders nothing when wyckoff_positions is %s`,
    (wyckoff_positions) => {
      mount(WyckoffTable, { target: document.body, props: { wyckoff_positions } })
      expect(document.querySelector(`table`)).toBeFalsy()
    },
  )
})
