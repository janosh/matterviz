<script lang="ts">
  // Controls for stacking a film slab on a substrate slab: the Zur–McGill coincidence-lattice
  // matches (scatter of cell area vs strain, plus a keyboard-friendly <select>), the gap,
  // vacuum and in-plane registry shift. The built Crystal is exposed through
  // `bind:interface` so the caller decides how to render it (typically a <Structure>).
  import { format_num } from '#lib/labels.js'
  import type { Vec2 } from '#lib/math.js'
  import * as math from '#lib/math.js'
  import { ControlGroup, KeyValueList } from '#lib/layout/index.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import type { Crystal } from '#lib/structure/index.js'
  import { to_error } from 'svelte-widgets/utils'
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
  // The search limits only matter when the matches fall short, so the collapsible opens by
  // itself then. It never closes by itself: a search that finds matches again would
  // collapse it under the input the user is still typing in.
  let limits_open = $state(false)
  $effect(() => {
    if (matches.length === 0) limits_open = true
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
      // the match number, as in the select, the stats and a host's URL (?match=7)
      // placed by the scatter's label solver, so numbers in dense clusters don't overlap
      point_label: matches.map((_, idx) => ({
        text: String(idx + 1),
        font_size: `10px`,
        auto_placement: true,
      })),
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
      [`Match`, `#${selected_idx + 1} of ${matches.length}`],
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
  <div class="groups">
    <ControlGroup legend="Match">
      {#if matches.length > 0}
        <label>
          Coincidence cell
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
      <details bind:open={limits_open}>
        <summary>Search limits</summary>
        <div class="limits">
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
        </div>
      </details>
    </ControlGroup>
    <ControlGroup legend="Stacking" class="sliders">
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
    </ControlGroup>
  </div>
  {#if result.error}
    <p class="error">{result.error}</p>
  {:else if matches.length === 0}
    <p class="empty">
      No coincidence cell up to {format_num(max_area, `.4~f`)} Å² fits within length_tol = {length_tol}
      and angle_tol = {angle_tol}. Raise the max area or loosen the tolerances.
    </p>
  {/if}
  <!-- plot and stats side by side where they fit, stacked otherwise -->
  <div class="results">
    {#if matches.length > 0}
      <ScatterPlot
        {series}
        bind:x_axis
        bind:y_axis
        selected_point={{ series_idx: 0, point_idx: selected_idx }}
        on_point_click={({ point }) => (match_idx = point.point_idx)}
        style="height: 240px; min-width: 0"
      />
    {/if}
    {#if rows.length > 0}<KeyValueList {rows} />{/if}
  </div>
</div>

<style>
  /* purpose-named groups side by side, stacking on narrow screens */
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 24em), 1fr));
    gap: 1em;
    margin-block: 0.5em;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.5em;
    select {
      flex: 1;
      min-width: 0;
      font-variant-numeric: tabular-nums;
    }
  }
  /* two short sliders per row where the width allows; a fixed label column keeps tracks
     aligned down each column, and 7ch fits "15.00 Å" */
  .groups :global(.sliders) {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15em), 1fr));
    column-gap: 1.5em;
    label {
      display: grid;
      grid-template-columns: 4.2em 1fr 7ch;
      input {
        min-width: 0;
      }
    }
  }
  summary {
    cursor: pointer;
    opacity: 0.8;
  }
  .limits {
    display: flex;
    flex-wrap: wrap;
    gap: 1ex 1em;
    margin-top: 0.5ex;
    input {
      width: 5em;
    }
  }
  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .error {
    color: var(--error-color, tomato);
    font-family: monospace;
    white-space: pre-wrap;
  }
  .empty {
    opacity: 0.8;
  }
  .results {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 26em), 1fr));
    align-items: start;
    gap: 1em 2em;
  }
</style>
