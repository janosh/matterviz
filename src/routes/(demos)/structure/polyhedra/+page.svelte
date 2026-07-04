<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import { DEFAULTS } from '$lib/settings'
  import type { AnyStructure, Molecule } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import { parse_any_structure } from '$lib/structure/parse'
  import type { Vec3 } from '$lib/math'
  import { structure_file_text } from '$site/structures'
  import batio3_poscar from '$site/structures/BaTiO3-tetragonal.poscar?raw'
  import lifepo4_cif from '$site/structures/LiFePO4.cif?raw'
  import nacl_poscar from '$site/structures/NaCl-cubic.poscar?raw'
  import rutile_cif from '$site/structures/TiO2.cif?raw'
  import { onMount } from 'svelte'

  // Load any site structure fixture via ?file=<name> URL param (e.g.
  // /structure/polyhedra?file=LiFePO4.cif) - handy for visual testing
  let url_structure = $derived.by(() => {
    // ?file=/?supercell= are a dev-only convenience; url.searchParams is off-limits during
    // prerender (would 500 the static build), so only read them client-side
    if (!browser) return null
    const file_param = page.url.searchParams.get(`file`)
    if (!file_param) return null
    const text = structure_file_text(file_param)
    if (!text) return null
    try {
      return parse_any_structure(text, file_param)
    } catch {
      return null
    }
  })

  type Example = {
    id: string
    label: string
    description: string
    structure: AnyStructure
    supercell?: string
  }

  const parse = (content: string, filename: string): AnyStructure => {
    const structure = parse_any_structure(content, filename)
    if (!structure) throw new Error(`Failed to parse ${filename}`)
    return structure
  }

  const examples: Example[] = [
    {
      id: `NaCl`,
      label: `NaCl (rocksalt)`,
      description: `Na⁺ octahedrally coordinated by 6 Cl⁻. Boundary octahedra are
        completed by image atoms, so the framework fills the cell out to its surfaces.`,
      structure: parse(nacl_poscar, `NaCl-cubic.poscar`),
      supercell: `2x2x2`,
    },
    {
      id: `rutile`,
      label: `TiO₂ (rutile)`,
      description: `Edge-sharing TiO₆ octahedra forming chains along the c-axis,
        linked by corners into the rutile framework.`,
      structure: parse(rutile_cif, `TiO2.cif`),
      supercell: `2x2x2`,
    },
    {
      id: `BaTiO3`,
      label: `BaTiO₃ (perovskite)`,
      description: `B-site TiO₆ octahedra. The large Ba A-site cations are spectator
        cations: their polyhedra are hidden by default to keep the framework visible.
        Toggle Ba below to draw them anyway.`,
      structure: parse(batio3_poscar, `BaTiO3-tetragonal.poscar`),
      supercell: `2x2x2`,
    },
    {
      id: `LiFePO4`,
      label: `LiFePO₄ (olivine)`,
      description: `The iconic olivine framework: corner-sharing PO₄ tetrahedra and
        FeO₆ octahedra, with spectator Li⁺ shown as plain spheres in the diffusion
        channels.`,
      structure: parse(lifepo4_cif, `LiFePO4.cif`),
    },
  ]

  let active_id = $state(examples[0].id)
  let active = $derived(examples.find((ex) => ex.id === active_id) ?? examples[0])
  let supercell_scaling = $state(examples[0].supercell ?? `1x1x1`)
  // ?supercell=2x2x2 overrides; ?file= structures default to 1x1x1. Read client-side only
  // (prerender forbids url.searchParams) and once on mount so it doesn't fight user changes.
  onMount(() => {
    const supercell = page.url.searchParams.get(`supercell`)
    if (supercell) supercell_scaling = supercell
    else if (page.url.searchParams.get(`file`)) supercell_scaling = `1x1x1`
  })
  let scene_props = $state({
    show_polyhedra: `crystals` as const,
    polyhedra_opacity: DEFAULTS.structure.polyhedra_opacity,
    polyhedra_show_edges: true,
    polyhedra_hide_center_atoms: false,
    polyhedra_excluded_elements: [] as string[],
    polyhedra_included_elements: [] as string[],
  })

  function select_example(example: Example) {
    active_id = example.id
    supercell_scaling = example.supercell ?? `1x1x1`
    scene_props.polyhedra_excluded_elements = []
    scene_props.polyhedra_included_elements = []
  }

  // Octahedral SF6 molecule (S-F bond length 1.56 Å) to show polyhedra
  // also work without a lattice when show_polyhedra is 'always' or 'molecules'
  const sf6: Molecule = {
    sites: [
      {
        species: [{ element: `S`, occu: 1, oxidation_state: 6 }],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `S`,
        properties: {},
      },
      ...(
        [
          [1.56, 0, 0],
          [-1.56, 0, 0],
          [0, 1.56, 0],
          [0, -1.56, 0],
          [0, 0, 1.56],
          [0, 0, -1.56],
        ] as const
      ).map((xyz, idx) => ({
        species: [{ element: `F` as const, occu: 1, oxidation_state: -1 }],
        abc: [0, 0, 0] as Vec3,
        xyz: [...xyz] as Vec3,
        label: `F${idx + 1}`,
        properties: {},
      })),
    ],
    charge: 0,
    id: `SF6`,
  }

  // stable reference so the bindable scene_props prop doesn't churn on every render
  const sf6_scene_props = { show_polyhedra: `always` as const, polyhedra_opacity: 0.5 }
</script>

<h1>Coordination Polyhedra</h1>

<p>
  Coordination polyhedra are drawn as convex hulls of anion neighbors around cation-like
  centers, following VESTA-style conventions: vertices must be non-metal neighbors more
  electronegative than the center, lying within 30% of the shortest such bond (so noisy
  over-long bonds don't inflate e.g. PO₄ tetrahedra). To keep the structural framework
  readable, spectator A-site cations (alkali metals, Ca/Sr/Ba), very high-coordination hulls
  (CN &gt; 8), and weakly-bound lone-pair cations (e.g. Bi³⁺) are skipped whenever framework
  polyhedra exist — toggle any element back on via the Centers checkboxes in the controls pane.
  Vertices come from the same bond graph as the rendered bonds, so polyhedra respect the
  bonding strategy, bond edits, and hidden elements, and boundary-truncated copies in
  supercells are skipped automatically.
</p>

<div class="bleed-1400">
  <nav>
    {#each examples as example (example.id)}
      {@const selected = example.id === active_id}
      <button class:selected onclick={() => select_example(example)}>
        {example.label}
      </button>
    {/each}
  </nav>

  <p class="description">{active.description}</p>

  <div class="controls">
    <label>
      Opacity
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        bind:value={scene_props.polyhedra_opacity}
      />
    </label>
    <label>
      <input type="checkbox" bind:checked={scene_props.polyhedra_show_edges} />
      Edges
    </label>
    <label>
      <input type="checkbox" bind:checked={scene_props.polyhedra_hide_center_atoms} />
      Hide center atoms
    </label>
    {#if active_id === `BaTiO3`}
      <label>
        <input
          type="checkbox"
          checked={scene_props.polyhedra_included_elements.includes(`Ba`)}
          onchange={() => {
            const included = scene_props.polyhedra_included_elements
            scene_props.polyhedra_included_elements = included.includes(`Ba`)
              ? included.filter((elem) => elem !== `Ba`)
              : [...included, `Ba`]
          }}
        />
        Ba polyhedra
      </label>
    {/if}
  </div>

  {#key url_structure ?? active_id}
    <Structure
      structure={url_structure ?? active.structure}
      bind:supercell_scaling
      bind:scene_props
      style="height: 600px"
    />
  {/key}
</div>

<h2>Molecules</h2>

<p>
  Polyhedra default to crystals only (<code>show_polyhedra: 'crystals'</code>) but also work
  for molecules when set to <code>'always'</code> or <code>'molecules'</code>, like this SF₆
  octahedron. Methane shows none: carbon is <em>more</em> electronegative than hydrogen, so CH₄ is
  not treated as a coordination environment.
</p>

<Structure
  structure={sf6}
  scene_props={sf6_scene_props}
  style="height: 400px; max-width: 600px; margin-inline: auto"
/>

<style>
  nav {
    display: flex;
    flex-wrap: wrap;
    place-content: center;
    gap: 6px;
    margin: 1em;
  }
  nav button {
    font-size: 0.9em;
    padding: 6px 10px;
    background: color-mix(in srgb, var(--nav-link-bg) 40%, transparent);
  }
  nav button.selected {
    outline: 1px solid var(--accent-color, #4e79a7);
  }
  .description {
    text-align: center;
    color: var(--text-color-muted);
    margin: 0.5em auto;
    max-width: 50em;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    place-content: center;
    gap: 1.5em;
    margin: 0.5em 0 1em;
  }
  .controls label {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }
</style>
