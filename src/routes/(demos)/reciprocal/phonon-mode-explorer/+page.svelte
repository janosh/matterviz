<script lang="ts">
  import { afterNavigate, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import FilePicker from '$lib/FilePicker.svelte'
  import { StatusMessage } from '$lib/feedback'
  import * as io from '$lib/io'
  import type { Vec3 } from '$lib/math'
  import {
    DEFAULT_PHONON_AMPLITUDE,
    DEFAULT_PHONON_FPS,
    DEFAULT_PHONON_SUPERCELL,
    PhononModeExplorer,
    default_phonon_mode_selection,
    phonon_explorer_views,
    parse_born,
    parse_phonon_modes,
    spectrum_from_phonon_data,
    type PhononExplorerView,
    type IrRamanOptions,
    type PhononModeDataset,
    type PhononModeSelection,
  } from '$lib/spectral'
  import { parse_supercell_scaling } from '$lib/structure'
  import {
    bool_from_param,
    bool_url_entry,
    sync_url_params,
    type UrlParamEntry,
  } from '$lib/url-params'
  import { untrack } from 'svelte'

  type ModeFixture = {
    filename: string
    label: string
    detail: string
    dataset: PhononModeDataset
  }
  const mode_modules = import.meta.glob<string>(
    [`$site/phonons/ir-raman/*.yaml`, `$site/phonons/ir-raman/*.yaml.gz`],
    { eager: true, query: `?raw`, import: `default` },
  )
  const born_modules = import.meta.glob<string>(`$site/phonons/ir-raman/*.BORN`, {
    eager: true,
    query: `?raw`,
    import: `default`,
  })
  const raman_modules = import.meta.glob<IrRamanOptions>(
    [
      `$site/phonons/ir-raman/*-raman-tensors.json`,
      `$site/phonons/ir-raman/*-raman-tensors.json.gz`,
    ],
    { eager: true, import: `default` },
  )

  const fixtures: ModeFixture[] = Object.entries(mode_modules)
    .map(([path, yaml]): ModeFixture => {
      const filename = path.split(`/`).at(-1) ?? path
      const stem = filename.replace(/\.yaml(?:\.gz)?$/, ``)
      const material = /^(?<material>.+?)-gamma/i.exec(stem)?.groups?.material ?? stem
      const mode_data = parse_phonon_modes(yaml)
      const born = Object.entries(born_modules).find(([born_path]) =>
        born_path.endsWith(`/${material}.BORN`),
      )?.[1]
      const raman_data = Object.entries(raman_modules).find(([raman_path]) =>
        raman_path.includes(`/${material}-raman-tensors.json`),
      )?.[1]
      const spectrum = born
        ? spectrum_from_phonon_data(mode_data, parse_born(born), raman_data)
        : undefined
      const has_band_path = mode_data.path_segments.length > 0
      const path_label = stem
        .replace(`${material}-`, ``)
        .replace(/-band$/, ``)
        .replaceAll(/gamma/gi, `Γ`)
        .replaceAll(`-`, ` → `)
      const label = has_band_path ? `${material} · ${path_label}` : `${material} · Γ modes`
      const contents = has_band_path
        ? `bands, spectra, and atomic motion`
        : `Γ-point spectra and atomic motion`
      const provenance = material === `CO2` ? `synthetic analytic` : `first-principles`
      return {
        filename,
        label,
        dataset: { modes: mode_data, spectrum, filename },
        detail: `Interactive ${contents} · ${provenance} fixture`,
      }
    })
    .toSorted((fixture_a, fixture_b) => {
      const band_difference =
        Number(fixture_b.dataset.modes.path_segments.length > 0) -
        Number(fixture_a.dataset.modes.path_segments.length > 0)
      return band_difference || fixture_a.label.localeCompare(fixture_b.label)
    })

  const default_fixture =
    fixtures.find(({ filename }) => filename === `NaCl-Gamma-X-band.yaml`) ?? fixtures[0]
  if (!default_fixture) throw new Error(`No phonon demo fixtures found`)

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
    show_vectors: true,
  })

  const default_explorer_state = initial_state(default_fixture.dataset)
  let selected_fixture = $state.raw(default_fixture)
  let selection = $state(default_explorer_state.selection)
  let view = $state(default_explorer_state.view)
  let amplitude = $state(default_explorer_state.amplitude)
  let supercell = $state(default_explorer_state.supercell)
  let fps = $state(default_explorer_state.fps)
  let show_vectors = $state(default_explorer_state.show_vectors)
  let uploaded_dataset = $state.raw<PhononModeDataset>()
  let upload_error = $state<string>()
  let upload_loading = $state(false)
  let dragover = $state(false)
  let url_initialized = $state(false)
  let uploaded_detail = $derived.by(() => {
    if (!uploaded_dataset) return undefined
    const has_band_path = uploaded_dataset.modes.path_segments.length > 0
    return `Local upload · ${has_band_path ? `bands and atomic motion` : `modes and atomic motion`}`
  })
  const fixture_files: io.FileInfo[] = fixtures.map((fixture) => ({
    name: fixture.filename,
    url: ``,
    category: `animated eigenvectors`,
    category_icon: `🎞️`,
  }))

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

  const apply_url_state = (params: URLSearchParams): void => {
    const fixture =
      fixtures.find(({ filename }) => filename === params.get(`file`)) ?? default_fixture
    selected_fixture = fixture
    uploaded_dataset = undefined
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
    next_state.show_vectors = bool_from_param(params, `vectors`, true)
    apply_explorer_state(next_state)
  }

  const select_fixture = (file: io.FileInfo): void => {
    const fixture = fixtures.find(({ filename }) => filename === file.name)
    if (!fixture) throw new Error(`Unknown phonon fixture '${file.name}'`)
    uploaded_dataset = undefined
    selected_fixture = fixture
    apply_explorer_state(initial_state(fixture.dataset))
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
      upload_error = undefined
    },
    on_error: (error) => (upload_error = error),
    set_loading: (value) => {
      upload_loading = value
      if (value) [dragover, upload_error] = [false, undefined]
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
      bool_url_entry(`vectors`, show_vectors, true),
    ]
  }

  $effect(() => {
    if (!url_initialized) return
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
    apply_url_state(to?.url.searchParams ?? page.url.searchParams)
    url_initialized = true
  })
</script>

<svelte:head>
  <title>Phonon Mode Explorer · MatterViz</title>
  <meta
    name="description"
    content="Explore phonon eigenvectors through synchronized structures, band plots, and vibrational spectra."
  />
</svelte:head>

<header class="hero">
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
    active_files={uploaded_dataset ? [] : [selected_fixture.filename]}
    on_click={select_fixture}
  />
  <p>
    <span data-testid="phonon-fixture-detail"
      >{uploaded_detail ?? selected_fixture.detail}</span
    >
    <small>{fixtures.length} bundled fixtures</small>
  </p>
</section>

<section
  class="explorer-shell bleed-1400"
  class:dragover
  aria-busy={upload_loading}
  ondrop={handle_file_drop}
  {...io.drag_over_handlers({
    allow: () => true,
    set_dragover: (value) => (dragover = value),
  })}
>
  {#if upload_error}<StatusMessage bind:message={upload_error} type="error" dismissible />{/if}
  <PhononModeExplorer
    id="phonon-mode-explorer"
    dataset={uploaded_dataset ?? selected_fixture.dataset}
    bind:selection
    bind:view
    bind:amplitude
    bind:supercell
    bind:fps
    bind:show_vectors
    style="height: min(720px, calc(100vh - 110px)); min-height: 640px"
  />
</section>

<section class="about">
  <div>
    <span>What you are seeing</span>
    <h2>
      {uploaded_dataset?.filename?.replace(/\.ya?ml(?:\.gz)?$/i, ``) ?? selected_fixture.label}
    </h2>
    <p>
      The selected eigenvector is rendered in real space using phonopy mass scaling and Bloch
      phases. Γ-only files open directly in the spectrum and mode selectors because they do not
      contain a dispersion path.
    </p>
  </div>
  <div>
    <span>Bring your own calculation</span>
    <h2>Drop in phonopy output</h2>
    <p>
      Choose an animated fixture, then drop a single <code>band.yaml</code>,
      <code>qpoints.yaml</code>, or <code>mesh.yaml</code> file onto the explorer. Gzip-compressed
      variants work too. Files without a band path remain explorable through the q-point and mode
      controls.
    </p>
  </div>
</section>

<p class="attribution">
  Animated NaCl data: PhononDB PBEsol,
  <a href="https://doi.org/10.48505/nims.4197">DOI 10.48505/nims.4197</a>. α-quartz data:
  Phonopy-Spectroscopy. Read the
  <a href="/reciprocal/ir-raman">IR/Raman and phonon data guide</a> for parsing and physics details.
</p>

<style>
  .hero {
    display: grid;
    justify-items: center;
    gap: 0.45em;
    max-width: 860px;
    margin: clamp(0.8em, 2vw, 1.5em) auto clamp(0.8em, 1.5vw, 1.2em);
    text-align: center;
    h1 {
      margin: 0;
      font-size: clamp(2.3rem, 5vw, 4rem);
      line-height: 0.98;
      letter-spacing: -0.045em;
    }
    p {
      max-width: 760px;
      margin: 0.2em 0 0;
      color: var(--text-color-muted, #5f6878);
      font-size: clamp(1rem, 1.7vw, 1.12rem);
      line-height: 1.45;
    }
  }
  .hero > span,
  .about span {
    color: var(--accent-color, #2878c8);
    font-size: 0.76em;
    font-weight: 750;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .fixture-picker {
    margin-block: 0.6em 1em;
    :global(.file-picker) {
      gap: 0.35em;
    }
    :global(.file-item.active) {
      border-color: var(--accent-color, #2878c8);
      background: color-mix(in srgb, var(--accent-color, #2878c8) 10%, transparent);
      box-shadow: none;
    }
    p {
      display: flex;
      justify-content: space-between;
      gap: 0.5em 1em;
      margin: 0.5em 0 0;
      color: var(--text-color-muted, #657083);
      font-size: 0.78em;
      small {
        white-space: nowrap;
      }
    }
  }
  .explorer-shell {
    position: relative;
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
    margin: 3em auto 1.5em;
    h2 {
      margin: 0.25em 0 0.45em;
      text-align: left;
    }
    p {
      margin: 0;
      color: var(--text-color-muted, #5f6878);
      line-height: 1.65;
    }
  }
  .attribution {
    margin: 2.5em auto 4em;
    color: var(--text-color-muted, #5f6878);
    font-size: 0.85em;
    text-align: center;
  }
  @media (max-width: 900px) {
    :global(.phonon-mode-explorer) {
      height: auto !important;
    }
    .fixture-picker p {
      flex-wrap: wrap;
    }
    .about {
      grid-template-columns: 1fr;
    }
  }
</style>
