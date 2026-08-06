import {
  create_tick_candidate,
  generate_ellipsis_candidate,
  generate_stagger_candidate,
  generate_thinned_candidate,
  type TickStrategy,
} from '$lib/plot/core/tick-strategies'
import { SvelteSet } from 'svelte/reactivity'
import { describe, expect, test } from 'vitest'

const base_candidate = create_tick_candidate({
  id: `upright`,
  strategy: `upright`,
  labels: [`Alpha`, `Beta`, `Gamma`, `Delta`, `Epsilon`],
})

describe(`tick strategy candidates`, () => {
  test(`represents caller-provided wrap and rotation layouts with the shared contract`, () => {
    const wrapped = create_tick_candidate({
      id: `wrapped`,
      strategy: `wrap`,
      labels: [{ full_text: `Formation energy`, display_lines: [`Formation`, `energy`] }],
    })
    const rotated = create_tick_candidate({
      id: `rotated`,
      strategy: `rotate`,
      labels: [`Formation energy`],
      rotation_deg: -45,
    })

    expect(wrapped.labels[0]).toMatchObject({
      tick_index: 0,
      full_text: `Formation energy`,
      display_lines: [`Formation`, `energy`],
      visible: true,
      stagger_row: 0,
      information_loss: 0,
    })
    expect(rotated.rotation_deg).toBe(-45)
  })

  test(`staggering alternates two rows over visible labels without moving tick slots`, () => {
    const partially_hidden = create_tick_candidate({
      id: `partially-hidden`,
      strategy: `upright`,
      labels: [`Alpha`, { full_text: `Beta`, visible: false }, `Gamma`, `Delta`, `Epsilon`],
    })
    const staggered = generate_stagger_candidate(partially_hidden, {
      id: `staggered`,
      first_row: 1,
    })

    expect(staggered.labels.map(({ tick_index }) => tick_index)).toEqual([0, 1, 2, 3, 4])
    expect(staggered.labels.map(({ stagger_row }) => stagger_row)).toEqual([1, 0, 0, 1, 0])
    expect(staggered.labels.map(({ visible }) => visible)).toEqual([
      true,
      false,
      true,
      true,
      true,
    ])
  })

  test(`thinning keeps stable slots and exactly the supplied visible-index subset`, () => {
    const thinned = generate_thinned_candidate(base_candidate, new SvelteSet([0, 2, 4]), {
      id: `thinned`,
    })

    expect(thinned.labels).toHaveLength(base_candidate.labels.length)
    expect(
      thinned.labels.filter(({ visible }) => visible).map(({ tick_index }) => tick_index),
    ).toEqual([0, 2, 4])
    expect(thinned.labels.map(({ full_text }) => full_text)).toEqual(
      base_candidate.labels.map(({ full_text }) => full_text),
    )
  })

  test(`measured ellipsis chooses the longest fitting grapheme prefix`, () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: `grapheme` })
    const measure_text = (text: string): number =>
      text === `ab…` ? 4 : text === `abc…` ? 3 : Array.from(segmenter.segment(text)).length
    const candidate = create_tick_candidate({
      id: `unabridged`,
      strategy: `upright`,
      labels: [`abcdefgh`, `AB👩‍🔬CDEF`, `xyz`, `abcd`, `Formation energy per atom`],
    })
    const ellipsized = generate_ellipsis_candidate(candidate, {
      id: `ellipsized`,
      max_width_px: [5, 5, 0, 3, 2],
      measure_text,
    })

    expect(ellipsized.labels.map(({ display_lines }) => display_lines[0])).toEqual([
      `abcd…`,
      `AB👩‍🔬C…`,
      `xyz`,
      `abc…`,
      `Formation energy per atom`,
    ])
    ellipsized.labels.slice(0, 2).forEach((label, label_idx) => {
      expect(measure_text(label.display_lines[0])).toBeLessThanOrEqual([5, 5, 0][label_idx])
    })
    expect(ellipsized.labels.map(({ full_text }) => full_text)).toEqual(
      candidate.labels.map(({ full_text }) => full_text),
    )
    expect(ellipsized.labels.map(({ information_loss }) => information_loss > 0)).toEqual([
      true,
      true,
      false,
      true,
      false,
    ])
  })

  const invalid_candidate =
    (overrides: Partial<Parameters<typeof create_tick_candidate>[0]>): (() => unknown) =>
    () =>
      create_tick_candidate({ ...base_candidate, ...overrides })
  const invalid_ellipsis =
    (
      max_width_px: number | readonly number[],
      measure_text: (text: string) => number,
    ): (() => unknown) =>
    () =>
      generate_ellipsis_candidate(base_candidate, {
        id: `invalid`,
        max_width_px,
        measure_text,
      })

  test.each([
    [`an empty id`, invalid_candidate({ id: ` ` }), /id must not be empty/u],
    [
      `an unknown strategy`,
      invalid_candidate({ strategy: `unknown` as unknown as TickStrategy }),
      /unknown strategy/u,
    ],
    [
      `a non-finite rotation`,
      invalid_candidate({ strategy: `rotate`, rotation_deg: Infinity }),
      /rotation_deg must be finite/u,
    ],
    [
      `information loss outside [0, 1]`,
      invalid_candidate({
        strategy: `ellipsis`,
        labels: [{ full_text: `Alpha`, information_loss: 1.1 }],
      }),
      /information_loss.*\[0, 1\]/u,
    ],
    [
      `an out-of-range visible index`,
      () =>
        generate_thinned_candidate(
          base_candidate,
          new SvelteSet([base_candidate.labels.length]),
          { id: `invalid-thinning` },
        ),
      /candidate "upright".*outside/u,
    ],
    [
      `negative ellipsis width`,
      invalid_ellipsis(-1, (text) => text.length),
      /finite non-negative/u,
    ],
    [
      `mismatched ellipsis widths`,
      invalid_ellipsis([10], (text) => text.length),
      /must match/u,
    ],
    [`invalid text measurement`, invalid_ellipsis(10, () => Number.NaN), /measured width/u],
  ])(`rejects %s`, (_name, call, expected_error) => {
    expect(call).toThrow(expected_error)
  })
})
