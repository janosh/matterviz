import type { WyckoffPos } from '$lib/symmetry'
import { WyckoffTable } from '$lib/symmetry'
import type { ComponentProps } from 'svelte'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'

describe(`WyckoffTable`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  const mount_table = (
    wyckoff_positions: WyckoffPos[] | null | undefined,
  ) =>
    mount(WyckoffTable, {
      target: document.body,
      props: {
        wyckoff_positions: wyckoff_positions as ComponentProps<
          typeof WyckoffTable
        >[`wyckoff_positions`],
      },
    })

  test.each(
    [
      [`empty array`, [] as WyckoffPos[]],
      [`null`, null],
      [`undefined`, undefined],
    ] as [string, WyckoffPos[] | null | undefined][],
  )(`renders nothing when wyckoff_positions is %s`, (_, wyckoff_positions) => {
    mount_table(wyckoff_positions)
    expect(document.querySelector(`table`)).toBeFalsy()
  })

  test(`renders duplicate semantic rows without keyed-each crash`, () => {
    const duplicate_semantic_rows: WyckoffPos[] = [
      {
        wyckoff: `1`,
        elem: `Ac`,
        abc: [0, 0, 0],
        site_indices: [0],
      },
      {
        wyckoff: `1`,
        elem: `Ac`,
        abc: [0, 0, 0],
        site_indices: [0],
      },
    ]

    expect(() => mount_table(duplicate_semantic_rows)).not.toThrow()

    const rendered_rows = document.querySelectorAll(`tbody tr`)
    expect(rendered_rows).toHaveLength(2)
  })
})
