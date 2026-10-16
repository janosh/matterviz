<script lang="ts">
  // Controls for stacking a film slab on a substrate slab: the Zur–McGill coincidence-lattice
  // matches (scatter of cell area vs strain, plus a keyboard-friendly <select>), the gap,
  // vacuum and in-plane registry shift. The built Crystal is exposed through
  // `bind:interface` so the caller decides how to render it (typically a <Structure>).
  import { format_num } from '#lib/labels.js'
  import type { Vec2 } from '#lib/math.js'
  import * as math from '#lib/math.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import type { Crystal } from '#lib/structure/index.js'
  import { to_error } from '#lib/utils.js'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { match_lattices, surface_frame } from './lattice-match'
  import { make_interface } from './stack'
  import type { Heterostructure, LatticeMatch } from './types'
  import { INTERFACE_DEFAULTS } from './types'

  let {
    substrate,
    film,
    match_idx = $bindable(0),
    gap = $bindable(INTERFACE_DEFAULTS.gap),
    vacuum = $bindable(INTERFACE_DEFAULTS.vacuum),
    shift = $bindable([0, 0]),
    max_area = $bindable(INTERFACE_DEFAULTS.max_area),
    length_tol = $bindable(INTERFACE_DEFAULTS.length_tol),
    angle_tol = $bindable(INTERFACE_DEFAULTS.angle_tol),
    interface: heterostructure = $bindable(null),
    error = $bindable(null),
    children,
    ...rest
  }: {
    // Slabs whose lattice rows a and b span the surface, e.g. from make_slab
    substrate: Crystal
    film: Crystal
    // Index into the matches (smallest cell first); clamped when the list shrinks
    match_idx?: number
    gap?: number
    vacuum?: number
    shift?: Vec2
    max_area?: number
    length_tol?: number
    angle_tol?: number
    // The stacked heterostructure, or null while there is no match or the inputs fail
    interface?: Heterostructure | null
    error?: string | null
    // Extra controls rendered at the start of the controls row
    children?: Snippet
  } & HTMLAttributes<HTMLDivElement> = $props()

  // Matches depend on the two in-plane meshes only, so slab thickness edits keep the pick
  const matching = $derived.by((): { matches: LatticeMatch[]; error: string | null } => {
    try {
      const [sub_basis, film_basis] = [substrate, film].map(
        (slab) => surface_frame(slab).basis,
      )
      return {
        matches: match_lattices(sub_basis, film_basis, { max_area, length_tol, angle_tol }),
        error: null,
      }
    } catch (err) {
      return { matches: [], error: to_error(err).message }
    }
  })
  const { matches } = $derived(matching)
  const selected_idx = $derived(math.clamp(match_idx, 0, Math.max(0, matches.length - 1)))
  const match = $derived(matches.at(selected_idx))
  const result = $derived.by((): { built: Heterostructure | null; error: string | null } => {
    if (matching.error || !match) return { built: null, error: matching.error }
    try {
      return {
        built: make_interface(substrate, film, { match, gap, vacuum, shift }),
        error: null,
      }
    } catch (err) {
      return { built: null, error: to_error(err).message }
    }
  })
  $effect(() => {
    ;({ built: heterostructure, error } = result)
    if (matches.length > 0) match_idx = selected_idx
  })

  let x_axis = $state({ label: `Interface cell area (Å²)` })
  let y_axis = $state({ label: `von Mises strain (%)` })
  const series = $derived([
    {
      x: matches.map(({ area }) => area),
      y: matches.map(({ von_mises }) => von_mises * 100),
      markers: `points` as const,
      label: `matches`,
      point_style: { radius: 5, cursor: `pointer` },
    },
  ])

  const pct = (val: number): string => `${format_num(val * 100, `.3~f`)} %`
  const match_label = (
    { n_film_cells, n_substrate_cells, area, von_mises, rotation_deg }: LatticeMatch,
    idx: number,
  ): string =>
    [
      `#${idx + 1}`,
      `${n_film_cells} : ${n_substrate_cells} cells`,
      `${format_num(area, `.1f`)} Å²`,
      pct(von_mises),
      `${format_num(rotation_deg, `.1f`)}°`,
    ].join(` · `)

  // One slider per stacking control; shift components replace the whole tuple so a parent
  // passing a plain array still sees the change
  const sliders = $derived([
    {
      label: `Gap`,
      value: gap,
      max: 6,
      step: 0.05,
      unit: ` Å`,
      set: (val: number) => (gap = val),
    },
    {
      label: `Vacuum`,
      value: vacuum,
      max: 40,
      step: 0.5,
      unit: ` Å`,
      set: (val: number) => (vacuum = val),
    },
    {
      label: `Shift a`,
      value: shift[0],
      max: 1,
      step: 0.01,
      unit: ``,
      set: (val: number) => (shift = [val, shift[1]]),
    },
    {
      label: `Shift b`,
      value: shift[1],
      max: 1,
      step: 0.01,
      unit: ``,
      set: (val: number) => (shift = [shift[0], val]),
    },
  ])
  // Search settings commit on change, not per keystroke
  const tolerances = $derived([
    {
      label: `Max area (Å²)`,
      value: max_area,
      step: 50,
      set: (val: number) => (max_area = val),
    },
    {
      label: `Length tol`,
      value: length_tol,
      step: 0.005,
      set: (val: number) => (length_tol = val),
    },
    {
      label: `Angle tol`,
      value: angle_tol,
      step: 0.005,
      set: (val: number) => (angle_tol = val),
    },
  ])

  const rows = $derived.by((): [string, string][] => {
    const built = result.built
    if (!built || !match) return []
    const {
      strain: [[exx, exy], [, eyy]],
      von_mises,
      rotation_deg,
      area,
    } = match
    const { n_substrate_sites, n_film_sites } = built.interface_info
    return [
      [`Interface area`, `${format_num(area, `.4~f`)} Å²`],
      [`Cells film / substrate`, `${match.n_film_cells} / ${match.n_substrate_cells}`],
      [`Strain εxx, εyy, εxy`, [exx, eyy, exy].map(pct).join(`, `)],
      [`von Mises strain`, pct(von_mises)],
      [`Film rotation`, `${format_num(rotation_deg, `.3~f`)}°`],
      [
        `Atoms`,
        `${built.sites.length} (${n_substrate_sites} substrate, ${n_film_sites} film)`,
      ],
      [`Cell height c`, `${format_num(built.lattice.c, `.3~f`)} Å`],
    ]
  })
</script>

<div {...rest} class={[`interface-builder`, rest.class]}>
  <div class="controls">
    {@render children?.()}
    {#each tolerances as { label, value, step, set } (label)}
      <label>
        {label}
        <input
          type="number"
          min="0"
          {step}
          {value}
          onchange={(event) => set(Number(event.currentTarget.value))}
        />
      </label>
    {/each}
    {#if matches.length > 0}
      <label>
        Match
        <select
          value={selected_idx}
          onchange={(event) => (match_idx = Number(event.currentTarget.value))}
        >
          {#each matches as option, idx (idx)}
            <option value={idx}>{match_label(option, idx)}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>
  <div class="controls">
    {#each sliders as { label, value, max, step, unit, set } (label)}
      <label>
        {label}
        <input
          type="range"
          min="0"
          {max}
          {step}
          {value}
          oninput={(event) => set(Number(event.currentTarget.value))}
        />
        <span class="value">{format_num(value, `.2f`)}{unit}</span>
      </label>
    {/each}
  </div>
  {#if result.error}
    <p class="error">{result.error}</p>
  {:else if matches.length === 0}
    <p class="empty">
      No coincidence cell up to {format_num(max_area, `.4~f`)} Å² fits within length_tol = {length_tol}
      and angle_tol = {angle_tol}. Raise the max area or loosen the tolerances.
    </p>
  {/if}
  {#if matches.length > 0}
    <ScatterPlot
      {series}
      bind:x_axis
      bind:y_axis
      selected_point={{ series_idx: 0, point_idx: selected_idx }}
      on_point_click={({ point }) => (match_idx = point.point_idx)}
      style="height: 240px"
    />
  {/if}
  {#if rows.length > 0}
    <dl>
      {#each rows as [term, value] (term)}
        <div>
          <dt>{term}</dt>
          <dd title={value}>{value}</dd>
        </div>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1ex 1em;
    margin-block: 0.5em;
    label {
      display: flex;
      align-items: center;
      gap: 0.5em;
    }
    input[type='number'] {
      width: 5em;
    }
    select {
      max-width: 100%;
      font-variant-numeric: tabular-nums;
    }
    .value {
      display: inline-block;
      min-width: 6ch;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  }
  .error {
    color: var(--error-color, tomato);
    font-family: monospace;
    white-space: pre-wrap;
  }
  .empty {
    opacity: 0.8;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 22em), 1fr));
    gap: 4pt 2em;
    margin: 1em 0;
    div {
      display: flex;
      justify-content: space-between;
      gap: 1em;
      min-width: 0;
      border-bottom: 1px solid var(--border-color, #3339);
      padding: 2pt 0;
    }
    dt {
      opacity: 0.7;
      white-space: nowrap;
    }
    dd {
      margin: 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
</style>
