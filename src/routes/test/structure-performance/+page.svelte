<script lang="ts">
  import type { ElementSymbol, Vec3 } from '$lib'
  import { type PymatgenStructure, Structure } from '$lib'
  import type { ComponentProps } from 'svelte'

  // URL parameter state
  let atom_count = $state(100)
  let show_atoms = $state(true)
  let show_bonds = $state<`always` | `never` | `crystals` | `molecules`>(`crystals`)
  let show_site_labels = $state(false)
  let show_site_indices = $state(false)
  let show_image_atoms = $state(true)
  let sphere_segments = $state(16)
  let supercell_scaling = $state(`1x1x1`)
  let performance_mode = $state<`quality` | `speed`>(`quality`)
  let bonding_strategy = $state<`electroneg_ratio` | `voronoi`>(
    `electroneg_ratio`,
  )
  let force_large_structure = $state(false)

  // Performance tracking
  let render_start_time = $state(0)
  let render_complete_time = $state(0)
  let structure_load_time = $state(0)
  let is_generating = $state(false)

  // Generated structure
  let test_structure = $state<PymatgenStructure | undefined>(undefined)

  // Scene props for Structure component - derived from reactive state
  let scene_props = $derived<ComponentProps<typeof Structure>[`scene_props`]>({
    show_atoms,
    show_bonds,
    show_site_labels,
    show_site_indices,
    sphere_segments,
    bonding_strategy,
    bonding_options: { force_large_structure },
  })

  /**
   * Generate a test structure with the specified number of atoms
   * Heavily optimized for performance with batch operations and minimal allocations
   */
  function generate_structure(count: number): PymatgenStructure {
    const start = performance.now()

    // Create a cubic lattice that scales with atom count
    const lattice_size = Math.ceil(Math.cbrt(count)) * 3
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

    // Pre-allocate sites array
    const sites: PymatgenStructure[`sites`] = new Array(count)

    // Pre-calculate constants
    const sites_per_edge = Math.ceil(Math.cbrt(count))
    const spacing = 1 / (sites_per_edge + 1)
    const random_offset = 0.1 / lattice_size
    const sites_per_layer = sites_per_edge * sites_per_edge

    // Mix of elements for more realistic testing
    const elements: ElementSymbol[] = [`H`, `C`, `N`, `O`, `Fe`, `Cu`, `Si`, `Al`]
    const element_count = elements.length

    // Pre-create reusable species objects (one per element type)
    const species_cache = elements.map((element) => [
      { element, occu: 1.0, oxidation_state: 0 },
    ])

    // Generate all random numbers in batch (much faster than individual calls)
    const random_count = count * 3
    const randoms = new Float32Array(random_count)
    for (let idx = 0; idx < random_count; idx++) {
      randoms[idx] = (Math.random() - 0.5) * random_offset
    }

    // Main loop - optimized for speed
    let random_idx = 0
    for (let idx = 0; idx < count; idx++) {
      // Calculate grid position using optimized integer math
      const grid_z = (idx / sites_per_layer) | 0 // Fast floor division
      const remainder = idx - grid_z * sites_per_layer
      const grid_y = (remainder / sites_per_edge) | 0
      const grid_x = remainder - grid_y * sites_per_edge

      // Fractional coordinates with pre-generated random offsets
      const frac_x = (grid_x + 1) * spacing + randoms[random_idx++]
      const frac_y = (grid_y + 1) * spacing + randoms[random_idx++]
      const frac_z = (grid_z + 1) * spacing + randoms[random_idx++]

      // Cartesian coordinates (inline calculation)
      const cart_x = frac_x * lattice_size
      const cart_y = frac_y * lattice_size
      const cart_z = frac_z * lattice_size

      // Reuse pre-created species objects
      const element_idx = idx % element_count
      const element = elements[element_idx]

      sites[idx] = {
        species: species_cache[element_idx],
        abc: [frac_x, frac_y, frac_z] as Vec3,
        xyz: [cart_x, cart_y, cart_z] as Vec3,
        label: `${element}${idx + 1}`,
        properties: {},
      }
    }

    structure_load_time = performance.now() - start

    return {
      '@module': `pymatgen.core.structure`,
      '@class': `Structure`,
      lattice,
      sites,
      charge: 0,
    } as PymatgenStructure
  }

  /**
   * Generate structure asynchronously to avoid blocking the UI
   */
  async function generate_structure_async(count: number): Promise<void> {
    is_generating = true

    // Use setTimeout to yield to browser for rendering the loading state
    await new Promise((resolve) => setTimeout(resolve, 0))

    test_structure = generate_structure(count)
    render_start_time = performance.now()
    is_generating = false
  }

  /**
   * Parse URL parameters on mount - run once
   */
  $effect(() => {
    if (typeof window === `undefined`) return

    const url_params = new URLSearchParams(window.location.search)

    // Batch all state updates to avoid multiple reactive triggers
    let new_atom_count = atom_count
    let new_show_atoms = show_atoms
    let new_show_bonds = show_bonds
    let new_show_site_labels = show_site_labels
    let new_show_site_indices = show_site_indices
    let new_show_image_atoms = show_image_atoms
    let new_sphere_segments = sphere_segments
    let new_supercell_scaling = supercell_scaling
    let new_performance_mode = performance_mode
    let new_bonding_strategy = bonding_strategy
    let new_force_large_structure = force_large_structure

    // Parse atom count
    if (url_params.has(`atoms`)) {
      const count = parseInt(url_params.get(`atoms`) || `100`)
      if (!isNaN(count) && count > 0 && count <= 50000) {
        new_atom_count = count
      }
    }

    // Parse rendering options
    if (url_params.has(`show_atoms`)) {
      new_show_atoms = url_params.get(`show_atoms`) === `true`
    }

    if (url_params.has(`show_bonds`)) {
      const bonds = url_params.get(`show_bonds`)
      if (
        bonds === `always` || bonds === `never` || bonds === `crystals` ||
        bonds === `molecules`
      ) {
        new_show_bonds = bonds as typeof show_bonds
      }
    }

    if (url_params.has(`show_site_labels`)) {
      new_show_site_labels = url_params.get(`show_site_labels`) === `true`
    }

    if (url_params.has(`show_site_indices`)) {
      new_show_site_indices = url_params.get(`show_site_indices`) === `true`
    }

    if (url_params.has(`show_image_atoms`)) {
      new_show_image_atoms = url_params.get(`show_image_atoms`) === `true`
    }

    if (url_params.has(`sphere_segments`)) {
      const segments = parseInt(url_params.get(`sphere_segments`) || `16`)
      if (!isNaN(segments) && segments >= 3 && segments <= 64) {
        new_sphere_segments = segments
      }
    }

    if (url_params.has(`supercell`)) {
      const scaling = url_params.get(`supercell`)
      if (scaling) new_supercell_scaling = scaling
    }

    if (url_params.has(`performance_mode`)) {
      const mode = url_params.get(`performance_mode`)
      if (mode === `speed` || mode === `quality`) {
        new_performance_mode = mode as typeof performance_mode
      }
    }

    if (url_params.has(`bonding_strategy`)) {
      const strategy = url_params.get(`bonding_strategy`)
      if (strategy === `electroneg_ratio` || strategy === `voronoi`) {
        new_bonding_strategy = strategy as typeof bonding_strategy
      }
    }

    if (url_params.has(`force_large_structure`)) {
      new_force_large_structure = url_params.get(`force_large_structure`) === `true`
    }

    // Apply all updates at once
    atom_count = new_atom_count
    show_atoms = new_show_atoms
    show_bonds = new_show_bonds
    show_site_labels = new_show_site_labels
    show_site_indices = new_show_site_indices
    show_image_atoms = new_show_image_atoms
    sphere_segments = new_sphere_segments
    supercell_scaling = new_supercell_scaling
    performance_mode = new_performance_mode
    bonding_strategy = new_bonding_strategy
    force_large_structure = new_force_large_structure
  })

  // Generate structure when atom_count changes - use async to avoid blocking
  $effect(() => {
    generate_structure_async(atom_count)
  })

  // Track render completion
  function handle_file_load() {
    render_complete_time = performance.now()
  }

  // Computed performance metrics
  let render_time = $derived(
    render_complete_time > render_start_time
      ? render_complete_time - render_start_time
      : 0,
  )

  /**
   * Update URL with current parameters
   */
  function update_url() {
    if (typeof window === `undefined`) return

    const params = new URLSearchParams()
    params.set(`atoms`, atom_count.toString())
    params.set(`show_atoms`, show_atoms.toString())
    params.set(`show_bonds`, show_bonds)
    params.set(`show_site_labels`, show_site_labels.toString())
    params.set(`show_site_indices`, show_site_indices.toString())
    params.set(`show_image_atoms`, show_image_atoms.toString())
    params.set(`sphere_segments`, sphere_segments.toString())
    params.set(`supercell`, supercell_scaling)
    params.set(`performance_mode`, performance_mode)
    params.set(`bonding_strategy`, bonding_strategy)
    params.set(`force_large_structure`, force_large_structure.toString())

    const new_url = `${window.location.pathname}?${params.toString()}`
    window.history.replaceState(null, ``, new_url)
  }
</script>

<div class="page-container">
  <h1>Structure Performance Test Page</h1>

  <div class="controls-section">
    <h2>Configuration</h2>

    <div class="controls-grid">
      <label>
        Atom Count:
        <input
          type="number"
          bind:value={atom_count}
          min="1"
          max="50000"
          step="100"
          onchange={update_url}
        />
        <small>(1 - 50,000)</small>
      </label>

      <label>
        Supercell Scaling:
        <input
          type="text"
          bind:value={supercell_scaling}
          placeholder="e.g., 2x2x2"
          onchange={update_url}
        />
      </label>

      <label>
        Performance Mode:
        <select bind:value={performance_mode} onchange={update_url}>
          <option value="quality">Quality</option>
          <option value="speed">Speed</option>
        </select>
      </label>

      <label>
        Sphere Segments:
        <input
          type="number"
          bind:value={sphere_segments}
          min="3"
          max="64"
          onchange={update_url}
        />
      </label>

      <label>
        Bonding Strategy:
        <select bind:value={bonding_strategy} onchange={update_url}>
          <option value="electroneg_ratio">Electronegativity Ratio</option>
          <option value="voronoi">Voronoi</option>
        </select>
      </label>
    </div>

    <h3>Rendering Options</h3>
    <div class="checkbox-grid">
      <label>
        <input type="checkbox" bind:checked={show_atoms} onchange={update_url} />
        Show Atoms
      </label>

      <label>
        <input type="checkbox" bind:checked={show_site_labels} onchange={update_url} />
        Show Site Labels
      </label>

      <label>
        <input type="checkbox" bind:checked={show_site_indices} onchange={update_url} />
        Show Site Indices
      </label>

      <label>
        <input type="checkbox" bind:checked={show_image_atoms} onchange={update_url} />
        Show Image Atoms
      </label>

      <label>
        <input
          type="checkbox"
          bind:checked={force_large_structure}
          onchange={update_url}
        />
        Force Large Structure Bonding
      </label>
    </div>

    <h3>Bond Display</h3>
    <div class="radio-grid">
      {#each [`always`, `never`, `crystals`, `molecules`] as option (option)}
        <label>
          <input
            type="radio"
            bind:group={show_bonds}
            value={option}
            onchange={update_url}
          />
          {option}
        </label>
      {/each}
    </div>

    <h3>Quick Presets</h3>
    <div class="preset-buttons">
      <button
        onclick={() => {
          atom_count = 100
          show_bonds = `crystals`
          show_site_labels = false
          performance_mode = `quality`
          update_url()
        }}
      >
        Small (100)
      </button>
      <button
        onclick={() => {
          atom_count = 500
          show_bonds = `crystals`
          show_site_labels = false
          performance_mode = `quality`
          update_url()
        }}
      >
        Medium (500)
      </button>
      <button
        onclick={() => {
          atom_count = 1000
          show_bonds = `never`
          show_site_labels = false
          performance_mode = `speed`
          update_url()
        }}
      >
        Large (1000)
      </button>
      <button
        onclick={() => {
          atom_count = 2500
          show_bonds = `never`
          show_site_labels = false
          show_image_atoms = false
          performance_mode = `speed`
          sphere_segments = 8
          update_url()
        }}
      >
        Very Large (2500)
      </button>
      <button
        onclick={() => {
          atom_count = 5000
          show_bonds = `never`
          show_site_labels = false
          show_image_atoms = false
          performance_mode = `speed`
          sphere_segments = 6
          update_url()
        }}
      >
        Huge (5000)
      </button>
    </div>
  </div>

  <div class="metrics-section">
    <h2>Performance Metrics</h2>
    <div class="metrics-grid">
      <div class="metric">
        <span class="metric-label">Structure Generation:</span>
        <span class="metric-value">
          {structure_load_time.toFixed(2)} ms
        </span>
        <span class="metric-hint">Time to create test structure data</span>
      </div>
      <div class="metric">
        <span class="metric-label">Component Render Time:</span>
        <span class="metric-value">
          {render_time.toFixed(2)} ms
        </span>
        <span class="metric-hint">Time from structure ready to displayed</span>
      </div>
      <div class="metric">
        <span class="metric-label">Atom Count:</span>
        <span class="metric-value">{test_structure?.sites?.length ?? 0}</span>
        <span class="metric-hint">Total atoms in structure</span>
      </div>
      <div class="metric">
        <span class="metric-label">Sphere Quality:</span>
        <span class="metric-value">{sphere_segments} segments</span>
        <span class="metric-hint">Polygons per atom sphere</span>
      </div>
    </div>
  </div>

  <div class="viewer-section">
    {#if is_generating}
      <div class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>Generating structure with {atom_count} atoms...</p>
      </div>
    {:else if test_structure}
      <Structure
        structure={test_structure}
        {scene_props}
        {performance_mode}
        {supercell_scaling}
        {show_image_atoms}
        on_file_load={handle_file_load}
        show_controls
      />
    {:else}
      <div class="empty-state">
        <p>Loading...</p>
      </div>
    {/if}
  </div>

  <div class="info-section">
    <h2>URL Parameters</h2>
    <p>
      You can configure this test page using URL parameters. Current URL:
    </p>
    <pre><code>{typeof window !== `undefined` ? window.location.href : ``}</code></pre>

    <h3>Available Parameters</h3>
    <ul>
      <li><code>atoms</code> - Number of atoms (1-50000, default: 100)</li>
      <li><code>show_atoms</code> - Show atoms (true/false, default: true)</li>
      <li>
        <code>show_bonds</code> - Bond display (always/never/crystals/molecules, default:
        crystals)
      </li>
      <li>
        <code>show_site_labels</code> - Show element labels (true/false, default: false)
      </li>
      <li>
        <code>show_site_indices</code> - Show site indices (true/false, default: false)
      </li>
      <li>
        <code>show_image_atoms</code> - Show PBC image atoms (true/false, default: true)
      </li>
      <li><code>sphere_segments</code> - Sphere quality (3-64, default: 16)</li>
      <li><code>supercell</code> - Supercell scaling (e.g., 2x2x2, default: 1x1x1)</li>
      <li>
        <code>performance_mode</code> - Performance mode (quality/speed, default: quality)
      </li>
      <li>
        <code>bonding_strategy</code> - Bonding algorithm (electroneg_ratio/voronoi)
      </li>
      <li>
        <code>force_large_structure</code> - Force bonding for large structures
        (true/false, default: false)
      </li>
    </ul>

    <h3>Example URLs</h3>
    <ul>
      <li>
        <a href="?atoms=1000&show_bonds=never&performance_mode=speed">
          1000 atoms, no bonds, speed mode
        </a>
      </li>
      <li>
        <a href="?atoms=500&show_site_labels=true&sphere_segments=32">
          500 atoms with labels, high quality spheres
        </a>
      </li>
      <li>
        <a href="?atoms=2500&show_bonds=never&show_image_atoms=false&sphere_segments=8">
          2500 atoms, minimal rendering
        </a>
      </li>
      <li>
        <a
          href="?atoms=100&show_bonds=always&force_large_structure=true&bonding_strategy=voronoi"
        >
          100 atoms with forced bonding calculation
        </a>
      </li>
    </ul>
  </div>
</div>

<style>
  .page-container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    margin-bottom: 2rem;
  }

  h2 {
    margin-top: 2rem;
    margin-bottom: 1rem;
    font-size: 1.5rem;
  }

  h3 {
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    font-size: 1.2rem;
  }

  .controls-section {
    background: var(--surface-bg, #f5f5f5);
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 2rem;
  }

  .controls-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .checkbox-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
  }

  .radio-grid {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-weight: 500;
  }

  .checkbox-grid label,
  .radio-grid label {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  input[type='number'],
  input[type='text'],
  select {
    padding: 0.5rem;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    font-size: 1rem;
  }

  input[type='checkbox'],
  input[type='radio'] {
    cursor: pointer;
  }

  small {
    color: var(--text-muted, #666);
    font-weight: 400;
  }

  .preset-buttons {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }

  .preset-buttons button {
    padding: 0.75rem 1.5rem;
    background: var(--accent-color, #007bff);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s;
  }

  .preset-buttons button:hover {
    background: var(--accent-color-hover, #0056b3);
  }

  .metrics-section {
    background: var(--surface-bg, #f5f5f5);
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 2rem;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .metric {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .metric-label {
    font-weight: 500;
    color: var(--text-muted, #666);
    font-size: 0.9rem;
  }

  .metric-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--accent-color, #007bff);
  }

  .metric-hint {
    font-size: 0.8rem;
    color: var(--text-muted, #999);
    font-weight: 400;
    margin-top: 0.25rem;
  }

  .viewer-section {
    margin-bottom: 2rem;
    min-height: 600px;
    position: relative;
  }

  .loading-overlay,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 600px;
    background: var(--surface-bg, #f5f5f5);
    border-radius: 8px;
  }

  .loading-spinner {
    width: 50px;
    height: 50px;
    box-sizing: border-box;
    border: 4px solid var(--border-color, #e0e0e0);
    border-top-color: var(--accent-color, #007bff);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-overlay p,
  .empty-state p {
    margin-top: 1rem;
    font-size: 1.1rem;
    color: var(--text-muted, #666);
  }

  .info-section {
    background: var(--surface-bg, #f5f5f5);
    padding: 1.5rem;
    border-radius: 8px;
  }

  .info-section ul {
    margin-left: 1.5rem;
  }

  .info-section li {
    margin-bottom: 0.5rem;
  }

  code {
    background: var(--code-bg, #e8e8e8);
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
  }

  pre {
    background: var(--code-bg, #e8e8e8);
    padding: 1rem;
    border-radius: 4px;
    overflow-x: auto;
    margin: 1rem 0;
  }

  pre code {
    background: none;
    padding: 0;
  }

  a {
    color: var(--accent-color, #007bff);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
