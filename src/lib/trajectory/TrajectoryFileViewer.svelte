<script lang="ts">
  // Acquisition shell around <Trajectory>: URL / File / binary sources, drag-and-drop,
  // decompression, worker parsing with progress, HDF5 group choice, errors, and the run
  // lifecycle (a new run is opened before the one it replaces is disposed).
  import EmptyState from '$lib/EmptyState.svelte'
  import { StatusMessage } from '$lib/feedback'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { parse_trajectory_in_worker } from '$lib/file-viewer/parse-in-worker'
  import * as io from '$lib/io'
  import type { FileLoadMeta } from '$lib/io/types'
  import { DEFAULTS } from '$lib/settings'
  import { to_error } from '$lib/utils'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { ParseProgress, TrajectorySource, TrajHandlerData } from './index'
  import {
    Hdf5GroupSelectionRequiredError,
    open_trajectory,
    type OpenTrajectoryOptions,
    source_byte_size,
  } from './open'
  import { get_unsupported_format_message } from './parse'
  import type { TrajectoryRun } from './run'
  import Trajectory from './Trajectory.svelte'
  import TrajectoryError from './TrajectoryError.svelte'

  type ViewerProps = Omit<ComponentProps<typeof Trajectory>, `trajectory`>
  type Hdf5PathGroup = { trunk: string; paths: string[] }
  type PendingSource = {
    data: TrajectorySource
    filename: string
    meta: Partial<FileLoadMeta>
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
  // True while a dropped file is still being read/inflated, before its bytes reach open_source
  let drop_reading = $state(false)
  let progress = $state<ParseProgress | null>(null)
  let error_msg = $state<string | null>(null)
  // The run this component opened (vs one the caller passed in); disposed on replacement
  let owned_run: TrajectoryRun | undefined
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
    const groups: Record<string, string[]> = {}
    for (const path of paths) {
      const slash_idx = path.lastIndexOf(`/`)
      const trunk = slash_idx > 0 ? path.slice(0, slash_idx) : `/`
      ;(groups[trunk] ??= []).push(path)
    }
    return Object.entries(groups)
      .toSorted(([first], [second]) => compare_paths(first, second))
      .map(([trunk, group_paths]) => ({ trunk, paths: group_paths.toSorted(compare_paths) }))
  }
  const hdf5_leaf = (path: string): string => path.slice(path.lastIndexOf(`/`) + 1)

  // Adopt `run` as the one on display; the previous owned run is disposed only now, so a
  // failed or superseded load never leaves the viewer empty
  const adopt = (run: TrajectoryRun): void => {
    const previous = owned_run
    trajectory = run
    // Read back rather than keep `run`: writes to an unbound $bindable (and to a parent's
    // $state) store a proxy of the run, and the ownership effect below compares identities
    owned_run = trajectory
    current_step_idx = 0
    if (previous && previous !== owned_run) previous.dispose()
  }

  // A caller can replace a run opened here through bind:trajectory. Release only the run
  // this shell owns; caller-supplied runs remain the caller's responsibility.
  $effect(() => {
    const displayed_run = trajectory
    if (owned_run && displayed_run !== owned_run) {
      owned_run.dispose()
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

  // Open a source and adopt the result. Payloads above the indexing threshold (and Blob-backed
  // HDF5, which h5wasm mounts in a worker) parse off the main thread and come back as a
  // worker-served run; everything else opens here with synchronous frame reads.
  async function open_source(
    source: PendingSource,
    controller: AbortController,
    hdf5_group_path: string | undefined = loading_options.hdf5_group_path,
  ): Promise<void> {
    const { data, filename: name, meta } = source
    const index_above_bytes =
      loading_options.index_above_bytes ?? DEFAULTS.trajectory.index_above_bytes
    const file_size = source_byte_size(data, index_above_bytes)
    const options = { ...loading_options, hdf5_group_path }
    const on_progress = (update: ParseProgress): void => {
      if (load_controller === controller) progress = update
    }
    try {
      const run =
        data instanceof Blob || file_size > index_above_bytes
          ? await parse_trajectory_in_worker(data, name, on_progress, options, {
              signal: controller.signal,
              transfer_source: data instanceof ArrayBuffer && Boolean(meta.file),
            })
          : await open_trajectory(data, { ...options, filename: name, on_progress })
      if (load_controller !== controller || controller.signal.aborted) return run.dispose()
      adopt(run)
      on_file_load?.({
        trajectory: run,
        frame_count: run.frame_count,
        total_atoms: run.preview.structure.sites.length,
        filename: name,
        file_size,
        source_filename: meta.source_filename ?? name,
        ...meta,
      })
    } catch (error) {
      if (load_controller !== controller || controller.signal.aborted) return
      if (error instanceof Hdf5GroupSelectionRequiredError) {
        hdf5_selection = { groups: error.groups, source }
        hdf5_picker_open = true
        return
      }
      const unsupported = get_unsupported_format_message(
        name,
        typeof data === `string` ? data : ``,
      )
      report_error(unsupported || `Failed to parse trajectory: ${to_error(error).message}`, {
        filename: name,
        file_size,
        ...meta,
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
    const load = async (): Promise<void> => {
      if (typeof source === `string`) {
        if (io.hdf5_compression_format(source) === `gzip`) progress = decompressing_hdf5()
        await io.load_trajectory_from_url(
          source,
          (content, name, meta) =>
            open_source({ data: content, filename: name, meta }, controller),
          controller.signal,
        )
      } else if (typeof File !== `undefined` && source instanceof File) {
        const { content, filename: name } = await io.decompress_trajectory_file(
          source,
          controller.signal,
        )
        await open_source(
          {
            data: content,
            filename: name,
            meta: { source_filename: source.name, file: source },
          },
          controller,
        )
      } else {
        await open_source({ data: source, filename: filename ?? ``, meta: {} }, controller)
      }
    }
    load().catch((error: unknown) => {
      if (load_controller !== controller || controller.signal.aborted) return
      console.error(`Failed to load trajectory:`, error)
      report_error(`Failed to load trajectory: ${to_error(error).message}`, {
        filename: typeof source === `string` ? io.basename_from_url(source) : filename,
      })
      end_load(controller)
    })
    return () => {
      if (load_controller === controller) {
        controller.abort(new DOMException(`Source changed`, `AbortError`))
        end_load(controller)
      }
    }
  })
  const decompressing_hdf5 = (): ParseProgress => ({
    current: 0,
    total: 100,
    stage: `Decompressing HDF5 into temporary browser-managed storage…`,
  })

  $effect(() => () => {
    load_controller?.abort(new DOMException(`Viewer unmounted`, `AbortError`))
    owned_run?.dispose()
    owned_run = undefined
  })
</script>

<div
  class={[`trajectory-file-viewer`, class_name]}
  {style}
  {id}
  role="region"
  aria-label="Drop trajectory file here to load"
  {@attach io.file_drop_zone({
    allow: () => allow_file_drop,
    hdf5_as_blob: true,
    max_files: 1,
    on_drop: (content, name, meta) => {
      const controller = begin_load()
      if (io.hdf5_compression_format(meta.source_filename) === `gzip`) {
        progress = decompressing_hdf5()
      }
      return open_source({ data: content, filename: name, meta }, controller)
    },
    on_error: (message) => report_error(message),
    set_loading: (reading) => (drop_reading = reading),
  })}
>
  {#if hdf5_selection && hdf5_picker_open}
    <EmptyState
      class="hdf5-group-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Choose HDF5 trajectory"
      style="justify-content: flex-start"
    >
      <h3>Choose trajectory</h3>
      <p>
        <code>{hdf5_selection.source.filename}</code> contains multiple trajectories; choose one
        to load.
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
  {:else if loading || drop_reading}
    <Spinner
      text={progress
        ? `${progress.stage} (${Math.round(progress.current)}%)`
        : `Loading trajectory...`}
      style="flex: 1; display: flex; align-items: center; justify-content: center"
      {...spinner_props}
    />
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
      <p>
        Drop a trajectory file here (.xyz, .extxyz, .json, .json.gz, XDATCAR, .traj, .h5) or
        provide trajectory data via props
      </p>
      <strong style="display: block; margin-block: 1em 1ex">Supported formats:</strong>
      <ul>
        <li>Multi-frame XYZ trajectory files (.xyz, .extxyz)</li>
        <li>ASE trajectory files (.traj)</li>
        <li>Pymatgen trajectory JSON</li>
        <li>Array of structures with metadata</li>
        <li>VASP XDATCAR and LAMMPS dump files</li>
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
