<script lang="ts">
  import { afterNavigate, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import FilePicker from '$lib/FilePicker.svelte'
  import { Spinner, StatusMessage } from 'svelte-widgets'
  import * as io from '$lib/io'
  import type { Vec3 } from '$lib/math'
  import type {
    IrRamanOptions,
    PhononExplorerView,
    PhononModeDataset,
    PhononModeSelection,
  } from '$lib/spectral'
  import {
    DEFAULT_PHONON_AMPLITUDE,
    DEFAULT_PHONON_FPS,
    DEFAULT_PHONON_SHOW_VECTORS,
    DEFAULT_PHONON_SUPERCELL,
    default_phonon_mode_selection,
    parse_born,
    parse_phonon_modes,
    phonon_explorer_views,
    PhononModeExplorer,
    qpoint_has_eigenvectors,
    spectrum_from_phonon_data,
  } from '$lib/spectral'
  import { parse_supercell_scaling } from '$lib/structure'
  import type { UrlParamEntry } from 'svelte-widgets/url-params'
  import { bool_from_param, bool_url_entry, sync_url_params } from 'svelte-widgets/url-params'
  import { to_error } from '$lib/utils'
  import { glob_basename, glob_default } from '$site/imports'
  import { untrack } from 'svelte'

  type FixtureSource = { name: string; href: string }
  type FixtureMeta = {
    label: string
    // q-path through the Brillouin zone; undefined for Γ-only mode files
    path?: string
    // what to look for once the fixture is loaded
    detail: string
    // defaults to PhononDB
    source?: FixtureSource
    born?: string
    raman?: string
  }
  type ModeFixture = FixtureMeta & {
    filename: string
    stats: string
    source: FixtureSource
    dataset: PhononModeDataset
  }

  const PHONONDB: FixtureSource = {
    name: `PhononDB (PBEsol)`,
    href: `https://doi.org/10.48505/nims.4197`,
  }
  // Picker order: the default NaCl path first, then the richer dispersions, then Γ-only files
  const FIXTURE_META: Record<string, FixtureMeta> = {
    [`NaCl-Gamma-X-band.yaml`]: {
      label: `NaCl rock salt`,
      path: `Γ–X`,
      detail: `Textbook two-atom dispersion: three acoustic and three optical branches, with LO–TO splitting at Γ from the Born charges`,
      born: `NaCl.BORN`,
    },
    [`BaTiO3-cubic-band.yaml.gz`]: {
      label: `BaTiO3 cubic perovskite`,
      path: `Γ–X–M–Γ–R–X|R–M`,
      detail: `Ferroelectric soft mode: the imaginary TO branch at Γ, X and M is the Ti-O off-centering that drives the cubic → tetragonal transition`,
      born: `BaTiO3-cubic.BORN`,
    },
    [`CsPbI3-Pnma-band.yaml.gz`]: {
      label: `δ-CsPbI3 orthorhombic`,
      path: `Γ–X–S–Y–Γ–Z`,
      detail: `20-atom Pnma cell with 60 branches all below 3.6 THz: PbI6 octahedral tilts and Cs rattling modes crowd the low-frequency window`,
      born: `CsPbI3-Pnma.BORN`,
    },
    [`CaCO3-calcite-band.yaml.gz`]: {
      label: `CaCO3 calcite`,
      path: `Γ–L–F–Γ–T`,
      detail: `Molecular crystal split: lattice modes below ~12 THz versus internal CO3 bending and stretching modes between 20 and 46 THz`,
      born: `CaCO3-calcite.BORN`,
    },
    [`hBN-band.yaml.gz`]: {
      label: `h-BN layered`,
      path: `Γ–M–K–Γ–A`,
      detail: `Layered material: the flexural ZA branch bends quadratically out of Γ, and the near-flat Γ–A branches show how weakly the layers couple`,
      born: `hBN.BORN`,
    },
    [`MgB2-band.yaml.gz`]: {
      label: `MgB2 superconductor`,
      path: `Γ–K–M–Γ–A–H–L–A`,
      detail: `Metal without Born charges: the in-plane boron E2g bond-stretching mode near 17 THz at Γ is the strongly coupled phonon behind its 39 K superconductivity`,
      source: {
        name: `phonopy examples (VASP PBE)`,
        href: `https://github.com/phonopy/phonopy/tree/develop/example/MgB2`,
      },
    },
    [`NaCl-gamma.yaml.gz`]: {
      label: `NaCl Γ modes`,
      detail: `Γ-only file with Born charges: the IR spectrum is computed from the eigenvectors and Z* tensors, so the TO mode is the only IR-active peak`,
      born: `NaCl.BORN`,
    },
    [`SiO2-gamma.yaml.gz`]: {
      label: `α-quartz SiO2 Γ modes`,
      detail: `Γ-only file with Born charges and Raman tensors: switch between the IR and Raman spectra and animate the mode behind each peak`,
      source: {
        name: `Phonopy-Spectroscopy`,
        href: `https://github.com/skelton-group/Phonopy-Spectroscopy`,
      },
      born: `SiO2.BORN`,
      raman: `SiO2-raman-tensors.json.gz`,
    },
    [`CO2-gamma.yaml.gz`]: {
      label: `CO2 molecule`,
      detail: `Synthetic analytic fixture: a linear molecule whose bending, symmetric and asymmetric stretch modes are either IR- or Raman-active (mutual exclusion rule)`,
      source: { name: `synthetic`, href: `/reciprocal/ir-raman` },
      born: `CO2.BORN`,
      raman: `CO2-raman-tensors.json.gz`,
    },
  }
  const DEFAULT_FILENAME = Object.keys(FIXTURE_META)[0]

  // Lazy globs keyed by basename: each fixture is a separate chunk fetched on demand rather
  // than ~300 KB of eigenvectors bundled into the page
  type Loaders<Value> = Record<string, () => Promise<Value | { default: Value }>>
  const by_basename = <Value>(loaders: Loaders<Value>): Loaders<Value> =>
    Object.fromEntries(
      Object.entries(loaders).map(([path, loader]) => [glob_basename(path), loader]),
    )
  const mode_loaders = by_basename(
    import.meta.glob<string>(
      [`$site/phonons/ir-raman/*.yaml`, `$site/phonons/ir-raman/*.yaml.gz`],
      { query: `?raw`, import: `default` },
    ),
  )
  const born_loaders = by_basename(
    import.meta.glob<string>(`$site/phonons/ir-raman/*.BORN`, {
      query: `?raw`,
      import: `default`,
    }),
  )
  const raman_loaders = by_basename(
    import.meta.glob<IrRamanOptions>(
      [
        `$site/phonons/ir-raman/*-raman-tensors.json`,
        `$site/phonons/ir-raman/*-raman-tensors.json.gz`,
      ],
      { import: `default` },
    ),
  )
  const loader_for = <Value>(loaders: Loaders<Value>, filename: string) => {
    const loader = loaders[filename]
    if (!loader) {
      throw new Error(
        `Phonon demo fixture '${filename}' not found in src/site/phonons/ir-raman`,
      )
    }
    return loader
  }
  // Fail at module init (i.e. in every test and build) when a fixture file has no metadata
  // or metadata points at a missing file, rather than surfacing a blank picker entry
  const unlisted = Object.keys(mode_loaders).filter((name) => !(name in FIXTURE_META))
  if (unlisted.length > 0) {
    throw new Error(`Phonon fixtures without metadata: ${unlisted.join(`, `)}`)
  }
  for (const [filename, { born, raman }] of Object.entries(FIXTURE_META)) {
    loader_for(mode_loaders, filename)
    if (born) loader_for(born_loaders, born)
    if (raman) loader_for(raman_loaders, raman)
  }

  const fixture_cache = new Map<string, Promise<ModeFixture>>()
  const load_fixture = (filename: string): Promise<ModeFixture> => {
    const cached = fixture_cache.get(filename)
    if (cached) return cached
    const meta = FIXTURE_META[filename]
    const promise = (async (): Promise<ModeFixture> => {
      const [yaml_text, born_text, raman_data] = await Promise.all([
        loader_for(mode_loaders, filename)().then(glob_default),
        meta.born ? loader_for(born_loaders, meta.born)().then(glob_default) : undefined,
        meta.raman ? loader_for(raman_loaders, meta.raman)().then(glob_default) : undefined,
      ])
      const modes = parse_phonon_modes(yaml_text)
      const spectrum = born_text
        ? spectrum_from_phonon_data(modes, parse_born(born_text), raman_data)
        : undefined
      const n_branches = modes.qpoints[0]?.modes.length ?? 0
      const n_qpoints = modes.qpoints.length
      const n_with_eigvecs = modes.qpoints.filter(qpoint_has_eigenvectors).length
      const coverage = `eigenvectors at ${
        n_with_eigvecs < n_qpoints ? `${n_with_eigvecs} of` : `all`
      } ${n_qpoints} q-points`
      const stats = [meta.path, `${modes.n_atoms} atoms`, `${n_branches} branches`, coverage]
        .filter(Boolean)
        .join(` · `)
      const source = meta.source ?? PHONONDB
      return { ...meta, filename, stats, source, dataset: { modes, spectrum, filename } }
    })()
    fixture_cache.set(filename, promise)
    // let a transient network failure be retried on the next click
    promise.catch(() => fixture_cache.delete(filename))
    return promise
  }

  type ExplorerState = {
    selection?: PhononModeSelection
    view?: PhononExplorerView
    amplitude: number
    supercell: Vec3
    fps: number
    show_vectors: boolean
  }
  const initial_state = (dataset: PhononModeDataset): ExplorerState => ({
    selection: default_phonon_mode_selection(dataset.modes),
    view: phonon_explorer_views(dataset.modes, dataset.spectrum)[0],
    amplitude: DEFAULT_PHONON_AMPLITUDE,
    supercell: [...DEFAULT_PHONON_SUPERCELL],
    fps: DEFAULT_PHONON_FPS,
    show_vectors: DEFAULT_PHONON_SHOW_VECTORS,
  })

  // shared by the explorer and the spinner that stands in for it so the page never reflows
  const explorer_height = `height: min(720px, calc(100vh - 110px)); min-height: 640px`
  let selected_filename = $state(DEFAULT_FILENAME)
  // stays on the previous fixture while the next one downloads so the explorer never blanks
  let selected_fixture = $state.raw<ModeFixture>()
  let fixture_loading = $state(false)
  let selection = $state<PhononModeSelection>()
  let view = $state<PhononExplorerView>()
  let amplitude = $state(DEFAULT_PHONON_AMPLITUDE)
  let supercell = $state<Vec3>([...DEFAULT_PHONON_SUPERCELL])
  let fps = $state(DEFAULT_PHONON_FPS)
  let show_vectors = $state(DEFAULT_PHONON_SHOW_VECTORS)
  let uploaded_dataset = $state.raw<PhononModeDataset>()
  let load_error = $state<string>()
  let upload_loading = $state(false)
  let dragover = $state(false)
  let url_initialized = $state(false)
  let selected_meta = $derived(FIXTURE_META[selected_filename])
  let active_dataset = $derived(uploaded_dataset ?? selected_fixture?.dataset)
  let uploaded_detail = $derived(
    uploaded_dataset &&
      `Local upload · ${uploaded_dataset.modes.path_segments.length > 0 ? `bands` : `modes`} and atomic motion`,
  )
  const fixture_files: io.FileInfo[] = Object.entries(FIXTURE_META).map(
    ([name, { label, path }]) => ({
      name,
      url: ``,
      label,
      category: path ? `band path` : `Γ point`,
      category_icon: path ? `📈` : `🎯`,
    }),
  )

  // Monotonic request id so a slow fixture that resolves after a newer click is discarded
  let load_request = 0
  const activate_fixture = async (filename: string): Promise<ModeFixture | undefined> => {
    const request = ++load_request
    selected_filename = filename
    uploaded_dataset = undefined
    load_error = undefined
    fixture_loading = true
    let fixture: ModeFixture | undefined
    let error_message: string | undefined
    try {
      fixture = await load_fixture(filename)
    } catch (error) {
      error_message = `Failed to load ${filename}: ${to_error(error).message}`
    }
    if (request !== load_request) return undefined // superseded by a newer click
    fixture_loading = false
    load_error = error_message
    if (fixture) selected_fixture = fixture
    return fixture
  }

  const number_param = (
    params: URLSearchParams,
    key: string,
    fallback: number,
    min: number,
    max = Infinity,
    integer = false,
  ): number => {
    const token = params.get(key)
    if (!token?.trim()) return fallback
    const value = Number(token)
    const in_range = Number.isFinite(value) && value >= min && value <= max
    return in_range && (!integer || Number.isSafeInteger(value)) ? value : fallback
  }
  const index_param = (params: URLSearchParams, key: string, fallback: number): number =>
    number_param(params, key, fallback + 1, 1, Infinity, true) - 1
  const index_value = (index?: number): string =>
    index === undefined ? `` : String(index + 1)
  const apply_explorer_state = (next_state: ExplorerState): void => {
    ;({ selection, view, amplitude, supercell, fps, show_vectors } = next_state)
  }

  const apply_url_state = async (params: URLSearchParams): Promise<void> => {
    const file_param = params.get(`file`)
    const filename = file_param && file_param in FIXTURE_META ? file_param : DEFAULT_FILENAME
    const fixture = await activate_fixture(filename)
    if (!fixture) return
    const next_state = initial_state(fixture.dataset)
    const default_selection = next_state.selection

    const qpoint_idx = index_param(params, `qpoint`, default_selection?.qpoint_idx ?? 0)
    const mode_idx = index_param(params, `mode`, default_selection?.mode_idx ?? 0)
    if (fixture.dataset.modes.qpoints[qpoint_idx]?.modes[mode_idx]?.eigenvector) {
      next_state.selection = { qpoint_idx, mode_idx }
    }

    const view_param = params.get(`view`)
    const views = phonon_explorer_views(fixture.dataset.modes, fixture.dataset.spectrum)
    next_state.view = views.find((candidate) => candidate === view_param) ?? next_state.view
    next_state.amplitude = number_param(params, `amplitude`, DEFAULT_PHONON_AMPLITUDE, 0.02, 1)
    const supercell_param = params.get(`supercell`)
    if (supercell_param) {
      try {
        next_state.supercell = parse_supercell_scaling(supercell_param)
      } catch {
        next_state.supercell = [...DEFAULT_PHONON_SUPERCELL]
      }
    }
    next_state.fps = number_param(params, `fps`, DEFAULT_PHONON_FPS, 0, 300)
    next_state.show_vectors = bool_from_param(params, `vectors`, DEFAULT_PHONON_SHOW_VECTORS)
    apply_explorer_state(next_state)
    url_initialized = true
  }

  const select_fixture = async (file: io.FileInfo): Promise<void> => {
    // a click supersedes whatever the URL asked for, even if that load is still in flight
    url_initialized = true
    const fixture = await activate_fixture(file.name)
    if (fixture) apply_explorer_state(initial_state(fixture.dataset))
  }

  const handle_file_drop = io.create_file_drop_handler({
    allow: () => true,
    max_files: 1,
    on_drop: (content, filename, metadata) => {
      if (!/\.ya?ml$/i.test(filename)) {
        throw new Error(`expected a .yaml or .yml phonopy mode file, got '${filename}'`)
      }
      const modes = parse_phonon_modes(io.as_text(content))
      uploaded_dataset = { modes, filename: metadata.source_filename ?? filename }
      apply_explorer_state(initial_state(uploaded_dataset))
      load_error = undefined
    },
    on_error: (error) => (load_error = error),
    set_loading: (value) => {
      upload_loading = value
      if (value) [dragover, load_error] = [false, undefined]
    },
  })

  const mode_fixture_url_entries = (fixture: ModeFixture): UrlParamEntry[] => {
    const default_state = initial_state(fixture.dataset)
    return [
      [
        `qpoint`,
        index_value(selection?.qpoint_idx),
        index_value(default_state.selection?.qpoint_idx),
      ],
      [
        `mode`,
        index_value(selection?.mode_idx),
        index_value(default_state.selection?.mode_idx),
      ],
      [`view`, view ?? ``, default_state.view],
      [`amplitude`, String(amplitude), String(DEFAULT_PHONON_AMPLITUDE)],
      [`supercell`, supercell.join(`x`), DEFAULT_PHONON_SUPERCELL.join(`x`)],
      [`fps`, String(fps), String(DEFAULT_PHONON_FPS)],
      bool_url_entry(`vectors`, show_vectors, DEFAULT_PHONON_SHOW_VECTORS),
    ]
  }

  $effect(() => {
    // while a fixture downloads, selection/view still belong to the previous one
    if (!url_initialized || fixture_loading || !selected_fixture) return
    const explorer_entries = mode_fixture_url_entries(selected_fixture).map(
      (entry): UrlParamEntry => (uploaded_dataset ? [entry[0], ``] : entry),
    )
    sync_url_params(
      [[`file`, uploaded_dataset ? `` : selected_fixture.filename], ...explorer_entries],
      globalThis.location,
      (url) =>
        replaceState(
          url,
          untrack(() => page.state),
        ),
    )
  })

  afterNavigate(({ to }) => {
    void apply_url_state(to?.url.searchParams ?? page.url.searchParams)
  })
</script>

<svelte:head>
  <title>Phonon Mode Explorer · MatterViz</title>
  <meta
    name="description"
    content="Explore phonon eigenvectors through synchronized structures, band plots, and vibrational spectra."
  />
</svelte:head>

<header style="margin-block: 1.5em; text-align: center">
  <span>Interactive lattice dynamics</span>
  <h1>Phonon Mode Explorer</h1>
  <p>
    Select a bundled calculation, inspect its structure and dispersion, and animate every
    available eigenvector directly from the band plot.
  </p>
</header>

<section class="fixture-picker bleed-1400" aria-label="Demo fixtures">
  <FilePicker
    files={fixture_files}
    active_files={uploaded_dataset ? [] : [selected_filename]}
    on_click={select_fixture}
    show_category_filters
  />
  <p>
    <span data-testid="phonon-fixture-detail">
      {#if uploaded_detail}
        {uploaded_detail}
      {:else if selected_fixture?.filename === selected_filename}
        {selected_fixture.detail}
        <small
          >{selected_fixture.stats} ·
          <a href={selected_fixture.source.href}>{selected_fixture.source.name}</a></small
        >
      {:else}
        {selected_meta.detail}
      {/if}
    </span>
    <small>{fixture_files.length} bundled fixtures</small>
  </p>
</section>

<section
  class="explorer-shell bleed-1400"
  class:dragover
  aria-busy={upload_loading || fixture_loading}
  ondrop={handle_file_drop}
  {...io.drag_over_handlers({
    allow: () => true,
    set_dragover: (value) => (dragover = value),
  })}
>
  {#if load_error}<StatusMessage bind:message={load_error} type="error" dismissible />{/if}
  {#if active_dataset}
    <PhononModeExplorer
      id="phonon-mode-explorer"
      dataset={active_dataset}
      bind:selection
      bind:view
      bind:amplitude
      bind:supercell
      bind:fps
      bind:show_vectors
      style={explorer_height}
    />
  {:else if !load_error}
    <Spinner
      text="Loading {selected_meta.label}..."
      style="display: flex; justify-content: center; {explorer_height}; --spinner-size: 1.5em"
    />
  {/if}
</section>

<section class="about">
  <div>
    <span>What you are seeing</span>
    <h2>
      {uploaded_dataset?.filename?.replace(/\.ya?ml(?:\.gz)?$/i, ``) ?? selected_meta.label}
    </h2>
    <p>
      The selected eigenvector is rendered in real space using phonopy mass scaling and Bloch
      phases. Γ-only files open directly in the spectrum and mode selectors because they do not
      contain a dispersion path. Larger fixtures store eigenvectors only at every second or
      third q-point to keep downloads small; clicking a band between them snaps to the nearest
      q-point that has one.
    </p>
  </div>
  <div>
    <span>Bring your own calculation</span>
    <h2>Drop in phonopy output</h2>
    <p>
      Drop a single <code>band.yaml</code>, <code>qpoints.yaml</code>, or
      <code>mesh.yaml</code> file onto the explorer. Gzip-compressed variants work too. Files without
      a band path remain explorable through the q-point and mode controls.
    </p>
  </div>
</section>

<p style="margin: 2em auto; text-align: center">
  Band dispersions were recomputed with phonopy from
  <a href="https://doi.org/10.48505/nims.4197">PhononDB (NIMS, PBEsol, CC BY 4.0)</a>
  force constants and Born charges; MgB2 from the
  <a href="https://github.com/phonopy/phonopy/tree/develop/example/MgB2">phonopy example set</a
  >
  (BSD-3, VASP PBE). α-quartz data:
  <a href="https://github.com/skelton-group/Phonopy-Spectroscopy">Phonopy-Spectroscopy</a>; CO2
  is a synthetic fixture. Read the
  <a href="/reciprocal/ir-raman">IR/Raman and phonon data guide</a> for parsing and physics details.
</p>

<style>
  .fixture-picker {
    margin-block: 0.6em 1em;
    p {
      display: flex;
      justify-content: space-between;
      gap: 0.5em 1em;
      margin: 0.5em 0 0;
      small {
        white-space: nowrap;
      }
    }
    [data-testid='phonon-fixture-detail'] small {
      display: block;
      white-space: normal;
      opacity: 0.8;
    }
  }
  .explorer-shell {
    margin-block: 0 2.5em;
    &.dragover {
      outline: 2px dashed var(--accent-color, #4c78a8);
      outline-offset: 3px;
    }
  }
  .about {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(1.5em, 5vw, 4em);
    margin: 2em auto;
  }
  /* Same condition under which PhononModeExplorer stacks its panes: only the stacked layout
     needs to outgrow the fixed height; the side-by-side one must keep it so the panes have a
     definite height to fill */
  @media (max-width: 699px), (max-width: 900px) and (orientation: portrait) {
    :global(.phonon-mode-explorer) {
      height: auto !important;
    }
  }
  @media (max-width: 900px) {
    .fixture-picker p {
      flex-wrap: wrap;
    }
    .about {
      grid-template-columns: 1fr;
    }
  }
</style>
