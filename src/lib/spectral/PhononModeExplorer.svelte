<script lang="ts">
  import EmptyState from '$lib/EmptyState.svelte'
  import { Spinner, StatusMessage } from '$lib/feedback'
  import * as io from '$lib/io'
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import type { ScatterHandlerEvent } from '$lib/plot/core/types'
  import Trajectory from '$lib/trajectory/Trajectory.svelte'
  import { to_error } from '$lib/utils'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import IrRamanSpectrum from './IrRamanSpectrum.svelte'
  import { acoustic_mode_indices } from './ir-raman'
  import { parse_phonon_modes } from './parse-phonon-modes'
  import {
    DEFAULT_PHONON_AMPLITUDE,
    DEFAULT_PHONON_FRAMES,
    DEFAULT_PHONON_SUPERCELL,
    PHONON_VECTOR_KEY,
    phonon_band_structure_from_modes,
    phonon_mode_trajectory,
  } from './phonon-modes'
  import type {
    PhononExplorerView,
    PhononModeData,
    PhononModeSelection,
    SpectrumKind,
    VibrationalSpectrum,
  } from './types'

  export type PhononModeExplorerHandlerData = {
    mode_data?: PhononModeData
    selection?: PhononModeSelection
    filename?: string
    source_filename?: string
    file?: File
    error_msg?: string
  }

  let {
    mode_data = $bindable(),
    yaml,
    data_url,
    spectrum,
    selection = $bindable(),
    view = $bindable(),
    amplitude = $bindable(DEFAULT_PHONON_AMPLITUDE),
    supercell = $bindable([...DEFAULT_PHONON_SUPERCELL] as Vec3),
    n_frames = $bindable(DEFAULT_PHONON_FRAMES),
    fps = $bindable(12),
    show_vectors = $bindable(true),
    allow_file_drop = true,
    auto_play = true,
    on_file_load,
    on_selection_change,
    on_error,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    mode_data?: PhononModeData
    yaml?: string
    data_url?: string
    spectrum?: VibrationalSpectrum
    selection?: PhononModeSelection
    view?: PhononExplorerView
    amplitude?: number
    supercell?: Vec3
    n_frames?: number
    fps?: number
    show_vectors?: boolean
    allow_file_drop?: boolean
    auto_play?: boolean
    on_file_load?: (data: PhononModeExplorerHandlerData) => void
    on_selection_change?: (data: PhononModeExplorerHandlerData) => void
    on_error?: (data: PhononModeExplorerHandlerData) => void
  } = $props()

  let loaded_data = $state<PhononModeData>()
  let loading = $state(false)
  let dragover = $state(false)
  let error_msg = $state<string>()
  let current_step_idx = $state(0)
  let source_filename = $state<string>()
  const data_url_loader = io.create_data_url_loader<PhononModeData>()

  const report_error = (error: unknown, filename?: string): void => {
    const prefix = filename ? `${filename}: ` : ``
    error_msg = `${prefix}${to_error(error).message}`
    on_error?.({ error_msg, filename })
  }

  const parse_source = (
    content: string | ArrayBuffer,
    filename?: string,
    metadata?: io.FileLoadMeta,
  ): PhononModeData => {
    if (filename && !/\.ya?ml$/i.test(filename)) {
      throw new Error(`expected a .yaml or .yml phonopy mode file, got '${filename}'`)
    }
    const parsed = parse_phonon_modes(io.as_text(content))
    loaded_data = parsed
    source_filename = filename
    error_msg = undefined
    on_file_load?.({ mode_data: parsed, filename, ...metadata })
    return parsed
  }

  $effect(() => {
    const source_count =
      Number(mode_data !== undefined) +
      Number(yaml !== undefined) +
      Number(data_url !== undefined)
    if (source_count > 1) {
      loaded_data = undefined
      report_error(`Provide exactly one of mode_data, yaml, or data_url`)
      return
    }
    if (mode_data) {
      loaded_data = mode_data
      source_filename = undefined
      error_msg = undefined
    } else if (yaml !== undefined) {
      try {
        parse_source(yaml)
      } catch (error) {
        loaded_data = undefined
        report_error(error)
      }
    } else if (!data_url) {
      loaded_data = undefined
      source_filename = undefined
    }
  })

  $effect(() =>
    data_url_loader.request({
      url: data_url,
      current_value: mode_data,
      skip: mode_data !== undefined || yaml !== undefined,
      set_loading: (value) => (loading = value),
      clear_error: () => (error_msg = undefined),
      on_load: ({ content, filename, metadata, is_current, mark_owned }) => {
        try {
          const parsed = parse_source(content, filename, metadata)
          if (is_current()) mark_owned(parsed)
        } catch (error) {
          if (is_current()) report_error(error, filename)
        }
      },
      on_error: report_error,
    }),
  )

  const handle_file_drop = io.create_file_drop_handler({
    allow: () => allow_file_drop && yaml === undefined && data_url === undefined,
    max_files: 1,
    on_drop: (content, filename, metadata) => {
      const parsed = parse_source(content, filename, metadata)
      mode_data = parsed
    },
    on_error: (message) => report_error(message),
    set_loading: (value) => {
      loading = value
      if (value) [dragover, error_msg] = [false, undefined]
    },
  })

  const first_selectable_mode = (data: PhononModeData): PhononModeSelection | undefined => {
    const gamma_idx = data.qpoints.findIndex(({ q_position }) =>
      q_position.every((coordinate) => Math.abs(coordinate - Math.round(coordinate)) < 0.01),
    )
    const qpoint_order = [
      gamma_idx,
      ...data.qpoints.map((_, qpoint_idx) => qpoint_idx),
    ].filter(
      (qpoint_idx, order_idx, values) =>
        qpoint_idx >= 0 && values.indexOf(qpoint_idx) === order_idx,
    )
    for (const qpoint_idx of qpoint_order) {
      const qpoint = data.qpoints[qpoint_idx]
      const acoustic = acoustic_mode_indices(qpoint.modes, qpoint.q_position)
      const optical_idx = qpoint.modes.findIndex(
        (mode, mode_idx) => mode.eigenvector !== null && !acoustic.has(mode_idx),
      )
      const mode_idx =
        optical_idx !== -1 ? optical_idx : qpoint.modes.findIndex((mode) => mode.eigenvector)
      if (mode_idx !== -1) return { qpoint_idx, mode_idx }
    }
  }

  let selected_data = $state<PhononModeData>()
  $effect(() => {
    const data = loaded_data
    if (!data || data === selected_data) return
    selected_data = data
    const current_mode =
      selection && data.qpoints[selection.qpoint_idx]?.modes[selection.mode_idx]
    if (!current_mode?.eigenvector) selection = first_selectable_mode(data)
    const has_bands = data.path_segments.length > 0
    const valid_view =
      (view === `bands` && has_bands) ||
      (view === `ir` && spectrum) ||
      (view === `raman` && spectrum?.has_raman) ||
      view === `modes`
    if (!valid_view) view = has_bands ? `bands` : spectrum ? `ir` : `modes`
  })

  let band_result = $derived.by(() => {
    if (!loaded_data?.path_segments.length) return { value: null, error: null }
    try {
      return { value: phonon_band_structure_from_modes(loaded_data), error: null }
    } catch (error) {
      return { value: null, error: to_error(error).message }
    }
  })
  let trajectory_result = $derived.by(() => {
    if (!loaded_data || !selection) return { value: null, error: null }
    try {
      return {
        value: phonon_mode_trajectory(loaded_data, selection, {
          amplitude,
          supercell,
          n_frames,
        }),
        error: null,
      }
    } catch (error) {
      return { value: null, error: to_error(error).message }
    }
  })
  let selected_qpoint = $derived(
    selection === undefined ? undefined : loaded_data?.qpoints[selection.qpoint_idx],
  )
  let selected_mode = $derived(selected_qpoint?.modes[selection?.mode_idx ?? -1])
  let commensurate = $derived(trajectory_result.value?.metadata?.is_commensurate !== false)

  let reported_generation_error: string | null = null
  $effect(() => {
    const generation_error = trajectory_result.error ?? band_result.error
    if (generation_error && generation_error !== reported_generation_error) {
      on_error?.({ error_msg: generation_error, filename: source_filename })
    }
    reported_generation_error = generation_error
  })

  let reset_key = ``
  $effect(() => {
    const next_key = selection
      ? `${selection.qpoint_idx}:${selection.mode_idx}:${supercell.join(`,`)}`
      : ``
    if (reset_key && next_key !== reset_key) current_step_idx = 0
    reset_key = next_key
  })

  const set_selection = (next: PhononModeSelection): void => {
    if (!loaded_data?.qpoints[next.qpoint_idx]?.modes[next.mode_idx]?.eigenvector) {
      report_error(
        `Mode ${next.mode_idx + 1} at q-point ${next.qpoint_idx + 1} has no eigenvector`,
      )
      return
    }
    selection = next
    error_msg = undefined
    on_selection_change?.({ mode_data: loaded_data, selection: next })
  }

  const select_qpoint = (qpoint_idx: number): void => {
    if (!loaded_data) return
    const modes = loaded_data.qpoints[qpoint_idx]?.modes ?? []
    const current_mode_idx = selection?.mode_idx ?? 0
    const mode_idx = modes[current_mode_idx]?.eigenvector
      ? current_mode_idx
      : modes.findIndex((mode) => mode.eigenvector)
    if (mode_idx !== -1) set_selection({ qpoint_idx, mode_idx })
  }

  const handle_band_click = (event: ScatterHandlerEvent): void => {
    const { band_idx, qpoint_idx } = event.metadata ?? {}
    if (typeof band_idx === `number` && typeof qpoint_idx === `number`) {
      set_selection({ qpoint_idx, mode_idx: band_idx })
    }
  }

  const select_spectrum_mode = (mode_idx: number): void => {
    if (!loaded_data || !spectrum) return
    const matches = loaded_data.qpoints
      .map((qpoint, qpoint_idx) => ({ qpoint, qpoint_idx }))
      .filter(({ qpoint }) =>
        qpoint.q_position.every((coordinate, axis) => {
          const delta = coordinate - spectrum.q_position[axis]
          return Math.abs(delta - Math.round(delta)) < 1e-6
        }),
      )
    const current_match = matches.find(
      ({ qpoint_idx }) => qpoint_idx === selection?.qpoint_idx,
    )
    const qpoint_idx = current_match?.qpoint_idx ?? matches[0]?.qpoint_idx
    if (qpoint_idx === undefined) {
      report_error(
        `Spectrum q-point [${spectrum.q_position.join(`, `)}] is absent from mode data`,
      )
      return
    }
    set_selection({ qpoint_idx, mode_idx })
  }

  const set_supercell_axis = (axis: number, value: number): void => {
    if (!Number.isInteger(value) || value <= 0) return
    supercell = supercell.map((scale, scale_axis) =>
      scale_axis === axis ? value : scale,
    ) as Vec3
  }
</script>

<div
  {...rest}
  class={[`phonon-mode-explorer`, { dragover }, rest.class]}
  ondrop={handle_file_drop}
  {...io.drag_over_handlers({
    allow: () => allow_file_drop && yaml === undefined && data_url === undefined,
    set_dragover: (value) => (dragover = value),
  })}
>
  {#if loading}
    <Spinner text="Loading phonon modes…" />
  {:else if !loaded_data}
    <EmptyState>
      <h3>Phonon mode explorer</h3>
      <p>
        Drop one phonopy <code>band.yaml</code>, <code>qpoints.yaml</code>,
        <code>mesh.yaml</code>, or gzip-compressed equivalent.
      </p>
      {#if error_msg}<StatusMessage message={error_msg} type="error" />{/if}
    </EmptyState>
  {:else}
    {#if error_msg}<StatusMessage bind:message={error_msg} type="error" dismissible />{/if}
    {#if band_result.error}<StatusMessage message={band_result.error} type="error" />{/if}
    {#if trajectory_result.error}<StatusMessage
        message={trajectory_result.error}
        type="error"
      />{/if}
    {#if !commensurate}
      <StatusMessage
        message="This q-point is not commensurate with the selected supercell, so opposite box faces do not repeat periodically."
        type="warning"
      />
    {/if}
    <div class="toolbar">
      <div class="tabs" aria-label="Phonon explorer plot">
        {#if band_result.value}<button
            class:active={view === `bands`}
            onclick={() => (view = `bands`)}>Bands</button
          >{/if}
        {#if spectrum}<button class:active={view === `ir`} onclick={() => (view = `ir`)}
            >IR</button
          >{/if}
        {#if spectrum?.has_raman}<button
            class:active={view === `raman`}
            onclick={() => (view = `raman`)}>Raman</button
          >{/if}
        <button class:active={view === `modes`} onclick={() => (view = `modes`)}>Modes</button>
      </div>
      <label
        >q-point
        <select
          value={selection?.qpoint_idx ?? 0}
          onchange={(event) => select_qpoint(Number(event.currentTarget.value))}
        >
          {#each loaded_data.qpoints as qpoint, qpoint_idx (qpoint_idx)}
            <option value={qpoint_idx}
              >{qpoint_idx + 1}: [{qpoint.q_position
                .map((coordinate) => format_num(coordinate, `.3~`))
                .join(`, `)}]</option
            >
          {/each}
        </select>
      </label>
      <label
        >Mode
        <select
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
      </label>
      <label
        >Amplitude (Å)<input
          type="number"
          min="0.001"
          step="0.05"
          bind:value={amplitude}
        /></label
      >
      <fieldset>
        <legend>Supercell</legend>
        {#each supercell as scale, axis (axis)}
          <input
            aria-label="Supercell axis {axis + 1}"
            type="number"
            min="1"
            step="1"
            value={scale}
            oninput={(event) => set_supercell_axis(axis, Number(event.currentTarget.value))}
          />
        {/each}
      </fieldset>
      <label class="checkbox"
        ><input type="checkbox" bind:checked={show_vectors} />Vectors</label
      >
    </div>
    {#if selected_mode && selection}
      <div class="mode-summary" data-testid="phonon-mode-summary">
        Mode {selection.mode_idx + 1} · {format_num(selected_mode.frequency, `.5~`)} THz · q = [{selected_qpoint?.q_position
          .map((coordinate) => format_num(coordinate, `.4~`))
          .join(`, `)}]
        {#if selected_mode.frequency < 0}<strong
            >unstable mode: periodic mode-shape preview</strong
          >{/if}
        {#if source_filename}<span>{source_filename}</span>{/if}
      </div>
    {/if}
    <div class="panes">
      <section class="plot-pane">
        {#if view === `bands` && band_result.value}
          <Bands
            band_structs={band_result.value}
            band_type="phonon"
            reference_frequency={selected_mode?.frequency ?? null}
            highlighted_qpoint_index={selection?.qpoint_idx ?? null}
            on_point_click={handle_band_click}
            show_controls={false}
          />
        {:else if (view === `ir` || view === `raman`) && spectrum}
          <IrRamanSpectrum
            {spectrum}
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
      <section class="trajectory-pane">
        {#if trajectory_result.value}
          <Trajectory
            trajectory={trajectory_result.value}
            bind:current_step_idx
            bind:fps
            {auto_play}
            allow_file_drop={false}
            display_mode="structure"
            show_controls={{
              mode: `always`,
              hidden: [
                `filename`,
                `info-pane`,
                `msd-pane`,
                `vacf-pane`,
                `structure-id-pane`,
                `data-inspector-pane`,
                `x-axis`,
                `view-mode`,
              ],
            }}
            structure_props={{
              scene_props: {
                vector_configs: {
                  [PHONON_VECTOR_KEY]: { visible: show_vectors, color: null, scale: null },
                },
              },
            }}
          />
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .phonon-mode-explorer {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    min-height: 520px;
    position: relative;
    box-sizing: border-box;
  }
  .phonon-mode-explorer.dragover {
    outline: 2px dashed var(--accent-color, #4c78a8);
    outline-offset: -3px;
  }
  .toolbar {
    display: flex;
    align-items: end;
    flex-wrap: wrap;
    gap: 0.5em 0.8em;
    padding: 0.45em;
    border: 1px solid var(--border-color, #ccc);
    border-radius: var(--border-radius, 4px);
  }
  .toolbar label {
    display: grid;
    gap: 0.2em;
    font-size: 0.8em;
  }
  .toolbar select {
    max-width: 18em;
  }
  .toolbar input,
  .toolbar select,
  .toolbar button {
    font: inherit;
  }
  .toolbar input[type='number'] {
    width: 5.5em;
  }
  .toolbar .checkbox {
    display: flex;
    align-items: center;
    gap: 0.3em;
    padding-bottom: 0.3em;
  }
  .tabs {
    display: flex;
    align-self: stretch;
  }
  .tabs button.active {
    color: var(--accent-color, #2678b2);
    font-weight: 600;
  }
  fieldset {
    display: flex;
    gap: 0.2em;
    margin: 0;
    padding: 0.15em 0.35em 0.35em;
  }
  fieldset input {
    width: 3.5em !important;
  }
  legend {
    font-size: 0.75em;
  }
  .mode-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35em 1em;
    padding-inline: 0.4em;
    font-size: 0.85em;
    color: var(--text-color-muted, #666);
  }
  .mode-summary strong {
    color: var(--warning-color, #b45309);
  }
  .panes {
    display: grid;
    grid-template-columns: minmax(280px, 1fr) minmax(320px, 1fr);
    flex: 1;
    min-height: 420px;
    gap: 0.5em;
  }
  .plot-pane,
  .trajectory-pane {
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--border-color, #ccc);
    border-radius: var(--border-radius, 4px);
    overflow: hidden;
  }
  .plot-pane > :global(*) {
    width: 100%;
    height: 100%;
  }
  .mode-list {
    display: grid;
    align-content: start;
    gap: 0.2em;
    overflow: auto;
    padding: 0.4em;
    box-sizing: border-box;
  }
  .mode-list button {
    display: flex;
    justify-content: space-between;
    padding: 0.45em 0.6em;
    border: 1px solid transparent;
    background: transparent;
  }
  .mode-list button.selected {
    border-color: var(--accent-color, #4c78a8);
    background: color-mix(in srgb, var(--accent-color, #4c78a8) 10%, transparent);
  }
  @media (max-width: 760px) {
    .panes {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(300px, 1fr) minmax(360px, 1fr);
    }
  }
</style>
