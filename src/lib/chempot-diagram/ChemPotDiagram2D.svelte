<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { get_hill_formula } from '$lib/composition/format'
  import { extract_formula_elements } from '$lib/composition/parse'
  import TemperatureSlider from '$lib/convex-hull/TemperatureSlider.svelte'
  import type { PhaseData } from '$lib/convex-hull/types'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import { download } from '$lib/io/fetch'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { ColorBar, ScatterPlot } from '$lib/plot'
  import type { DataSeries, UserContentProps } from '$lib/plot/types'
  import { scaleSequential } from 'd3-scale'
  import * as d3_sc from 'd3-scale-chromatic'
  import { onDestroy } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import {
    apply_element_padding,
    best_form_energy_for_formula,
    build_axis_ranges,
    compute_chempot_diagram,
    formula_key_from_composition,
    get_energy_per_atom,
    get_min_entries_and_el_refs,
    orthonormal_2d,
    pad_domain_points,
  } from './compute'
  import { get_temp_filter_payload, get_valid_temperature } from './temperature'
  import type { ChemPotDiagramConfig, ChemPotHoverInfo } from './types'
  import { CHEMPOT_DEFAULTS } from './types'

  let {
    entries = [],
    config = {},
    width = $bindable(800),
    height = $bindable(600),
    // Auto-corrected to a valid available temperature when needed.
    temperature = $bindable<number | undefined>(undefined),
    interpolate_temperature = CHEMPOT_DEFAULTS.interpolate_temperature,
    max_interpolation_gap = CHEMPOT_DEFAULTS.max_interpolation_gap,
    hover_info = $bindable<ChemPotHoverInfo | null>(null),
    render_local_tooltip = true,
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    temperature?: number
    interpolate_temperature?: boolean
    max_interpolation_gap?: number
    hover_info?: ChemPotHoverInfo | null
    render_local_tooltip?: boolean
  } = $props()
  let container_width = $state(0)
  const base_aspect_ratio = $derived(height > 0 && width > 0 ? height / width : 1)
  const render_width = $derived(container_width > 0 ? container_width : width)
  const render_height = $derived(Math.round(render_width * base_aspect_ratio))

  // === Control overrides ===
  let formal_chempots_override = $state<boolean | null>(null)
  let label_stable_override = $state<boolean | null>(null)
  let element_padding_override = $state<number | null>(null)
  let default_min_limit_override = $state<number | null>(null)
  const formal_chempots = $derived(
    formal_chempots_override ??
      (config.formal_chempots ?? CHEMPOT_DEFAULTS.formal_chempots),
  )
  const label_stable = $derived(
    label_stable_override ?? (config.label_stable ?? CHEMPOT_DEFAULTS.label_stable),
  )
  const element_padding = $derived(
    element_padding_override ??
      (config.element_padding ?? CHEMPOT_DEFAULTS.element_padding),
  )
  const default_min_limit = $derived(
    default_min_limit_override ??
      (config.default_min_limit ?? CHEMPOT_DEFAULTS.default_min_limit),
  )
  let color_mode_override = $state<
    NonNullable<ChemPotDiagramConfig[`color_mode`]> | null
  >(
    null,
  )
  let color_scale_override = $state<D3InterpolateName | null>(null)
  let reverse_color_scale_override = $state<boolean | null>(null)
  const color_mode = $derived(
    color_mode_override ?? (config.color_mode ?? CHEMPOT_DEFAULTS.color_mode),
  )
  const color_scale = $derived(
    color_scale_override ?? (config.color_scale ?? CHEMPOT_DEFAULTS.color_scale),
  )
  const reverse_color_scale = $derived(
    reverse_color_scale_override ??
      (config.reverse_color_scale ?? CHEMPOT_DEFAULTS.reverse_color_scale),
  )
  const arity_colors = [`#3498db`, `#2ecc71`, `#e67e22`, `#9b59b6`] as const
  const show_tooltip = $derived(config.show_tooltip ?? CHEMPOT_DEFAULTS.show_tooltip)
  const effective_config = $derived({
    ...config,
    formal_chempots,
    label_stable,
    element_padding,
    default_min_limit,
  })
  const { has_temp_data, available_temperatures, temp_filtered_entries } = $derived(
    get_temp_filter_payload(entries, temperature, config, {
      interpolate_temperature,
      max_interpolation_gap,
    }),
  )

  $effect(() => {
    // Keep bound temperature aligned with available data points.
    const next_temperature = get_valid_temperature(
      temperature,
      has_temp_data,
      available_temperatures,
    )
    if (next_temperature !== temperature) temperature = next_temperature
  })

  const show_temperature_slider = $derived(
    has_temp_data && available_temperatures.length > 0,
  )

  function reset_controls(): void {
    formal_chempots_override = null
    label_stable_override = null
    element_padding_override = null
    default_min_limit_override = null
    color_mode_override = null
    color_scale_override = null
    reverse_color_scale_override = null
  }

  // === Diagram computation ===
  const diagram_data = $derived.by(() => {
    if (temp_filtered_entries.length < 2) return null
    try {
      return compute_chempot_diagram(temp_filtered_entries, effective_config)
    } catch (err) {
      console.error(`ChemPotDiagram2D:`, err)
      return null
    }
  })

  const plot_elements = $derived(
    (diagram_data?.elements ?? config.elements ?? []).slice(0, 2),
  )

  const draw_domains = $derived.by(() => {
    if (!diagram_data || plot_elements.length < 2) return {}
    const indices = [0, 1]
    if (element_padding <= 0) {
      return Object.fromEntries(
        Object.entries(diagram_data.domains).filter(([, pts]) => pts.length > 0),
      )
    }
    const new_lims = apply_element_padding(
      diagram_data.domains,
      indices,
      element_padding,
      default_min_limit,
    )
    const result: Record<string, number[][]> = {}
    for (const [formula, pts] of Object.entries(diagram_data.domains)) {
      const padded = pad_domain_points(
        pts,
        indices,
        new_lims,
        default_min_limit,
        element_padding,
      )
      if (padded.length > 0) result[formula] = padded
    }
    return result
  })
  const domain_entries = $derived(Object.entries(draw_domains))
  const domain_formulas = $derived(Object.keys(draw_domains))

  interface FormulaEnergyStats {
    matching_entry_count: number
    min_energy_per_atom: number | null
  }
  type NumericColorMode = Exclude<
    NonNullable<ChemPotDiagramConfig[`color_mode`]>,
    `none` | `arity`
  >

  const raw_el_refs = $derived(
    get_min_entries_and_el_refs(temp_filtered_entries).el_refs,
  )
  function get_interpolator(
    interpolator_name: D3InterpolateName,
  ): (t: number) => string {
    const raw = (d3_sc as unknown as Record<string, (t: number) => string>)[
      interpolator_name
    ] ??
      d3_sc.interpolateViridis
    return reverse_color_scale ? (param_t: number) => raw(1 - param_t) : raw
  }
  function make_color_scale(
    values: number[],
    interpolator_name: D3InterpolateName,
  ): ((val: number) => string) | null {
    const finite_vals = values.filter(Number.isFinite)
    if (finite_vals.length === 0) return null
    let min_val = finite_vals[0], max_val_raw = finite_vals[0]
    for (let idx = 1; idx < finite_vals.length; idx++) {
      if (finite_vals[idx] < min_val) min_val = finite_vals[idx]
      if (finite_vals[idx] > max_val_raw) max_val_raw = finite_vals[idx]
    }
    const max_val = Math.max(max_val_raw, min_val + 1e-6)
    return scaleSequential(get_interpolator(interpolator_name)).domain([
      min_val,
      max_val,
    ])
  }
  const entry_energy_stats_by_formula = $derived.by(
    (): SvelteMap<string, FormulaEnergyStats> => {
      const stats = new SvelteMap<string, FormulaEnergyStats>()
      for (const entry of temp_filtered_entries) {
        const formula_key = formula_key_from_composition(entry.composition)
        const epa = get_energy_per_atom(entry)
        const prev_stats = stats.get(formula_key)
        if (!prev_stats) {
          stats.set(formula_key, {
            matching_entry_count: 1,
            min_energy_per_atom: epa,
          })
          continue
        }
        stats.set(formula_key, {
          matching_entry_count: prev_stats.matching_entry_count + 1,
          min_energy_per_atom: Math.min(prev_stats.min_energy_per_atom ?? epa, epa),
        })
      }
      return stats
    },
  )
  const color_mode_labels: Record<NumericColorMode, string> = {
    energy: `Energy per atom (eV)`,
    formation_energy: `Formation energy (eV/atom)`,
    entries: `Entry count`,
  }
  function get_numeric_color_value(
    formula: string,
    active_color_mode: NumericColorMode,
  ): number | null {
    if (active_color_mode === `energy`) {
      return entry_energy_stats_by_formula.get(formula)?.min_energy_per_atom ?? null
    }
    if (active_color_mode === `formation_energy`) {
      return best_form_energy_for_formula(
        temp_filtered_entries,
        formula,
        raw_el_refs,
      ) ?? null
    }
    return entry_energy_stats_by_formula.get(formula)?.matching_entry_count ?? 0
  }
  const domain_color_values = $derived.by(
    (): { value_by_formula: SvelteMap<string, number>; values: number[] } | null => {
      if (color_mode === `none` || color_mode === `arity`) return null
      const active_color_mode = color_mode as NumericColorMode
      const value_by_formula = new SvelteMap<string, number>()
      const values: number[] = []
      for (const formula of domain_formulas) {
        const value = get_numeric_color_value(formula, active_color_mode)
        if (value == null || !Number.isFinite(value)) continue
        values.push(value)
        value_by_formula.set(formula, value)
      }
      return { value_by_formula, values }
    },
  )
  const domain_colors = $derived.by((): SvelteMap<string, string> => {
    const colors = new SvelteMap<string, string>()
    if (color_mode === `none`) return colors
    if (color_mode === `arity`) {
      for (const formula of domain_formulas) {
        const n_elements = extract_formula_elements(formula).length
        const color_idx = Math.min(n_elements, arity_colors.length) - 1
        colors.set(formula, arity_colors[Math.max(0, color_idx)])
      }
      return colors
    }
    const values_payload = domain_color_values
    const scale = make_color_scale(values_payload?.values ?? [], color_scale)
    for (const formula of domain_formulas) {
      const color_val = values_payload?.value_by_formula.get(formula)
      colors.set(formula, color_val != null && scale ? scale(color_val) : `#999`)
    }
    return colors
  })
  const color_range = $derived.by(
    (): { min: number; max: number; label: string } | null => {
      const values = domain_color_values?.values ?? []
      if (values.length === 0) return null
      let min_val = values[0], max_val = values[0]
      for (let idx = 1; idx < values.length; idx++) {
        if (values[idx] < min_val) min_val = values[idx]
        if (values[idx] > max_val) max_val = values[idx]
      }
      return {
        min: min_val,
        max: Math.max(max_val, min_val + 1e-6),
        label: color_mode === `none` || color_mode === `arity`
          ? ``
          : color_mode_labels[color_mode],
      }
    },
  )

  // === Convert domains to ScatterPlot DataSeries ===
  const series = $derived<DataSeries[]>(
    domain_entries.map(([formula, pts]) => ({
      id: formula,
      label: formula,
      x: pts.map((pt) => pt[0]),
      y: pts.map((pt) => pt[1]),
      markers: `line+points` as const,
      line_style: { stroke: domain_colors.get(formula) ?? `black`, stroke_width: 3 },
      point_style: { fill: domain_colors.get(formula) ?? `black`, radius: 3 },
    })),
  )

  // Axis label text
  function axis_label(element: string): string {
    if (formal_chempots) return `\u0394\u03BC(${element}) (eV)`
    return `\u03BC(${element}) (eV)`
  }

  let x_axis = $state({ label: `` })
  let y_axis = $state({ label: `` })

  $effect(() => {
    const next_x_label = axis_label(plot_elements[0] ?? ``)
    const next_y_label = axis_label(plot_elements[1] ?? ``)
    if (x_axis.label !== next_x_label) x_axis = { ...x_axis, label: next_x_label }
    if (y_axis.label !== next_y_label) y_axis = { ...y_axis, label: next_y_label }
  })

  // === Domain label annotations (in data coordinates) ===
  const annotations = $derived.by(() => {
    if (!label_stable) return []
    const result: { formula: string; data_x: number; data_y: number }[] = []
    for (const [formula, pts] of Object.entries(draw_domains)) {
      if (pts.length === 0) continue
      const center_x = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const center_y = pts.reduce((s, p) => s + p[1], 0) / pts.length
      let offset_x = 0
      let offset_y = 0
      if (pts.length >= 2) {
        const [nx, ny] = orthonormal_2d(pts)
        offset_x = nx * 0.25
        offset_y = ny * 0.25
      }
      result.push({
        formula,
        data_x: center_x + offset_x,
        data_y: center_y + offset_y,
      })
    }
    return result
  })

  // === Hover info for external consumers ===
  let locked_hover_formula = $state<string | null>(null)

  function set_hover_info(
    formula: string,
    pts: number[][],
    event: MouseEvent,
  ): void {
    const bounds = scatter_wrapper?.getBoundingClientRect()
    hover_info = {
      formula,
      view: `2d`,
      n_points: pts.length,
      axis_ranges: build_axis_ranges(pts, plot_elements),
      pointer: bounds
        ? {
          x: event.clientX - bounds.left + 4,
          y: event.clientY - bounds.top + 4,
        }
        : undefined,
    }
  }

  function clear_hover_lock(): void {
    locked_hover_formula = null
    hover_info = null
  }

  function handle_hover(
    data: { point: { series_idx: number }; event: MouseEvent } | null,
  ): void {
    if (!data) {
      if (!locked_hover_formula) hover_info = null
      return
    }
    const entry = domain_entries[data.point.series_idx]
    if (!entry) return
    const [formula, pts] = entry
    if (locked_hover_formula && locked_hover_formula !== formula) return
    set_hover_info(formula, pts, data.event)
  }

  function handle_click(
    data: { point: { series_idx: number }; event: MouseEvent },
  ): void {
    const entry = domain_entries[data.point.series_idx]
    if (!entry) return
    const [formula, pts] = entry
    if (locked_hover_formula === formula) {
      clear_hover_lock()
      return
    }
    locked_hover_formula = formula
    set_hover_info(formula, pts, data.event)
  }

  // === Export ===
  let scatter_wrapper = $state<HTMLDivElement>()
  let export_pane_open = $state(false)
  let copy_status = $state(false)
  let copy_timeout_id: ReturnType<typeof setTimeout> | null = null

  function get_svg_element(): SVGSVGElement | null {
    return scatter_wrapper?.querySelector<SVGSVGElement>(`svg`) ?? null
  }

  function get_json_string(): string {
    return JSON.stringify(
      {
        elements: diagram_data?.elements ?? [],
        domains: draw_domains,
        lims: diagram_data?.lims ?? [],
      },
      null,
      2,
    )
  }

  function export_json_file(): void {
    download(
      get_json_string(),
      `chempot-${plot_elements.join(`-`)}.json`,
      `application/json`,
    )
  }

  async function copy_json(): Promise<void> {
    try {
      await navigator.clipboard.writeText(get_json_string())
      copy_status = true
    } catch (err) {
      copy_status = false
      console.error(`Failed to copy JSON to clipboard:`, err)
    }
    if (copy_timeout_id !== null) clearTimeout(copy_timeout_id)
    copy_timeout_id = setTimeout(() => {
      copy_status = false
      copy_timeout_id = null
    }, 1000)
  }

  onDestroy(() => {
    if (copy_timeout_id !== null) clearTimeout(copy_timeout_id)
  })
</script>

{#snippet domain_labels(props: UserContentProps)}
  {#each annotations as { formula, data_x, data_y } (formula)}
    <text
      x={props.x_scale_fn(data_x)}
      y={props.y_scale_fn(data_y)}
      text-anchor="middle"
      class="domain-label"
    >
      {get_hill_formula(formula, true, ``)}
    </text>
  {/each}
{/snippet}

{#snippet export_toggle()}
  <DraggablePane
    bind:show={export_pane_open}
    open_icon="Cross"
    closed_icon="Export"
    pane_props={{ class: `chempot-export-pane` }}
    toggle_props={{
      class: `chempot-export-toggle`,
      title: `Export chemical potential diagram`,
      style:
        `position: absolute; top: var(--ctrl-btn-top, 5pt); right: 36px; z-index: 10`,
    }}
  >
    <h4>Export Image</h4>
    <div class="export-row">
      <label>
        SVG
        <button
          type="button"
          onclick={() => {
            const svg = get_svg_element()
            if (svg) {
              export_svg_as_svg(svg, `chempot-${plot_elements.join(`-`)}.svg`)
            }
          }}
          aria-label="Download SVG"
        >
          ⬇
        </button>
      </label>
      <label>
        PNG
        <button
          type="button"
          onclick={() => {
            const svg = get_svg_element()
            if (svg) {
              export_svg_as_png(svg, `chempot-${plot_elements.join(`-`)}.png`)
            }
          }}
          aria-label="Download PNG"
        >
          ⬇
        </button>
      </label>
    </div>
    <h4>Export Data</h4>
    <div class="export-row">
      <label>
        JSON
        <button type="button" onclick={export_json_file} aria-label="Download JSON">
          ⬇
        </button>
        <button
          type="button"
          onclick={copy_json}
          aria-label="Copy JSON to clipboard"
        >
          {copy_status ? `✅` : `📋`}
        </button>
      </label>
    </div>
  </DraggablePane>
{/snippet}

{#snippet chempot_controls(_props: unknown)}
  <h4>ChemPot</h4>
  <label>
    <span>Formal chempots:</span>
    <input
      type="checkbox"
      checked={formal_chempots}
      onchange={() => {
        formal_chempots_override = !formal_chempots
      }}
    />
  </label>
  <label>
    <span>Label stable:</span>
    <input
      type="checkbox"
      checked={label_stable}
      onchange={() => {
        label_stable_override = !label_stable
      }}
    />
  </label>
  <label>
    <span>Element padding (eV):</span>
    <input
      type="number"
      min="0"
      step="0.1"
      value={element_padding}
      oninput={(event) => {
        element_padding_override = Number(event.currentTarget.value) || 0
      }}
    />
  </label>
  <label>
    <span>Default min limit (eV):</span>
    <input
      type="number"
      max="0"
      step="1"
      value={default_min_limit}
      oninput={(event) => {
        const raw = event.currentTarget.value
        const parsed = parseFloat(raw)
        default_min_limit_override = raw === `` || isNaN(parsed)
          ? default_min_limit
          : parsed
      }}
    />
  </label>
  <label>
    <span>Color mode:</span>
    <select
      value={color_mode}
      onchange={(event) => {
        color_mode_override = event.currentTarget.value as typeof color_mode
      }}
    >
      <option value="none">None</option>
      <option value="energy">Energy/atom</option>
      <option value="formation_energy">Formation energy</option>
      <option value="arity">Element count</option>
      <option value="entries">Entry count</option>
    </select>
  </label>
  {#if color_mode !== `none` && color_mode !== `arity`}
    <label>
      <span>Color scale:</span>
      <select
        value={color_scale}
        onchange={(event) => {
          color_scale_override = event.currentTarget.value as D3InterpolateName
        }}
      >
        <option value="interpolateViridis">Viridis</option>
        <option value="interpolatePlasma">Plasma</option>
        <option value="interpolateInferno">Inferno</option>
        <option value="interpolateMagma">Magma</option>
        <option value="interpolateCividis">Cividis</option>
        <option value="interpolateTurbo">Turbo</option>
        <option value="interpolateRdYlBu">RdYlBu</option>
        <option value="interpolateSpectral">Spectral</option>
      </select>
      <span class="reverse-scale-toggle">
        <span>Reverse:</span>
        <input
          type="checkbox"
          checked={reverse_color_scale}
          onchange={() => {
            reverse_color_scale_override = !reverse_color_scale
          }}
        />
      </span>
    </label>
  {/if}
  <button type="button" onclick={reset_controls}>Reset defaults</button>
{/snippet}

{#if !diagram_data}
  <div class="error-state" role="alert" aria-live="polite">
    <p>Cannot compute chemical potential diagram.</p>
    <p>Need at least 2 elements with elemental reference entries.</p>
  </div>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="chempot-diagram-2d"
    bind:clientWidth={container_width}
    role="application"
    tabindex="0"
    onkeydown={(event) => {
      if (event.key === `Escape`) clear_hover_lock()
    }}
    onpointerdown={(event) => {
      const target = event.target
      if (!locked_hover_formula) return
      const is_background_click = target === scatter_wrapper ||
        (target instanceof SVGElement &&
          target.closest(`g[data-series-id]`) === null)
      if (is_background_click) {
        clear_hover_lock()
      }
    }}
  >
    {@render export_toggle()}
    <ScatterPlot
      bind:wrapper={scatter_wrapper}
      {series}
      bind:x_axis
      bind:y_axis
      legend={null}
      controls={{ show: true }}
      controls_extra={chempot_controls}
      user_content={domain_labels}
      on_point_hover={handle_hover}
      on_point_click={handle_click}
      style="--scatter-width: 100%; --scatter-height: {render_height}px; --fullscreen-btn-offset: 68px"
    />
    {#if color_mode !== `none` && color_mode !== `arity` && color_range}
      <ColorBar
        title={color_range.label}
        range={[color_range.min, color_range.max]}
        color_scale_fn={get_interpolator(color_scale)}
        color_scale_domain={[0, 1]}
        wrapper_style="position: absolute; bottom: 70px; left: 50px; width: 180px; z-index: 10;"
        bar_style="height: 10px;"
        title_style="margin-bottom: 3px;"
      />
    {/if}
    {#if color_mode === `arity`}
      <div class="arity-legend">
        {#each [`Unary`, `Binary`, `Ternary`, `4+`] as label_text, color_idx (label_text)}
          <span>
            <span style:background={arity_colors[color_idx]}></span>
            {label_text}
          </span>
        {/each}
      </div>
    {/if}
    {#if render_local_tooltip && show_tooltip && hover_info?.view === `2d`}
      <aside
        class="tooltip"
        style:left="{hover_info.pointer?.x ?? 4}px"
        style:top="{hover_info.pointer?.y ?? 4}px"
      >
        <strong>{@html get_hill_formula(hover_info.formula, false, ``)}</strong>
        {#if locked_hover_formula === hover_info.formula}
          <div>Pinned · Press Esc to unlock</div>
        {/if}
      </aside>
    {/if}
  </div>
{/if}
{#if show_temperature_slider && temperature !== undefined}
  <TemperatureSlider {available_temperatures} bind:temperature />
{/if}

<style>
  .chempot-diagram-2d {
    position: relative;
    width: 100%;
  }
  .chempot-diagram-2d > :global(.pane-toggle) {
    opacity: 0;
    transition: opacity 0.2s, background-color 0.2s;
  }
  .chempot-diagram-2d:hover > :global(.pane-toggle),
  .chempot-diagram-2d > :global(.pane-toggle:focus-visible),
  .chempot-diagram-2d > :global(.pane-toggle[aria-expanded='true']) {
    opacity: 1;
  }
  .chempot-diagram-2d :global(.draggable-pane label) {
    display: flex;
    align-items: center;
    gap: 6pt;
    margin: 4pt 0;
    font-size: 0.95em;
  }
  .chempot-diagram-2d :global(.export-row) {
    display: flex;
    flex-wrap: wrap;
    gap: 4pt 10pt;
    margin: 0 0 4pt;
  }
  .chempot-diagram-2d :global(.export-row > label) {
    margin: 0;
  }
  .chempot-diagram-2d :global(.reverse-scale-toggle) {
    display: flex;
    align-items: center;
    gap: 4pt;
    margin-left: 4pt;
  }
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-color, #666);
  }
  .domain-label {
    font-size: 12px;
    fill: var(--text-color, currentColor);
    opacity: 0.7;
    pointer-events: none;
  }
  .tooltip {
    position: absolute;
    background: var(
      --tooltip-bg,
      light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.9))
    );
    color: var(--tooltip-text, var(--text-color, #fff));
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    pointer-events: none;
    white-space: nowrap;
    z-index: 10;
  }
  .arity-legend {
    position: absolute;
    bottom: 52px;
    left: 24px;
    display: flex;
    gap: 10px;
    font-size: 12px;
    z-index: 10;
    pointer-events: none;
  }
  .arity-legend > span {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .arity-legend > span > span {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
