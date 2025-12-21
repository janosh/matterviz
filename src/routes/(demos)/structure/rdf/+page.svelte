<script lang="ts">
  import type { ElementSymbol, Matrix3x3 } from '$lib'
  import { PLOT_COLORS } from '$lib/colors'
  import { RdfPlot } from '$lib/rdf'
  import type { Crystal, Pbc } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import bi2zr2o8 from '$site/structures/Bi2Zr2O8-Fm3m.json'
  import nacl from '$site/structures/mp-1234.json'
  import pd from '$site/structures/mp-2.json'

  const structures = {
    NaCl: nacl,
    Pd: pd,
    'Bi₂Zr₂O₈': bi2zr2o8,
  } as unknown as Record<string, Crystal>

  let selected = $state([`NaCl`, `Pd`])
  let mode = $state<`element_pairs` | `full`>(`full`)
  let cutoff = $state(7)
  let n_bins = $state(100)

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
    const total = Object.values(comp).reduce((s, v) => s + v, 0)
    const sites: Crystal[`sites`] = []

    for (const [el, frac] of Object.entries(comp)) {
      for (let _ = 0; _ < Math.round((frac / total) * n_atoms); _++) {
        const x = rand() * box_size
        const y = rand() * box_size
        const z = rand() * box_size
        sites.push({
          species: [{ element: el as ElementSymbol, occu: 1, oxidation_state: 0 }],
          xyz: [x, y, z],
          abc: [x / box_size, y / box_size, z / box_size],
          label: el,
          properties: {},
        })
      }
    }

    const lattice = {
      matrix: [[box_size, 0, 0], [0, box_size, 0], [0, 0, box_size]] as Matrix3x3,
      pbc: [true, true, true] as Pbc,
      a: box_size,
      b: box_size,
      c: box_size,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: box_size ** 3,
    }
    return { lattice, sites }
  })
</script>

<h1>Radial Distribution Functions (RDF)</h1>

<p>
  g(r) describes the probability of finding an atom at distance r from a reference atom,
  normalized by bulk density. The line at g(r) = 1 represents uniform distribution (ideal
  gas).
</p>

<div class="bleed-1400">
  <h2>Element-Pair RDFs</h2>
  <p>
    Partial RDFs show correlations between specific element pairs in NaCl: Na-Na, Na-Cl,
    and Cl-Cl reveal the crystal structure.
  </p>
  <section class="grid">
    <Structure structure={structures.NaCl} />
    <RdfPlot
      structures={structures.NaCl}
      mode="element_pairs"
      {cutoff}
      {n_bins}
      style="height: 100%"
    />
  </section>

  <h2>Full RDF</h2>
  <p>The full RDF averages all element pairs, like experimental measurements.</p>
  <RdfPlot
    structures={structures.NaCl}
    mode="full"
    {cutoff}
    {n_bins}
    style="height: 500px"
  />

  <h2>Complex: Bi₂Zr₂O₈</h2>
  <p>
    Cubic oxide structure (Fm3m) with partial occupancy, showing multiple element pairs
    (Bi-Bi, Bi-Zr, Bi-O, Zr-Zr, Zr-O, O-O).
  </p>
  <section class="grid">
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
  <nav>
    {#each Object.keys(structures) as key, idx (key)}
      <button
        class:active={selected.includes(key)}
        onclick={() => (selected = selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key])}
        style:background={selected.includes(key) ? `${PLOT_COLORS[idx]}20` : null}
      >
        {key}
      </button>
    {/each}
  </nav>

  <nav>
    <button
      class:active={mode === `element_pairs`}
      onclick={() => (mode = `element_pairs`)}
    >
      Element Pairs
    </button>
    <button class:active={mode === `full`} onclick={() => (mode = `full`)}>
      Full RDF
    </button>
  </nav>

  <div class="controls">
    <label>Cutoff: <input type="range" min="3" max="12" step="0.5" bind:value={cutoff} />
      {cutoff} Å</label>
    <label>Bins: <input type="range" min="30" max="200" bind:value={n_bins} /> {
        n_bins
      }</label>
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

  <div class="controls">
    <label>Atoms: <input type="range" min="50" max="500" step="50" bind:value={n_atoms} />
      {n_atoms}</label>
    <label>Box: <input type="range" min="15" max="30" bind:value={box_size} /> {box_size}
      Å</label>
  </div>

  <nav>
    {#each [[`element_pairs`, `Element Pairs`], [`full`, `Full`]] as const as
      [mode, label]
      (mode)
    }
      <button
        class:active={amorphous_mode === mode}
        onclick={() => (amorphous_mode = mode)}
      >
        {label}
      </button>
    {/each}
  </nav>

  <section class="grid">
    <Structure structure={amorphous} />
    <RdfPlot
      structures={amorphous}
      mode={amorphous_mode}
      cutoff={10}
      n_bins={100}
      style="height: 100%"
    />
  </section>

  <h2>Drag & Drop</h2>
  <RdfPlot mode="element_pairs" enable_drop cutoff={7} style="height: 500px" />
</div>

<style>
  .bleed-1400 > section {
    margin: 2em 0;
  }
  h2, p {
    text-align: center;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2em;
    min-height: 500px;
  }
  @media (max-width: 1024px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    place-content: center;
    gap: 8px;
    margin: 1em 0;
  }
  button {
    padding: 8px 16px;
    border: 1px solid #999;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
  }
  button:hover {
    border-color: #4e79a7;
  }
  button.active {
    border-color: #4e79a7;
    border-width: 2px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    place-content: center;
  }
</style>
