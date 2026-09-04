<script lang="ts">
  // Convenience shell around <Trajectory>: source/drop UI, HDF5 group choice and errors.
  // open_material owns acquisition, parsing, workers, provenance and resource disposal.
  import { FileInput, TaskStatus } from 'svelte-widgets'
  import EmptyState from '$lib/EmptyState.svelte'
  import { StatusMessage } from '$lib/feedback'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import {
    open_material,
    MaterialOpenError,
    type MaterialPayload,
    type MaterialSource,
    type OpenedMaterial,
  } from '$lib/file-viewer/open'
  import * as io from '$lib/io'
  import { DEFAULTS } from '$lib/settings'
  import { to_error } from '$lib/utils'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { ParseProgress, TrajHandlerData } from './index'
  import type { OpenTrajectoryOptions } from './open'
  import { Hdf5GroupSelectionRequiredError } from './open'
  import { get_unsupported_format_message } from './parse'
  import type { TrajectoryRun } from './run'
  import Trajectory from './Trajectory.svelte'
  import TrajectoryError from './TrajectoryError.svelte'

  type ViewerProps = Omit<ComponentProps<typeof Trajectory>, `trajectory`>
  type Hdf5PathGroup = { trunk: string; paths: string[] }
  type PendingSource = {
    source: MaterialSource | ArrayBuffer | Blob
    filename?: string
    // Set once the source has been fetched/inflated, so an HDF5 group pick re-parses the
    // payload already in hand instead of downloading and inflating the file again
    payload?: MaterialPayload
  }

  let {
    src,
    filename,
    trajectory = $bindable(),
    loading_options = {},
    allow_file_drop = DEFAULTS.trajectory.allow_file_drop,
    spinner_props = {},
    error_snippet,
    on_file_load,
    on_error,
    current_step_idx = $bindable(0),
    fps = $bindable(DEFAULTS.trajectory.fps),
    display_mode = $bindable(DEFAULTS.trajectory.display_mode),
    active_pane = $bindable(null),
    pane_ratio = $bindable(0.5),
    structure_props = {},
    supercell_scaling = $bindable(structure_props.supercell_scaling ?? `1x1x1`),
    x_quantity = $bindable(),
    visible_properties = $bindable(),
    fullscreen = $bindable(false),
    hovered = $bindable(false),
    wrapper = $bindable(),
    class: class_name,
    style,
    id,
    ...viewer_props
  }: ViewerProps & {
    // URL to fetch, or a File / ArrayBuffer / Blob to open directly
    src?: string | ArrayBuffer | Blob | File | null
    // Name used for format detection when `src` is binary (URLs and Files carry their own)
    filename?: string
    // bindable: the run on display. A caller-supplied run is shown as-is and never disposed
    // here; runs this component opens are disposed when replaced or on unmount.
    trajectory?: TrajectoryRun
    loading_options?: Pick<
      OpenTrajectoryOptions,
      `hdf5_group_path` | `atom_type_mapping` | `index_above_bytes`
    >
    allow_file_drop?: boolean
    spinner_props?: ComponentProps<typeof Spinner>
    error_snippet?: Snippet<[{ error_msg: string; on_dismiss: () => void }]>
    on_file_load?: (data: TrajHandlerData) => void
    on_error?: (data: TrajHandlerData) => void
  } = $props()

  let loading = $state(false)
  let progress = $state<ParseProgress | null>(null)
  let error_msg = $state<string | null>(null)
  // The run this component opened (vs one the caller passed in); disposed on replacement
  let owned_material = $state.raw<OpenedMaterial | undefined>()
  let owned_run = $state.raw<TrajectoryRun | undefined>()
  let load_controller: AbortController | undefined
  // HDF5 files holding several trajectories wait here for the user's pick
  let hdf5_selection = $state.raw<{ groups: string[]; source: PendingSource } | undefined>(
    undefined,
  )
  let hdf5_picker_open = $state(false)
  let hdf5_path_groups = $derived(
    hdf5_selection ? group_hdf5_paths(hdf5_selection.groups) : [],
  )

  const compare_paths = (first: string, second: string): number =>
    first.localeCompare(second, undefined, { numeric: true })
  function group_hdf5_paths(paths: string[]): Hdf5PathGroup[] {
    const groups = Map.groupBy(paths, (path) => {
      const slash_idx = path.lastIndexOf(`/`)
      return slash_idx > 0 ? path.slice(0, slash_idx) : `/`
    })
    return [...groups]
      .toSorted(([first], [second]) => compare_paths(first, second))
      .map(([trunk, group_paths]) => ({ trunk, paths: group_paths.toSorted(compare_paths) }))
  }
  const hdf5_leaf = (path: string): string => path.slice(path.lastIndexOf(`/`) + 1)

  // Adopt `run` as the one on display; the previous owned run is disposed only now, so a
  // failed or superseded load never leaves the viewer empty
  const adopt = (opened: Extract<OpenedMaterial, { type: `trajectory` }>): void => {
    const previous = owned_material
    const run = opened.data
    trajectory = run
    // Read back rather than keep `run`: writes to an unbound $bindable (and to a parent's
    // $state) store a proxy of the run, and the ownership effect below compares identities
    owned_material = opened
    owned_run = trajectory
    current_step_idx = 0
    if (previous !== opened) previous?.dispose()
  }

  // A caller can replace a run opened here through bind:trajectory. Release only the run
  // this shell owns; caller-supplied runs remain the caller's responsibility.
  $effect(() => {
    const displayed_run = trajectory
    if (owned_material && displayed_run !== owned_run) {
      owned_material.dispose()
      owned_material = undefined
      owned_run = undefined
    }
  })

  // Every load supersedes the one before it: abort decompression/parsing and forget any
  // pending HDF5 pick
  const begin_load = (): AbortController => {
    load_controller?.abort(new DOMException(`Superseded by a newer load`, `AbortError`))
    load_controller = new AbortController()
    hdf5_selection = undefined
    hdf5_picker_open = false
    loading = true
    progress = null
    error_msg = null
    return load_controller
  }
  const end_load = (controller: AbortController): void => {
    if (load_controller !== controller) return
    loading = false
    progress = null
  }

  const report_error = (message: string, details: TrajHandlerData = {}): void => {
    error_msg = message
    on_error?.({ error_msg: message, ...details })
  }
  const source_name = ({ source, filename: source_filename }: PendingSource): string => {
    if (source_filename) return source_filename
    if (typeof source === `string` || source instanceof URL) {
      return io.basename_from_url(String(source))
    }
    if (typeof File !== `undefined` && source instanceof File) return source.name
    return `filename` in source ? source.filename : ``
  }

  async function open_source(
    pending: PendingSource,
    controller: AbortController,
    hdf5_group_path: string | undefined = loading_options.hdf5_group_path,
  ): Promise<void> {
    const { source } = pending
    const is_file = typeof File !== `undefined` && source instanceof File
    const material_source: MaterialSource =
      pending.payload ??
      (source instanceof ArrayBuffer || (source instanceof Blob && !is_file)
        ? { data: source, filename: pending.filename ?? `` }
        : (source as MaterialSource))
    const on_progress = (update: ParseProgress): void => {
      if (load_controller === controller) progress = update
    }
    // Inflating a gzipped HDF5 into browser-managed storage happens before any parse progress
    // arrives and can take a while, so say so instead of showing a bare spinner
    if (!pending.payload && io.hdf5_compression_format(source_name(pending)) === `gzip`) {
      progress = {
        current: 0,
        total: 100,
        stage: `Decompressing HDF5 into temporary browser-managed storage…`,
      }
    }
    try {
      const opened = await open_material(material_source, {
        ...loading_options,
        hdf5_group_path,
        signal: controller.signal,
        on_progress,
        on_acquired: (payload) => (pending.payload = payload),
      })
      if (load_controller !== controller || controller.signal.aborted) return opened.dispose()
      if (opened.type !== `trajectory`) {
        opened.dispose()
        throw new Error(`${opened.filename} is ${opened.type}, not a trajectory`)
      }
      const run = opened.data
      adopt(opened)
      on_file_load?.({
        trajectory: run,
        frame_count: run.frame_count,
        total_atoms: run.preview.structure.sites.length,
        ...opened.provenance,
      })
    } catch (error) {
      if (load_controller !== controller || controller.signal.aborted) return
      if (error instanceof Hdf5GroupSelectionRequiredError) {
        hdf5_selection = { groups: error.groups, source: pending }
        hdf5_picker_open = true
        return
      }
      const name = source_name(pending)
      // Enough of the payload for the binary sniff behind get_unsupported_format_message
      const acquired = pending.payload?.data ?? pending.source
      const head =
        acquired instanceof ArrayBuffer
          ? new TextDecoder().decode(acquired.slice(0, 8192))
          : typeof acquired === `string`
            ? acquired
            : ``
      const unsupported = get_unsupported_format_message(name, head)
      const prefix =
        error instanceof MaterialOpenError && error.stage === `acquire`
          ? `Failed to load trajectory`
          : `Failed to parse trajectory`
      const message = `${prefix}: ${name ? `${name}: ` : ``}${to_error(error).message}`
      report_error(unsupported || message, {
        filename: name,
        ...(error instanceof MaterialOpenError && error.provenance),
      })
    } finally {
      end_load(controller)
    }
  }

  async function select_hdf5_group(path: string): Promise<void> {
    const selection = hdf5_selection
    if (!selection) return
    hdf5_picker_open = false
    const controller = begin_load()
    hdf5_selection = selection
    await open_source(selection.source, controller, path)
    // A failed pick reopens the picker with the reason so another group can be tried
    if (load_controller === controller && error_msg) hdf5_picker_open = true
  }

  // === sources: prop, URL, drop ===
  let loaded_src: typeof src
  $effect(() => {
    const source = src
    if (source === loaded_src) return
    loaded_src = source
    // Hosts that clear a URL trait often send `` or null rather than undefined
    if (!source) return
    const controller = begin_load()
    void open_source({ source, filename }, controller)
    return () => {
      if (load_controller === controller) {
        controller.abort(new DOMException(`Source changed`, `AbortError`))
        end_load(controller)
      }
    }
  })
  $effect(() => () => {
    load_controller?.abort(new DOMException(`Viewer unmounted`, `AbortError`))
    owned_material?.dispose()
    owned_material = undefined
    owned_run = undefined
  })
</script>

<div
  class={[`trajectory-file-viewer`, class_name]}
  {style}
  {id}
  role="region"
  aria-label="Drop trajectory file here to load"
  {@attach io.raw_file_drop_zone({
    allow: () => allow_file_drop,
    max_files: 1,
    on_drop: (source) => {
      const controller = begin_load()
      return open_source({ source }, controller)
    },
    on_error: (message) => report_error(message),
  })}
>
  {#if hdf5_selection && hdf5_picker_open}
    <EmptyState
      class="hdf5-group-picker"
      role="dialog"
      aria-label="Choose HDF5 trajectory"
      style="justify-content: flex-start"
    >
      <h3>Choose trajectory</h3>
      <p>
        <code>{source_name(hdf5_selection.source)}</code> contains multiple trajectories; choose
        one to load.
      </p>
      {#if error_msg}
        <StatusMessage bind:message={error_msg} type="error" dismissible />
      {/if}
      <div
        class="hdf5-group-options"
        class:flat={hdf5_path_groups.length === 1}
        style="flex: initial"
        role="group"
        aria-label="HDF5 trajectory groups"
      >
        {#each hdf5_path_groups as { trunk, paths }, group_idx (trunk)}
          <div
            class="hdf5-path-group"
            style="--hdf5-path-hue: {(200 + group_idx * 89) % 360}deg"
          >
            {#if trunk !== `/`}
              <div class="hdf5-path-trunk" title={trunk}><code>{trunk}</code></div>
            {/if}
            <div class="hdf5-path-leaves">
              {#each paths as group_path (group_path)}
                <button
                  class="hdf5-group-option"
                  data-hdf5-group={group_path}
                  title={group_path}
                  onclick={() => void select_hdf5_group(group_path)}
                >
                  <code>{hdf5_leaf(group_path)}</code>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <button
        style="margin-top: 0.5rem"
        onclick={() => {
          hdf5_picker_open = false
          if (!trajectory) hdf5_selection = undefined
          error_msg = null
        }}
      >
        Cancel
      </button>
    </EmptyState>
  {:else if loading}
    <TaskStatus
      label={progress
        ? `${progress.stage} (${Math.round(progress.current)}%)`
        : `Loading trajectory...`}
      value={progress?.current}
      oncancel={() => {
        const controller = load_controller
        if (!controller) return
        controller.abort(new DOMException(`Cancelled`, `AbortError`))
        end_load(controller)
      }}
      style="flex: 1; align-content: center; justify-items: center; padding: 1em"
    >
      <Spinner {...spinner_props} />
    </TaskStatus>
  {:else if error_msg}
    <TrajectoryError {error_msg} on_dismiss={() => (error_msg = null)} {error_snippet} />
  {:else if trajectory}
    {#if hdf5_selection}
      <button
        type="button"
        class="hdf5-group-picker-back"
        data-hdf5-group-picker-back
        title="Choose a different trajectory from this HDF5 file"
        aria-label="Choose a different trajectory from this HDF5 file"
        onclick={() => (hdf5_picker_open = true)}
      >
        ←
      </button>
    {/if}
    <Trajectory
      {trajectory}
      bind:current_step_idx
      bind:fps
      bind:display_mode
      bind:active_pane
      bind:pane_ratio
      {structure_props}
      bind:supercell_scaling
      bind:x_quantity
      bind:visible_properties
      bind:fullscreen
      bind:hovered
      bind:wrapper
      {...viewer_props}
    />
  {:else}
    <EmptyState class="trajectory-empty-state">
      <h3>Load Trajectory</h3>
      {#if allow_file_drop}
        <FileInput
          label="Choose trajectory file"
          ondrop={(event) => event.stopPropagation()}
          onfiles={(files) => {
            const source = files[0]
            if (source) void open_source({ source }, begin_load())
          }}
        />
      {/if}
      <p>
        Drop a trajectory file here (.xyz, .extxyz, .json, .json.gz, XDATCAR, OUTCAR,
        vasprun.xml, .traj, .h5) or provide trajectory data via props
      </p>
      <strong style="display: block; margin-block: 1em 1ex">Supported formats:</strong>
      <ul>
        <li>Multi-frame XYZ trajectory files (.xyz, .extxyz)</li>
        <li>ASE trajectory files (.traj)</li>
        <li>Pymatgen trajectory JSON</li>
        <li>Array of structures with metadata</li>
        <li>VASP XDATCAR, OUTCAR and vasprun.xml files</li>
        <li>LAMMPS dump files (.lammpstrj)</li>
        <li>HDF5 trajectory files (.h5, .hdf5)</li>
        <li>Compressed files (.gz)</li>
      </ul>
      <p>💡 Force vectors will be automatically displayed when present in trajectory data</p>
    </EmptyState>
  {/if}
</div>

<style>
  .trajectory-file-viewer {
    display: flex;
    flex-direction: column;
    position: relative;
    height: var(--traj-height, 100%);
    min-height: var(--traj-min-height, 500px);
    border-radius: var(--traj-border-radius, 4px);
    &:global(.dragover) {
      background-color: var(--traj-dragover-bg, var(--dragover-bg));
      border: var(--traj-dragover-border, var(--dragover-border));
    }
    > :global(.trajectory) {
      flex: 1;
      min-height: 0;
    }
  }
  .hdf5-group-picker-back {
    position: absolute;
    top: 4pt;
    left: 4pt;
    z-index: 3;
    padding: 1pt 5pt;
    line-height: 1;
    background: var(--btn-bg);
  }
  :global(.trajectory-empty-state) {
    flex: 1;
    padding: 2rem;
    border-radius: var(--border-radius, 3pt);
    background: var(--dropzone-bg);
    :where(p, ul) {
      color: var(--text-color-muted);
    }
    :where(ul, li, strong) {
      max-width: var(--trajectory-empty-state-max-width, 500px);
      margin-inline: auto;
    }
  }
  .trajectory-file-viewer :global(.hdf5-group-picker) {
    align-self: center;
    flex: 0 1 auto;
    width: min(calc(100% - 2rem), 72rem);
    height: auto;
    max-height: calc(100% - 2rem);
    min-height: 0;
    margin: auto;
    padding: clamp(1rem, 2cqi, 2rem);
    border-radius: var(--border-radius, 3pt);
    background: var(--dropzone-bg);
    overflow: hidden;
  }
  .hdf5-group-options {
    display: grid;
    align-content: start;
    min-height: 0;
    overflow-y: auto;
    gap: 0.5rem;
    width: 100%;
    &.flat {
      display: block;
      .hdf5-path-leaves {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
        gap: 0.5rem;
      }
      .hdf5-group-option {
        text-align: left;
      }
    }
    &:not(.flat) {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 23rem), 1fr));
      width: min(100%, 52rem);
      margin-inline: auto;
    }
  }
  .hdf5-path-group {
    --hdf5-path-color: hsl(var(--hdf5-path-hue) 55% 45%);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    padding: 0.25rem;
    background: color-mix(in srgb, var(--hdf5-path-color) 8%, transparent);
    border-inline-start: 3px solid var(--hdf5-path-color);
    border-radius: var(--border-radius, 3pt);
  }
  .hdf5-path-trunk {
    overflow: hidden;
    color: color-mix(in srgb, var(--hdf5-path-color) 72%, var(--text-color, CanvasText));
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hdf5-path-leaves {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(3rem, 1fr));
    gap: 0.25rem;
  }
  .hdf5-group-option {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
