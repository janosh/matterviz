<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import { FacetGrid, ScatterPlot, type DataSeries, type RefLine } from '$lib/plot'
  import { BUILTIN_VIBRATIONAL_REFERENCES } from '$lib/spectral'

  const frequencies = Array.from(
    { length: 721 },
    (_, frequency_idx) => 500 + frequency_idx * 5,
  )
  const gaussian = (frequency: number, center: number, width: number): number =>
    Math.exp(-0.5 * ((frequency - center) / width) ** 2)
  const normalized_curve = (
    centers: { frequency: number; amplitude: number }[],
    width: number,
  ): number[] => {
    const values = frequencies.map((frequency) =>
      centers.reduce(
        (total, center) =>
          total + center.amplitude * gaussian(frequency, center.frequency, width),
        0,
      ),
    )
    const maximum = Math.max(0, ...values)
    return maximum > 0 ? values.map((value) => value / maximum) : values
  }
  const spectrum = (
    id: string,
    label: string,
    centers: { frequency: number; amplitude: number }[],
    width: number,
    color: string,
    dashed = false,
  ): DataSeries => ({
    id,
    x: frequencies,
    y: normalized_curve(centers, width),
    label,
    markers: `line`,
    line_style: { stroke: color, stroke_width: 2, ...(dashed && { line_dash: `7 4` }) },
  })
  const panels = BUILTIN_VIBRATIONAL_REFERENCES.map((reference, reference_idx) => {
    const trajectory_centers = reference.modes.map((mode, mode_idx) => ({
      frequency: mode.wavenumber_cm1,
      amplitude: 0.55 + ((mode_idx + reference_idx) % 4) * 0.15,
    }))
    const infrared_centers = reference.modes.flatMap((mode, mode_idx) =>
      mode.ir_activity === `active`
        ? [{ frequency: mode.wavenumber_cm1, amplitude: 0.65 + ((mode_idx + 1) % 3) * 0.18 }]
        : [],
    )
    const raman_centers = reference.modes.flatMap((mode, mode_idx) =>
      mode.raman_activity === `active`
        ? [{ frequency: mode.wavenumber_cm1, amplitude: 0.6 + ((mode_idx + 2) % 3) * 0.2 }]
        : [],
    )
    const series = [
      spectrum(
        `${reference.id}-raman`,
        `Relative Raman intensity`,
        raman_centers,
        15,
        PLOT_COLORS[2],
      ),
      spectrum(
        `${reference.id}-ir`,
        `Relative IR intensity`,
        infrared_centers,
        13,
        PLOT_COLORS[0],
      ),
      spectrum(
        `${reference.id}-vdos`,
        `Mass-weighted VDOS`,
        trajectory_centers,
        17,
        PLOT_COLORS[1],
        true,
      ),
    ]
    const ref_lines: RefLine[] = reference.modes.map((mode) => ({
      type: `vertical`,
      x: mode.wavenumber_cm1,
      label: `${mode.label}: IR ${mode.ir_activity}, Raman ${mode.raman_activity}`,
      style: {
        color: mode.ir_activity === `active` ? `#c85a00` : `#777`,
        width: mode.ir_activity === `active` ? 2 : 1,
        dash: mode.ir_activity === `active` ? `` : `5 4`,
        opacity: 0.8,
      },
      annotation: { text: mode.label, position: `end`, side: `left` },
    }))
    return {
      key: reference.id,
      data: { title: reference.formula, series, ref_lines },
    }
  })
</script>

<svelte:head><title>Trajectory Spectroscopy Demo</title></svelte:head>

<h1>Trajectory IR/Raman &amp; VDOS</h1>
<p>
  The four panels exercise MatterViz's shared-axis spectroscopy presentation and curated
  activity markers. The smooth curves are deterministic synthetic stand-ins, not MACE
  predictions or experimental intensities; load a trajectory in the main viewer to compute
  finite-temperature IR, Raman, and mass-weighted VDOS from recorded response signals.
</p>

<div data-testid="trajectory-spectroscopy-facets" style="height: 760px; min-width: 0">
  <FacetGrid
    {panels}
    columns={2}
    gap={10}
    axis_modes={{ x: `shared`, y: `shared` }}
    axis_visibility={{ x: `outer`, x2: `none`, y: `outer`, y2: `none` }}
    shared_bands={{ title_height: 58, legend_width: 148, gap: 10 }}
  >
    {#snippet title()}
      <div class="shared-title">
        <strong>Gas-phase molecular IR, Raman, and vibrational DOS</strong>
        <span>Reference labels report independent IR and Raman activity</span>
      </div>
    {/snippet}
    {#snippet legend()}
      <div class="shared-legend" aria-label="Shared spectrum legend">
        <strong>Curves</strong>
        <span><i style:background={PLOT_COLORS[0]}></i>Relative IR</span>
        <span><i style:background={PLOT_COLORS[2]}></i>Relative Raman</span>
        <span><i class="dashed" style:background={PLOT_COLORS[1]}></i>Mass-weighted VDOS</span>
        <small>Each curve is independently max-normalized.</small>
      </div>
    {/snippet}
    {#snippet children(context)}
      <div class="facet-panel">
        <strong>{context.data.title}</strong>
        <ScatterPlot
          series={context.data.series}
          ref_lines={context.data.ref_lines}
          facet_layout={context}
          x_axis={{ label: `Wavenumber (cm⁻¹)`, range: [500, 4100] }}
          y_axis={{ label: `Independent normalized power`, range: [0, 1.08] }}
          styles={{ show_lines: true, show_points: false }}
          legend={null}
          show_controls={false}
          fullscreen_toggle={false}
          line_tween={{ duration: 0 }}
          style="height: 100%; min-height: 0"
        />
      </div>
    {/snippet}
  </FacetGrid>
</div>

<h2>Reference provenance</h2>
<p>
  The bundled catalog reproduces only individual band origins and bibliographic facts. NIST
  WebBook pages are comparison links; no NIST spectrum or compilation table is redistributed.
</p>
<div class="provenance-grid">
  {#each BUILTIN_VIBRATIONAL_REFERENCES as reference (reference.id)}
    <article>
      <h3>{reference.formula} · {reference.isotopologue} · {reference.phase}</h3>
      <ul>
        {#each reference.citations as citation (citation.id)}
          <li>
            <a href={citation.url}>{citation.authors} ({citation.year}), {citation.title}</a> — {citation.locator}
          </li>
        {/each}
      </ul>
      {#if reference.comparison_url}<a href={reference.comparison_url}
          >NIST WebBook cross-reference</a
        >{/if}
    </article>
  {/each}
</div>

<style>
  .shared-title {
    display: grid;
    place-content: center;
    height: 100%;
    text-align: center;
  }
  .shared-title span,
  small {
    opacity: 0.7;
  }
  .shared-legend {
    display: grid;
    align-content: center;
    gap: 0.7em;
    height: 100%;
  }
  .shared-legend span {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }
  .shared-legend i {
    inline-size: 1.5em;
    block-size: 3px;
    border-radius: 2px;
  }
  .shared-legend i.dashed {
    background: repeating-linear-gradient(
      90deg,
      var(--line-color) 0 8px,
      transparent 8px 12px
    ) !important;
    --line-color: currentColor;
  }
  .facet-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    min-width: 0;
    min-height: 0;
    text-align: center;
  }
  .provenance-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(22em, 1fr));
    gap: 1em;
  }
  article {
    padding: 0.8em;
    border: 1px solid var(--border-color, #8884);
    border-radius: var(--border-radius, 6px);
  }
  h3 {
    margin-top: 0;
  }
  ul {
    padding-left: 1.2em;
  }
</style>
