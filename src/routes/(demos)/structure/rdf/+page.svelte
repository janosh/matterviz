<script lang="ts">
  import LazyDemo from '#site/LazyDemo.svelte'
  import type { ElementSymbol, Matrix3x3, Vec3 } from '#lib'
  import { calc_lattice_params, scale } from '#lib/math.js'
  import FilePicker from '#lib/FilePicker.svelte'
  import { add_alpha, plot_color } from '#lib/colors/index.js'
  import { highlight_site_union } from '#lib/plot/core/structure-input.js'
  import { PdfPlot, RdfPlot } from '#lib/rdf/index.js'
  import type { RadiationType } from '#lib/scattering/index.js'
  import type { Crystal, Pbc } from '#lib/structure/index.js'
  import { Structure } from '#lib/structure/index.js'
  import { make_site } from '#lib/structure/site.js'
  import { structure_files } from '#site/structures.js'
  import { toggle_item } from '#lib/utils.js'
  import bi2zr2o8 from '#site/structures/Bi2Zr2O8-Fm3m.json'
  import al2lu from '#site/structures/mp-1234.json'
  import palladium from '#site/structures/mp-2.json'

  const structures = {
    'Al₂Lu': al2lu,
    Pd: palladium,
    'Bi₂Zr₂O₈': bi2zr2o8,
  } as unknown as Record<string, Crystal>

  let selected = $state([`Al₂Lu`, `Pd`])
  type RdfMode = `element_pairs` | `full`
  let mode = $state<RdfMode>(`full`)
  let cutoff = $state(7)
  let n_bins = $state(100)

  let pdf_quantity = $state<`g_r` | `reduced_g_r`>(`reduced_g_r`)
  let pdf_radiation = $state<RadiationType>(`xray`)
  let pdf_cutoff = $state(20)
  let pdf_bins = $state(1000)

  const cubic_lattice = (a_len: number) => {
    const matrix: Matrix3x3 = [
      [a_len, 0, 0],
      [0, a_len, 0],
      [0, 0, a_len],
    ]
    return { matrix, pbc: [true, true, true] as Pbc, ...calc_lattice_params(matrix) }
  }

  const cubic_site = (element: ElementSymbol, abc: Vec3, a_len: number) =>
    make_site(element, abc, scale(abc, a_len), element)

  // Rock salt AB: cation on the fcc sublattice, anion shifted by (1/2, 0, 0). The % 1 wraps the
  // two anions that shift past the cell edge, so <Structure> draws them inside the box.
  const rock_salt = (cation: ElementSymbol, anion: ElementSymbol, a_len: number): Crystal => {
    const fcc: Vec3[] = [
      [0, 0, 0],
      [0, 0.5, 0.5],
      [0.5, 0, 0.5],
      [0.5, 0.5, 0],
    ]
    const sites = fcc.flatMap(([face_a, face_b, face_c]) => [
      cubic_site(cation, [face_a, face_b, face_c], a_len),
      cubic_site(anion, [(face_a + 0.5) % 1, face_b, face_c], a_len),
    ])
    return { lattice: cubic_lattice(a_len), sites }
  }

  // b_coh(H) = -3.739 fm is negative, so neutrons see the Ni-H correlation with the opposite
  // sign to x-rays, while the Ni-Ni shell stays positive for both
  const nickel_hydride = rock_salt(`Ni`, `H`, 3.73)

  // Hovering an RDF bin highlights the atom pairs behind it, a legend entry the pair's atoms
  let rdf_highlights = $state.raw(new Map<Crystal, number[]>())

  // Amorphous structure
  let n_atoms = $state(200)
  let box_size = $state(20)
  let amorphous_mode = $state<RdfMode>(`full`)

  const amorphous = $derived.by(() => {
    let seed = 42 + n_atoms
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32
      return seed / 2 ** 32
    }

    const comp = { Si: 1, O: 2, Al: 0.5, Fe: 0.3 }
    const total = Object.values(comp).reduce((sum, count) => sum + count, 0)
    const sites = Object.entries(comp).flatMap(([element, frac]) =>
      Array.from({ length: Math.round((frac / total) * n_atoms) }, () =>
        cubic_site(element as ElementSymbol, [rand(), rand(), rand()], box_size),
      ),
    )
    return { lattice: cubic_lattice(box_size), sites }
  })
</script>

{#snippet structure_rdf(
  structure: Crystal,
  rdf_mode: RdfMode,
  rdf_cutoff: number,
  rdf_bins: number,
)}
  <section class="demo-2col">
    <Structure {structure} highlighted_sites={rdf_highlights.get(structure) ?? []} />
    <RdfPlot
      structures={structure}
      mode={rdf_mode}
      cutoff={rdf_cutoff}
      n_bins={rdf_bins}
      style="height: 100%"
      on_sites_hover={(highlights) => {
        // both ends of the hovered pairs (one structure per section)
        const sites = highlight_site_union(highlights?.[0])
        rdf_highlights = new Map(rdf_highlights).set(structure, sites)
      }}
    />
  </section>
{/snippet}

<h1 id="radial-distribution-functions-rdf">Radial Distribution Functions (RDF)</h1>

<div class="bleed-1400">
  <h2 id="element-pair-rdfs">Element-Pair RDFs</h2>
  <LazyDemo label="Element-Pair RDFs">
    {@render structure_rdf(structures[`Al₂Lu`], `element_pairs`, cutoff, n_bins)}
  </LazyDemo>

  <div class="demo-pairs">
    <section>
      <h2 id="full-rdf">Full RDF</h2>
      <p>All atom pairs pooled into one g(r), regardless of which elements they join.</p>
      <LazyDemo label="Full RDF">
        <RdfPlot
          structures={structures[`Al₂Lu`]}
          mode="full"
          {cutoff}
          {n_bins}
          style="height: 500px"
        />
      </LazyDemo>
    </section>

    <section>
      <h2 id="pair-distribution-function-g-r">Pair Distribution Function G(r)</h2>
      <p>
        The reduced PDF G(r) = 4πrρ₀(g(r) − 1) combines partial RDFs with radiation-dependent
        Faber–Ziman weights, so the curve depends on the probe and follows −4πrρ₀ below the
        closest approach.
      </p>
      <LazyDemo label="Pair Distribution Function G(r)">
        <PdfPlot
          {structures}
          bind:quantity={pdf_quantity}
          bind:radiation={pdf_radiation}
          bind:cutoff={pdf_cutoff}
          bind:n_bins={pdf_bins}
          style="height: 500px"
        />
      </LazyDemo>
    </section>
  </div>

  <h2 id="negative-scattering-length-nih">Negative Scattering Length: NiH</h2>
  <p>
    Switching from X-ray to neutron flips the Ni–H correlation because H has negative b<sub
      >coh</sub
    >, while the Ni–Ni shell stays positive.
  </p>
  <LazyDemo label="Negative Scattering Length: NiH" class="demo-2col">
    <Structure structure={nickel_hydride} />
    <PdfPlot
      structures={nickel_hydride}
      cutoff={10}
      n_bins={1000}
      show_partials
      style="height: 100%"
    />
  </LazyDemo>

  <h2 id="complex-bi₂zr₂o₈">Complex: Bi₂Zr₂O₈</h2>
  <LazyDemo label="Complex: Bi₂Zr₂O₈">
    {@render structure_rdf(structures[`Bi₂Zr₂O₈`], `element_pairs`, cutoff, n_bins)}
  </LazyDemo>

  <h2 id="compare-structures">Compare Structures</h2>
  <div class="demo-controls">
    <!-- in Full RDF mode tinted like the key's series, which follow selection order; element
      pairs get one curve each, colored independently of the structures -->
    {#each Object.keys(structures) as key (key)}
      {@const series_idx = selected.indexOf(key)}
      <button
        class:active={series_idx >= 0}
        onclick={() => (selected = toggle_item(selected, key))}
        style:background={mode === `full` && series_idx >= 0
          ? add_alpha(plot_color(series_idx), 0.125)
          : null}
      >
        {key}
      </button>
    {/each}
    <span class="separator">|</span>
    <button class:active={mode === `element_pairs`} onclick={() => (mode = `element_pairs`)}>
      Element Pairs
    </button>
    <button class:active={mode === `full`} onclick={() => (mode = `full`)}> Full RDF </button>
    <span class="separator">|</span>
    <label
      >Cutoff: <input type="range" min="3" max="12" step="0.5" bind:value={cutoff} />
      <span class="demo-value" style="min-width: 6ch">{cutoff} Å</span></label
    >
    <label
      >Bins: <input type="range" min="30" max="200" bind:value={n_bins} />
      <span class="demo-value">{n_bins}</span></label
    >
  </div>

  <LazyDemo label="Compare Structures">
    <RdfPlot
      structures={Object.fromEntries(selected.map((key) => [key, structures[key]]))}
      {mode}
      {cutoff}
      {n_bins}
      style="height: 500px"
    />
  </LazyDemo>

  <h2 id="amorphous-structure">Amorphous Structure</h2>

  <div class="demo-controls">
    {#each [[`element_pairs`, `Element Pairs`], [`full`, `Full`]] as const as [mode, label] (mode)}
      <button class:active={amorphous_mode === mode} onclick={() => (amorphous_mode = mode)}>
        {label}
      </button>
    {/each}
    <span class="separator">|</span>
    <label
      >Atoms: <input type="range" min="50" max="500" step="50" bind:value={n_atoms} />
      <span class="demo-value">{n_atoms}</span></label
    >
    <label
      >Box: <input type="range" min="15" max="30" bind:value={box_size} />
      <span class="demo-value">{box_size} Å</span></label
    >
  </div>

  <LazyDemo label="Amorphous Structure">
    {@render structure_rdf(amorphous, amorphous_mode, 10, 100)}
  </LazyDemo>

  <h2 id="try-your-own-structure">Try Your Own Structure</h2>
  <FilePicker files={structure_files} show_category_filters style="margin-bottom: 1em" />
  <LazyDemo label="Try Your Own Structure">
    <RdfPlot mode="element_pairs" allow_file_drop cutoff={7} style="height: 500px" />
  </LazyDemo>
</div>

<style>
  p {
    text-align: center;
  }
  .bleed-1400 :global(.demo-2col) {
    gap: 2em;
    min-height: 500px;
    margin-block: 2em;
  }
  .separator {
    color: #ccc;
    user-select: none;
  }
  button {
    padding: 4px 12px;
    border: 1px solid #999;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    &:hover,
    &.active {
      border-color: #4e79a7;
    }
    &.active {
      border-width: 2px;
    }
  }
</style>
