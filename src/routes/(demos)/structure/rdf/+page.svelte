<script lang="ts">
  import type { ElementSymbol, Matrix3x3, Vec3 } from '$lib'
  import FilePicker from '$lib/FilePicker.svelte'
  import { PLOT_COLORS } from '$lib/colors'
  import { PdfPlot, RdfPlot } from '$lib/rdf'
  import type { RadiationType } from '$lib/scattering'
  import type { Crystal, Pbc } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import { structure_files } from '$site/structures'
  import bi2zr2o8 from '$site/structures/Bi2Zr2O8-Fm3m.json'
  import al2lu from '$site/structures/mp-1234.json'
  import pd from '$site/structures/mp-2.json'

  const structures = {
    'Al₂Lu': al2lu,
    Pd: pd,
    'Bi₂Zr₂O₈': bi2zr2o8,
  } as unknown as Record<string, Crystal>

  let selected = $state([`Al₂Lu`, `Pd`])
  let mode = $state<`element_pairs` | `full`>(`full`)
  let cutoff = $state(7)
  let n_bins = $state(100)

  let pdf_quantity = $state<`g_r` | `reduced_g_r`>(`reduced_g_r`)
  let pdf_radiation = $state<RadiationType>(`xray`)
  let pdf_cutoff = $state(20)
  let pdf_bins = $state(1000)

  const cubic_lattice = (a_len: number) => ({
    matrix: [
      [a_len, 0, 0],
      [0, a_len, 0],
      [0, 0, a_len],
    ] as Matrix3x3,
    pbc: [true, true, true] as Pbc,
    a: a_len,
    b: a_len,
    c: a_len,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: a_len ** 3,
  })

  const cubic_site = (element: ElementSymbol, abc: Vec3, a_len: number) => ({
    species: [{ element, occu: 1, oxidation_state: 0 }],
    abc,
    xyz: abc.map((frac) => frac * a_len) as Vec3,
    label: element,
    properties: {},
  })

  // Rock salt AB: cation on the fcc sublattice, anion shifted by (1/2, 0, 0). The % 1 wraps the
  // two anions that shift past the cell edge, so <Structure> draws them inside the box.
  const rock_salt = (cation: ElementSymbol, anion: ElementSymbol, a_len: number): Crystal => {
    const fcc: Vec3[] = [
      [0, 0, 0],
      [0, 0.5, 0.5],
      [0.5, 0, 0.5],
      [0.5, 0.5, 0],
    ]
    const sites = fcc.flatMap(([fa, fb, fc]) => [
      cubic_site(cation, [fa, fb, fc], a_len),
      cubic_site(anion, [(fa + 0.5) % 1, fb, fc], a_len),
    ])
    return { lattice: cubic_lattice(a_len), sites }
  }

  // b_coh(H) = -3.739 fm is negative, so neutrons see the Ni-H correlation with the opposite
  // sign to x-rays, while the Ni-Ni shell stays positive for both
  const nickel_hydride = rock_salt(`Ni`, `H`, 3.73)

  // Amorphous structure
  let n_atoms = $state(200)
  let box_size = $state(20)
  let amorphous_mode = $state<`element_pairs` | `full`>(`full`)

  const amorphous = $derived.by(() => {
    let seed = 42 + n_atoms
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32
      return seed / 2 ** 32
    }

    const comp = { Si: 1, O: 2, Al: 0.5, Fe: 0.3 }
    const total = Object.values(comp).reduce((sum, count) => sum + count, 0)
    const sites: Crystal[`sites`] = []

    for (const [el, frac] of Object.entries(comp)) {
      for (let _ = 0; _ < Math.round((frac / total) * n_atoms); _++) {
        const abc: Vec3 = [rand(), rand(), rand()]
        sites.push(cubic_site(el as ElementSymbol, abc, box_size))
      }
    }
    return { lattice: cubic_lattice(box_size), sites }
  })
</script>

<h1>Radial Distribution Functions (RDF)</h1>

<p>
  g(r) describes the probability of finding an atom at distance r from a reference atom,
  normalized by bulk density. The line at g(r) = 1 represents uniform distribution (ideal gas).
</p>

<div class="bleed-1400">
  <h2>Element-Pair RDFs</h2>
  <p>
    Partial RDFs show correlations between specific element pairs in Al₂Lu: Al-Al, Al-Lu and
    Lu-Lu reveal the crystal structure.
  </p>
  <section class="demo-2col">
    <Structure structure={structures[`Al₂Lu`]} />
    <RdfPlot
      structures={structures[`Al₂Lu`]}
      mode="element_pairs"
      {cutoff}
      {n_bins}
      style="height: 100%"
    />
  </section>

  <h2>Full RDF</h2>
  <p>The full RDF averages all element pairs, like experimental measurements.</p>
  <RdfPlot
    structures={structures[`Al₂Lu`]}
    mode="full"
    {cutoff}
    {n_bins}
    style="height: 500px"
  />

  <h2>Pair Distribution Function G(r)</h2>
  <p>
    The reduced PDF G(r) = 4πrρ₀(g(r) − 1) is what total-scattering experiments refine against.
    Partial g<sub>ab</sub>(r) are combined with Faber–Ziman weights w<sub>ab</sub> = c<sub
      >a</sub
    >c<sub>b</sub>b<sub>a</sub>b<sub>b</sub>/⟨b⟩², so the curve depends on the radiation. Below
    the closest approach G(r) falls on the straight line −4πrρ₀.
  </p>
  <PdfPlot
    {structures}
    bind:quantity={pdf_quantity}
    bind:radiation={pdf_radiation}
    bind:cutoff={pdf_cutoff}
    bind:n_bins={pdf_bins}
    style="height: 500px"
  />

  <h2>Negative Scattering Length: NiH</h2>
  <p>
    Hydrogen has b<sub>coh</sub> = −3.739 fm. In rock-salt NiH the shortest distance (a/2 = 1.865
    Å) is a Ni–H contact, so switching from X-ray to neutron flips that correlation from a peak to
    a trough while the Ni–Ni shell at a/√2 stays positive. Toggle the radiation to see the reversal.
  </p>
  <section class="demo-2col">
    <Structure structure={nickel_hydride} />
    <PdfPlot
      structures={nickel_hydride}
      cutoff={10}
      n_bins={1000}
      show_partials
      style="height: 100%"
    />
  </section>

  <h2>Complex: Bi₂Zr₂O₈</h2>
  <p>
    Cubic oxide structure (Fm3m) with partial occupancy, showing multiple element pairs (Bi-Bi,
    Bi-Zr, Bi-O, Zr-Zr, Zr-O, O-O).
  </p>
  <section class="demo-2col">
    <Structure structure={structures[`Bi₂Zr₂O₈`]} />
    <RdfPlot
      structures={structures[`Bi₂Zr₂O₈`]}
      mode="element_pairs"
      {cutoff}
      {n_bins}
      style="height: 100%"
    />
  </section>

  <h2>Compare Structures</h2>
  <div class="demo-controls">
    {#each Object.keys(structures) as key, idx (key)}
      <button
        class:active={selected.includes(key)}
        onclick={() =>
          (selected = selected.includes(key)
            ? selected.filter((selected_key) => selected_key !== key)
            : [...selected, key])}
        style:background={selected.includes(key) ? `${PLOT_COLORS[idx]}20` : null}
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

  <RdfPlot
    structures={Object.fromEntries(
      selected.map((key) => [key, structures[key as keyof typeof structures]]),
    )}
    {mode}
    {cutoff}
    {n_bins}
    style="height: 500px"
  />

  <h2>Amorphous Structure</h2>
  <p>
    Random atomic positions (Si-O-Al-Fe) show broad peaks vs sharp crystalline peaks.
    Increasing atoms shows g(r) → 1 at large distances.
  </p>

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

  <section class="demo-2col">
    <Structure structure={amorphous} />
    <RdfPlot
      structures={amorphous}
      mode={amorphous_mode}
      cutoff={10}
      n_bins={100}
      style="height: 100%"
    />
  </section>

  <h2>Try Your Own Structure</h2>
  <p>Pick a file below or drag &amp; drop onto the plot.</p>
  <FilePicker files={structure_files} show_category_filters style="margin-bottom: 1em" />
  <RdfPlot mode="element_pairs" enable_drop cutoff={7} style="height: 500px" />
</div>

<style>
  .bleed-1400 > section {
    margin: 2em 0;
  }
  h2,
  p {
    text-align: center;
  }
  .demo-2col {
    gap: 2em;
    min-height: 500px;
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
