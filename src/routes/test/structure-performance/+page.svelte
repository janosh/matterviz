<script lang="ts">
  import { goto } from '$app/navigation'
  import type { ElementSymbol, Vec3, Crystal } from '#lib'
  import Spinner from 'svelte-widgets/Spinner.svelte'
  import Structure from '#lib/structure/Structure.svelte'
  import { SETTINGS_CONFIG, SHOW_BONDS_OPTIONS } from '#lib/settings.js'
  import type { BondingStrategy } from '#lib/structure/bonding.js'
  import type { ComponentProps } from 'svelte'

  let atom_count = $state(100)
  let show_atoms = $state(true)
  let show_bonds = $state<`always` | `never` | `crystals` | `molecules`>(`crystals`)
  let show_site_labels = $state(false)
  let show_site_indices = $state(false)
  let show_image_atoms = $state(true)
  let sphere_segments = $state(16)
  let supercell_scaling = $state(`1x1x1`)
  let performance_mode = $state<`quality` | `speed`>(`quality`)
  let bonding_strategy = $state<BondingStrategy>(`electroneg_ratio`)
  let force_large_structure = $state(false)
  let is_generating = $state(false)
  let test_structure = $state<Crystal | undefined>(undefined)

  let scene_props = $derived<ComponentProps<typeof Structure>[`scene_props`]>({
    show_atoms,
    show_bonds,
    show_site_labels,
    show_site_indices,
    sphere_segments,
    bonding_strategy,
    bonding_options: { force_large_structure },
  })

  // Cubic cell with `count` atoms on a slightly jittered grid, cycling through a few elements
  function generate_structure(count: number): Crystal {
    const sites_per_edge = Math.ceil(Math.cbrt(count))
    const lattice_size = sites_per_edge * 3
    const lattice = {
      matrix: [
        [lattice_size, 0, 0],
        [0, lattice_size, 0],
        [0, 0, lattice_size],
      ] as [Vec3, Vec3, Vec3],
      a: lattice_size,
      b: lattice_size,
      c: lattice_size,
      alpha: 90,
      beta: 90,
      gamma: 90,
      pbc: [true, true, true] as [boolean, boolean, boolean],
      volume: lattice_size ** 3,
    }

    const spacing = 1 / (sites_per_edge + 1)
    const to_frac = (grid_idx: number) =>
      (grid_idx + 1) * spacing + (Math.random() - 0.5) * (0.1 / lattice_size)
    const elements: ElementSymbol[] = [`H`, `C`, `N`, `O`, `Fe`, `Cu`, `Si`, `Al`]
    const species_cache = elements.map((element) => [
      { element, occu: 1.0, oxidation_state: 0 },
    ])

    const sites: Crystal[`sites`] = Array.from({ length: count }, (_, idx) => {
      const abc: Vec3 = [
        to_frac(idx % sites_per_edge),
        to_frac(Math.trunc(idx / sites_per_edge) % sites_per_edge),
        to_frac(Math.trunc(idx / sites_per_edge ** 2)),
      ]
      const element_idx = idx % elements.length
      return {
        species: species_cache[element_idx],
        abc,
        xyz: [abc[0] * lattice_size, abc[1] * lattice_size, abc[2] * lattice_size],
        label: `${elements[element_idx]}${idx + 1}`,
        properties: {},
      }
    })

    return { lattice, sites, charge: 0 } as Crystal
  }

  async function generate_structure_async(count: number): Promise<void> {
    is_generating = true
    await new Promise((resolve) => setTimeout(resolve, 0))
    test_structure = generate_structure(count)
    is_generating = false
  }

  $effect(() => {
    if (typeof window === `undefined`) return
    const params = new URLSearchParams(globalThis.location.search)

    const parse_int = (key: string, min: number, max: number, fallback: number) => {
      const val = params.get(key)
      if (!val) return fallback
      const parsed = Math.trunc(Number(val))
      return !isNaN(parsed) && parsed >= min && parsed <= max ? parsed : fallback
    }
    const parse_bool = (key: string, fallback: boolean) => {
      const val = params.get(key)
      return val === null ? fallback : val === `true`
    }
    const parse_enum = <T extends string>(
      key: string,
      options: readonly string[],
      fallback: T,
    ) => {
      const val = params.get(key)
      return val && options.includes(val) ? (val as T) : fallback
    }

    atom_count = parse_int(`atoms`, 1, 50000, atom_count)
    sphere_segments = parse_int(`sphere_segments`, 3, 64, sphere_segments)
    supercell_scaling = params.get(`supercell`) || supercell_scaling
    performance_mode = parse_enum(`performance_mode`, [`quality`, `speed`], performance_mode)
    bonding_strategy = parse_enum(
      `bonding_strategy`,
      Object.keys(SETTINGS_CONFIG.structure.bonding_strategy.enum ?? {}),
      bonding_strategy,
    )
    show_bonds = parse_enum(`show_bonds`, SHOW_BONDS_OPTIONS, show_bonds)
    show_atoms = parse_bool(`show_atoms`, show_atoms)
    show_site_labels = parse_bool(`show_site_labels`, show_site_labels)
    show_site_indices = parse_bool(`show_site_indices`, show_site_indices)
    show_image_atoms = parse_bool(`show_image_atoms`, show_image_atoms)
    force_large_structure = parse_bool(`force_large_structure`, force_large_structure)
    // Initial generation after URL params are loaded
    generate_structure_async(atom_count)
  })

  function update_url() {
    if (typeof window === `undefined`) return
    const params = new URLSearchParams({
      atoms: `${atom_count}`,
      show_atoms: `${show_atoms}`,
      show_bonds,
      show_site_labels: `${show_site_labels}`,
      show_site_indices: `${show_site_indices}`,
      show_image_atoms: `${show_image_atoms}`,
      sphere_segments: `${sphere_segments}`,
      supercell: supercell_scaling,
      performance_mode,
      bonding_strategy,
      force_large_structure: `${force_large_structure}`,
    })
    void goto(`?${params}`, { shallow: true, replace: true })
  }

  const regenerate = () => {
    update_url()
    generate_structure_async(atom_count)
  }
</script>

<h1 id="structure-performance-test">Structure Performance Test</h1>

<div class="controls">
  <label>
    Atoms:
    <input
      type="number"
      bind:value={atom_count}
      min="1"
      max="50000"
      step="100"
      onchange={regenerate}
    />
  </label>

  <label>
    Supercell:
    <input
      type="text"
      bind:value={supercell_scaling}
      placeholder="2x2x2"
      onchange={update_url}
    />
  </label>

  <label>
    Mode:
    <select bind:value={performance_mode} onchange={update_url}>
      <option value="quality">Quality</option>
      <option value="speed">Speed</option>
    </select>
  </label>

  <label>
    Segments:
    <input type="number" bind:value={sphere_segments} min="3" max="64" onchange={update_url} />
  </label>

  <label>
    Bonding:
    <select bind:value={bonding_strategy} onchange={update_url}>
      {#each Object.entries(SETTINGS_CONFIG.structure.bonding_strategy.enum ?? {}) as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>
</div>

<div class="controls">
  <label>
    <input type="checkbox" bind:checked={show_atoms} onchange={update_url} />
    Atoms
  </label>

  <label>
    <input type="checkbox" bind:checked={show_site_labels} onchange={update_url} />
    Labels
  </label>

  <label>
    <input type="checkbox" bind:checked={show_site_indices} onchange={update_url} />
    Indices
  </label>

  <label>
    <input type="checkbox" bind:checked={show_image_atoms} onchange={update_url} />
    Images
  </label>

  <label>
    <input type="checkbox" bind:checked={force_large_structure} onchange={update_url} />
    Force Large
  </label>

  {#each SHOW_BONDS_OPTIONS as option (option)}
    <label>
      <input type="radio" bind:group={show_bonds} value={option} onchange={update_url} />
      {option}
    </label>
  {/each}
</div>

<div class="controls">
  <h2 id="quick-presets">Quick Presets</h2>
  {#each [[100, `Small`], [500, `Medium`], [1000, `Large`], [2500, `Very Large`], [5000, `Huge`]] as [count, label] (count)}
    <button
      onclick={() => {
        atom_count = count as number
        regenerate()
      }}
    >
      {label} ({count})
    </button>
  {/each}
</div>

{#if is_generating}
  <Spinner text="Generating {atom_count} atoms..." />
{:else if test_structure}
  <Structure
    structure={test_structure}
    {scene_props}
    {performance_mode}
    {supercell_scaling}
    {show_image_atoms}
    show_controls
    class="full-bleed"
    style="height: min(70vh, 1000px)"
  />
{:else}
  <p>Loading...</p>
{/if}

<style>
  h1 {
    margin-bottom: 1.5rem;
  }
  h2 {
    width: 100%;
    margin: 0 0 0.5rem 0;
  }
  .controls {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
    align-items: center;
  }
  label {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }
</style>
