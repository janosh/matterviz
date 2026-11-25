<script lang="ts">
  import { format_num } from 'svelte-widgets/format'
  import { to_error } from 'svelte-widgets/utils'
  import FilePicker from '#lib/FilePicker.svelte'
  import { file_drop_zone } from '#lib/io/file-drop.js'
  import { IDENTITY_3X3, type Matrix3x3, type Vec2 } from '#lib/math.js'
  import type { Crystal } from '#lib/structure/index.js'
  import { parse_structure_file } from '#lib/structure/parse.js'
  import { is_crystal } from '#lib/structure/validation.js'
  import type { WulffFacetInput, WulffShapeData } from '#lib/wulff/index.js'
  import { parse_surface_energies, WulffFacetEditor, WulffShape } from '#lib/wulff/index.js'
  import { set_url_param, url_param, url_selection } from '#site/state.svelte.js'
  import { decode_facets, encode_facets, oxide_example, wulff_examples } from '#site/wulff.js'
  import { onMount } from 'svelte'

  // a crystal (MP's, or a dropped one) brings its lattice and, via moyo, its point group; without
  // one, the lattice holohedry (illustrative examples, a dropped pymatgen file) expands the families
  type Dataset = {
    label: string
    description: string
    facets: WulffFacetInput[]
    energy_range: Vec2 // slider bounds, J/m²
    delta_mu_range?: Vec2 // eV, for families with a slope
    mp_tolerance?: number // largest |area fraction - MP's|
    illustrative?: boolean
    url?: string // the example's MP document, to drag onto the viewer
    structure?: Crystal
    lattice?: Matrix3x3
  }
  const examples: Dataset[] = [
    ...wulff_examples,
    { ...oxide_example, illustrative: true },
    {
      label: `Cube ↔ octahedron (illustrative)`,
      description: `Made-up energies: γ{111}/γ{100} ≤ 1/√3 gives an octahedron, ≥ √3 a cube, in between a truncated octahedron (a cuboctahedron at 2/√3)`,
      facets: [
        { miller: [1, 0, 0], energy: 1 },
        { miller: [1, 1, 1], energy: 1 },
      ],
      energy_range: [0.3, 2.5],
      illustrative: true,
      lattice: IDENTITY_3X3,
    },
  ]

  const selected = url_selection(
    `example`,
    examples.map(({ label }) => label),
  )
  // writable: a dropped file replaces it until the next pick
  let dataset = $derived(examples.find(({ label }) => label === selected.value) ?? examples[0])
  // writable: slider edits replace them, a pick or drop (or the editor's reset) restores them
  let facets = $derived($state.snapshot(dataset.facets))
  let delta_mu = $state(0)
  let wulff_data = $state<WulffShapeData | null>(null)
  let load_error = $state<string | null>(null)
  const pick = (label: string) => {
    selected.value = label
    dataset = examples.find((example) => example.label === label) ?? examples[0]
    facets = $state.snapshot(dataset.facets) // re-picking the shown example resets it too
    delta_mu = 0
    load_error = null
  }

  // Edits live in ?facets= and ?delta_mu= (written once dragging pauses), so a link shares them
  onMount(() => {
    try {
      const encoded = url_param(`facets`)
      if (encoded) facets = decode_facets(encoded, dataset.facets)
      const mu = Number(url_param(`delta_mu`) ?? 0)
      if (!Number.isFinite(mu)) throw new TypeError(`?delta_mu= must be a number`)
      delta_mu = mu
    } catch (error) {
      load_error = to_error(error).message
    }
  })
  $effect(() => {
    // a dropped file's data can't be linked to
    const shared = examples.includes(dataset)
    const encoded = shared ? encode_facets(facets, dataset.facets) : null
    const mu = shared && delta_mu !== 0 ? String(delta_mu) : null
    const timer = setTimeout(() => {
      set_url_param(`facets`, encoded)
      set_url_param(`delta_mu`, mu)
    }, 300)
    return () => clearTimeout(timer)
  })

  // A dropped MP or pymatgen surface-energy JSON replaces the facets (a pymatgen file also the
  // lattice); a dropped structure file (CIF, POSCAR, ...) the crystal whose point group expands them
  const load_file = (content: string | ArrayBuffer, filename: string) => {
    if (typeof content !== `string`) throw new TypeError(`${filename} is binary`)
    const json: unknown = /\.json$/i.test(filename) ? JSON.parse(content) : null
    if (json && !(typeof json === `object` && `sites` in json)) {
      const { facets: loaded, lattice, label } = parse_surface_energies(json)
      const energies = loaded.map(({ energy }) => energy)
      dataset = {
        label: filename,
        description: `${label ?? filename}: ${loaded.length} families from the dropped file`,
        facets: loaded,
        energy_range: [Math.min(...energies) / 2, Math.max(...energies) * 1.5],
        ...(lattice
          ? { lattice }
          : { lattice: dataset.lattice, structure: dataset.structure }),
      }
    } else {
      const structure = parse_structure_file(content, filename)
      if (!is_crystal(structure)) throw new Error(`${filename} has no lattice`)
      // the dataset's own facets: edits reset, as on every load
      const { label, facets: kept, energy_range, delta_mu_range } = dataset
      const description = `Facets of ${label} on the crystal in the dropped ${filename}`
      dataset = { label, description, facets: kept, energy_range, delta_mu_range, structure }
    }
    load_error = null
  }
</script>

<h1 id="wulff-shapes">Wulff Shapes</h1>

<p class="demo-intro">
  The equilibrium shape of a crystal minimizes its total surface energy at fixed volume.
  Wulff's construction finds it by placing a plane at distance proportional to its surface
  energy γ along every facet normal and keeping their inner envelope. Each Miller family is
  expanded to its symmetry-equivalent planes with the crystal's point group (found by moyo from
  the structure). Drag the γ sliders to watch facets grow, shrink and vanish; add or remove
  families below the table. Drop a Materials Project surface-energy JSON (or pymatgen's
  WulffShape lattice, miller_list and e_surf_list as JSON) onto the viewer to load its
  energies, and a CIF or POSCAR of the conventional cell for its lattice and point group.
</p>

<FilePicker
  files={examples.map(({ label, url }) => ({ name: label, url: url ?? ``, type: `example` }))}
  active_files={[dataset.label]}
  on_click={({ name }) => pick(name)}
  on_drag_start={({ url }, event) => {
    if (!url) event.preventDefault() // an illustrative example has no file to drop
  }}
/>

<p>
  {#if load_error}
    <strong style="color: var(--error-color, crimson)">{load_error}</strong>
  {:else if dataset.illustrative}
    <strong>Illustrative:</strong> {dataset.description}. Not measured or computed data.
  {:else if dataset.mp_tolerance !== undefined}
    {dataset.description}. Surface energies (J/m²): DFT (PBE) values from
    <a href="https://doi.org/10.1038/sdata.2016.80">Tran et al., Sci. Data 3, 160080 (2016)</a>
    via the Materials Project. With these energies, the computed area fractions match the ones the
    Materials Project lists to {format_num(dataset.mp_tolerance, `.0e`)}.
  {:else}
    {dataset.description}.
  {/if}
</p>

<section
  class="demo-2col"
  {@attach file_drop_zone({
    allow: () => true,
    on_drop: load_file,
    on_error: (msg) => (load_error = msg),
  })}
>
  <WulffShape
    {facets}
    {delta_mu}
    lattice={dataset.structure ? undefined : dataset.lattice}
    structure={dataset.structure}
    bind:wulff_data
    style="--wulff-height: 520px"
  />
  <WulffFacetEditor
    bind:facets
    bind:delta_mu
    {wulff_data}
    energy_range={dataset.energy_range}
    delta_mu_range={dataset.delta_mu_range}
    default_facets={dataset.facets}
  />
</section>

<style>
  /* an outline, unlike a border, moves nothing while a file hovers */
  section:global(.dragover) {
    outline: 2px dashed var(--accent-color);
    outline-offset: 4px;
  }
</style>
