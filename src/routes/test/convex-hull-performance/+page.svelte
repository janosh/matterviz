<script lang="ts">
  import { replaceState } from '$app/navigation'
  import type { ElementSymbol } from '$lib'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import type { PhaseData } from '$lib/convex-hull'
  import { ConvexHull2D, ConvexHull3D, ConvexHull4D } from '$lib/convex-hull'
  import { tick } from 'svelte'

  type Dimension = `2d` | `3d` | `4d`

  let dimension = $state<Dimension>(`3d`)
  let entry_count = $state(500)
  let is_generating = $state(false)
  let generated_entries = $state<PhaseData[]>([])
  let generation_time_ms = $state(0)
  let show_stable = $state(true)
  let show_unstable = $state(true)
  let max_hull_dist = $state(0.5)
  let color_mode = $state<`stability` | `energy`>(`energy`)
  let enable_click_selection = $state(true)
  let render_start = $state(0)
  let render_time_ms = $state(0)

  const ELEMENTS: Record<Dimension, ElementSymbol[]> = {
    '2d': [`Fe`, `O`],
    '3d': [`Li`, `Fe`, `O`],
    '4d': [`Li`, `Co`, `Ni`, `O`],
  }

  function generate_entries(count: number, dim: Dimension): PhaseData[] {
    const elements = ELEMENTS[dim]
    const entries: PhaseData[] = elements.map((el) => ({
      composition: { [el]: 1 } as Partial<Record<ElementSymbol, number>>,
      energy: 0,
      entry_id: `ref-${el}`,
      e_form_per_atom: 0,
      e_above_hull: 0,
      is_stable: true,
      reduced_formula: el,
    }))

    for (let idx = 0; idx < count - elements.length; idx++) {
      const raw = elements.map(() => -Math.log(Math.random() + 1e-10))
      const total = raw.reduce((sum, val) => sum + val, 0)
      const composition: Partial<Record<ElementSymbol, number>> = {}
      const formula: string[] = []

      elements.forEach((el, elem_idx) => {
        const stoich = Math.max(1, Math.round((raw[elem_idx] / total) * 10))
        composition[el] = stoich
        formula.push(`${el}${stoich > 1 ? stoich : ``}`)
      })

      const e_form = Math.random() < 0.7
        ? -2 * Math.random() + 0.2 * Math.random()
        : -1 + Math.random() * 1.5
      const atoms = Object.values(composition).reduce((s, v) => s + v, 0)

      // Add dummy structure data to first 5 entries for testing click selection
      const structure = idx < 5
        ? {
          sites: elements.map((el, site_idx) => ({
            species: [{ element: el, occu: 1 }],
            xyz: [site_idx * 2, 0, 0],
          })),
          lattice: { matrix: [[10, 0, 0], [0, 10, 0], [0, 0, 10]] },
        }
        : undefined

      entries.push({
        composition,
        energy: e_form * atoms,
        entry_id: `test-${idx}`,
        e_form_per_atom: e_form,
        reduced_formula: formula.join(``),
        structure,
      })
    }
    return entries
  }

  async function regenerate(): Promise<void> {
    is_generating = true
    render_start = performance.now()
    await tick()
    const start = performance.now()
    generated_entries = generate_entries(entry_count, dimension)
    generation_time_ms = performance.now() - start
    is_generating = false
  }

  function track_render(_node: HTMLElement): { destroy: () => void } {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (render_start > 0) {
          render_time_ms = performance.now() - render_start
          render_start = 0
        }
      })
    })
    return { destroy: () => {} }
  }

  $effect(() => {
    if (typeof window === `undefined`) return
    const params = new URLSearchParams(window.location.search)
    const dim = params.get(`dim`)
    if (dim && [`2d`, `3d`, `4d`].includes(dim)) dimension = dim as Dimension
    const cnt = parseInt(params.get(`count`) ?? ``)
    if (!isNaN(cnt) && cnt >= 10 && cnt <= 50000) entry_count = cnt
    const hull = parseFloat(params.get(`hull_dist`) ?? ``)
    if (!isNaN(hull) && hull >= 0) max_hull_dist = hull
    const click_sel = params.get(`click_selection`)
    if (click_sel !== null) enable_click_selection = click_sel !== `false`
    // Initial generation after URL params are loaded
    regenerate()
  })

  function update_url(): void {
    if (typeof window === `undefined`) return
    replaceState(
      `?dim=${dimension}&count=${entry_count}&hull_dist=${max_hull_dist}`,
      {},
    )
  }

  const PRESETS = [100, 500, 1000, 2500, 5000, 10000]
</script>

<h1>Convex Hull Performance Test</h1>

<div style="display: flex; flex-wrap: wrap; gap: 2em; margin-bottom: 1em">
  <label>
    Dimension:
    <select
      bind:value={dimension}
      onchange={() => {
        update_url()
        regenerate()
      }}
    >
      <option value="2d">2D Binary</option>
      <option value="3d">3D Ternary</option>
      <option value="4d">4D Quaternary</option>
    </select>
  </label>

  <label>
    Entries:
    <input
      type="number"
      bind:value={entry_count}
      min="10"
      max="50000"
      step="100"
      style="width: 5em"
      onchange={() => {
        update_url()
        regenerate()
      }}
    />
  </label>

  {#each PRESETS as count (count)}
    <button
      style:font-weight={entry_count === count ? `bold` : `normal`}
      onclick={() => {
        entry_count = count
        update_url()
        regenerate()
      }}
    >
      {count}
    </button>
  {/each}
</div>

<div style="display: flex; flex-wrap: wrap; gap: 2em; margin-bottom: 1em">
  <label><input type="checkbox" bind:checked={show_stable} /> Stable</label>
  <label><input type="checkbox" bind:checked={show_unstable} /> Unstable</label>
  <label><input type="checkbox" bind:checked={enable_click_selection} /> Click
    selection</label>
  <label>
    Color:
    <select bind:value={color_mode}>
      <option value="energy">Energy</option>
      <option value="stability">Stability</option>
    </select>
  </label>
  <label>
    Hull dist:
    <input
      type="number"
      bind:value={max_hull_dist}
      min="0"
      max="2"
      step="0.1"
      style="width: 4em"
      onchange={update_url}
    />
  </label>
  <button onclick={regenerate} disabled={is_generating}>🔄 Regenerate</button>
</div>

<p>
  <strong>{ELEMENTS[dimension].join(`-`)}</strong> |
  {generated_entries.length} entries | Gen: {generation_time_ms.toFixed(1)}ms | Render: {
    render_time_ms.toFixed(1)
  }ms
</p>

{#if is_generating}
  <Spinner text="Generating {entry_count} entries..." />
{:else if generated_entries.length > 0}
  {#key `${dimension}-${generated_entries.length}-${generation_time_ms}`}
    <div style="height: min(70vh, 800px)" use:track_render>
      {#if dimension === `2d`}
        <ConvexHull2D
          entries={generated_entries}
          controls={{ title: `${ELEMENTS[dimension].join(`-`)} (${generated_entries.length})` }}
          {show_stable}
          {show_unstable}
          max_hull_dist_show_phases={max_hull_dist}
          {color_mode}
          {enable_click_selection}
        />
      {:else if dimension === `3d`}
        <ConvexHull3D
          entries={generated_entries}
          controls={{ title: `${ELEMENTS[dimension].join(`-`)} (${generated_entries.length})` }}
          {show_stable}
          {show_unstable}
          max_hull_dist_show_phases={max_hull_dist}
          {color_mode}
          {enable_click_selection}
        />
      {:else}
        <ConvexHull4D
          entries={generated_entries}
          controls={{ title: `${ELEMENTS[dimension].join(`-`)} (${generated_entries.length})` }}
          {show_stable}
          {show_unstable}
          max_hull_dist_show_phases={max_hull_dist}
          {color_mode}
          {enable_click_selection}
        />
      {/if}
    </div>
  {/key}
{/if}

<details style="margin-top: 1em">
  <summary>Performance tips</summary>
  <ul>
    <li>Open DevTools Performance tab to profile</li>
    <li>Check frame rate while rotating 3D/4D diagrams</li>
    <li>Monitor memory for large entry counts</li>
    <li>4D is most expensive (tetrahedron projection)</li>
  </ul>
</details>
