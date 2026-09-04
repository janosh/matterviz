<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { capitalize, format_num } from '$lib/labels'
  import PaneDivider from 'svelte-widgets/SplitPane.svelte'
  import type { Vec3 } from '$lib/math'
  import type { ScatterHandlerEvent } from '$lib/plot/core/types'
  import { parse_supercell_scaling } from '$lib/structure'
  import Trajectory from '$lib/trajectory/Trajectory.svelte'
  import { to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import { frequency_unit_per_thz } from './frequency-units'
  import { are_qpoints_equivalent, phonon_explorer_views, pretty_sym_point } from './helpers'
  import IrRamanSpectrum from './IrRamanSpectrum.svelte'
  import {
    DEFAULT_PHONON_AMPLITUDE,
    DEFAULT_PHONON_FPS,
    DEFAULT_PHONON_FRAMES,
    DEFAULT_PHONON_SHOW_VECTORS,
    DEFAULT_PHONON_SUPERCELL,
    PHONON_VECTOR_KEY,
    default_phonon_mode_selection,
    is_imaginary_frequency,
    nearest_qpoint_with_eigenvector,
    phonon_band_structure_from_modes,
    phonon_mode_character,
    phonon_mode_pattern,
    phonon_mode_run,
    phonon_qpoint_labels,
    phonon_supercell,
    qpoint_has_eigenvectors,
  } from './phonon-modes'
  import type {
    PhononExplorerView,
    PhononModeData,
    PhononModeDataset,
    PhononModeSelection,
    SpectrumKind,
  } from './types'

  const view_label = (candidate: PhononExplorerView): string =>
    candidate === `ir` ? `IR` : capitalize(candidate)
  const format_qpoint = (q_position: Vec3, fmt: string): string =>
    q_position.map((coordinate) => format_num(coordinate, fmt)).join(`, `)

  let {
    dataset,
    selection = $bindable(),
    view = $bindable(),
    amplitude = $bindable(DEFAULT_PHONON_AMPLITUDE),
    supercell = $bindable([...DEFAULT_PHONON_SUPERCELL] as Vec3),
    n_frames = $bindable(DEFAULT_PHONON_FRAMES),
    fps = $bindable(DEFAULT_PHONON_FPS),
    show_vectors = $bindable(DEFAULT_PHONON_SHOW_VECTORS),
    auto_play = true,
    pane_ratio = $bindable(1.15 / 2.1),
    trajectory_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    dataset: PhononModeDataset
    selection?: PhononModeSelection
    view?: PhononExplorerView
    amplitude?: number
    supercell?: Vec3
    n_frames?: number
    fps?: number
    show_vectors?: boolean
    auto_play?: boolean
    pane_ratio?: number
    trajectory_props?: Partial<ComponentProps<typeof Trajectory>>
  } = $props()

  let error_msg = $state<string>()
  let current_step_idx = $state(0)
  let mode_data = $derived(dataset.modes)
  let active_spectrum = $derived(dataset.spectrum)

  const report_error = (error: unknown): void => {
    error_msg = to_error(error).message
  }
  const try_generate = <Value>(generator: () => Value) => {
    try {
      return { value: generator(), error: null }
    } catch (error) {
      return { value: null, error: to_error(error).message }
    }
  }

  let initialized_data: PhononModeData | undefined
  $effect(() => {
    const data = mode_data
    if (data === initialized_data) return
    initialized_data = data
    const current_mode =
      selection && data.qpoints[selection.qpoint_idx]?.modes[selection.mode_idx]
    if (!current_mode?.eigenvector) selection = default_phonon_mode_selection(data)
  })

  let band_result = $derived.by(() =>
    mode_data.path_segments.length
      ? try_generate(() => phonon_band_structure_from_modes(mode_data))
      : { value: null, error: null },
  )
  let visible_views = $derived(
    phonon_explorer_views(mode_data, active_spectrum).filter(
      (candidate) => candidate !== `bands` || band_result.value,
    ),
  )
  $effect(() => {
    if (!view || !visible_views.includes(view)) view = visible_views[0]
  })
  // Three stages so each control redoes only its own work: the supercell (tiling + bonding)
  // survives mode and amplitude changes and keys the camera framing, the displacement pattern
  // survives amplitude changes, and frames are synthesised on read
  let supercell_result = $derived(try_generate(() => phonon_supercell(mode_data, supercell)))
  let pattern_result = $derived.by(() => {
    const [cell, selected] = [supercell_result.value, selection]
    if (!cell || !selected) return { value: null, error: null }
    return try_generate(() => phonon_mode_pattern(cell, selected))
  })
  let trajectory_result = $derived.by(() => {
    const pattern = pattern_result.value
    if (!pattern) return { value: null, error: null }
    return try_generate(() => phonon_mode_run(pattern, { amplitude, n_frames }))
  })
  let generation_error = $derived(
    supercell_result.error ?? pattern_result.error ?? trajectory_result.error,
  )
  let selected_qpoint = $derived(selection && mode_data.qpoints[selection.qpoint_idx])
  let selected_mode = $derived(selection && selected_qpoint?.modes[selection.mode_idx])
  let qpoint_labels = $derived(phonon_qpoint_labels(mode_data))
  let n_animatable_qpoints = $derived(mode_data.qpoints.filter(qpoint_has_eigenvectors).length)
  // Mode indices at the selected q-point that can be animated, for prev/next stepping
  let animatable_mode_indices = $derived(
    (selected_qpoint?.modes ?? []).flatMap((mode, mode_idx) =>
      mode.eigenvector ? [mode_idx] : [],
    ),
  )
  let commensurate = $derived(pattern_result.value?.is_commensurate ?? true)
  let character = $derived(
    selected_mode?.eigenvector && phonon_mode_character(mode_data, selected_mode.eigenvector),
  )
  const wavenumber = (thz: number): string =>
    `${format_num(thz * frequency_unit_per_thz(`cm^-1`), `.1f`)} cm⁻¹`

  let reset_key = ``
  $effect(() => {
    const next_key = selection
      ? `${selection.qpoint_idx}:${selection.mode_idx}:${supercell.join(`,`)}`
      : ``
    if (reset_key && next_key !== reset_key) current_step_idx = 0
    reset_key = next_key
  })

  const set_selection = (next: PhononModeSelection): void => {
    if (!mode_data.qpoints[next.qpoint_idx]?.modes[next.mode_idx]?.eigenvector) {
      report_error(
        `Mode ${next.mode_idx + 1} at q-point ${next.qpoint_idx + 1} has no eigenvector`,
      )
      return
    }
    selection = next
    error_msg = undefined
  }

  const select_qpoint = (qpoint_idx: number): void => {
    const modes = mode_data.qpoints[qpoint_idx]?.modes ?? []
    const current_mode_idx = selection?.mode_idx ?? 0
    const mode_idx = modes[current_mode_idx]?.eigenvector
      ? current_mode_idx
      : modes.findIndex((mode) => mode.eigenvector)
    if (mode_idx !== -1) set_selection({ qpoint_idx, mode_idx })
  }

  // Band files may carry eigenvectors at only some q-points; a click elsewhere snaps to the
  // nearest one along the path that can animate this band. Wired to both the markers and the
  // plot background: markers are a few px wide, so a near miss selects the point under the tooltip
  const handle_band_click = (event: ScatterHandlerEvent): void => {
    const { band_idx, qpoint_idx } = event.metadata ?? {}
    if (typeof band_idx !== `number` || typeof qpoint_idx !== `number`) return
    const snapped_idx = nearest_qpoint_with_eigenvector(mode_data, qpoint_idx, band_idx)
    if (snapped_idx === -1) {
      report_error(`Band ${band_idx + 1} has no eigenvector at any q-point`)
      return
    }
    set_selection({ qpoint_idx: snapped_idx, mode_idx: band_idx })
  }

  const step_mode = (direction: 1 | -1): void => {
    if (!selection) return
    const position = animatable_mode_indices.indexOf(selection.mode_idx)
    const mode_idx = animatable_mode_indices[position + direction]
    if (mode_idx !== undefined) set_selection({ ...selection, mode_idx })
  }

  const select_spectrum_mode = (mode_idx: number): void => {
    if (!active_spectrum) return
    const selected_qpoint_idx = selection?.qpoint_idx ?? -1
    const current_qpoint = mode_data.qpoints[selected_qpoint_idx]
    const qpoint_idx =
      current_qpoint &&
      are_qpoints_equivalent(current_qpoint.q_position, active_spectrum.q_position)
        ? selected_qpoint_idx
        : mode_data.qpoints.findIndex(({ q_position }) =>
            are_qpoints_equivalent(q_position, active_spectrum.q_position),
          )
    if (qpoint_idx === -1) {
      report_error(
        `Spectrum q-point [${active_spectrum.q_position.join(`, `)}] is absent from mode data`,
      )
      return
    }
    set_selection({ qpoint_idx, mode_idx })
  }
</script>

<div {...rest} class={[`phonon-mode-explorer`, rest.class]}>
  {#if error_msg}<StatusMessage bind:message={error_msg} type="error" dismissible />{/if}
  {#if band_result.error}<StatusMessage message={band_result.error} type="error" />{/if}
  {#if generation_error}<StatusMessage message={generation_error} type="error" />{/if}
  {#if !commensurate}
    <StatusMessage
      message="This q-point is not commensurate with the selected supercell, so opposite box faces do not repeat periodically."
      type="warning"
    />
  {/if}
  <div class="explorer-header">
    {#if selected_mode && selection && selected_qpoint}
      <div class="mode-summary" data-testid="phonon-mode-summary">
        <strong>Mode {selection.mode_idx + 1}</strong>
        <span class="frequency"
          >{format_num(selected_mode.frequency, `.5~`)} THz
          <small>{wavenumber(selected_mode.frequency)}</small></span
        >
        {#if qpoint_labels[selection.qpoint_idx]}
          <span class="qpoint-label"
            >{pretty_sym_point(qpoint_labels[selection.qpoint_idx])}</span
          >
        {/if}
        <span class="qpoint">q = [{format_qpoint(selected_qpoint.q_position, `.4~`)}]</span>
        {#if character}
          <span
            class="character"
            title="Share of the mass-weighted mode each element carries · participation ratio {format_num(
              character.participation_ratio,
              `.2f`,
            )} (1 = all atoms move equally)"
            >{character.element_weights
              .map(([symbol, weight]) => `${symbol} ${format_num(weight * 100, `.0f`)}%`)
              .join(` · `)}</span
          >
        {/if}
        {#if is_imaginary_frequency(selected_mode.frequency)}<span class="unstable"
            >Unstable mode · periodic mode-shape preview</span
          >{/if}
        {#if n_animatable_qpoints < mode_data.qpoints.length}
          <span
            class="sparse"
            title="This file stores eigenvectors at {n_animatable_qpoints} of its {mode_data
              .qpoints.length} q-points; band clicks snap to the nearest one that can animate"
            >eigenvectors at {n_animatable_qpoints}/{mode_data.qpoints.length} q-points</span
          >
        {/if}
        {#if dataset.filename}<span class="source">{dataset.filename}</span>{/if}
      </div>
    {/if}
    <div class="tabs" role="group" aria-label="Phonon explorer plot">
      {#each visible_views as candidate}
        <button
          aria-pressed={view === candidate}
          class:active={view === candidate}
          onclick={() => (view = candidate)}>{view_label(candidate)}</button
        >
      {/each}
    </div>
  </div>
  <div class="panes">
    <section class="trajectory-pane" aria-label="Atomic motion">
      {#if trajectory_result.value}
        <Trajectory
          {...trajectory_props}
          trajectory={trajectory_result.value}
          bind:current_step_idx
          bind:fps
          bind:supercell_scaling={
            () => supercell.join(`x`),
            (scaling) => (supercell = parse_supercell_scaling(scaling))
          }
          {auto_play}
          display_mode="structure"
          show_controls={{
            mode: `hover`,
            hidden: [
              `filename`,
              `info-pane`,
              `msd-pane`,
              `vacf-pane`,
              `rdf-pane`,
              `structure-id-pane`,
              `data-inspector-pane`,
              `x-axis`,
              `view-mode`,
            ],
          }}
          structure_props={{
            // Re-frame the camera only when the displayed cell changes, not per mode/amplitude
            structure_series_key: supercell_result.value?.structure,
            analyze_symmetry: false,
            apply_supercell_scaling: false,
            show_image_atoms: false,
            scene_props: {
              bonding_strategy: `explicit_only`,
              show_polyhedra: `never`,
              vector_configs: {
                [PHONON_VECTOR_KEY]: {
                  visible: show_vectors,
                  color: null,
                  scale: null,
                },
              },
            },
          }}
        />
      {/if}
    </section>
    <PaneDivider
      orientation="horizontal"
      bind:ratio={pane_ratio}
      aria-label="Resize atomic motion and phonon plot panes"
    />
    <section class="plot-pane" aria-label="Phonon mode plot">
      {#if view === `bands` && band_result.value}
        <Bands
          band_structs={band_result.value}
          band_type="phonon"
          reference_frequency={selected_mode?.frequency ?? null}
          highlighted_qpoint_index={selection?.qpoint_idx ?? null}
          highlighted_band_index={selection?.mode_idx ?? null}
          on_point_click={handle_band_click}
          on_plot_click={handle_band_click}
          show_controls={false}
        />
      {:else if (view === `ir` || view === `raman`) && active_spectrum}
        <IrRamanSpectrum
          spectrum={active_spectrum}
          kind={view as SpectrumKind}
          selected_mode_idx={selection?.mode_idx ?? null}
          on_mode_select={select_spectrum_mode}
          show_controls={false}
        />
      {:else}
        <div class="mode-list">
          {#each selected_qpoint?.modes ?? [] as mode, mode_idx (mode_idx)}
            <button
              class:selected={selection?.mode_idx === mode_idx}
              disabled={!mode.eigenvector}
              onclick={() => selection && set_selection({ ...selection, mode_idx })}
            >
              <span>Mode {mode_idx + 1}</span><span
                >{format_num(mode.frequency, `.5~`)} THz</span
              >
            </button>
          {/each}
        </div>
      {/if}
    </section>
  </div>
  <div class="toolbar" aria-label="Phonon animation controls">
    {#if mode_data.qpoints.length > 1}
      <label
        >q-point
        <select
          aria-label="q-point"
          value={selection?.qpoint_idx ?? 0}
          onchange={(event) => select_qpoint(Number(event.currentTarget.value))}
        >
          {#each mode_data.qpoints as qpoint, qpoint_idx (qpoint_idx)}
            <option value={qpoint_idx} disabled={!qpoint_has_eigenvectors(qpoint)}
              >{qpoint_idx + 1}: {qpoint_labels[qpoint_idx]
                ? `${pretty_sym_point(qpoint_labels[qpoint_idx])} `
                : ``}[{format_qpoint(qpoint.q_position, `.3~`)}]</option
            >
          {/each}
        </select>
      </label>
    {/if}
    <div class="mode-control">
      Mode
      <button
        type="button"
        class="step-mode"
        aria-label="Previous mode"
        title="Previous mode with an eigenvector"
        disabled={!selection || animatable_mode_indices[0] === selection.mode_idx}
        onclick={() => step_mode(-1)}>‹</button
      >
      <select
        aria-label="Mode"
        value={selection?.mode_idx ?? 0}
        onchange={(event) =>
          selection &&
          set_selection({ ...selection, mode_idx: Number(event.currentTarget.value) })}
      >
        {#each selected_qpoint?.modes ?? [] as mode, mode_idx (mode_idx)}
          <option value={mode_idx} disabled={!mode.eigenvector}
            >{mode_idx + 1}: {format_num(mode.frequency, `.5~`)} THz</option
          >
        {/each}
      </select>
      <button
        type="button"
        class="step-mode"
        aria-label="Next mode"
        title="Next mode with an eigenvector"
        disabled={!selection || animatable_mode_indices.at(-1) === selection.mode_idx}
        onclick={() => step_mode(1)}>›</button
      >
    </div>
    <label class="amplitude-control">
      Amplitude
      <input type="range" min="0.02" max="1" step="0.02" bind:value={amplitude} />
      <output>{format_num(amplitude, `.3~`)} Å</output>
    </label>
    <label class="checkbox"
      ><input type="checkbox" bind:checked={show_vectors} />Eigenvectors</label
    >
  </div>
</div>

<style>
  .phonon-mode-explorer {
    display: flex;
    flex-direction: column;
    gap: 0.4em;
    min-height: 560px;
  }
  .explorer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.35em 1em;
  }
  .mode-summary {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.6em;
    min-width: 0;
    .frequency {
      color: var(--accent-color, #2878c8);
    }
    .qpoint-label {
      font-weight: 600;
      /* the label reads as a prefix of the q-vector it names */
      margin-right: -0.3em;
    }
    .unstable {
      color: var(--warning-color, #b45309);
    }
    .character,
    .sparse {
      color: var(--text-muted, #6b7280);
      font-size: 0.9em;
    }
  }
  .tabs {
    display: inline-flex;
    button {
      padding: 0.25em 0.55em;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      background: transparent;
      &.active {
        color: var(--accent-color, #2678b2);
        border-bottom-color: currentColor;
      }
    }
  }
  .panes {
    display: grid;
    position: relative;
    grid-template-columns: minmax(0, var(--split-pane-size, 54.7619%)) minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    border-block: 1px solid color-mix(in srgb, var(--border-color, #b7bec8) 55%, transparent);
  }
  .plot-pane,
  .trajectory-pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .plot-pane {
    /* Bands and IrRamanSpectrum both use ScatterPlot's public sizing contract. */
    --scatter-height: 100%;
    --scatter-min-height: 0;
  }
  .trajectory-pane {
    --traj-border-radius: 0;
    --struct-border-radius: 0;
  }
  /* the bar stays open while its step input has focus; hovering the plot pane hides it anyway
     so the spectra are never covered */
  .panes:has(.plot-pane:hover) :global(.trajectory-controls.hover-visible) {
    opacity: 0;
    pointer-events: none;
  }
  .plot-pane > :global(*),
  .trajectory-pane > :global(*) {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  /* Every control is one inline row: label text, then its input, on the same line */
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35em 1.2em;
    padding: 0.35em 0 0;
    label,
    .mode-control {
      display: flex;
      align-items: center;
      gap: 0.4em;
      white-space: nowrap;
    }
    select {
      max-width: 18em;
    }
    .step-mode {
      padding: 0 0.45em;
      line-height: 1.4;
      font-size: 1.1em;
    }
  }
  .amplitude-control {
    input {
      width: 9em;
    }
    output {
      min-width: 4.5em;
    }
  }
  .mode-list {
    display: grid;
    align-content: start;
    gap: 0.2em;
    overflow: auto;
    padding: 0.4em;
    box-sizing: border-box;
    button {
      display: flex;
      justify-content: space-between;
      padding: 0.45em 0.6em;
      border: 1px solid transparent;
      background: transparent;
      &.selected {
        border-left-color: var(--accent-color, #4c78a8);
        color: var(--accent-color, #4c78a8);
      }
    }
  }
  /* Stack the panes on phones and portrait tablets. A landscape phone (e.g. 844×390) keeps
     them side by side: stacking there would put ~940px of panes into a 390px-tall viewport,
     so the structure and the plot could never be on screen together. */
  @media (max-width: 699px), (max-width: 900px) and (orientation: portrait) {
    .phonon-mode-explorer {
      min-height: 940px;
    }
    .panes {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(340px, 1fr) minmax(340px, 1fr);
      border-block: 0;
      > :global(.pane-divider) {
        display: none;
      }
    }
    .plot-pane,
    .trajectory-pane {
      border-block: 1px solid color-mix(in srgb, var(--border-color, #b7bec8) 55%, transparent);
    }
  }
  @media (max-width: 560px) {
    .explorer-header {
      align-items: stretch;
    }
    .tabs {
      width: 100%;
    }
    .tabs button {
      flex: 1;
    }
    .toolbar select {
      flex: 1;
      min-width: 0;
    }
  }
</style>
