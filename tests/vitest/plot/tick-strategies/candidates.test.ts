import {
  create_tick_candidate,
  generate_abbreviated_candidate,
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

  test(`semantic abbreviation protects units and labels with no-break characters`, () => {
    const candidate = create_tick_candidate({
      id: `long-labels`,
      strategy: `upright`,
      labels: [
        `Average Temperature (eV/Å³)`,
        `Minimum Pressure [GPa]`,
        `Average\u00A0Temperature (K)`,
        `Maximum\u2011Pressure`,
        `constructor`,
      ],
    })
    const abbreviated = generate_abbreviated_candidate(candidate, {
      id: `abbreviated`,
    })

    expect(abbreviated.labels.map(({ display_lines }) => display_lines[0])).toEqual([
      `Avg. Temp. (eV/Å³)`,
      `Min. Press. [GPa]`,
      `Average\u00A0Temperature (K)`,
      `Maximum\u2011Pressure`,
      `constructor`,
    ])
    expect(abbreviated.labels.map(({ full_text }) => full_text)).toEqual(
      candidate.labels.map(({ full_text }) => full_text),
    )
    expect(
      abbreviated.labels.slice(0, 2).every(({ information_loss }) => information_loss > 0),
    ).toBe(true)
    expect(
      abbreviated.labels.slice(2).every(({ information_loss }) => information_loss === 0),
    ).toBe(true)
  })

  test(`measured ellipsis chooses the longest fitting grapheme prefix`, () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: `grapheme` })
    const measure_text = (text: string): number => Array.from(segmenter.segment(text)).length
    const candidate = create_tick_candidate({
      id: `unabridged`,
      strategy: `upright`,
      labels: [`abcdefgh`, `AB👩‍🔬CDEF`, `xyz`],
    })
    const ellipsized = generate_ellipsis_candidate(candidate, {
      id: `ellipsized`,
      max_width_px: [5, 5, 0],
      measure_text,
    })

    expect(ellipsized.labels.map(({ display_lines }) => display_lines[0])).toEqual([
      `abcd…`,
      `AB👩‍🔬C…`,
      `xyz`,
    ])
    ellipsized.labels.slice(0, 2).forEach((label, label_idx) => {
      expect(measure_text(label.display_lines[0])).toBeLessThanOrEqual([5, 5, 0][label_idx])
    })
    expect(ellipsized.labels.map(({ full_text }) => full_text)).toEqual([
      `abcdefgh`,
      `AB👩‍🔬CDEF`,
      `xyz`,
    ])
    expect(ellipsized.labels.map(({ information_loss }) => information_loss > 0)).toEqual([
      true,
      true,
      false,
    ])
  })

  test(`keeps meaningful source text when ellipsis would retain too little information`, () => {
    const candidate = create_tick_candidate({
      id: `long-label`,
      strategy: `upright`,
      labels: [`Formation energy per atom`],
    })
    const ellipsized = generate_ellipsis_candidate(candidate, {
      id: `not-bare`,
      max_width_px: 2,
      measure_text: (text) => Array.from(text).length,
    })

    expect(ellipsized.labels[0]).toMatchObject({
      display_lines: [`Formation energy per atom`],
      information_loss: 0,
    })
  })

  test.each([
    [`an empty id`, { id: ` ` }, /id must not be empty/u],
    [
      `an unknown strategy`,
      { strategy: `unknown` as unknown as TickStrategy },
      /unknown strategy/u,
    ],
    [
      `a non-finite rotation`,
      { strategy: `rotate` as const, rotation_deg: Infinity },
      /rotation_deg must be finite/u,
    ],
    [
      `information loss outside [0, 1]`,
      {
        strategy: `abbreviate` as const,
        labels: [{ full_text: `Alpha`, information_loss: 1.1 }],
      },
      /information_loss.*\[0, 1\]/u,
    ],
  ] as const)(`rejects %s`, (_name, overrides, expected_error) => {
    expect(() => create_tick_candidate({ ...base_candidate, ...overrides })).toThrow(
      expected_error,
    )
  })

  test(`rejects a visible index outside the source candidate`, () => {
    expect(() =>
      generate_thinned_candidate(
        base_candidate,
        new SvelteSet([base_candidate.labels.length]),
        { id: `invalid-thinning` },
      ),
    ).toThrow(/candidate "upright".*outside/u)
  })

  test.each([
    [`empty key`, { [``]: `value` }],
    [`empty value`, { alpha: ` ` }],
  ])(`rejects an abbreviation with an %s`, (_name, abbreviations) => {
    expect(() =>
      generate_abbreviated_candidate(base_candidate, {
        id: `invalid-abbreviation`,
        abbreviations,
      }),
    ).toThrow(/abbreviation keys and values must not be empty/u)
  })

  test.each([
    [
      `negative ellipsis width`,
      { max_width_px: -1, measure_text: (text: string) => text.length },
      /finite non-negative/u,
    ],
    [
      `mismatched ellipsis widths`,
      { max_width_px: [10], measure_text: (text: string) => text.length },
      /must match/u,
    ],
    [
      `invalid text measurement`,
      { max_width_px: 10, measure_text: () => Number.NaN },
      /measured width/u,
    ],
  ])(`rejects %s`, (_name, options, expected_error) => {
    expect(() =>
      generate_ellipsis_candidate(base_candidate, { id: `invalid`, ...options }),
    ).toThrow(expected_error)
  })
})
