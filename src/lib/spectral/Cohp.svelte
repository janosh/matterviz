<script module lang="ts">
  // Derived columns per source column, shared by every Cohp (see `signed` below)
  const negated = new WeakMap<Float64Array, Float64Array>()
  const spin_sums = new WeakMap<Float64Array, Float64Array>()
</script>

<script lang="ts">
  import SettingsSection from 'svelte-widgets/SettingsSection.svelte'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import { format_num } from 'svelte-widgets/format'
  import { TooltipValue } from '#lib/tooltip/index.js'
  import { add_alpha, plot_color } from '#lib/colors/index.js'
  import { sanitize_html } from '#lib/sanitize.js'
  import ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
  import { DEFAULT_PLOT_PADDING, plot_area_line } from '#lib/plot/core/layout.js'
  import type { AxisConfig, DataSeries } from '#lib/plot/core/types.js'
  import type { ScatterHandlerProps, ScatterPlotOptions } from '#lib/plot/index.js'
  import {
    bonding_sign,
    type CohpCurves,
    type CohpData,
    lobster_quantity_label,
    type SpinChannels,
  } from './lobster'
  import { COHP_SPIN_MODES } from './helpers'
  import Dos from './Dos.svelte'
  import type { DosOptions } from './index'
  import {
    create_bands_dos_sync,
    MIN_SIDE_BY_SIDE_WIDTH,
    SIDE_DOS_WIDTH,
  } from './synced-axes.svelte'
  import type { CohpSpinMode, ElectronicDos } from './types'

  type SeriesMeta = {
    bond: string // CohpBond.label, or `average`
    spin: `up` | `down` | `total`
    integrated: boolean
  }

  let {
    cohp,
    bonds = null,
    show_average = $bindable(false),
    spin_mode = $bindable(`overlay`),
    show_integrated = $bindable(false),
    shift_to_fermi = $bindable(true),
    highlighted_bonds = [],
    hovered_bond = $bindable(null),
    on_bond_click,
    display = $bindable({ x_grid: true, y_grid: true, x_zero_line: true, y_zero_line: true }),
    controls_open = $bindable(false),
    doses,
    dos_props = {},
    ...rest
  }: Omit<ScatterPlotOptions, `controls_extra` | `series`> & {
    cohp: CohpData // from parse_cohpcar
    // Pairs (CohpBond.label) and orbital pairs (their `key`, see orbital_key) to draw, in this
    // order (which picks their colors: plot_color of the position); null draws all pairs
    bonds?: readonly string[] | null
    show_average?: boolean // LOBSTER's average over all pairs, in gray
    spin_mode?: CohpSpinMode // ignored for spin-restricted data
    // Running integral (ICOHP/ICOOP/ICOBI) as dotted lines on a secondary axis
    show_integrated?: boolean
    // Energies relative to E_F (as LOBSTER writes them) or absolute (shifted by the file's E_F)
    shift_to_fermi?: boolean
    // Pairs and orbital pairs (as in `bonds`) drawn bold; with any set, the others fade
    highlighted_bonds?: readonly string[]
    hovered_bond?: string | null // output: `bonds` key of the curve under the pointer, or `average`
    on_bond_click?: (key: string) => void // `bonds` key of the clicked curve (not Average)
    // Densities of states with energies relative to E_F (as `cohp`'s, e.g. parse_doscar's),
    // beside the curves on their energy axis, or below them in containers narrower than
    // MIN_SIDE_BY_SIDE_WIDTH
    doses?: Record<string, ElectronicDos>
    dos_props?: DosOptions // extra props for the DOS panel
  } = $props()

  const energy_offset = $derived(shift_to_fermi ? 0 : cohp.efermi)
  const highlighted = $derived(new Set(highlighted_bonds))

  // Bonding-positive columns, made once per LOBSTER column: toggles and restyles hand the plot
  // the same arrays, so its per-array line and obstacle caches keep hitting
  const signed = (column: Float64Array): Float64Array => {
    if (bonding_sign(cohp.kind) === 1) return column
    let hit = negated.get(column)
    if (!hit) negated.set(column, (hit = column.map((val) => -val)))
    return hit
  }
  const spin_sum = (up: Float64Array, down: Float64Array): Float64Array => {
    let hit = spin_sums.get(up)
    const signed_down = signed(down)
    if (!hit) spin_sums.set(up, (hit = signed(up).map((val, idx) => val + signed_down[idx])))
    return hit
  }
  const channels = ({ up, down }: SpinChannels<Float64Array>) =>
    !down || spin_mode === `up_only`
      ? ([[`up`, signed(up)]] as const)
      : spin_mode === `down_only`
        ? ([[`down`, signed(down)]] as const)
        : spin_mode === `sum`
          ? ([[`total`, spin_sum(up, down)]] as const)
          : ([
              [`up`, signed(up)],
              [`down`, signed(down)],
            ] as const)
  const energies = $derived(
    energy_offset ? cohp.energies.map((energy) => energy + energy_offset) : cohp.energies,
  )
  const shifted_doses = $derived(
    doses &&
      Object.fromEntries(
        Object.entries(doses).map(([key, dos]) => [
          key,
          { ...dos, energies: dos.energies.map((energy) => energy + energy_offset) },
        ]),
      ),
  )

  const series_data = $derived.by(() => {
    const by_key = new Map<string, { label: string; curves: CohpCurves }>()
    for (const bond of cohp.bonds) {
      const [{ label: atom_1 }, { label: atom_2 }] = bond.atoms
      const length = format_num(bond.length, `.3~f`)
      by_key.set(bond.label, {
        label: `${atom_1}–${atom_2} #${bond.label} (${length} Å)`,
        curves: bond,
      })
      for (const { key, orbitals, ...curves } of bond.orbitals)
        by_key.set(key, {
          label: `${atom_1}[${orbitals[0]}]–${atom_2}[${orbitals[1]}] #${bond.label}`,
          curves,
        })
    }
    // colored in drawn order, so up to PLOT_COLORS' length of shown curves never share a color
    const pairs = (bonds ?? cohp.bonds.map(({ label }) => label)).map((key, idx) => {
      const pair = by_key.get(key)
      if (!pair)
        throw new Error(`Cohp: no pair or orbital pair "${key}" in the ${cohp.kind}CAR`)
      return { key, color: plot_color(idx), ...pair }
    })
    const average = {
      key: `average`,
      label: `Average`,
      color: `#8c8c8c`,
      curves: cohp.average,
    }
    return [...(show_average ? [average] : []), ...pairs].flatMap(
      ({ key, label, color, curves }) => {
        const width = highlighted.has(key) ? 2.75 : 1.5
        const faded = highlighted.size > 0 && !highlighted.has(key)
        return (show_integrated ? [false, true] : [false]).flatMap((integrated) =>
          channels(integrated ? curves.integrated : curves.values).map(
            ([spin, values]): DataSeries<SeriesMeta> => ({
              id: JSON.stringify([key, spin, integrated]),
              legend_id: key,
              x: values,
              y: energies,
              ...(integrated && { x_axis: `x2` }),
              markers: `line`,
              // overlay shows both spins under one legend row; single-spin modes name theirs
              label: `${label}${cohp.spin_polarized && spin_mode !== `overlay` ? { up: ` ↑`, down: ` ↓`, total: `` }[spin] : ``}`,
              metadata: { bond: key, spin, integrated },
              line_style: {
                color: faded ? add_alpha(color, 0.25) : color,
                width: integrated ? width * 0.8 : width,
                // values: spin-down dashed; integrated: dotted, dash-dotted for spin-down
                dash:
                  spin === `down`
                    ? integrated
                      ? `6,2,1,2`
                      : `5,3`
                    : integrated
                      ? `1,3`
                      : undefined,
              },
            }),
          ),
        )
      },
    )
  })

  const energy_label = $derived(shift_to_fermi ? `E − E<sub>F</sub> (eV)` : `E (eV)`)
  const value_axis = (integrated: boolean): AxisConfig => ({
    label: lobster_quantity_label(cohp.kind, integrated),
    format: `.2~f`,
    ticks: integrated ? 4 : 5,
  })
  // the DOS shares the energy axis (range, zoom, vertical padding) as in BandsAndDos
  let clientWidth = $state(1200)
  let clientHeight = $state(0)
  const side_by_side = $derived(clientWidth >= MIN_SIDE_BY_SIDE_WIDTH)
  const sync = create_bands_dos_sync({
    band_structs: () => ({}),
    doses: () => shifted_doses ?? {},
    units: () => `eV`,
    fermi_level: () => energy_offset,
    bands_props: () => ({
      y_axis: { label: energy_label, format: `.1~f`, ...rest.y_axis },
      padding: rest.padding,
    }),
    dos_props: () => dos_props,
    side_by_side: () => Boolean(doses) && side_by_side,
    size: () => [clientWidth, clientHeight],
    data_range: () => [energies[0], energies[energies.length - 1]],
    shared_axis: () => Boolean(doses),
    base_padding: { t: DEFAULT_PLOT_PADDING.t, b: DEFAULT_PLOT_PADDING.b },
  })
  // new data or energy reference: both panes start over from the shared range (else the last
  // dataset's bound view would lead the sync)
  $effect.pre(() => {
    void [cohp, energy_offset]
    sync.views[0] = undefined
    sync.views[1] = undefined
  })
  // secondary axis for the integrals, writable since ScatterPlot binds it
  let x2_axis = $derived({
    ...(show_integrated && value_axis(true)),
    ...rest.x2_axis,
  })

  const fermi_color = `var(--cohp-fermi-line-color, light-dark(#e74c3c, #ff6b6b))`
  const meta_of = (metadata: unknown): SeriesMeta | null => {
    if (!metadata || typeof metadata !== `object`) return null
    if (!(`bond` in metadata && `spin` in metadata && `integrated` in metadata)) return null
    const { bond, spin, integrated } = metadata
    const valid_spin = spin === `up` || spin === `down` || spin === `total`
    return typeof bond === `string` && valid_spin && typeof integrated === `boolean`
      ? { bond, spin, integrated }
      : null
  }
  // pass on_plot_click only when someone listens: it replaces ScatterPlot's click-to-pin tooltip
  const handle_plot_click = $derived(
    on_bond_click || rest.on_plot_click
      ? (event: Parameters<NonNullable<typeof rest.on_plot_click>>[0]) => {
          // curves draw no markers, so clicks resolve to the nearest curve point; the Average
          // curve belongs to no pair
          const bond = meta_of(event.metadata)?.bond
          if (bond && bond !== `average`) on_bond_click?.(bond)
          rest.on_plot_click?.(event)
        }
      : undefined,
  )
</script>

{#snippet cohp_plot()}
  {#if series_data.length > 0}
    {@render scatter()}
  {:else}
    <EmptyState message="No {cohp.kind} pairs to display" />
  {/if}
{/snippet}

{#if shifted_doses}
  <div
    class={[`cohp-and-dos`, side_by_side ? `side` : `stacked`]}
    style:--side-dos-width="{SIDE_DOS_WIDTH}px"
    style:--linked-tick-font-size={sync.tick_font_size}
    bind:clientWidth
    bind:clientHeight
  >
    {@render cohp_plot()}
    <Dos
      {...dos_props}
      style="height: {side_by_side ? `100%` : `250px`}; {dos_props.style ?? ``}"
      doses={shifted_doses}
      fermi_level={energy_offset}
      orientation={side_by_side ? `horizontal` : `vertical`}
      x_axis={sync.dos_x_axis}
      y_axis={sync.y_axes[1]}
      bind:view={sync.views[1]}
      bind:resolved_padding={() => undefined, sync.raise_padding}
      padding={{
        l: side_by_side ? 15 : undefined,
        ...dos_props.padding,
        ...sync.shared_padding,
      }}
    />
  </div>
{:else}
  {@render cohp_plot()}
{/if}

{#snippet scatter()}
  {#snippet cohp_tooltip({ x, y, label, metadata }: ScatterHandlerProps)}
    {@const meta = meta_of(metadata)}
    {#if label}<strong>{@html sanitize_html(label)}</strong><br />{/if}
    <TooltipValue label={energy_label} value={format_num(y, `.3~f`)} /><br />
    <TooltipValue
      label={lobster_quantity_label(cohp.kind, meta?.integrated ?? false)}
      value={format_num(x, `.4~f`)}
    />
    {#if meta && cohp.spin_polarized}<br />
      <TooltipValue label="Spin" value={meta.spin} />{/if}
  {/snippet}

  <ScatterPlot
    {...rest}
    tooltip={rest.tooltip ?? cohp_tooltip}
    series={series_data}
    x_axis={{ ...value_axis(false), ...rest.x_axis }}
    y_axis={sync.y_axes[0]}
    padding={{ ...rest.padding, ...sync.shared_padding }}
    bind:view={sync.views[0]}
    bind:resolved_padding={() => undefined, sync.raise_padding}
    bind:x2_axis
    bind:display
    hover_config={{ threshold_px: 30, ...rest.hover_config }}
    on_point_hover={(event) => {
      hovered_bond = meta_of(event?.metadata)?.bond ?? null
      rest.on_point_hover?.(event)
    }}
    on_plot_click={handle_plot_click}
    bind:controls_open
  >
    {#snippet controls_extra()}
      <SettingsSection title="COHP" layout="flow">
        {#if cohp.spin_polarized}
          <label>
            Spin
            <select bind:value={spin_mode}>
              {#each COHP_SPIN_MODES as mode (mode.value)}
                <option value={mode.value}>{mode.title}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label><input type="checkbox" bind:checked={show_integrated} /> Integrated</label>
        <label><input type="checkbox" bind:checked={show_average} /> Average</label>
        <label><input type="checkbox" bind:checked={shift_to_fermi} /> E − E<sub>F</sub></label
        >
      </SettingsSection>
    {/snippet}

    {#snippet user_content(ctx)}
      {@const { width, x_scale_fn, y_scale_fn, pad } = ctx}
      {@const fermi_pos = y_scale_fn(energy_offset)}
      {#if Number.isFinite(fermi_pos)}
        <line
          class="fermi-level-line"
          {...plot_area_line(fermi_pos, true, ctx)}
          stroke={fermi_color}
          stroke-width="var(--cohp-fermi-line-width, 1.5)"
          stroke-dasharray="var(--cohp-fermi-line-dash, 6,3)"
          opacity="0.8"
        />
        <text
          x={width - pad.r - 4}
          y={fermi_pos - 4}
          text-anchor="end"
          font-size="10"
          fill={fermi_color}
        >
          E<tspan dy="2" font-size="8">F</tspan>
        </text>
      {/if}
      <!-- bonding/antibonding side labels beside the zero line -->
      {@const zero_pos = x_scale_fn(0)}
      {#if zero_pos >= pad.l && zero_pos <= width - pad.r}
        {#each [`bonding →`, `← antibonding`] as side, idx (side)}
          <text
            x={zero_pos + (idx ? -6 : 6)}
            y={pad.t + 12}
            text-anchor={idx ? `end` : `start`}
            font-size="11"
            fill="var(--cohp-side-label-color, light-dark(#777, #aaa))"
            pointer-events="none"
          >
            {side}
          </text>
        {/each}
      {/if}
    {/snippet}
  </ScatterPlot>
{/snippet}

<style>
  .cohp-and-dos {
    display: grid;
    &.side {
      grid-template-columns: minmax(0, 1fr) var(--side-dos-width);
    }
  }
</style>
