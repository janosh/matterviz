<script lang="ts">
  import { BrillouinZone, compute_brillouin_zone } from '#lib/brillouin/index.js'
  import ColorInput from 'svelte-widgets/ColorInput.svelte'
  import Icon from 'svelte-widgets/Icon.svelte'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import { css_color_to_hex } from '#lib/colors/index.js'
  import { Settings } from 'svelte-widgets/icons'
  import ToolbarMenu from '#lib/overlays/ToolbarMenu.svelte'
  import { format_num } from '#lib/labels.js'
  import { DEFAULTS } from '#lib/settings.js'
  import PaneDivider from 'svelte-widgets/SplitPane.svelte'
  import { in_range, reciprocal_lattice } from '#lib/math.js'
  import type { Vec2, Vec3 } from '#lib/math.js'
  import type { ScatterHandlerEvent } from '#lib/plot/core/types.js'
  import { parse_supercell_scaling } from '#lib/structure/index.js'
  import Trajectory from '#lib/trajectory/Trajectory.svelte'
  import { to_error } from 'svelte-widgets/utils'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { band_point_meta, create_band_path_link } from './band-path-link.svelte'
  import Bands from './Bands.svelte'
  import { frequency_unit_per_thz } from './frequency-units'
  import {
    are_qpoints_equivalent,
    frac_k_to_cartesian,
    pretty_sym_point,
    qpoint_x_position,
  } from './helpers'
  import IrRamanSpectrum from './IrRamanSpectrum.svelte'
  import { spectrum_kind_label } from './ir-raman'
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
  import { create_bands_dos_sync } from './synced-axes.svelte'
  import type {
    BaseBandStructure,
    PhononModeData,
    PhononModeDataset,
    PhononModeSelection,
    SpectrumKind,
  } from './types'

  const format_qpoint = (q_position: Vec3, fmt: string): string =>
    q_position.map((coordinate) => format_num(coordinate, fmt)).join(`, `)

  let {
    dataset,
    selection = $bindable(),
    spectrum_kind = $bindable(`ir`),
    amplitude = $bindable(DEFAULT_PHONON_AMPLITUDE),
    supercell = $bindable([...DEFAULT_PHONON_SUPERCELL] as Vec3),
    n_frames = $bindable(DEFAULT_PHONON_FRAMES),
    fps = $bindable(DEFAULT_PHONON_FPS),
    show_vectors = $bindable(DEFAULT_PHONON_SHOW_VECTORS),
    vector_thickness = $bindable(1),
    vector_color = $bindable<string | null>(null),
    auto_play = true,
    pane_ratio = $bindable(1.15 / 2.1),
    show_bz_inset = true,
    trajectory_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    dataset: PhononModeDataset
    selection?: PhononModeSelection
    // Activity the spectrum beside the dispersion shows; Raman needs polarizability data
    spectrum_kind?: SpectrumKind
    amplitude?: number
    supercell?: Vec3
    n_frames?: number
    fps?: number
    show_vectors?: boolean
    // Multiplier for arrow shaft and head radii; null color uses element colors.
    vector_thickness?: number
    vector_color?: string | null
    auto_play?: boolean
    pane_ratio?: number
    // Brillouin zone in a corner of the atomic-motion pane marking the selected and hovered
    // q-points on the path; needs a lattice and more than one q-point
    show_bz_inset?: boolean
    trajectory_props?: Pick<
      ComponentProps<typeof Trajectory>,
      | `class`
      | `style`
      | `fps_range`
      | `step_labels`
      | `fullscreen_toggle`
      | `on_play`
      | `on_pause`
      | `on_end`
      | `on_loop`
      | `on_controller`
    >
  } = $props()

  let error_msg = $state<string>()
  let current_step_idx = $state(0)
  let mode_data = $derived(dataset.modes)
  let active_spectrum = $derived(dataset.spectrum)

  const report_error = (error: unknown): void => {
    error_msg = to_error(error).message
  }
  const no_result = { value: null, error: null }
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
      : no_result,
  )
  let band_structure = $derived(band_result.value)
  let band_structs = $derived<Record<string, BaseBandStructure>>(
    band_structure ? { '': band_structure } : {},
  )
  let shown_kind = $derived<SpectrumKind>(active_spectrum?.has_raman ? spectrum_kind : `ir`)
  let has_plot = $derived(Boolean(band_structure || active_spectrum))
  let modes_open = $derived(!has_plot)
  // Three stages so each control redoes only its own work: the supercell (tiling + bonding)
  // survives mode and amplitude changes and keys the camera framing, the displacement pattern
  // survives amplitude changes, and frames are synthesised on read
  // Snapshot only the unit cell: the whole dataset's eigenvectors take seconds to snapshot
  let supercell_result = $derived.by(() => {
    const { n_atoms, atoms, lattice } = mode_data
    return try_generate(() =>
      phonon_supercell($state.snapshot({ n_atoms, atoms, lattice }), supercell),
    )
  })
  let pattern_result = $derived.by(() => {
    const [cell, selected] = [supercell_result.value, selection]
    if (!cell || !selected) return no_result
    return try_generate(() => phonon_mode_pattern(cell, mode_data, selected))
  })
  let trajectory_result = $derived.by(() => {
    const pattern = pattern_result.value
    if (!pattern) return no_result
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
  // === Brillouin zone inset ===
  let bz_inset = $derived.by(() => {
    const { lattice, qpoints } = mode_data
    if (!show_bz_inset || !lattice || qpoints.length < 2) return no_result
    return try_generate(() => {
      const k_lattice = reciprocal_lattice(lattice, { two_pi: true })
      return { k_lattice, bz_data: compute_brillouin_zone(k_lattice) }
    })
  })
  // the q-point hovered on the dispersion, marked on the inset's k-path
  const path_link = create_band_path_link({
    band_struct: () => band_structure,
    k_lattice: () => bz_inset.value?.k_lattice,
  })
  // === Dispersion and spectrum side by side ===
  let plot_width = $state(800)
  let both_plots = $derived(Boolean(band_structure && active_spectrum))
  // Below 480px a spectrum column would squeeze the bands, so the spectrum turns vertical and
  // stacks underneath, as in BandsAndDos
  let side_by_side = $derived(both_plots && plot_width >= 480)
  // One frequency axis for both panels: a rotated spectrum shares the bands' y range, zoom and
  // vertical padding; stacked underneath, it plots the same range along x
  const plot_sync = create_bands_dos_sync({
    band_structs: () => band_structs,
    units: () => `THz`,
    side_by_side: () => side_by_side,
    base_padding: { t: 20, b: 50 },
  })
  // Every visit of the spectrum's q-point (Γ) on the path, where bands and peaks are the same modes
  let spectrum_qpoint_indices = $derived.by(() => {
    const q_position = active_spectrum?.q_position
    if (!q_position) return []
    return mode_data.qpoints.flatMap((qpoint, qpoint_idx) =>
      are_qpoints_equivalent(qpoint.q_position, q_position) ? [qpoint_idx] : [],
    )
  })
  // under each panel's own pointer, so the two directions cannot feed back
  let bands_hovered_band_idx = $state<number | null>(null)
  let spectrum_hovered_modes = $state<number[]>([])
  let band_x_positions = $state<Record<string, Vec2>>()
  // a band hovered at Γ lights up its stick in the spectrum
  let band_hovered_spectrum_modes = $derived(
    bands_hovered_band_idx !== null &&
      spectrum_qpoint_indices.includes(path_link.active_qpoint ?? -1)
      ? [bands_hovered_band_idx]
      : [],
  )
  // the modes behind the hovered peak, ringed on the dispersion at every visit of Γ
  let peak_band_points = $derived.by(() => {
    if (!band_structure || !band_x_positions) return []
    const x_positions = band_x_positions
    return spectrum_qpoint_indices.flatMap((qpoint_idx) => {
      const x_pos = qpoint_x_position(band_structure, qpoint_idx, x_positions)
      if (x_pos === null) return []
      return spectrum_hovered_modes.flatMap((mode_idx) => {
        const frequency = mode_data.qpoints[qpoint_idx]?.modes[mode_idx]?.frequency
        return frequency === undefined ? [] : [{ qpoint_idx, mode_idx, x_pos, frequency }]
      })
    })
  })
  // the k-path's own point (folded with its branch, so on the drawn path), else from the mode
  // data: q-point-only files (no band path) still mark it
  let selected_k_points = $derived.by(() => {
    const k_lattice = bz_inset.value?.k_lattice
    const qpoint_idx = selection?.qpoint_idx ?? -1
    const on_path = path_link.k_path?.points[qpoint_idx]
    if (on_path) return [on_path]
    const qpoint = mode_data.qpoints[qpoint_idx]
    return k_lattice && qpoint ? [frac_k_to_cartesian(qpoint.q_position, k_lattice)] : []
  })

  const wavenumber = (thz: number): string =>
    format_num(thz * frequency_unit_per_thz(`cm^-1`), `.1f`)

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
    // stay at the selected q-point if it is a visit of the spectrum's, else jump to the first
    const selected_qpoint_idx = selection?.qpoint_idx ?? -1
    const qpoint_idx = spectrum_qpoint_indices.includes(selected_qpoint_idx)
      ? selected_qpoint_idx
      : (spectrum_qpoint_indices[0] ?? -1)
    if (qpoint_idx === -1) {
      report_error(
        `Spectrum q-point [${active_spectrum.q_position.join(`, `)}] is absent from mode data`,
      )
      return
    }
    set_selection({ qpoint_idx, mode_idx })
  }
</script>

<!-- rendered inside the structure viewer, so both overlays follow it into fullscreen and stay
under its open panes -->
{#snippet structure_overlays()}
  {#if bz_inset.value}
    <BrillouinZone
      class="bz-inset"
      aria-label="Selected q-point in the Brillouin zone"
      bz_data={bz_inset.value.bz_data}
      k_path={path_link.k_path}
      highlighted_k_points={selected_k_points}
      hovered_k_point={path_link.hovered_k_point}
      hovered_qpoint_index={path_link.active_qpoint}
      show_vectors={false}
      show_controls={false}
      fullscreen_toggle={false}
      allow_file_drop={false}
    />
  {/if}
  <div class="mode-picker">
    <ToolbarMenu
      bind:open={modes_open}
      label="Modes"
      button_class="phonon-modes-toggle"
      menu_class="phonon-modes-pane"
    >
      {#snippet button()}Modes{/snippet}
      {#if active_spectrum?.has_raman}
        <div class="tabs" role="group" aria-label="Spectrum type">
          {#each [`ir`, `raman`] as const as kind (kind)}
            <button
              aria-pressed={shown_kind === kind}
              class:active={shown_kind === kind}
              onclick={() => (spectrum_kind = kind)}>{spectrum_kind_label(kind)}</button
            >
          {/each}
        </div>
      {/if}
      <div class="mode-list">
        {#each selected_qpoint?.modes ?? [] as mode, mode_idx (mode_idx)}
          <button
            class:selected={selection?.mode_idx === mode_idx}
            disabled={!mode.eigenvector}
            onclick={() => selection && set_selection({ ...selection, mode_idx })}
          >
            <span>Mode {mode_idx + 1}</span><span>{format_num(mode.frequency, `.5~`)} THz</span
            >
          </button>
        {/each}
      </div>
    </ToolbarMenu>
  </div>
{/snippet}

{#snippet phonon_settings()}
  <ToolbarMenu label="Phonon settings">
    {#snippet button()}<Icon icon={Settings} />{/snippet}
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
      {#if show_vectors}
        <label class="vector-thickness-control">
          Thickness
          <input
            type="range"
            aria-label="Eigenvector thickness"
            min="0.25"
            max="4"
            step="0.05"
            bind:value={vector_thickness}
          />
          <output>{format_num(vector_thickness, `.3~`)}×</output>
        </label>
        <div class="vector-color-control">
          <ColorInput
            label="Color"
            value={css_color_to_hex(
              vector_color ?? undefined,
              DEFAULTS.structure.vector_color,
            )}
            labels={{ picker: `Eigenvector color`, hex: `Eigenvector color hex` }}
            on_commit={(color) => (vector_color = color)}
          />
          <button
            type="button"
            title="Use element colors for eigenvectors"
            disabled={vector_color === null}
            onclick={() => (vector_color = null)}>By element</button
          >
        </div>
      {/if}
    </div>
  </ToolbarMenu>
{/snippet}

<div {...rest} class={[`phonon-mode-explorer`, rest.class]}>
  {#if error_msg}<StatusMessage bind:message={error_msg} type="error" dismissible />{/if}
  {#if band_result.error}<StatusMessage message={band_result.error} type="error" />{/if}
  {#if generation_error}<StatusMessage message={generation_error} type="error" />{/if}
  {#if bz_inset.error}<StatusMessage message={bz_inset.error} type="error" />{/if}
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
        <span
          >{format_num(selected_mode.frequency, `.5~`)} THz
          <small>{wavenumber(selected_mode.frequency)} cm<sup>−1</sup></small></span
        >
        {#if qpoint_labels[selection.qpoint_idx]}
          <span class="qpoint-label"
            >{pretty_sym_point(qpoint_labels[selection.qpoint_idx])}</span
          >
        {/if}
        <span>q = [{format_qpoint(selected_qpoint.q_position, `.4~`)}]</span>
        {#if character}
          <span
            class="character"
            title="Share of the mass-weighted mode each element carries · participation ratio {format_num(
              character.participation_ratio,
              `.2f`,
            )} (1 = all atoms move equally)"
            >{character.element_weights
              .map(([symbol, weight]) => `${symbol} = ${format_num(weight * 100, `.0f`)}%`)
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
        {#if dataset.filename}<span>{dataset.filename}</span>{/if}
      </div>
    {/if}
  </div>
  <div class="panes" class:structure_only={!has_plot}>
    <section class="trajectory-pane" aria-label="Atomic motion">
      {#if trajectory_result.value}
        <Trajectory
          {...trajectory_props}
          trajectory={trajectory_result.value}
          allow_file_drop={false}
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
          extra_controls={phonon_settings}
          structure_series_key={supercell_result.value?.structure}
          structure_props={{
            children: structure_overlays,
            analyze_symmetry: false,
            apply_supercell_scaling: false,
            show_image_atoms: false,
            scene_props: {
              bonding_strategy: `explicit_only`,
              show_polyhedra: `never`,
              vector_shaft_radius: DEFAULTS.structure.vector_shaft_radius * vector_thickness,
              vector_arrow_head_radius:
                DEFAULTS.structure.vector_arrow_head_radius * vector_thickness,
              vector_configs: {
                [PHONON_VECTOR_KEY]: {
                  visible: show_vectors,
                  color: vector_color,
                  scale: null,
                },
              },
            },
          }}
        />
      {/if}
    </section>
    {#if has_plot}
      <PaneDivider
        orientation="horizontal"
        bind:ratio={pane_ratio}
        aria-label="Resize atomic motion and phonon plot panes"
      />
      <section
        class="plot-pane"
        class:side_by_side
        class:spectrum_stacked={both_plots && !side_by_side}
        aria-label="Phonon mode plot"
        bind:clientWidth={plot_width}
      >
        {#if band_structure}
          <Bands
            {band_structs}
            y_axis={plot_sync.y_axes[0]}
            bind:view={plot_sync.views[0]}
            bind:resolved_padding={() => undefined, plot_sync.raise_padding}
            padding={side_by_side ? { r: 10, ...plot_sync.shared_padding } : undefined}
            bind:x_positions={band_x_positions}
            bind:hovered_frequency={plot_sync.hovered.bands}
            reference_frequency={plot_sync.hovered.dos ?? selected_mode?.frequency ?? null}
            highlighted_qpoint_index={selection?.qpoint_idx ?? null}
            highlighted_band_index={selection?.mode_idx ?? null}
            on_point_click={handle_band_click}
            on_plot_click={handle_band_click}
            on_point_hover={(event) => {
              path_link.hover_band(event)
              bands_hovered_band_idx = band_point_meta(event?.metadata)?.band_idx ?? null
            }}
            show_controls={false}
          >
            {#snippet children({ width, height, x_scale_fn, y_scale_fn, x_range, y_range })}
              <svg class="peak-band-markers" {width} {height} aria-hidden="true">
                {#each peak_band_points as { qpoint_idx, mode_idx, x_pos, frequency } (`${qpoint_idx}:${mode_idx}`)}
                  {#if in_range(x_pos, x_range) && in_range(frequency, y_range)}
                    <circle
                      class="peak-band-marker"
                      cx={x_scale_fn(x_pos)}
                      cy={y_scale_fn(frequency)}
                      r="7"
                      fill="none"
                      stroke="var(--phonon-peak-marker-color, light-dark(#c44e52, #e07b7e))"
                      stroke-width="2"
                    />
                  {/if}
                {/each}
              </svg>
            {/snippet}
          </Bands>
        {/if}
        {#if active_spectrum}
          <!-- hover tracks the frequency axis alone, so a stick tip far from its broadened peak
          still links to the bands -->
          <IrRamanSpectrum
            spectrum={active_spectrum}
            kind={shown_kind}
            units="THz"
            orientation={side_by_side ? `horizontal` : `vertical`}
            x_axis={{ ...(side_by_side && { ticks: 3 }), ...plot_sync.dos_x_axis }}
            y_axis={plot_sync.y_axes[1]}
            bind:view={plot_sync.views[1]}
            bind:resolved_padding={() => undefined, plot_sync.raise_padding}
            padding={side_by_side ? { l: 15, ...plot_sync.shared_padding } : undefined}
            bind:hovered_frequency={plot_sync.hovered.dos}
            bind:hovered_mode_indices={spectrum_hovered_modes}
            reference_frequency={plot_sync.hovered.bands}
            highlighted_mode_indices={band_hovered_spectrum_modes}
            selected_mode_idx={selection &&
            spectrum_qpoint_indices.includes(selection.qpoint_idx)
              ? selection.mode_idx
              : null}
            on_mode_select={select_spectrum_mode}
            hover_config={{ threshold_px: 30, mode: side_by_side ? `y` : `x` }}
            show_controls={false}
          />
        {/if}
      </section>
    {/if}
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
    flex-wrap: wrap;
    gap: 0.35em 1em;
  }
  .mode-summary {
    display: flex;
    padding-left: 0.4em;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.6em;
    min-width: 0;
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
  }
  .plot-pane {
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    position: relative;
    overflow: hidden;
    /* Bands and IrRamanSpectrum both use ScatterPlot's public sizing contract. */
    --scatter-height: 100%;
    --scatter-min-height: 0;
    &.side_by_side {
      grid-template-columns: minmax(0, 1fr) var(
          --phonon-spectrum-width,
          clamp(120px, 28%, 220px)
        );
    }
    &.spectrum_stacked {
      grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
    }
  }
  .peak-band-markers {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }
  .trajectory-pane {
    position: relative;
    z-index: 1;
    container-type: inline-size;
    --traj-border-radius: 0;
    --struct-border-radius: 0;
    /* bottom-left is the one corner the structure viewer keeps free of controls */
    :global(.structure .bz-inset) {
      position: absolute;
      left: 0.5em;
      bottom: 0.5em;
      z-index: 1;
      --bz-width: var(--phonon-bz-inset-size, clamp(100px, 22cqi, 160px));
      --bz-height: var(--phonon-bz-inset-size, clamp(100px, 22cqi, 160px));
      --bz-min-width: 0;
      --bz-bg: color-mix(in srgb, var(--surface-bg, #fff) 70%, transparent);
      --bz-border-radius: var(--border-radius, 3pt);
    }
  }
  /* the bar stays open while its step input has focus; hovering the plot pane hides it anyway
     so the spectra are never covered */
  .panes:has(.plot-pane:hover) :global(.trajectory-controls.hover-visible) {
    opacity: 0;
    pointer-events: none;
  }
  .plot-pane > :global(*),
  .trajectory-pane > :global(.trajectory) {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .mode-picker {
    position: absolute;
    top: var(--viewer-buttons-top, 0.5em);
    left: 0.5em;
    z-index: 2;
    :global(.phonon-modes-toggle) {
      opacity: 0;
      pointer-events: none;
    }
    :global(.structure:is(:hover, :focus-within)) & :global(.phonon-modes-toggle) {
      opacity: 1;
      pointer-events: auto;
    }
    @media (hover: none) {
      :global(.phonon-modes-toggle) {
        opacity: 1;
        pointer-events: auto;
      }
    }
  }
  .panes.structure_only {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }
  .toolbar {
    display: grid;
    gap: 0.5em;
    padding: 0.6em;
    max-width: calc(100vw - 2em);
    label,
    .mode-control {
      display: flex;
      align-items: center;
      gap: 0.4em;
      white-space: nowrap;
    }
    select {
      min-width: 0;
      flex: 1;
    }
    .step-mode {
      padding: 0 0.45em;
      line-height: 1.4;
      font-size: 1.1em;
    }
  }
  .amplitude-control,
  .vector-thickness-control {
    input {
      width: 9em;
      min-width: 0;
      flex: 1;
    }
    output {
      min-width: 4.5em;
    }
  }
  .vector-color-control {
    display: flex;
    align-items: end;
    gap: 0.5em;
  }
  :global(.phonon-modes-pane) {
    width: 220px;
    min-width: 0;
    left: 0;
    right: auto;
    padding: 4px;
    box-sizing: border-box;
    max-height: min(60vh, 400px);
    overflow: auto;
  }
  .mode-list {
    display: grid;
    align-content: start;
    gap: 0;
    overflow: auto;
    box-sizing: border-box;
    button {
      display: flex;
      justify-content: space-between;
      padding: 0.15em 0.35em;
      border: 0;
      background: transparent;
      &.selected {
        font-weight: 600;
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
      /* bands and spectrum stacked inside the plot pane need room for both */
      &:has(.spectrum_stacked) {
        grid-template-rows: minmax(340px, 1fr) minmax(520px, 1fr);
      }
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
    .tabs {
      width: 100%;
      button {
        flex: 1;
      }
    }
  }
</style>
