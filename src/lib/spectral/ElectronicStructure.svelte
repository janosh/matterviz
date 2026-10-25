<script lang="ts">
  // One viewer fusing a material's crystal structure, Fermi surface, band structure and DOS (plus
  // phonon spectra and sweep trends), as Trajectory fuses a structure and its plots: one frame,
  // control row, fullscreen and file drop. 3D scenes on top, spectra below, every split at a
  // draggable divider; the pane menu shows any subset (default: the panes with data). Links:
  // - Real and reciprocal lattice share one Cartesian frame (b_i · a_j = 2π δ_ij), so orbiting
  //   either scene turns the other alike (sync_rotation). Data in different frames is reported
  //   and keeps the rotations apart.
  // - Bands ↔ Fermi surface: hover previews, click pins and isolates a sheet, band lines take
  //   their sheet's colour and E_F crossings are dotted on bands and k-path (FermiBandsLink).
  // - Bands ↔ DOS share zoom and hover lines on the energy axis; hovering the DOS previews the
  //   Fermi surface at that energy too.
  // A `sweep` runs the viewer along one axis, e.g. pressure: a control bar steps through a
  // series' frames, `load_frame` fetches frames on demand (neighbours prefetched), the spectra
  // span every loaded frame so their axes hold still, and the trends pane plots descriptors
  // against the axis (see sweep.ts), loading the frames still lacking its values in the
  // background. `compare_series` shows a second series beside the first:
  // every frame pane splits into two sides, the compared series' frame nearest the shown value
  // on the right, sharing spectra axes, one rotation link and the frame cache. A dropped file
  // replaces the data of the panes it fills (see `fill`); while a sweep is shown only sweep JSONs
  // are taken.
  import { normalize_show_controls, shows_fullscreen_toggle } from '#lib/controls.js'
  import type { ShowControlsProp } from '#lib/controls.js'
  import { open_material, type OpenedMaterial } from '#lib/file-viewer/open.js'
  import { FermiBandsLink } from '#lib/fermi-surface/fermi-bands-link.svelte.js'
  import FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
  import { normalize_band_grid, normalize_fermi_surface } from '#lib/fermi-surface/parse.js'
  import type { BandGridJson, FermiSurfaceJson } from '#lib/fermi-surface/parse.js'
  import type { BandGridData, FermiSurfaceData } from '#lib/fermi-surface/types.js'
  import { is_fermi_surface_data } from '#lib/fermi-surface/types.js'
  import { chain_callbacks } from '#lib/plot/core/interactions.js'
  import { union_ranges } from '#lib/plot/core/shared-axes.js'
  import { observe_size } from '#lib/plot/core/utils.js'
  import { pick_pane_orientation } from '#lib/layout/pane-orientation.js'
  import {
    create_sequence_player,
    is_sequence_key_target,
  } from '#lib/layout/sequence-player.svelte.js'
  import SequenceControlBar from '#lib/layout/SequenceControlBar.svelte'
  import SequenceControls from '#lib/layout/SequenceControls.svelte'
  import ViewerChrome from '#lib/layout/ViewerChrome.svelte'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import { raw_file_drop_zone } from '#lib/io/file-drop.js'
  import {
    clamp,
    dot,
    in_range,
    matrix_inverse_3x3,
    type Matrix3x3,
    type Vec2,
  } from '#lib/math.js'
  import { SHORTCUTS, viewer_keydown } from '#lib/shortcuts.js'
  import { ToolbarMenu } from '#lib/overlays/index.js'
  import { link_orbits } from '#lib/scene/orbit-link.svelte.js'
  import type { Crystal } from '#lib/structure/index.js'
  import Structure from '#lib/structure/Structure.svelte'
  import { is_crystal } from '#lib/structure/validation.js'
  import { materialize_frame_result } from '#lib/trajectory/frame.js'
  import { format_num } from '#lib/labels.js'
  import { html_to_text, is_plain_object } from '#lib/utils.js'
  import { type ComponentProps, type Snippet, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Icon from 'svelte-widgets/Icon.svelte'
  import {
    Atom,
    BandStructure,
    DensityOfStates,
    FermiSurface as FermiSurfaceIcon,
    Grid2x2,
    LinePlot,
    LinkOff,
    LinkVariant,
    Phonons,
  } from 'svelte-widgets/icons'
  import SplitPane from 'svelte-widgets/SplitPane.svelte'
  import TaskStatus from 'svelte-widgets/TaskStatus.svelte'
  import Bands from './Bands.svelte'
  import BandsAndDos from './BandsAndDos.svelte'
  import Dos from './Dos.svelte'
  import {
    BANDS_CSS_COLORS,
    compute_frequency_range,
    normalize_band_structure,
    normalize_dos,
  } from './helpers'
  import { create_bands_dos_sync, MIN_SIDE_BY_SIDE_WIDTH } from './synced-axes.svelte'
  import {
    descriptor_lines,
    descriptor_value,
    format_axis_value,
    is_sweep_like,
    nearest_frame,
    normalize_sweep,
    series_spacing,
    validate_sweep,
  } from './sweep'
  import type { Sweep, SweepFrame, SweepSeries } from './sweep'
  import { create_sweep_frames, type FrameRef, type FrameWindow } from './sweep-frames.svelte'
  import SweepTrends from './SweepTrends.svelte'
  import { DEFAULT_PLOT_PADDING, type Sides } from '#lib/plot/core/layout.js'
  import type {
    BaseBandStructure,
    DosData,
    ElectronicPane,
    FrequencyUnit,
    PhononSpectra,
    SpectraRecords,
  } from './types'

  const PANES = [
    { pane: `structure`, icon: Atom, label: `Structure` },
    { pane: `fermi`, icon: FermiSurfaceIcon, label: `Fermi surface` },
    { pane: `bands`, icon: BandStructure, label: `Band structure` },
    { pane: `dos`, icon: DensityOfStates, label: `Density of states` },
    { pane: `phonon`, icon: Phonons, label: `Phonon spectra` },
    { pane: `trends`, icon: LinePlot, label: `Sweep descriptors` },
  ] as const
  const PANE_IDS = PANES.map(({ pane }) => pane)
  // Beside each other, the divider keeps bands and DOS this wide (px), room for their axes
  const [MIN_BANDS_WIDTH, MIN_DOS_WIDTH] = [300, 120]
  const SWEEP_FPS_RANGE = [0.25, 5] as const // frames per second while playing a sweep
  // The structure is in the Fermi data's frame when a_i · b_j / 2π is an integer matrix (its
  // cell a supercell of the zone's) or the inverse of one (the zone's cell a supercell of its).
  // Simulation outputs print ~6 significant digits, putting entries within ~1e-5 of integers,
  // while a 0.1° rotation already moves them by ~2e-3.
  const FRAME_TOL = 1e-3

  let {
    structure = $bindable(),
    fermi_data = $bindable(),
    band_data = $bindable(),
    band_structs = $bindable({}),
    doses = $bindable({}),
    phonon = $bindable(),
    sweep = $bindable(),
    series_id = $bindable(),
    frame_idx = $bindable(0),
    compare_series = $bindable(),
    descriptor = $bindable(),
    fps = $bindable(1),
    panes = $bindable(),
    units = $bindable(`THz`),
    mu = $bindable(0),
    selected_bands = $bindable(),
    layout = `auto`,
    pane_ratio = $bindable(0.5),
    row_ratio = $bindable(0.5),
    spectra_ratio = $bindable(0.78),
    trends_ratio = $bindable(0.4),
    phonon_ratio = $bindable(0.5),
    sync_rotation = $bindable(true),
    show_controls,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    allow_file_drop = true,
    loading = $bindable(false),
    error_msg = $bindable(),
    on_file_load,
    on_error,
    structure_props = {},
    fermi_props = {},
    bands_props = {},
    dos_props = {},
    phonon_props = {},
    trends_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    structure?: Crystal // must share the Fermi data's Cartesian frame (same calculation)
    fermi_data?: FermiSurfaceData | FermiSurfaceJson
    band_data?: BandGridData | BandGridJson // band grid: energy previews and band colours
    // the first band structure's k-path is drawn through the Fermi surface's zone
    band_structs?: Record<string, BaseBandStructure>
    doses?: Record<string, DosData>
    phonon?: PhononSpectra // phonon bands and DOS, on their own frequency axis
    // a sweep along one axis: while set, the panes show its selected frame, not the props above
    sweep?: Sweep
    series_id?: string // the shown series (default: the first)
    frame_idx?: number // the shown frame of that series
    // a series shown beside it, at its frame nearest the shown frame's axis value (none: unset)
    compare_series?: string
    // the descriptor key the trends pane plots (default: the first), reset when a new sweep
    // has none of that key
    descriptor?: string
    fps?: number // frames per second when playing the sweep
    panes?: ElectronicPane[] // shown panes, default: those with data
    units?: FrequencyUnit // phonon frequency unit of the spectra
    mu?: number // Fermi surface energy relative to E_F
    selected_bands?: number[] // bands whose Fermi sheets are shown (all when unset)
    layout?: `auto` | `horizontal` | `vertical` // the 3D scenes' split, auto by their row's shape
    pane_ratio?: number // the structure's share of the scenes' row
    row_ratio?: number // the scenes' share of the viewer height above the spectra
    spectra_ratio?: number // the bands' share of the spectra's row beside the DOS
    trends_ratio?: number // the trends pane's share of the lower row beside the spectra
    phonon_ratio?: number // the electronic spectra's share of their column above the phonons
    sync_rotation?: boolean // orbiting one scene turns the other alike
    // the viewer's row; `never` also hides the panes' own controls
    show_controls?: ShowControlsProp<
      `panes` | `sync-rotation` | `fullscreen` | `series` | `compare` | `nav` | `step` | `fps`
    >
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    allow_file_drop?: boolean // one drop zone for all panes: theirs are off
    loading?: boolean
    error_msg?: string
    on_file_load?: (data: { filename: string; panes: ElectronicPane[] }) => void // panes filled
    on_error?: (data: { error_msg: string; filename?: string }) => void
    // per-pane extras; the fused props (data, links, drop, fullscreen) override them
    structure_props?: Partial<ComponentProps<typeof Structure>>
    fermi_props?: Partial<ComponentProps<typeof FermiSurface>>
    bands_props?: Partial<ComponentProps<typeof Bands>>
    dos_props?: Partial<ComponentProps<typeof Dos>>
    phonon_props?: Partial<ComponentProps<typeof BandsAndDos>>
    trends_props?: Partial<ComponentProps<typeof SweepTrends>>
  } = $props()

  link_orbits(() => sync_rotation && !frames_differ)

  let wrapper = $state<HTMLDivElement>()
  let dragover = $state(false)
  let chrome_width = $state(0)

  const controls_config = $derived(normalize_show_controls(show_controls))
  const pane_controls = <Prop>(prop: Prop): Prop | false =>
    controls_config.mode === `never` ? false : prop

  // === sweep ===
  // The shown series and frame. While a sweep is set its frame's data feeds every pane.
  // `picked` is the series the viewer itself selected (series menu, trends click): a new sweep
  // without it opens at its first series, while a caller's series_id must name one.
  let picked: { sweep: Sweep; id: string } | undefined
  // the sweep's series of a prop's id, else throws naming the prop
  const series_of = (active: Sweep, prop: string, id: string): SweepSeries => {
    const match = active.series.find((entry) => entry.id === id)
    if (match) return match
    const ids = active.series.map((entry) => entry.id).join(`, `)
    throw new Error(`${prop} "${id}" is not a series of the sweep (${ids})`)
  }
  const series = $derived.by(() => {
    if (!sweep) return undefined
    validate_sweep(sweep)
    if (series_id === undefined) return sweep.series[0]
    const stale_pick = picked && picked.sweep !== sweep && picked.id === series_id
    if (stale_pick && !sweep.series.some(({ id }) => id === series_id)) return sweep.series[0]
    return series_of(sweep, `series_id`, series_id)
  })
  const frame_index = $derived.by(() => {
    if (!series) return 0
    if (!Number.isFinite(frame_idx))
      throw new RangeError(`frame_idx must be finite, got ${frame_idx}`)
    return clamp(Math.round(frame_idx), 0, series.frames.length - 1)
  })
  // the bound series and index follow those shown (a shorter series clamps the index), and a
  // series is not compared with itself
  $effect(() => {
    if (series && series_id !== undefined && series_id !== series.id) series_id = series.id
    if (series && frame_idx !== frame_index) frame_idx = frame_index
    if (series && compare_series === series.id) compare_series = undefined
  })
  // a replaced sweep (also a dropped one), or one whose series or descriptors change in place,
  // keeps the plotted descriptor and the compared series only if it has them
  const sweep_keys = (active?: Sweep): string =>
    [...(active?.series ?? []), ...(active?.descriptors ?? [])]
      .map((entry) => (`id` in entry ? entry.id : entry.key))
      .join(`\n`)
  let kept = untrack(() => ({ sweep, keys: sweep_keys(sweep) }))
  $effect.pre(() => {
    const keys = sweep_keys(sweep)
    if (sweep === kept.sweep && keys === kept.keys) return
    kept = { sweep, keys }
    const [key, compare_id] = untrack(() => [descriptor, compare_series])
    if (!sweep?.descriptors?.some((spec) => spec.key === key)) descriptor = undefined
    if (!sweep?.series.some(({ id }) => id === compare_id)) compare_series = undefined
  })
  const frames = create_sweep_frames({
    sweep: () => sweep,
    on_error: (message) => report_error(message),
  })
  const frame = $derived(series && frames.frame(series, frame_index))
  const frame_label = $derived(sweep && frame ? format_axis_value(sweep.axis, frame) : ``)
  // the frame after the shown one, wrapping as playback does
  const next_index = $derived(series ? (frame_index + 1) % series.frames.length : 0)
  // the compared series, at its frames nearest the shown frame's and the next one's values
  const compare_target = $derived(
    sweep && series && compare_series !== undefined && compare_series !== series.id
      ? series_of(sweep, `compare_series`, compare_series)
      : undefined,
  )
  const compared = $derived.by(() => {
    if (!compare_target || !series) return undefined
    const at = (idx: number) => nearest_frame(compare_target, series.frames[idx].value)
    return { series: compare_target, shown: at(frame_index), next: at(next_index).idx }
  })
  const compare_frame = $derived(compared && frames.frame(compared.series, compared.shown.idx))
  // the compared frame lies off the shown value by more than its series' typical step (the
  // shown series' for a one-frame compared series; none when neither has a step)
  const spacing = $derived(
    compared && series ? series_spacing(compared.series) || series_spacing(series) : 0,
  )
  const compare_far = $derived(
    compared !== undefined && spacing > 0 && compared.shown.distance > spacing,
  )
  const with_unit = (value: number): string =>
    `${format_num(value)}${sweep?.axis.unit ? ` ${sweep.axis.unit}` : ``}`
  // the shown frames first, then their neighbours, so a step lands on loaded data
  $effect(() => {
    if (!series) return
    const own: FrameWindow = [series, [frame_index, next_index, frame_index - 1]]
    if (compared) frames.request(own, [compared.series, [compared.shown.idx, compared.next]])
    else frames.request(own)
  })
  // the panes' data: the shown frame's in a sweep, else the props' (JSON grids parsed, as
  // sweeps parse theirs)
  const pane_data = $derived<Partial<SweepFrame>>(
    sweep
      ? (frame ?? {})
      : {
          structure,
          fermi_data: fermi_data && normalize_fermi_surface(fermi_data),
          band_data: band_data && normalize_band_grid(band_data),
          band_structs,
          doses,
          phonon,
        },
  )
  const playback = create_sequence_player({
    count: () => series?.frames.length ?? 0,
    index: () => frame_index,
    set_index: (idx) => (frame_idx = idx),
    fps: () => fps,
    set_fps: (value) => (fps = value),
    fps_range: () => SWEEP_FPS_RANGE,
    should_auto_play: () => false,
    // playback waits for the next frames' data
    can_advance: () =>
      !series ||
      (frames.is_ready(series, next_index) &&
        (!compared || frames.is_ready(compared.series, compared.next))),
  })
  // Playback keys work while the viewer is focused or hovered, as in Trajectory
  const keys = viewer_keydown(
    (event) =>
      Boolean(series) && is_sequence_key_target(event) && playback.handle_keydown(event),
  )
  let bar_height = $state(0)
  // the hover-revealed control bar overlays the top row, whose controls sit below it
  const bar_offset = $derived(series && controls_config.mode === `hover` ? bar_height : 0)
  // a frame of another series (series menu, trends click) trades places with the compared
  // series when it is that one
  const select_frame = (id: string, idx: number): void => {
    if (series && id === compare_series) compare_series = series.id
    picked = sweep && { sweep, id }
    series_id = id
    frame_idx = idx
  }
  // another series opens at its frame nearest the shown frame's axis value
  const select_series = (id: string): void => {
    const target = sweep?.series.find((entry) => entry.id === id)
    select_frame(id, target && frame ? nearest_frame(target, frame.value).idx : 0)
  }

  // === panes and layout ===
  // the panes any of the entries (frames, or the props) has data for
  const panes_with_data = (
    entries: Partial<SweepFrame>[],
    with_trends: boolean,
  ): ElectronicPane[] => {
    const some = (has: (entry: Partial<SweepFrame>) => unknown) => entries.some(has)
    const count = (record?: object) => Object.keys(record ?? {}).length
    const filled: Record<ElectronicPane, boolean> = {
      structure: some((entry) => entry.structure),
      fermi: some((entry) => entry.fermi_data || entry.band_data),
      bands: some((entry) => count(entry.band_structs) > 0),
      dos: some((entry) => count(entry.doses) > 0),
      phonon: some(
        ({ phonon: spectra }) =>
          count(spectra?.band_structs) + count(spectra?.doses) + count(spectra?.a2f),
      ),
      trends: with_trends,
    }
    return PANE_IDS.filter((pane) => filled[pane])
  }
  // In a sweep, what each shown series' frames loaded so far add up to: a running value per
  // series that grows as its frames load and never shrinks when they are evicted, so panes stay
  // and axes hold still (also across a swap or a series compared again), reset by a new sweep or
  // loader. A pane has data when any frame has (loaded) it, so the default layout neither waits
  // on the shown frame's load nor collapses on a frame without it.
  const shown_series = $derived(series ? [series, ...(compared ? [compared.series] : [])] : [])
  function running<T>(next: (loaded: SweepFrame[], prev?: T) => T): () => T[] {
    let seen = { key: [] as unknown[], values: new WeakMap<SweepSeries, T>() }
    return () => {
      const key = [sweep, sweep?.load_frame]
      if (key.some((part, idx) => part !== seen.key[idx]))
        seen = { key, values: new WeakMap() }
      return shown_series.map((entry) => {
        const loaded = entry.frames.map((_frame, idx) => frames.frame(entry, idx))
        const value = next(loaded, seen.values.get(entry))
        seen.values.set(entry, value)
        return value
      })
    }
  }
  const sweep_panes = $derived.by(
    running<ElectronicPane[]>((loaded, prev = []) => {
      const now = panes_with_data(loaded, Boolean(sweep?.descriptors?.length))
      return PANE_IDS.filter((pane) => prev.includes(pane) || now.includes(pane))
    }),
  )
  const with_data = $derived(
    sweep
      ? PANE_IDS.filter((pane) => sweep_panes.some((filled) => filled.includes(pane)))
      : panes_with_data([pane_data], false),
  )
  // the frequency extent (data units) the shown series' loaded frames span, shared by the sides
  const running_span = (pick: (frame: SweepFrame) => SpectraRecords | undefined) =>
    running<Vec2 | undefined>((loaded, prev) =>
      union_ranges([
        prev,
        ...loaded.map((entry) => {
          const { band_structs: bands = {}, doses: dos = {} } = pick(entry) ?? {}
          return compute_frequency_range(bands, dos)
        }),
      ]),
    )
  const electronic_spans = $derived.by(running_span((entry) => entry))
  const phonon_spans = $derived.by(running_span((entry) => entry.phonon))
  const shown = $derived.by((): Set<ElectronicPane> => {
    if (panes?.length === 0) throw new Error(`ElectronicStructure needs at least one pane`)
    if (panes?.includes(`trends`) && !sweep?.descriptors?.length) {
      throw new Error(`ElectronicStructure's trends pane needs a sweep with descriptors`)
    }
    if (panes) return new Set(panes)
    // nothing loaded yet: the two scenes' empty states invite a drop
    return new Set(with_data.length ? with_data : [`structure`, `fermi`])
  })
  const toggle_pane = (pane: ElectronicPane): void => {
    const next = PANE_IDS.filter((id) => shown.has(id) !== (id === pane))
    if (next.length > 0) panes = next
  }
  const show_scenes = $derived(shown.has(`structure`) || shown.has(`fermi`))
  const show_spectra = $derived(shown.has(`bands`) || shown.has(`dos`))
  const show_phonon = $derived(shown.has(`phonon`))
  const show_trends = $derived(shown.has(`trends`)) // `shown` checks the sweep has descriptors
  // The frames the trends plot lacks a value for (its descriptor's or an overlay's) because
  // they never loaded (a supplied null is a value): while it shows they load in the background
  // one at a time, the shown series first, then the compared one and the rest, each in index
  // order (see frames.load_background)
  // A failed frame stays missing (it counts against the loaded note) but isn't loaded again
  const missing = $derived.by((): FrameRef[] => {
    if (!sweep || !series || !show_trends) return []
    const lines = descriptor_lines(sweep, descriptor)
    const order = new Set([...shown_series, ...sweep.series])
    return [...order].flatMap((entry) =>
      entry.frames.flatMap((_frame, idx): FrameRef[] => {
        const loaded = frames.frame(entry, idx)
        return lines.some((line) => descriptor_value(loaded, line) === undefined)
          ? [[entry, idx]]
          : []
      }),
    )
  })
  const unfilled = $derived(missing.filter(([entry, idx]) => !frames.is_settled(entry, idx)))
  $effect(() => frames.load_background(unfilled[0]))
  // the electronic spectra above the phonons, beside the trends
  const show_column = $derived(show_spectra || show_phonon)
  const column_split = $derived(show_spectra && show_phonon)
  const show_lower = $derived(show_trends || show_column)
  const lower_split = $derived(show_trends && show_column)
  const scenes_split = $derived(shown.has(`structure`) && shown.has(`fermi`))
  const spectra_split = $derived(shown.has(`bands`) && shown.has(`dos`))
  // The pane in the viewer's top-right corner (on the compared side while comparing) lines its
  // own controls up left of the viewer's
  const corner_pane = $derived.by((): ElectronicPane => {
    if (!show_scenes && !show_spectra) return show_phonon ? `phonon` : `trends`
    const [first, second] = show_scenes
      ? ([`structure`, `fermi`] as const)
      : ([`bands`, `dos`] as const)
    if (!shown.has(first) || !shown.has(second)) return shown.has(first) ? first : second
    const { scene_orientation, spectra_side } = corner_side
    return (show_scenes ? scene_orientation === `horizontal` : spectra_side) ? second : first
  })
  const pane_style = (pane: ElectronicPane, side?: FrameSide): string | undefined => {
    if (pane !== corner_pane || (side && side !== corner_side) || chrome_width === 0)
      return undefined
    const top = `calc(1ex + ${bar_offset}px)`
    // beside the top row's buttons (inset 1ex) with the 1px gap they keep between themselves
    const right = `calc(1ex + ${chrome_width + 1}px)`
    return `--viewer-buttons-top: ${top}; --ctrl-btn-top: ${top}; --viewer-buttons-right: ${right}; --ctrl-btn-right: ${right}`
  }
  // the top row's controls clear the overlaid control bar
  const top_row_style = $derived(
    bar_offset > 0 ? `--viewer-buttons-top: calc(1ex + ${bar_offset}px)` : undefined,
  )

  // === sides ===
  // One frame's panes (scenes, spectra, phonons) and the links between them: the shown frame's,
  // and while comparing the compared series' frame beside it. Both sides share mu, units, the
  // spectra's ranges and (one orbit link) the scenes' rotation.
  type SideInputs = {
    series: () => SweepSeries | undefined
    data: () => Partial<SweepFrame> // the shown frame's in a sweep
    // its Fermi surface's shown bands
    bands: { get: () => number[] | undefined; set: (bands?: number[]) => void }
  }
  // reported anew for each structure or zone (e.g. a dropped file) while the frames differ,
  // in a sweep once per series (its frames share one calculation's frame), also when a lazily
  // loaded frame turns frames_differ off and on again
  const reported_series = new WeakSet<SweepSeries>()
  class FrameSide {
    inputs: SideInputs
    constructor(inputs: SideInputs) {
      this.inputs = inputs
      $effect(() => {
        if (!this.frames_differ) return
        const entry = this.series
        if (entry) {
          if (reported_series.has(entry)) return
          reported_series.add(entry)
        } else void [this.structure, this.k_lattice]
        const message = `The structure's lattice and the Fermi data's k_lattice are in different Cartesian frames (a_i · b_j / 2π is no integer matrix), so the scenes rotate apart`
        untrack(() => report_error(message))
      })
    }
    series = $derived.by(() => this.inputs.series())
    data = $derived.by(() => this.inputs.data())
    // e.g. `fcc Cu · 175 GPa`, plain text (a series label may hold the trends legend's HTML)
    label = $derived.by((): string => {
      const { value, label } = this.data
      if (!sweep || !this.series || value === undefined) return ``
      const { id, label: name = id } = this.series
      return `${html_to_text(name)} · ${format_axis_value(sweep.axis, { value, label })}`
    })
    // each field on its own, so rewriting one (e.g. a pane's bound grid) leaves the others be
    structure = $derived(this.data.structure)
    band_data = $derived(this.data.band_data)
    // the frame's own surface, else what FermiSurface extracts from its band grid
    surface = $derived(this.data.fermi_data)
    band_structs = $derived(this.data.band_structs ?? {})
    doses = $derived(this.data.doses ?? {})
    phonon = $derived(this.data.phonon ?? {})
    first_band_struct = $derived(Object.values(this.band_structs)[0])
    // the Fermi surface's zone
    k_lattice = $derived((this.band_data ?? this.surface)?.k_lattice)
    frames_differ = $derived.by(() => {
      const { k_lattice, structure: crystal } = this
      if (!crystal || !k_lattice) return false
      const overlap = crystal.lattice.matrix.map((a_vec) =>
        k_lattice.map((b_vec) => dot(a_vec, b_vec) / (2 * Math.PI)),
      ) as Matrix3x3
      const integral = (matrix: Matrix3x3) =>
        matrix.flat().every((val) => Math.abs(val - Math.round(val)) < FRAME_TOL)
      return !integral(overlap) && !integral(matrix_inverse_3x3(overlap))
    })
    scenes_size = $state({ width: 0, height: 0 })
    scene_orientation = $derived(
      layout === `auto`
        ? pick_pane_orientation(this.scenes_size.width, this.scenes_size.height)
        : layout,
    )
    spectra_width = $state(0)
    spectra_side = $derived(spectra_split && this.spectra_width >= MIN_SIDE_BY_SIDE_WIDTH)
    // Left padding the DOS settled on beside the bands (its tick labels and their margin),
    // which the bands mirror on their right (room for the E_F label), centring the divider
    dos_left_padding = $state<number>()
    // the density extents its DOS plots drew, shared by both sides while comparing
    dos_density = $state<Vec2>()
    phonon_density = $state<Vec2>()
    link = new FermiBandsLink({
      band_data: () => this.band_data,
      band_struct: () => this.first_band_struct,
      k_lattice: () => this.k_lattice,
      mu: { get: () => mu, set: (value) => (mu = value) },
      selected_bands: () => this.inputs.bands.get(),
      bands_props: () => bands_props,
      fermi_props: () => fermi_props,
    })
    sync = create_bands_dos_sync({
      band_structs: () => this.band_structs,
      doses: () => this.doses,
      units: () => units,
      fermi_level: () => this.link.fermi_energy, // the grid's E_F, else the spectra's own
      bands_props: () => bands_props,
      dos_props: () => dos_props,
      side_by_side: () => this.spectra_side,
      data_range: () => union_ranges(electronic_spans),
      base_padding: DEFAULT_PLOT_PADDING,
    })
    // the energy marked on both spectra: the previewed surface's, else the hovered one
    reference_energy = $derived(this.link.reference_frequency ?? this.sync.hovered_frequency)
  }
  const main_side = new FrameSide({
    series: () => series,
    data: () => pane_data,
    bands: { get: () => selected_bands, set: (bands) => (selected_bands = bands) },
  })
  // the compared side's own band selection (another series numbers its bands its own way),
  // reset with the compared series
  let compare_bands = $derived.by((): number[] | undefined => void compare_target)
  const compare_side = new FrameSide({
    series: () => compared?.series,
    data: () => compare_frame ?? {},
    bands: { get: () => compare_bands, set: (bands) => (compare_bands = bands) },
  })
  const sides = $derived(compared ? [main_side, compare_side] : [main_side])
  const corner_side = $derived(compared ? compare_side : main_side)
  const frames_differ = $derived(sides.some((side) => side.frames_differ))
  // while comparing, both sides' DOS span the union of their density extents
  const shared_density = (pick: (side: FrameSide) => Vec2 | undefined): Vec2 | undefined =>
    compared ? union_ranges(sides.map(pick)) : undefined

  // === file drop ===
  const report_error = (message: string, filename?: string): void => {
    error_msg = message
    on_error?.({ error_msg: message, filename })
  }
  // Fill the panes a parsed file has data for (a trajectory: its final frame's structure and a
  // vaspout.h5's DOS, never bands; phonon spectra: the phonon pane), else say why it fills none
  const fill = async (opened: OpenedMaterial): Promise<ElectronicPane[] | string> => {
    const { filename } = opened
    if (opened.type === `json_browser` && is_sweep_like(opened.data)) {
      let dropped: Sweep
      try {
        dropped = normalize_sweep(opened.data)
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
      ;[sweep, series_id, frame_idx] = [dropped, undefined, 0]
      const dropped_frames = dropped.series.flatMap((entry) => entry.frames)
      return panes_with_data(dropped_frames, Boolean(dropped.descriptors?.length))
    }
    if (sweep) {
      return `${filename} is no sweep JSON: while a sweep is shown the viewer takes only sweeps`
    }
    if (opened.type === `fermi_surface`) {
      if (is_fermi_surface_data(opened.data))
        [fermi_data, band_data] = [opened.data, undefined]
      else [band_data, fermi_data] = [opened.data, undefined]
      return [`fermi`]
    }
    if (opened.type === `structure` || opened.type === `trajectory`) {
      const run = opened.type === `trajectory` ? opened.data : undefined
      const crystal = run
        ? (await materialize_frame_result(run.read_frame(run.frame_count - 1))).structure
        : opened.data
      if (!is_crystal(crystal))
        return `${filename} holds no periodic structure: its Fermi surface needs a lattice`
      structure = crystal
      const electronic = run?.metadata.electronic
      const dos = is_plain_object(electronic) ? normalize_dos(electronic.dos) : null
      if (dos) doses = { [filename]: dos }
      return dos ? [`structure`, `dos`] : [`structure`]
    }
    const vasp = opened.type === `vaspout_electronic` ? opened.data : null
    const json = opened.type === `json_browser` ? opened.data : null
    const unwrap = (key: string): unknown =>
      is_plain_object(json) && key in json ? json[key] : json
    const bands = vasp ? vasp.bands : normalize_band_structure(unwrap(`band_structure`))
    const dos = vasp ? vasp.dos : normalize_dos(unwrap(`dos`))
    if (!bands && !dos) {
      const kind = opened.type.replaceAll(`_`, ` `)
      return `${filename} is ${kind} data, not a structure, Fermi surface, band structure or DOS`
    }
    // phonon spectra go to the phonon pane, beside (not into) the electronic ones
    const filled: ElectronicPane[] = []
    if (bands?.type === `electronic`) {
      band_structs = { [filename]: bands }
      filled.push(`bands`)
    }
    if (dos?.type === `electronic`) {
      doses = { [filename]: dos }
      filled.push(`dos`)
    }
    if (bands?.type === `phonon` || dos?.type === `phonon`) {
      // mode values are placed on their own band structure's path, so leave with it
      phonon = {
        ...phonon,
        ...(bands?.type === `phonon` && {
          band_structs: { [filename]: bands },
          mode_values: undefined,
        }),
        ...(dos?.type === `phonon` && { doses: { [filename]: dos } }),
      }
      filled.push(`phonon`)
    }
    return filled
  }
  const drop_zone = raw_file_drop_zone({
    allow: () => allow_file_drop,
    set_loading: (value) => (loading = value),
    on_dragover: (over) => (dragover = over),
    on_error: (message) => report_error(message),
    on_drop: async (source) => {
      error_msg = undefined
      const opened = await open_material(source)
      try {
        const filled = await fill(opened)
        if (typeof filled === `string`) return report_error(filled, opened.filename)
        // a pane the file filled shows even when the caller's pane list left it out, trends
        // only while the (dropped) sweep has descriptors
        const has_trends = Boolean(sweep?.descriptors?.length)
        if (panes)
          panes = PANE_IDS.filter(
            (pane) =>
              filled.includes(pane) ||
              (panes?.includes(pane) && (pane !== `trends` || has_trends)),
          )
        on_file_load?.({ filename: opened.filename, panes: filled })
      } finally {
        opened.dispose()
      }
    },
  })
</script>

<div
  bind:this={wrapper}
  role="group"
  aria-label="Electronic structure viewer"
  aria-keyshortcuts={shows_fullscreen_toggle(fullscreen_toggle, controls_config)
    ? SHORTCUTS.fullscreen.keys
    : undefined}
  {...rest}
  class={[
    `electronic-structure`,
    show_scenes && show_lower ? `two-rows` : `one-row`,
    { dragover },
    rest.class,
  ]}
  {@attach drop_zone}
  {@attach keys}
>
  {#if sweep && series}
    <SequenceControlBar {controls_config} {fullscreen} bind:height={bar_height}>
      {#if sweep.series.length > 1 && controls_config.visible(`series`)}
        {@render series_menu(`Series`, series.id, sweep.series, select_series, false)}
      {/if}
      {#if sweep.series.length > 1 && controls_config.visible(`compare`)}
        {@const others = sweep.series.filter(({ id }) => id !== series.id)}
        {@render series_menu(
          `Compare with`,
          compared?.series.id ?? ``,
          others,
          (id) => (compare_series = id || undefined),
          true,
        )}
      {/if}
      <SequenceControls
        {controls_config}
        index={frame_index}
        count={series.frames.length}
        {playback}
        item_name="frame"
        aria_label="{html_to_text(sweep.axis.label)} frame"
        aria_valuetext={frame_label}
        disable_step_while_playing={false}
      />
      <span class="frame-status" aria-live="polite">
        {frame_label}
        {#if frames.is_loading(series, frame_index)}<small>loading…</small>{/if}
        {#if frame?.status?.unstable}<small class="unstable">unstable</small>{/if}
        {#if frame?.status?.note}<small>{frame.status.note}</small>{/if}
      </span>
    </SequenceControlBar>
  {/if}

  <div class="panes">
    <ViewerChrome
      {controls_config}
      bind:fullscreen
      {fullscreen_toggle}
      {wrapper}
      fullscreen_bg_css_var="--electronic-bg-fullscreen"
      style={top_row_style}
      {@attach observe_size(({ width }) => (chrome_width = width))}
    >
      {#if show_scenes && (scenes_split || compared) && controls_config.visible(`sync-rotation`)}
        {@const linked = sync_rotation && !frames_differ}
        <button
          type="button"
          class="sync-rotation-toggle"
          aria-pressed={linked}
          disabled={frames_differ}
          title={frames_differ
            ? `Structure and Fermi data are in different frames: their rotations can't be linked`
            : linked
              ? `Unlink the scenes' rotations`
              : `Link the scenes' rotations`}
          onclick={() => (sync_rotation = !sync_rotation)}
        >
          <Icon icon={linked ? LinkVariant : LinkOff} />
        </button>
      {/if}
      {#if controls_config.visible(`panes`)}
        <ToolbarMenu label="Shown panes" class="panes-menu">
          {#snippet button()}
            <Icon icon={Grid2x2} />
          {/snippet}
          {#each PANES as { pane, icon, label } (pane)}
            {#if pane !== `trends` || sweep?.descriptors?.length}
              <button
                class={[`view-mode-option`, { selected: shown.has(pane) }]}
                aria-pressed={shown.has(pane)}
                disabled={shown.size === 1 && shown.has(pane)}
                title={with_data.includes(pane)
                  ? undefined
                  : `No ${label.toLowerCase()} data loaded`}
                onclick={() => toggle_pane(pane)}
              >
                <Icon {icon} />
                <span>{label}</span>
              </button>
            {/if}
          {/each}
        </ToolbarMenu>
      {/if}
    </ViewerChrome>

    {#if show_scenes}
      {@render sided(scenes_row, true)}
    {/if}

    {#if show_scenes && show_lower}
      <SplitPane
        orientation="vertical"
        bind:ratio={row_ratio}
        aria-label="Resize 3D scenes and the plots below"
      />
    {/if}

    {#if show_lower}
      <div
        class={[`row lower`, lower_split ? `horizontal` : `single`]}
        style={show_scenes ? undefined : top_row_style}
      >
        {#if show_trends && sweep && series}
          <div class="pane" data-pane="trends" style={pane_style(`trends`)}>
            <SweepTrends
              {...trends_props}
              {sweep}
              frame_of={frames.frame}
              series_id={series.id}
              frame_idx={frame_index}
              compare={compared && {
                series_id: compared.series.id,
                frame_idx: compared.shown.idx,
              }}
              bind:descriptor
              on_frame_select={select_frame}
              show_controls={pane_controls(trends_props.show_controls)}
              fullscreen_toggle={false}
            />
            {#if unfilled.length > 0}
              {@const trend_frames = sweep.series.flatMap((entry) => entry.frames).length}
              {@const filled = trend_frames - missing.length}
              <small
                class="trends-fill"
                role="status"
                title="{filled} of {trend_frames} frames loaded for the trends, loading the rest"
              >
                {filled}/{trend_frames}
              </small>
            {/if}
          </div>
        {/if}
        {#if lower_split}
          <SplitPane
            bind:ratio={trends_ratio}
            aria-label="Resize sweep descriptors and spectra"
          />
        {/if}
        {#if show_column}
          {@render sided(spectra_column, !show_scenes)}
        {/if}
      </div>
    {/if}
  </div>

  <!-- a series select, with a `none` option (empty value) for the compared series; options are
  plain text, series labels may hold the trends legend's HTML -->
  {#snippet series_menu(
    title: string,
    value: string,
    options: SweepSeries[],
    on_pick: (id: string) => void,
    none: boolean,
  )}
    <label class="series-control">
      {title}
      <select {value} onchange={(event) => on_pick(event.currentTarget.value)}>
        {#if none}<option value="">none</option>{/if}
        {#each options as { id, label = id } (id)}
          <option value={id}>{html_to_text(label)}</option>
        {/each}
      </select>
    </label>
  {/snippet}

  <!-- the frame panes of one side, or while comparing both sides next to each other, each
  labelled by its series and axis value in the first row -->
  {#snippet sided(content: Snippet<[FrameSide]>, labelled: boolean)}
    <!-- keyed by side, so comparing mounts and drops only the compared side's panes -->
    <div class={[`sides`, { compare: compared }]}>
      {#each sides as side (side)}
        <div class="side">
          {#if compared && labelled}
            <div class="side-label">
              {side.label}
              {#if side === compare_side && compare_far && frame}
                <small class="far" role="status">
                  no frame within {with_unit(spacing)} of {with_unit(frame.value)}
                </small>
              {/if}
            </div>
          {/if}
          {@render content(side)}
        </div>
      {/each}
    </div>
  {/snippet}

  {#snippet scenes_row(side: FrameSide)}
    <div
      class={[`row scenes`, scenes_split ? side.scene_orientation : `single`]}
      style={top_row_style}
      bind:clientWidth={side.scenes_size.width}
      bind:clientHeight={side.scenes_size.height}
    >
      {#if shown.has(`structure`)}
        <div class="pane" data-pane="structure" style={pane_style(`structure`, side)}>
          <Structure
            structure_series_key={side.series?.id}
            {...structure_props}
            bind:structure={
              () => side.structure,
              (value) => {
                if (!sweep && is_crystal(value)) structure = value
              }
            }
            show_controls={pane_controls(structure_props.show_controls)}
            allow_file_drop={false}
            fullscreen_toggle={false}
          />
        </div>
      {/if}
      {#if scenes_split}
        <SplitPane
          orientation={side.scene_orientation}
          bind:ratio={pane_ratio}
          aria-label="Resize structure and Fermi surface panes"
        />
      {/if}
      {#if shown.has(`fermi`)}
        {@const { link } = side}
        <div class="pane" data-pane="fermi" style={pane_style(`fermi`, side)}>
          <FermiSurface
            {...fermi_props}
            bind:fermi_data={
              () => side.surface,
              (value) => {
                if (sweep) side.surface = value
                else fermi_data = value
              }
            }
            bind:band_data={
              () => side.band_data,
              (value) => {
                if (!sweep) band_data = value
              }
            }
            show_controls={pane_controls(fermi_props.show_controls)}
            allow_file_drop={false}
            fullscreen_toggle={false}
            wigner_seitz={fermi_props.wigner_seitz ?? Boolean(side.first_band_struct)}
            selected_spins={link.selected_spins}
            previewing={link.previewing}
            bind:color_property={link.color_property}
            bind:mu={link.mu}
            bind:selected_bands={side.inputs.bands.get, side.inputs.bands.set}
            bind:isolated_band={link.isolated_band}
            k_marker={link.path.hovered_k_point}
            k_path={link.k_path}
            on_point_hover={chain_callbacks(link.fermi_hover, fermi_props.on_point_hover)}
          />
        </div>
      {/if}
    </div>
  {/snippet}

  <!-- the electronic spectra above the phonons -->
  {#snippet spectra_column(side: FrameSide)}
    {@const { link, sync } = side}
    <div class={[`row column`, column_split ? `vertical` : `single`]}>
      {#if show_spectra}
        <div
          class={[
            `row spectra`,
            spectra_split ? (side.spectra_side ? `side` : `stacked`) : `single`,
          ]}
          bind:clientWidth={side.spectra_width}
        >
          {#if shown.has(`bands`)}
            <div class="pane" data-pane="bands" style={pane_style(`bands`, side)}>
              <Bands
                {...bands_props}
                band_structs={side.band_structs}
                bind:units
                fermi_level={sync.fermi_level}
                show_controls={pane_controls(bands_props.show_controls)}
                fullscreen_toggle={false}
                padding={{
                  r: side.spectra_side ? (side.dos_left_padding ?? 20) : 5,
                  ...bands_props.padding,
                  ...sync.shared_padding,
                }}
                y_axis={sync.y_axes[0]}
                bind:view={sync.views[0]}
                bind:resolved_padding={() => undefined, sync.raise_padding}
                bind:hovered_frequency={sync.hovered.bands}
                reference_frequency={side.reference_energy}
                line_kwargs={link.line_kwargs}
                bind:band_spin_mode={link.band_spin_mode}
                bind:x_positions={link.x_positions}
                highlighted_band_index={link.highlighted_band}
                highlighted_qpoint_index={link.path.active_qpoint}
                highlighted_qpoint_range={link.path.highlighted_qpoint_range}
                hover_config={link.bands_hover_config}
                on_point_hover={chain_callbacks(link.band_hover, bands_props.on_point_hover)}
                on_plot_click={chain_callbacks(link.band_click, bands_props.on_plot_click)}
              >
                {#snippet children(ctx)}
                  {@render bands_props.children?.(ctx)}
                  <!-- E_F (and shown energy) crossings, coloured like the line at that
                  energy; the 3D markers resolve their colours on this node -->
                  <svg
                    bind:this={link.crossings_svg}
                    class="band-crossings"
                    width={ctx.width}
                    height={ctx.height}
                  >
                    {#each link.crossings as { x, energy, level }}
                      {#if in_range(x, ctx.x_range) && in_range(energy, ctx.y_range)}
                        <circle
                          cx={ctx.x_scale_fn(x)}
                          cy={ctx.y_scale_fn(energy)}
                          r="3"
                          fill={BANDS_CSS_COLORS[level]}
                          stroke="var(--page-bg, white)"
                        />
                      {/if}
                    {/each}
                  </svg>
                {/snippet}
              </Bands>
            </div>
          {/if}
          {#if shown.has(`dos`)}
            {#if side.spectra_side}
              <SplitPane
                bind:ratio={spectra_ratio}
                min_px={MIN_BANDS_WIDTH}
                second_min_px={MIN_DOS_WIDTH}
                aria-label="Resize band structure and DOS"
              />
            {/if}
            <div class="pane" data-pane="dos" style={pane_style(`dos`, side)}>
              <Dos
                {...dos_props}
                doses={side.doses}
                bind:units
                fermi_level={sync.fermi_level}
                show_controls={pane_controls(dos_props.show_controls)}
                fullscreen_toggle={false}
                orientation={side.spectra_side ? `horizontal` : `vertical`}
                x_axis={sync.dos_x_axis}
                y_axis={sync.y_axes[1]}
                density_range={dos_props.density_range ??
                  shared_density((entry) => entry.dos_density)}
                bind:density_extent={side.dos_density}
                bind:view={sync.views[1]}
                bind:resolved_padding={
                  () => undefined,
                  (padding: Required<Sides> | undefined) => {
                    sync.raise_padding(padding)
                    side.dos_left_padding = padding?.l
                  }
                }
                bind:hovered_frequency={
                  () => sync.hovered.dos,
                  (energy) => {
                    sync.hovered.dos = energy
                    link.hovered_energy = energy
                  }
                }
                reference_frequency={side.reference_energy}
                padding={{ ...dos_props.padding, ...sync.shared_padding }}
              />
            </div>
          {/if}
        </div>
      {/if}
      {#if column_split}
        <SplitPane
          orientation="vertical"
          bind:ratio={phonon_ratio}
          aria-label="Resize electronic and phonon spectra"
        />
      {/if}
      {#if show_phonon}
        {@const { phonon: spectra } = side}
        <div class="pane" data-pane="phonon" style={pane_style(`phonon`, side)}>
          <BandsAndDos
            {...phonon_props}
            bands_props={{
              mode_values: spectra.mode_values,
              ...phonon_props.bands_props,
              show_controls: pane_controls(phonon_props.bands_props?.show_controls),
            }}
            dos_props={{
              ...phonon_props.dos_props,
              show_controls: pane_controls(phonon_props.dos_props?.show_controls),
            }}
            band_structs={spectra.band_structs ?? {}}
            doses={spectra.doses ?? {}}
            a2f={spectra.a2f}
            frequency_range={union_ranges(phonon_spans)}
            density_range={phonon_props.density_range ??
              shared_density((entry) => entry.phonon_density)}
            bind:density_extent={side.phonon_density}
            bind:units
            fullscreen_toggle={false}
          />
        </div>
      {/if}
    </div>
  {/snippet}

  {#if loading}
    <TaskStatus overlay spinner label="Loading file..." />
  {/if}
  <ViewerError bind:message={error_msg} dismissible />
</div>

<style>
  /* One frame and background for all panes, theirs transparent and filling their cells
     (Structure's root is display: contents, so its viewer sizes through its variables). The
     rows and panes split at --split-pane-size, which each SplitPane sets on its parent. */
  .electronic-structure {
    position: relative;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
    width: var(--electronic-width, 100%);
    height: var(--electronic-height, 500px);
    border-radius: var(--electronic-border-radius, 0);
    background: var(--electronic-bg, var(--struct-bg));
    --struct-bg-override: transparent;
    /* the Structure pane's buttons match the Fermi pane's and the top row's they share a row with */
    --struct-buttons-gap: 1px;
    --struct-buttons-btn-padding: 4px;
    --struct-buttons-align: center;
    --fermi-bg: transparent;
    --struct-height: 100%;
    --struct-min-width: 0;
    --fermi-height: 100%;
    --scatter-min-height: 0;
    &.two-rows {
      height: var(--electronic-height, 860px);
      > .panes {
        grid-template-rows: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
      }
    }
    &.dragover {
      background: var(--electronic-dragover-bg, var(--dragover-bg));
      outline: var(--electronic-dragover-border, var(--dragover-border));
    }
    &:fullscreen {
      width: 100vw;
      height: 100vh;
      border-radius: 0;
      background: var(--electronic-bg-fullscreen, var(--electronic-bg, var(--struct-bg)));
    }
  }
  .panes {
    position: relative;
    display: grid;
    flex: 1;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  }
  /* the same blue ToolbarMenu marks selected options with; .panes outranks ViewerChrome's
     hover color, so the pressed state stays blue under the pointer */
  .panes .sync-rotation-toggle[aria-pressed='true'] {
    color: var(
      --accent-color,
      var(--menu-option-selected-color, light-dark(#2563eb, #6ea8ff))
    );
  }
  .row {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    &.horizontal {
      grid-template-columns: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
    }
    &.vertical {
      grid-template-rows: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
    }
    &.lower.horizontal {
      grid-template-columns: minmax(0, var(--split-pane-size, 40%)) minmax(0, 1fr);
    }
    &.side {
      grid-template-columns: minmax(0, var(--split-pane-size, 78%)) minmax(0, 1fr);
    }
    &.stacked {
      grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
    }
  }
  .pane {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 0;
    > :global(:not(.structure-fullscreen-root)) {
      height: 100%;
    }
  }
  .band-crossings {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .series-control {
    display: flex;
    gap: 0.4em;
    align-items: center;
  }
  /* one cell per side: compared sides split their row in half, a hairline between them.
     Direct children only: `.row.side` is the spectra row with bands beside the DOS. */
  .sides {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    > .side {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      > .row {
        flex: 1;
      }
    }
    > .side + .side {
      border-left: 1px solid var(--border-color, light-dark(#ddd, #444));
    }
  }
  .side-label {
    display: flex;
    gap: 0.5em;
    align-items: baseline;
    padding: 2px 1ex;
    font-size: 0.85em;
    white-space: nowrap;
    .far {
      color: var(--warning-color, darkorange);
    }
  }
  .trends-fill {
    position: absolute;
    top: 4px;
    left: 50%;
    translate: -50%;
    pointer-events: none;
    color: var(--text-muted, currentColor);
    font-size: 0.8em;
  }
  .frame-status {
    display: flex;
    gap: 0.5em;
    align-items: baseline;
    white-space: nowrap;
    small {
      color: var(--text-muted, currentColor);
    }
    .unstable {
      color: var(--warning-color, darkorange);
    }
  }
</style>
