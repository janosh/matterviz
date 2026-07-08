<script lang="ts">
  import { StructurePopup } from '$lib/convex-hull'
  import type { ElementSymbol } from '$lib/element'
  import { format_num } from '$lib/labels'
  import type { Point2D, Vec3 } from '$lib/math'
  import { BinnedScatterPlot } from '$lib/plot'
  import type { BinnedPointPayload, DensePointSeries } from '$lib/plot'
  import type { Crystal } from '$lib/structure'

  type MaterialPoint = Record<string, unknown> & {
    material_id: string
    formula: string
    family: string
    band_gap: number
    e_form: number
    e_above_hull: number
    n_sites: number
    elements: ElementSymbol[]
    lattice_a: number
  }

  type PointClickPayload = BinnedPointPayload<MaterialPoint> & {
    event: MouseEvent
  }

  const family_configs: {
    family: string
    color: string
    elements: ElementSymbol[]
    base_gap: number
    base_energy: number
  }[] = [
    {
      family: `Oxides`,
      color: `#4dabf7`,
      elements: [`Li`, `Fe`, `O`],
      base_gap: 2.2,
      base_energy: -2.8,
    },
    {
      family: `Sulfides`,
      color: `#f59f00`,
      elements: [`Na`, `Ti`, `S`],
      base_gap: 1.5,
      base_energy: -1.9,
    },
    {
      family: `Nitrides`,
      color: `#12b886`,
      elements: [`Mg`, `Si`, `N`],
      base_gap: 3.1,
      base_energy: -2.4,
    },
  ]

  let plot_host = $state<HTMLDivElement>()
  let render_mode = $state<`density` | `points`>(`density`)
  let clicked_point = $state<MaterialPoint | null>(null)
  let popup_pos = $state<Point2D>({ x: 0, y: 0 })
  let selected_point_id = $state<string | number | null>(null)

  const x_axis = { label: `Formation energy (eV/atom)` }
  const y_axis = { label: `Band gap (eV)` }
  const density = {
    bin_px: 9,
    color_scale: { type: `log`, scheme: `interpolateMagma` },
    // disable auto density/points switching so the manual toggle (default: binned) is honored
    auto_point_mode: false,
    bin_click: `point`,
  } as const
  const popup_width = 360 // shared with StructurePopup width prop below
  const popup_margin = 40 // room for the control tab + gap when placed right
  const popup_place_right = $derived(
    popup_pos.x < (plot_host?.clientWidth ?? 960) - (popup_width + popup_margin),
  )

  function make_structure(elements: ElementSymbol[], lattice_a: number): Crystal {
    const frac_coords: Vec3[] = [
      [0, 0, 0],
      [0.5, 0.5, 0.5],
      [0.25, 0.25, 0.25],
      [0.75, 0.75, 0.25],
    ]
    const sites = elements.map((element, idx) => {
      const abc = frac_coords[idx % frac_coords.length]
      return {
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz: abc.map((coord) => coord * lattice_a) as Vec3,
        label: `${element}${idx + 1}`,
        properties: {},
      }
    })
    return {
      id: elements.join(``),
      sites,
      lattice: {
        matrix: [
          [lattice_a, 0, 0],
          [0, lattice_a, 0],
          [0, 0, lattice_a],
        ],
        pbc: [true, true, true],
        volume: lattice_a ** 3,
        a: lattice_a,
        b: lattice_a,
        c: lattice_a,
        alpha: 90,
        beta: 90,
        gamma: 90,
      },
      charge: 0,
      properties: {},
    }
  }

  const point_formula = (elements: ElementSymbol[], idx: number): string =>
    elements
      .map((element, elem_idx) => {
        const count = 1 + ((idx + elem_idx) % 3)
        return `${element}${count > 1 ? count : ``}`
      })
      .join(``)

  function normal_sample(seed: number): number {
    const phase_1 = Math.sin(seed * 12.9898) * 43_758.5453
    const phase_2 = Math.sin((seed + 37.719) * 78.233) * 24_634.6345
    const uniform_1 = Math.max(1e-6, phase_1 - Math.floor(phase_1))
    const uniform_2 = phase_2 - Math.floor(phase_2)
    return Math.sqrt(-2 * Math.log(uniform_1)) * Math.cos(2 * Math.PI * uniform_2)
  }

  function clear_selection(): void {
    clicked_point = null
    selected_point_id = null
  }

  const make_series = (): DensePointSeries<MaterialPoint>[] =>
    family_configs.map((config, family_idx) => {
      const point_count = 2400
      const x = new Float32Array(point_count)
      const y = new Float32Array(point_count)
      const size_values = new Float32Array(point_count)
      const metadata: MaterialPoint[] = []
      const point_ids: string[] = []
      const centers = [
        { e_form: config.base_energy, band_gap: config.base_gap, cutoff: 0.45 },
        { e_form: config.base_energy + 0.55, band_gap: config.base_gap - 0.42, cutoff: 0.75 },
        { e_form: config.base_energy + 1.05, band_gap: config.base_gap - 0.95, cutoff: 0.93 },
        { e_form: config.base_energy + 1.5, band_gap: config.base_gap - 1.25, cutoff: 1 },
      ]

      for (let idx = 0; idx < point_count; idx++) {
        const mix_val = (Math.sin((idx + 1) * (family_idx + 2) * 19.19) + 1) / 2
        const cluster_idx = centers.findIndex(({ cutoff }) => mix_val <= cutoff)
        const center = centers[cluster_idx]
        const spread = 0.09 + 0.035 * cluster_idx
        const e_form = center.e_form + normal_sample(idx * 2 + family_idx * 101) * spread
        const band_gap = Math.max(
          0.05,
          center.band_gap +
            normal_sample(idx * 2 + family_idx * 101 + 1) * spread * 1.35 -
            0.1 * (e_form - center.e_form),
        )
        const trend = idx / (point_count - 1)
        const e_above_hull = Math.max(0, 0.35 * trend - 0.08 + family_idx * 0.025)
        const n_sites = 4 + ((idx + family_idx) % 8) * 4
        const material_id = `${config.family.toLowerCase()}-${idx + 1}`
        const formula = point_formula(config.elements, idx)
        const lattice_a = 4.5 + trend + family_idx * 0.2

        x[idx] = e_form
        y[idx] = band_gap
        size_values[idx] = n_sites
        point_ids.push(material_id)
        metadata.push({
          material_id,
          formula,
          family: config.family,
          band_gap,
          e_form,
          e_above_hull,
          n_sites,
          elements: config.elements,
          lattice_a,
        })
      }
      const { family: id, family: label, color } = config
      return { id, label, color, x, y, size_values, point_ids, metadata }
    })

  const series = make_series()

  function handle_point_click(payload: PointClickPayload): void {
    const metadata = payload.metadata
    if (!metadata || !plot_host) return
    const rect = plot_host.getBoundingClientRect()
    clicked_point = metadata
    selected_point_id = payload.point.point_id ?? null
    popup_pos = {
      x: payload.event.clientX - rect.left,
      y: payload.event.clientY - rect.top,
    }
  }
</script>

{#snippet point_tooltip(payload: BinnedPointPayload<MaterialPoint>)}
  {@const data = payload.metadata}
  {#if data}
    <strong>{data.formula}</strong>
    <span>{data.family}</span>
    <span>E<sub>form</sub> = {format_num(data.e_form, `.3~`)} eV/atom</span>
    <span>Gap = {format_num(data.band_gap, `.2~`)} eV</span>
    <span>{data.n_sites} sites</span>
  {/if}
{/snippet}

<svelte:head>
  <title>Binned Scatter Plot Demo</title>
</svelte:head>

<main>
  <header>
    <h1>Binned Scatter Plot</h1>
    <p>
      Dense scatter rendering with adaptive density bins, point picking, size scaling, a
      structure popup on material clicks, and per-family marginal distributions (top histogram
      + right KDE) that track zoom/pan.
    </p>
  </header>

  <div class="controls">
    <label>
      Render mode
      <select bind:value={render_mode}>
        <option value="points">Points</option>
        <option value="density">Density bins</option>
      </select>
    </label>
  </div>

  <BinnedScatterPlot
    {series}
    {x_axis}
    {y_axis}
    {density}
    marginals={{ top: { type: `histogram`, size: 64 }, right: { type: `kde`, size: 64 } }}
    tooltip={point_tooltip}
    bind:render_mode
    bind:wrapper={plot_host}
    {selected_point_id}
    on_point_click={handle_point_click}
    class="plot-card"
  >
    {#snippet annotation()}
      {@const n_points = series.reduce((sum, srs) => sum + srs.x.length, 0)}
      <div class="stats-badge">
        <strong>{n_points.toLocaleString()}</strong> materials<br />
        {family_configs.length} families
      </div>
    {/snippet}
    {#if clicked_point}
      <StructurePopup
        structure={make_structure(clicked_point.elements, clicked_point.lattice_a)}
        place_right={popup_place_right}
        stats={{
          id: clicked_point.material_id,
          formula: clicked_point.formula,
          e_form: clicked_point.e_form,
          e_above_hull: clicked_point.e_above_hull,
        }}
        onclose={clear_selection}
        style={popup_place_right
          ? `left: ${popup_pos.x}px; top: ${popup_pos.y}px`
          : `right: ${(plot_host?.clientWidth ?? 0) - popup_pos.x}px; top: ${popup_pos.y}px`}
        width={popup_width}
        height={360}
      />
    {/if}
  </BinnedScatterPlot>

  <section class="notes">
    <h2>What to Try</h2>
    <ul>
      <li>Click a density bin or point to open the draggable <code>StructurePopup</code>.</li>
      <li>Switch to point mode to see the same materials rendered individually.</li>
      <li>Use the mouse wheel or drag-select to zoom into crowded regions.</li>
      <li>
        The stats badge (an <code>annotation</code> snippet) auto-places itself away from
        both the data and the colorbar — zoom around and watch it relocate.
      </li>
    </ul>
  </section>
</main>

<style>
  main {
    padding: 1.5rem;
  }
  .controls {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin: 1rem 0;
  }
  :global(.binned-scatter.plot-card) {
    position: relative;
    box-sizing: border-box;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--surface-bg);
    padding: 1rem;
    height: 640px;
  }
  :global(.binned-scatter.plot-card .plot-tooltip) {
    display: grid;
    gap: 0.15rem;
  }
  .stats-badge {
    background: color-mix(in srgb, var(--surface-bg, Canvas) 60%, transparent);
    backdrop-filter: blur(4px);
    border-radius: 4px;
    font-size: 0.85em;
    padding: 2pt 6pt;
  }
</style>
