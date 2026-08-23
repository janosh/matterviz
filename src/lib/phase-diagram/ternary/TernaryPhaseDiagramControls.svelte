<script lang="ts">
  import { DEFAULT_GAS_PRESSURES, type GasSpecies } from '$lib/convex-hull/types'
  import { format_num } from '$lib/labels'
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import { ControlPane } from '$lib/overlays'
  import { ColorScaleSelect } from '$lib/plot'
  import type { ComponentProps } from 'svelte'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { FreeEnergyMode, FreeEnergySource, TernaryDisplay } from './types'

  let {
    controls_open = $bindable(false),
    display,
    set_display,
    free_energy_mode = $bindable(`auto`),
    t_range = $bindable(),
    n_samples = $bindable(64),
    relevant_gases = [],
    gas_enabled = $bindable(false),
    gas_pressures = $bindable({}),
    sources = [],
    n_phases = 0,
    n_events = 0,
    ...rest
  }: Omit<ComponentProps<typeof ControlPane>, `children`> & {
    display: TernaryDisplay
    set_display: (patch: Partial<TernaryDisplay>) => void
    free_energy_mode?: FreeEnergyMode
    t_range?: Vec2
    n_samples?: number
    relevant_gases?: GasSpecies[]
    gas_enabled?: boolean
    gas_pressures?: Partial<Record<GasSpecies, number>>
    sources?: FreeEnergySource[]
    n_phases?: number
    n_events?: number
  } = $props()

  type KeysOf<T> = {
    [K in keyof TernaryDisplay]: TernaryDisplay[K] extends T ? K : never
  }[keyof TernaryDisplay]
  type Checkbox = [KeysOf<boolean>, string, string]
  type Slider = [KeysOf<number>, string, string, number, number, number]
  type Toggle<K extends keyof TernaryDisplay> = [
    K,
    string,
    readonly [TernaryDisplay[K], string, string][],
  ]

  const MODES: [FreeEnergyMode, string, string][] = [
    [
      `auto`,
      `Auto`,
      `Tabulated G(T) where present, else SISSO when a volume is known, else 0 K energies`,
    ],
    [
      `tabulated`,
      `G(T) tables`,
      `Only the entries' own temperatures/free_energies vary with T`,
    ],
    [
      `sisso`,
      `SISSO`,
      `Bartel et al. 2018 descriptor from volume per atom and reduced mass with experimental elemental references (300-2000 K)`,
    ],
    [`static`, `0 K`, `Temperature-independent 0 K energies`],
  ]
  const SOURCE_LABELS: Record<FreeEnergySource, string> = {
    tabulated: `tabulated G(T)`,
    sisso: `SISSO G(T)`,
    static: `0 K energies`,
  }
  const VIEW: Toggle<`view`> = [
    `view`,
    `Mode`,
    [
      [`section`, `2D section`, `Isothermal section at the current temperature`],
      [
        `prism`,
        `3D prism`,
        `Composition-temperature prism with a draggable cutting plane (WebGPU)`,
      ],
    ],
  ]
  const FACE: Toggle<`face_color_mode`> = [
    `face_color_mode`,
    `Fill colour`,
    [
      [`uniform`, `Uniform`, `One colour for every tie-triangle`],
      [`formation_energy`, `Energy`, `Mean formation energy of the vertices`],
      [`facet_index`, `Index`, `Distinct colour per tie-triangle`],
    ],
  ]
  const ROWS: Toggle<`map_filter`> = [
    `map_filter`,
    `Rows`,
    [
      [`stable_ever`, `Stable`, `Phases on the hull at some temperature`],
      [
        `near_hull`,
        `Near hull`,
        `Phases within the threshold of the hull at some temperature`,
      ],
      [`all`, `All`, `Every phase`],
    ],
  ]
  const SORT: Toggle<`map_sort`> = [
    `map_sort`,
    `Sort`,
    [
      [`first_stable`, `Onset`, `Phases stable earliest first`],
      [`composition`, `Composition`, `By position in the triangle`],
      [`min_e_hull`, `Hull distance`, `Closest to the hull first`],
    ],
  ]
  const PRISM: Checkbox[] = [
    [
      `show_sheets`,
      `Tie-line sheets`,
      `Vertical sheets swept out by each tie-line between the transitions that create and destroy it`,
    ],
    [
      `show_rods`,
      `Stability rods`,
      `Stable phases as vertical rods spanning their stability windows`,
    ],
    [
      `show_event_rings`,
      `Transition rings`,
      `Triangle outlines at every transition temperature`,
    ],
    [`ghost_above_plane`, `Cut-away`, `Fade rods and sheets above the cutting plane`],
  ]
  const SECTION: Checkbox[] = [
    [`show_tie_lines`, `Tie-lines`, `Outline the tie-triangles`],
    [`show_tie_triangles`, `Tie-triangles`, `Fill the three-phase regions`],
    [
      `show_unstable`,
      `Unstable phases`,
      `Show phases above the hull, coloured by hull distance`,
    ],
    [`show_stable_labels`, `Stable labels`, `Label stable phases`],
    [`show_unstable_labels`, `Unstable labels`, `Label unstable phases within the threshold`],
    [`show_grid`, `Grid`, `10% composition grid`],
    [
      `show_upcoming`,
      `Upcoming changes`,
      `Ring the phases that change at the next transition on heating`,
    ],
  ]
  const MAP: Checkbox[] = [
    [`show_map`, `Stability map`, `Phase × temperature stability map`],
    [`show_events`, `Transitions`, `List of transitions and reactions`],
    [`show_map_elements`, `Elements`, `Include the pure elements as map rows`],
    [`show_event_lines`, `Transition lines`, `Mark transition temperatures in the map`],
  ]
  const SLIDERS = {
    sheet: [
      `sheet_opacity`,
      `Sheet opacity`,
      `Opacity of the tie-line sheets`,
      0.02,
      0.6,
      0.02,
    ],
    face: [`face_opacity`, `Fill opacity`, `Opacity of the tie-triangle fills`, 0, 1, 0.05],
    threshold: [
      `max_e_above_hull`,
      `E_hull threshold`,
      `Hull-distance ceiling (eV/atom) for unstable phases and the stability-map colour scale`,
      0,
      1,
      0.01,
    ],
    speed: [`play_speed`, `Play speed (K/s)`, `Heating rate of the play button`, 10, 2000, 10],
  } satisfies Record<string, Slider>

  // Slider position previews locally while dragging; the bound pressure (which triggers a
  // full worker re-sweep) is only committed on release
  let preview_log_p = $state<Partial<Record<GasSpecies, number>>>({})
  const log_p = (gas: GasSpecies) =>
    preview_log_p[gas] ?? Math.log10(gas_pressures[gas] ?? DEFAULT_GAS_PRESSURES[gas])
  function commit_pressure(gas: GasSpecies, log_pressure: number): void {
    const { [gas]: _dropped, ...remaining } = preview_log_p
    preview_log_p = remaining
    gas_pressures = { ...gas_pressures, [gas]: 10 ** log_pressure }
  }
</script>

<!-- One mutually exclusive button per [value, text, tip] option -->
{#snippet toggle_group<V>(
  options: readonly [V, string, string][],
  current: V,
  select: (value: V) => void,
)}
  <div class="toggle-group">
    {#each options as [value, text, tip] (value)}
      <button
        type="button"
        class={[`toggle-btn`, { active: current === value }]}
        aria-pressed={current === value}
        onclick={() => select(value)}
        {@attach tooltip({ content: tip })}>{text}</button
      >
    {/each}
  </div>
{/snippet}

{#snippet toggle_row<K extends keyof TernaryDisplay>([key, label, options]: Toggle<K>)}
  <div class="setting">
    <span class="control-label">{label}</span>
    {@render toggle_group(options, display[key], (value) => set_display({ [key]: value }))}
  </div>
{/snippet}

{#snippet checkboxes(rows: Checkbox[])}
  {#each rows as [key, label, tip] (key)}
    <label {@attach tooltip({ content: tip })}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={display[key]}
        onchange={(evt) => set_display({ [key]: evt.currentTarget.checked })}
      />
    </label>
  {/each}
{/snippet}

{#snippet slider([key, label, title, min, max, step]: Slider)}
  <NumberRangeInput
    {min}
    {max}
    {step}
    {title}
    bind:value={() => display[key], (value) => set_display({ [key]: value })}
    >{label}</NumberRangeInput
  >
{/snippet}

<ControlPane
  bind:controls_open
  controls_name="ternary-phase-diagram"
  pane_style=""
  toggle_style=""
  toggle_title="Ternary phase diagram"
  {...rest}
>
  <h4 style="margin: 0 0 6pt">Ternary phase diagram</h4>

  <SettingsSection title="Free energy model" layout="grid">
    <div class="setting">
      <span class="control-label">G(T)</span>
      {@render toggle_group(MODES, free_energy_mode, (mode) => (free_energy_mode = mode))}
    </div>
    {#each t_range ? [0, 1] : [] as end (end)}
      <label
        {@attach tooltip({
          content: `${end ? `Highest` : `Lowest`} temperature of the sweep (K)`,
        })}
      >
        <span>T {end ? `max` : `min`}</span>
        <input
          type="number"
          step="50"
          value={t_range?.[end]}
          onchange={(evt) => {
            const value = evt.currentTarget.valueAsNumber
            const next: Vec2 = end ? [t_range?.[0] ?? 0, value] : [value, t_range?.[1] ?? 0]
            if (Number.isFinite(value) && next[0] < next[1]) t_range = next
            // Rejected input: the bound value is unchanged, so restore the field by hand
            else evt.currentTarget.value = String(t_range?.[end] ?? ``)
          }}
        />
      </label>
    {/each}
    <NumberRangeInput
      min={8}
      max={400}
      step={8}
      title="Temperatures sampled for the stability map. Transitions between adjacent samples are bisected to within 0.5 K, but a phase stable only inside one sampling interval is missed; raise this if the diagram looks incomplete"
      bind:value={n_samples}>Samples</NumberRangeInput
    >
    {#if relevant_gases.length > 0}
      <label
        {@attach tooltip({
          content: `Treat gas-forming elements as an atmosphere: their reference becomes mu(T, p) of the gas`,
        })}
      >
        <span>Gas atmosphere</span>
        <input type="checkbox" bind:checked={gas_enabled} />
      </label>
      {#each gas_enabled ? relevant_gases : [] as gas (gas)}
        <label {@attach tooltip({ content: `Partial pressure of ${gas} in bar (log scale)` })}>
          <span>p({gas})</span>
          <span class="pressure">{format_num(10 ** log_p(gas), `.2~e`)} bar</span>
          <input
            type="range"
            min="-12"
            max="2"
            step="0.25"
            value={log_p(gas)}
            oninput={(evt) =>
              (preview_log_p = { ...preview_log_p, [gas]: evt.currentTarget.valueAsNumber })}
            onchange={(evt) => commit_pressure(gas, evt.currentTarget.valueAsNumber)}
          />
        </label>
      {/each}
    {/if}
    <p class="model-summary">
      {n_phases} phases, {n_events} transitions{sources.length
        ? ` · ${sources.map((src) => SOURCE_LABELS[src]).join(` + `)}`
        : ``}
    </p>
  </SettingsSection>

  <SettingsSection title="View" layout="grid">
    {@render toggle_row(VIEW)}
    {#if display.view === `prism`}
      {@render checkboxes(PRISM)}
      {#if display.show_sheets}{@render slider(SLIDERS.sheet)}{/if}
    {/if}
  </SettingsSection>

  <SettingsSection title="Isothermal section" layout="grid">
    {@render checkboxes(SECTION)}
    {#if display.show_tie_triangles}
      {@render toggle_row(FACE)}
      {@render slider(SLIDERS.face)}
    {/if}
    {@render slider(SLIDERS.threshold)}
    <div class="setting color-scale-row">
      <span class="control-label">Colour scale</span>
      <ColorScaleSelect
        bind:value={() => display.color_scale, (value) => set_display({ color_scale: value })}
        placeholder="Select color scale"
      />
    </div>
  </SettingsSection>

  <SettingsSection title="Stability map & transitions" layout="grid">
    {@render checkboxes(MAP)}
    {#if display.show_map}
      {@render toggle_row(ROWS)}
      {@render toggle_row(SORT)}
    {/if}
    {@render slider(SLIDERS.speed)}
  </SettingsSection>
</ControlPane>

<style>
  :global(.ternary-phase-diagram-controls-pane) {
    font-size: 0.85em;
    max-width: 340px;
    --pane-padding: 10px;
    --pane-gap: 4px;
    --ctrl-label-w: 8.5em;
    --ctrl-value-w: 5.5em;
  }
  .setting {
    display: flex;
    align-items: center;
    gap: 6px;
    grid-column: 1 / -1;
  }
  .control-label {
    font-weight: 500;
    min-width: var(--ctrl-label-w);
  }
  .toggle-group {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .toggle-btn {
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
    padding: 1px 6px;
    &.active {
      background: light-dark(rgba(25, 118, 210, 0.15), rgba(100, 180, 255, 0.2));
    }
  }
  .pressure {
    font-size: 0.9em;
    white-space: nowrap;
  }
  .model-summary {
    grid-column: 1 / -1;
    margin: 2px 0 0;
    font-size: 0.9em;
    opacity: 0.75;
  }
  input {
    font: inherit;
  }
  input[type='number'] {
    width: 4.5em;
  }
  .color-scale-row :global(.multiselect) {
    --sms-min-height: 24px;
    flex: 1;
  }
</style>
