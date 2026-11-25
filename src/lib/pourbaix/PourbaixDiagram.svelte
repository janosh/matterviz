<script lang="ts">
  import { PLOT_COLORS } from '#lib/colors/index.js'
  import { format_formula_html, format_formula_svg } from '#lib/composition/formula-markup.js'
  import { json_source } from '#lib/io/export.js'
  import { polygon_label_point, type Vec2 } from '#lib/math.js'
  import ColorBar from '#lib/plot/core/components/ColorBar.svelte'
  import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
  import { get_relative_coords } from '#lib/plot/core/interactions.js'
  import { CONTROLS_ROW_HEIGHT } from '#lib/plot/core/layout.js'
  import { color_interpolator, resolve_color_scale } from '#lib/plot/core/scales.js'
  import { rgb } from 'd3-color'
  import type {
    AxisConfig,
    AxisRanges,
    DisplayConfig,
    UserContentProps,
  } from '#lib/plot/core/types.js'
  import type { RefLine } from '#lib/plot/core/types/reference-lines.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import { sanitize_html, sanitize_svg } from '#lib/sanitize.js'
  import { type TooltipProp, TooltipValue } from '#lib/tooltip/index.js'
  import type { ComponentProps } from 'svelte'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import { format_num } from 'svelte-widgets/format'
  import SettingsSection from 'svelte-widgets/SettingsSection.svelte'
  import {
    compute_pourbaix_diagram,
    energy_above_envelope,
    mix_planes,
    POURBAIX_DEFAULTS,
    pourbaix_domains,
    pourbaix_energy,
    stable_plane_at,
    water_lines,
  } from './compute'
  import PourbaixControls from './PourbaixControls.svelte'
  import type {
    PourbaixDiagramData,
    PourbaixEntry,
    PourbaixHoverInfo,
    PourbaixPlane,
  } from './types'

  let {
    entries,
    log_conc = $bindable(POURBAIX_DEFAULTS.log_conc),
    temperature = $bindable(POURBAIX_DEFAULTS.temperature),
    ph_range = POURBAIX_DEFAULTS.ph_range,
    potential_range = POURBAIX_DEFAULTS.potential_range,
    water_energy = POURBAIX_DEFAULTS.water_energy,
    composition = $bindable(null),
    element_log_conc = {},
    show_water_lines = $bindable(true),
    show_labels = $bindable(true),
    heatmap_formula = $bindable(null),
    hover_info = $bindable(null),
    tooltip,
    controls_open = $bindable(false),
    ...rest
  }: Omit<
    ComponentProps<typeof ScatterPlot>,

    // owned by the diagram: overriding any of them would drop domains, water lines or controls
    | `series`
    | `tooltip`
    | `x_axis`
    | `y_axis`
    | `display`
    | `view`
    | `ref_lines`
    | `user_content`
    | `controls_extra`
    | `children`
    | `legend`
    | `export_sources`
  > & {
    // Species of a system of one or two metals (elements besides H and O) and water: unique
    // formula (caret charges like `Fe^2+`, a neutral dissolved species ending in `(aq)` or
    // given phase `aqueous`) and ΔfG° (eV), e.g. from import_pymatgen_pourbaix
    entries: PourbaixEntry[]
    // log10 activity of the aqueous species
    log_conc?: number
    // Amounts of the two metals (only their ratio matters), null for equal parts
    composition?: Record<string, number> | null
    // log10 activity of one metal's aqueous species, overriding log_conc for it
    element_log_conc?: Record<string, number>
    // Temperature (K) of the Nernst terms; ΔfG° stay at 298.15 K
    temperature?: number
    // Initial window [min, max] in pH; pan and zoom recompute the domains for the view
    ph_range?: Vec2
    // Initial window [min, max] in V vs SHE
    potential_range?: Vec2
    // ΔfG° of liquid water (eV per H2O), ideally from the same source as the entries
    water_energy?: number
    // Dashed H2 and O2 evolution lines bounding water's stability
    show_water_lines?: boolean
    // Species labels centred in their domains
    show_labels?: boolean
    // Shade the view by how far this species' Pourbaix energy lies above the stable one
    // (eV per metal atom), null for plain domains
    heatmap_formula?: string | null
    // Phase under the pointer, null when none
    hover_info?: PourbaixHoverInfo | null
    // false hides the hover tooltip, a snippet replaces its content
    tooltip?: TooltipProp<PourbaixHoverInfo>
  } = $props()

  const uid = $props.id() // must be a declaration of its own, else SSR fails to compile
  const clip_id = `pourbaix-clip-${uid}`

  // Input errors (unknown elements, several metals, bad ranges) show in place of the plot
  const result = $derived.by((): { data: PourbaixDiagramData } | { error: string } => {
    try {
      const data = compute_pourbaix_diagram(entries, {
        log_conc,
        temperature,
        water_energy,
        composition,
        element_log_conc,
      })
      pourbaix_domains([], ph_range, potential_range) // no planes: validates the window alone
      if (heatmap_formula && !entries.some((entry) => entry.formula === heatmap_formula))
        throw new Error(`heatmap_formula ${heatmap_formula} names no entry`)
      return { data }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { error: error.message }
    }
  })
  const data = $derived(`data` in result ? result.data : null)

  const color_of = (plane: PourbaixPlane): string =>
    PLOT_COLORS[(data?.planes.indexOf(plane) ?? 0) % PLOT_COLORS.length]
  // Ψ is per atom of the elements besides H and O
  const per_atom = $derived(`eV/${data?.elements.join(`+`)}`)

  // Writable deriveds: pan/zoom and the controls pane edit them, a new window prop resets them
  let x_axis = $derived<AxisConfig>({ label: `pH`, range: [...ph_range] })
  let y_axis = $derived<AxisConfig>({ label: `E (V vs SHE)`, range: [...potential_range] })
  // Domain edges are straight in data space, so both axes stay linear whatever the pane picks
  const linear = (axis: AxisConfig): AxisConfig => ({ ...axis, scale_type: `linear` })
  // No grid, and no zero lines: pH 0 and 0 V are no reference here (the H2 line is)
  // oxfmt-ignore
  let display = $state<DisplayConfig>({ x_grid: false, y_grid: false, x_zero_line: false, y_zero_line: false })
  // The plotted (pH, E) window after pan and zoom
  let view = $state<Partial<AxisRanges>>({})
  const visible_window = $derived<[Vec2, Vec2]>([
    view.x ?? ph_range,
    view.y ?? potential_range,
  ])
  // A window zoomed below one float step holds no domains (pourbaix_domains would throw)
  const visible_domains = $derived(
    data && visible_window.every(([lo, hi]) => lo < hi)
      ? pourbaix_domains(data.planes, ...visible_window)
      : [],
  )

  // From temperature and water_energy alone, so a log_conc tick leaves them untouched
  const ref_lines = $derived.by((): RefLine[] => {
    if (!show_water_lines) return []
    const { h2, o2 } = water_lines(temperature, water_energy)
    const color = `currentColor`
    return [
      { ...h2, label: `H₂ evolution`, text: `H⁺/H₂` },
      { ...o2, label: `O₂ evolution`, text: `O₂/H₂O` },
    ].map(({ text, ...line }): RefLine => ({
      ...line,
      type: `diagonal`,
      style: { dash: `6 4`, width: 1.5, color, opacity: 0.8 },
      z_index: `above-all`,
      annotation: { text, color, position: `end`, side: `above`, font_size: `12px` },
    }))
  })

  // === Heatmap of one species' energy above the stable envelope ===
  const HEATMAP_GRID: Vec2 = [180, 120]
  const heatmap_plane = $derived(
    data?.species.find((plane) => plane.label === heatmap_formula) ?? null,
  )
  // The phases at the species' own composition, which hold it: energies above them are >= 0
  // (the diagram's own phases would mix in the other metal at another ratio)
  const envelope = $derived(
    data && heatmap_plane ? mix_planes(data.species, heatmap_plane.metal_fractions) : [],
  )
  const HEATMAP_SCALE = `interpolateViridis`
  // 256-color lookup table built once, not per repaint
  const color_at = color_interpolator(HEATMAP_SCALE)
  const heatmap_lut = Array.from({ length: 256 }, (_, idx) => rgb(color_at(idx / 255)))
  // Painted to one image per view, client-side only. The color range spans the whole initial
  // window, so panning never recolors. Ψ_own - envelope = max_j (Ψ_own - Ψ_j) is convex, so its
  // maximum over the window sits at a corner.
  const heatmap = $derived.by(() => {
    if (!data || !heatmap_plane || typeof document === `undefined`) return null
    const max_value = Math.max(
      1e-9,
      ...ph_range.flatMap((ph) =>
        potential_range.map(
          (potential) =>
            pourbaix_energy(heatmap_plane, ph, potential) -
            stable_plane_at(envelope, ph, potential).energy,
        ),
      ),
    )
    const scale = resolve_color_scale(HEATMAP_SCALE, [0, max_value])
    const context = document.createElement(`canvas`).getContext(`2d`)
    if (!context) return { ...scale, image: null } // e.g. a test DOM without 2D canvas
    const values = energy_above_envelope(envelope, heatmap_plane, visible_window, HEATMAP_GRID)
    const [n_ph, n_e] = HEATMAP_GRID
    const pixels = new Uint8ClampedArray(n_ph * n_e * 4).fill(255) // opaque alpha
    values.forEach((value, idx) => {
      const { r, g, b } = heatmap_lut[Math.round(scale.position(value) * 255)]
      pixels.set([r, g, b], idx * 4)
    })
    ;[context.canvas.width, context.canvas.height] = [n_ph, n_e]
    context.putImageData(new ImageData(pixels, n_ph, n_e), 0, 0)
    return { ...scale, image: context.canvas.toDataURL() }
  })

  // === Hover ===
  // Axes are linear, so two scale evaluations invert pixels back to data
  const invert = (scale: (value: number) => number, [lo, hi]: Vec2, px: number): number =>
    lo + ((px - scale(lo)) / (scale(hi) - scale(lo))) * (hi - lo)

  // The pointer in data coordinates; the species under it is re-resolved from the current
  // planes, so slider, entry and zoom changes update or clear the hover without a pointer move
  let hover_point = $state<{ ph: number; potential: number } | null>(null)
  const hovered = $derived.by((): PourbaixHoverInfo | null => {
    if (!data || !hover_point) return null
    const { ph, potential } = hover_point
    const [[ph_lo, ph_hi], [e_lo, e_hi]] = visible_window
    if (ph < ph_lo || ph > ph_hi || potential < e_lo || potential > e_hi) return null
    return { ...stable_plane_at(data.planes, ph, potential), ph, potential }
  })
  $effect.pre(() => {
    hover_info = hovered
  })

  function on_pointer_move(
    event: PointerEvent & { currentTarget: SVGGElement },
    { x_scale_fn, y_scale_fn, x_range, y_range }: UserContentProps,
  ) {
    const at_svg = get_relative_coords(event, event.currentTarget.ownerSVGElement)
    if (!at_svg) return
    const ph = invert(x_scale_fn, x_range, at_svg.x)
    hover_point = { ph, potential: invert(y_scale_fn, y_range, at_svg.y) }
  }

  // === Export ===
  const export_sources = {
    json: json_source(() => ({
      elements: data?.elements,
      composition,
      log_conc,
      temperature,
      water_lines: water_lines(temperature, water_energy),
      // what the view shows, as in the SVG and PNG exports
      domains: visible_domains.map(({ plane: { label, species }, ...polygon }) => ({
        label,
        species,
        ...polygon,
      })),
    })),
  }
</script>

{#snippet domain_layer(props: UserContentProps)}
  {@const { x_scale_fn: sx, y_scale_fn: sy, pad, width, height } = props}
  {@const to_px = (vertices: Vec2[]): Vec2[] => vertices.map(([ph, e]) => [sx(ph), sy(e)])}
  {@const [[ph_lo, ph_hi], [e_lo, e_hi]] = visible_window}
  <defs>
    <clipPath id={clip_id}>
      <rect
        x={pad.l}
        y={pad.t}
        width={Math.max(0, width - pad.l - pad.r)}
        height={Math.max(0, height - pad.t - pad.b)}
      />
    </clipPath>
  </defs>
  <!-- the domains tile the view, so one handler on their group resolves every hover -->
  <g
    class="pourbaix-domains"
    clip-path="url(#{clip_id})"
    role="presentation"
    onpointermove={(event) => on_pointer_move(event, props)}
    onpointerleave={() => (hover_point = null)}
  >
    {#if heatmap?.image}
      <image
        href={heatmap.image}
        x={sx(ph_lo)}
        y={sy(e_hi)}
        width={sx(ph_hi) - sx(ph_lo)}
        height={sy(e_lo) - sy(e_hi)}
        preserveAspectRatio="none"
        pointer-events="none"
      />
    {/if}
    {#each visible_domains as { plane, vertices } (plane.label)}
      <!-- transparent, not none, over the heatmap: an unpainted fill would take no pointer -->
      <polygon
        points={to_px(vertices).join(` `)}
        fill={heatmap ? `transparent` : color_of(plane)}
        fill-opacity={plane.species.some((part) => part.aqueous) ? 0.3 : 0.55}
        class:hovered={hovered?.plane === plane}
      />
    {/each}
  </g>
  {#if show_labels}
    {#each visible_domains as { plane, vertices } (plane.label)}
      {@const label = polygon_label_point(to_px(vertices))}
      <!-- skip domains too small for their label (~6.5 px per character, pairs run long) -->
      {#if label && label.width > Math.max(28, 6.5 * plane.label.length) && label.height > 16}
        <text
          x={label.at[0]}
          y={label.at[1]}
          class="domain-label"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          {@html sanitize_svg(
            plane.species.map((part) => format_formula_svg(part.entry.formula)).join(` + `),
          )}
        </text>
      {/if}
    {/each}
  {/if}
{/snippet}

<!-- inside the plot frame, so the color bar is exported and both follow it to fullscreen -->
{#snippet frame_overlays({ pad, width, height, x_scale_fn, y_scale_fn }: UserContentProps)}
  {#if heatmap && heatmap_plane}
    <ColorBar
      title="Ψ({format_formula_html(
        heatmap_plane.label,
      )}) − Ψ<sub>stable</sub> (eV/{Object.keys(heatmap_plane.metal_fractions).join(`+`)})"
      color_scale={heatmap.color_scale}
      class="pourbaix-color-bar"
      style="position: absolute; top: {pad.t + 8}px; right: {pad.r +
        8}px; width: min(260px, 50%); pointer-events: none"
    />
  {/if}
  {#if hovered && tooltip !== false}
    {@const { plane, ph, potential, energy } = hovered}
    <!-- anchored through the scales, so it stays on its point through zoom and fullscreen -->
    <PlotTooltip
      x={x_scale_fn(ph)}
      y={y_scale_fn(potential)}
      offset={{ x: 12, y: 8 }}
      bg_color={color_of(plane)}
      constrain_to={{ width, height }}
    >
      {#if tooltip}
        {@render tooltip(hovered)}
      {:else}
        {#each plane.species as { entry, aqueous }, idx (entry.formula)}
          {idx ? ` + ` : ``}<strong
            >{@html sanitize_html(format_formula_html(entry.formula))}</strong
          >
          ({aqueous ? `aqueous` : `solid`})
        {/each}<br />
        <TooltipValue label="pH" value={format_num(ph, `.2f`)} /><br />
        <TooltipValue label="E" value={format_num(potential, `.3f`)} unit="V" /><br />
        <TooltipValue label="Ψ" value={format_num(energy, `.3f`)} unit={per_atom} />
      {/if}
    </PlotTooltip>
  {/if}
{/snippet}

{#snippet pourbaix_controls(_props: unknown)}
  <SettingsSection title="Pourbaix">
    <PourbaixControls
      bind:log_conc
      bind:temperature
      bind:show_water_lines
      bind:show_labels
      bind:heatmap_formula
      bind:composition
      formulas={entries.map((entry) => entry.formula)}
    />
  </SettingsSection>
{/snippet}

{#if `error` in result}
  <EmptyState>
    <p>Cannot compute Pourbaix diagram.</p>
    <p>{result.error}</p>
  </EmptyState>
{:else}
  <ScatterPlot
    series={[]}
    bind:controls_open
    bind:x_axis={() => x_axis, (axis) => (x_axis = linear(axis))}
    bind:y_axis={() => y_axis, (axis) => (y_axis = linear(axis))}
    bind:display
    bind:view
    {ref_lines}
    legend={null}
    show_controls
    export_filename="pourbaix-{data?.elements.join(`-`)}"
    {export_sources}
    controls_extra={pourbaix_controls}
    user_content={domain_layer}
    children={frame_overlays}
    tooltip={false}
    // the domains fill the plot area, so its top edge clears the corner controls row with 8 px
    // of air (a scatter's sparse marks may sit under it); a padding prop replaces this
    padding={{ t: CONTROLS_ROW_HEIGHT + 8 }}
    {...rest}
  />
{/if}

<style>
  polygon {
    stroke: var(--text-color, #333);
    stroke-width: 1;
    stroke-opacity: 0.6;
    &.hovered {
      stroke-width: 2;
      stroke-opacity: 1;
    }
  }
  .domain-label {
    font-size: 13px;
    font-weight: 600;
    fill: var(--text-color, currentColor);
    pointer-events: none;
  }
</style>
