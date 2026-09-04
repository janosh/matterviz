<script lang="ts">
  // Time-averaged partial g(r) of an MD run with the coordination shells read off each curve.
  // Frames are analysed one at a time (see calc-trajectory-rdf.ts), so the shared pane's
  // frame-stride control stays hidden and `max_frames` caps the sample instead.
  import { format_num } from '$lib/labels'
  import type { ViewerPaneOptions } from '$lib/overlays'
  import { has_usable_lattice, lattice_unavailable_reason } from '$lib/structure/validation'
  import type { TrajectoryRun } from '$lib/trajectory'
  import type { AnalysisCollectOptions } from '$lib/trajectory/analysis'
  import { positive_int, sweep_frame_plan, sweep_progress } from '$lib/trajectory/analysis'
  import AnalysisSummary from '$lib/trajectory/AnalysisSummary.svelte'
  import TrajectoryAnalysisPane from '$lib/trajectory/TrajectoryAnalysisPane.svelte'
  import type { TrajectoryRdf } from './calc-trajectory-rdf'
  import {
    collect_trajectory_rdf,
    DEFAULT_RDF_BINS,
    DEFAULT_RDF_CUTOFF,
    DEFAULT_RDF_MAX_FRAMES,
  } from './calc-trajectory-rdf'
  import type { RdfEntry } from './index'
  import RdfPlot from './RdfPlot.svelte'

  let {
    run,
    pane_open = $bindable(false),
    result = $bindable(),
    ...pane_options
  }: ViewerPaneOptions & {
    run?: TrajectoryRun
    pane_open?: boolean
    result?: TrajectoryRdf
  } = $props()

  // null, not 0, is what <input type="number"> writes back when cleared
  let max_frames = $state<number | null>(DEFAULT_RDF_MAX_FRAMES)
  let cutoff = $state<number | null>(DEFAULT_RDF_CUTOFF)
  let n_bins = $state<number | null>(DEFAULT_RDF_BINS)
  let error_msg = $state<string | undefined>(undefined)

  let safe_max_frames = $derived(positive_int(max_frames, DEFAULT_RDF_MAX_FRAMES))
  let safe_bins = $derived(positive_int(n_bins, DEFAULT_RDF_BINS))
  let safe_cutoff = $derived(
    cutoff !== null && Number.isFinite(cutoff) && cutoff > 0 ? cutoff : DEFAULT_RDF_CUTOFF,
  )
  // A cutoff past half the cell is legal (the neighbour search images as far as needed) but
  // g(r) there averages over periodic replicas, so say so rather than refuse
  let half_cell = $derived.by(() => {
    const structure = run?.preview.structure
    if (!has_usable_lattice(structure)) return null
    return Math.min(structure.lattice.a, structure.lattice.b, structure.lattice.c) / 2
  })

  const collect = (
    target: TrajectoryRun,
    { on_progress, signal, start_frame, end_frame }: AnalysisCollectOptions,
  ): Promise<TrajectoryRdf> =>
    collect_trajectory_rdf(target, {
      signal,
      start_frame,
      end_frame,
      max_frames: safe_max_frames,
      cutoff: safe_cutoff,
      n_bins: safe_bins,
      on_progress: sweep_progress(on_progress),
    })

  let entries = $derived<RdfEntry[]>(
    (result?.curves ?? []).map(({ label, g_r, element_pair }) => ({
      label,
      pattern: { r: result?.r ?? [], g_r, element_pair },
    })),
  )
  const fmt = (value: number | null, spec = `.3~f`): string =>
    value === null ? `—` : format_num(value, spec)
</script>

<TrajectoryAnalysisPane
  {run}
  bind:pane_open
  bind:input={result}
  bind:error_msg
  title="Radial Distribution Function"
  pane_name="radial distribution function"
  class_prefix="trajectory-rdf"
  analysis_name="RDF"
  {collect}
  frame_unavailable_reason={({ structure }) =>
    lattice_unavailable_reason(structure, true) ?? null}
  compute_label="Compute g(r)"
  recollect_label="Recompute"
  collecting_label="Binning pair distances…"
  {...pane_options}
>
  <!-- with no stride control, collected_frames is the trajectory's total frame count -->
  {#snippet controls({ collected_frames: total_frames, n_atoms })}
    {@const plan =
      total_frames > 0
        ? sweep_frame_plan(total_frames, safe_max_frames)
        : { frame_numbers: [], frame_stride: 1 }}
    <label>
      Max frames
      <input
        type="number"
        aria-label="Max RDF frames"
        min="1"
        step="1"
        bind:value={max_frames}
      />
    </label>
    <label>
      Cutoff
      <input type="number" aria-label="RDF cutoff" min="0.5" step="0.5" bind:value={cutoff} />
      <span>Å</span>
      {#if half_cell !== null && safe_cutoff > half_cell}
        <span class="hint">beyond half the cell ({format_num(half_cell, `.3~g`)} Å)</span>
      {/if}
    </label>
    <label>
      Bins
      <input type="number" aria-label="RDF bins" min="10" step="10" bind:value={n_bins} />
      <span class="hint">{format_num(safe_cutoff / safe_bins, `.3~g`)} Å per bin</span>
    </label>
    <p class="hint">
      {plan.frame_numbers.length} of {total_frames} frames
      {#if plan.frame_stride > 1}(every {plan.frame_stride}){/if}
      × {n_atoms} atoms
    </p>
  {/snippet}
  {#snippet children({ input, collecting })}
    <RdfPlot
      patterns={entries}
      allow_file_drop={false}
      loading={collecting}
      {error_msg}
      style="height: 320px"
    />
    {#if input}
      <AnalysisSummary
        headers={[`Pair A-B`, `r₁ (Å)`, `g(r₁)`, `r_min (Å)`, `CN(B|A)`, `CN(A|B)`]}
        downloads={[
          {
            label: `g(r) CSV`,
            filename: `rdf.csv`,
            columns: () => ({
              r_A: input.r,
              ...Object.fromEntries(input.curves.map(({ label, g_r }) => [`g_${label}`, g_r])),
            }),
          },
          {
            label: `Analysis JSON`,
            filename: `rdf.json`,
            json: () => ({
              schema_version: 1,
              analysis: `rdf`,
              units: {
                distance: `A`,
                volume: `A^3`,
                g_r: `dimensionless`,
                coordination: `neighbors`,
              },
              ...input,
            }),
          },
        ]}
      >
        {#each input.curves as { label, shell, coordination_reverse } (label)}
          <tr>
            <td>{label}</td>
            <td>{fmt(shell.first_peak_r)}</td>
            <td>{fmt(shell.first_peak_height, `.3~g`)}</td>
            <td>{fmt(shell.first_min_r)}</td>
            <td>{fmt(shell.coordination, `.3~g`)}</td>
            <td>{fmt(coordination_reverse, `.3~g`)}</td>
          </tr>
        {/each}
        {#snippet note()}
          {input.frame_numbers.length} frames
          {#if input.frame_stride > 1}(every {input.frame_stride}th){/if}
          × {input.n_atoms} atoms · cutoff {format_num(input.cutoff, `.3~g`)} Å · ⟨V⟩ =
          {format_num(input.mean_volume, `.4~g`)} Å³ · CN(B|A) counts B neighbours of an A atom out
          to r_min
        {/snippet}
      </AnalysisSummary>
    {/if}
  {/snippet}
</TrajectoryAnalysisPane>
