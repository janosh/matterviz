<script lang="ts">
  import { ChemPotDiagram2D, ChemPotDiagram3D } from '$lib/chempot-diagram'
  import type { PhaseData } from '$lib/convex-hull'
  import { decompress_data } from '$lib/io/decompress'
  import li_fe_o_entries_url from '$site/chempot-diagram/li-fe-o-entries.json.gz?url'
  import ytos_entries_url from '$site/chempot-diagram/ytos_entries.json.gz?url'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { onMount } from 'svelte'

  const quaternary_files = (import.meta as unknown as {
    glob: (
      pattern: string,
      options: { eager: false; query: string },
    ) => Record<string, () => Promise<{ default: string }>>
  }).glob(
    `$site/convex-hull/quaternaries/*.json.gz`,
    { eager: false, query: `?url` },
  )

  let all_entries = $state<PhaseData[]>([])
  let li_fe_o_entries = $state<PhaseData[]>([])
  let ytos_entries = $state<PhaseData[]>([])
  let loading = $state(true)
  let error_msg = $state<string | null>(null)

  // Filter entries to only include those with compositions from target elements
  function filter_by_elements(entries: PhaseData[], elements: string[]): PhaseData[] {
    const element_set = new Set(elements)
    return entries.filter((entry) =>
      Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0)
        .every(([el]) => element_set.has(el))
    )
  }

  // Binary subset for 2D demo
  const binary_entries = $derived(filter_by_elements(all_entries, [`Li`, `O`]))
  // Ternary subset for 3D demo
  const ternary_entries = $derived(filter_by_elements(all_entries, [`Li`, `Co`, `O`]))

  async function load_phase_entries(url: string): Promise<PhaseData[]> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Failed to load ${url}: ${response.status} ${response.statusText}`,
      )
    }
    const content_encoding =
      response.headers.get(`content-encoding`)?.toLowerCase() ?? ``
    const parsed_data = content_encoding.includes(`gzip`)
      ? await response.json()
      : JSON.parse(await decompress_data(await response.arrayBuffer(), `gzip`))
    return parsed_data as PhaseData[]
  }

  onMount(async () => {
    try {
      ;[li_fe_o_entries, ytos_entries] = await Promise.all([
        load_phase_entries(li_fe_o_entries_url),
        load_phase_entries(ytos_entries_url),
      ])

      const li_co_ni_o_path = Object.keys(quaternary_files).find((path) =>
        path.includes(`Li-Co-Ni-O`)
      )
      if (!li_co_ni_o_path) {
        error_msg = `Li-Co-Ni-O data file not found`
        loading = false
        return
      }

      const loader = quaternary_files[li_co_ni_o_path]
      all_entries = await load_phase_entries((await loader()).default)
    } catch (err) {
      error_msg = `Failed to load data: ${
        err instanceof Error ? err.message : String(err)
      }`
    } finally {
      loading = false
    }
  })
</script>

<h1>Chemical Potential Diagram</h1>
<p>
  The chemical potential diagram is the mathematical dual of the compositional phase
  diagram, related by a
  <a
    href="https://en.wikipedia.org/wiki/Legendre_transformation"
    target="_blank"
    rel="noopener"
  >
    Legendre transform
  </a>
  that swaps composition variables for their conjugate chemical potentials. Each phase
  becomes a convex polytope domain in chemical potential (μ) space, showing the region
  where that phase is thermodynamically most stable.
</p>

{#if loading}
  <div class="loading-state">
    <Spinner text="Loading phase diagram data..." style="--spinner-size: 1.5em" />
  </div>
{:else if error_msg}
  <p class="error">{error_msg}</p>
{:else}
  <section>
    <h2>Binary System (Li-O) &mdash; 2D</h2>
    <p>
      For a binary system, the chemical potential diagram shows domain boundaries as line
      segments in 2D μ-space. Each line represents the stability region of a phase.
    </p>
    <p>
      <strong>Features in this demo:</strong>
      interactive hover + click-to-pin tooltips, control pane for formal potentials and
      bounds/padding, and export options (SVG, PNG, JSON). This panel also supports the
      full 2D color modes (none, energy/atom, formation energy, arity, entry count) with
      color bar/legend where applicable.
    </p>
    {#if binary_entries.length > 0}
      <ChemPotDiagram2D
        entries={binary_entries}
        config={{ elements: [`Li`, `O`] }}
        width={650}
        height={550}
      />
    {:else}
      <p>No binary Li-O entries found in the dataset.</p>
    {/if}
  </section>

  <section>
    <h2>Ternary System (Li-Co-O) &mdash; 3D</h2>
    <p>
      For a ternary system, stability domains are 3D polytopes. Drag to rotate the view.
    </p>
    <p>
      <strong>Features in this demo:</strong>
      3D hull rendering with domain boundaries, hover + click-to-pin tooltips, camera and
      display controls, color modes/scales, and export options (PNG, SVG snapshot, JSON,
      view JSON, GLB). Projection switching is intentionally hidden here because this is a
      true ternary system.
    </p>
    {#if ternary_entries.length > 0}
      <ChemPotDiagram3D
        entries={ternary_entries}
        config={{ elements: [`Li`, `Co`, `O`] }}
        width={550}
        height={500}
      />
    {:else}
      <p>No ternary Li-Co-O entries found.</p>
    {/if}
  </section>

  <section>
    <h2>Ternary System (Li-Fe-O) &mdash; 3D</h2>
    <p>Li-Fe-O ternary from pymatgen test data. Axes: x=Li, y=Fe, z=O.</p>
    <p>
      <strong>Features in this demo:</strong>
      same core 3D interactions as Li-Co-O, useful as a parity/reference dataset against
      pymatgen expectations (domain topology, labels, and energy-aware coloring).
    </p>
    {#if li_fe_o_entries.length > 0}
      <ChemPotDiagram3D
        entries={li_fe_o_entries}
        config={{ elements: [`Li`, `Fe`, `O`] }}
        width={550}
        height={500}
      />
    {:else}
      <p>No Li-Fe-O entries found.</p>
    {/if}
  </section>

  <section>
    <h2>YTOS Quaternary &mdash; Ti-S-Y Projection</h2>
    <p>
      Full Y-Ti-O-S quaternary projected onto Ti-S-Y axes with Y<sub>2</sub>Ti<sub
      >2</sub>S<sub>2</sub>O<sub>5</sub> overlay.
    </p>
    <p>
      <strong>Features in this demo:</strong>
      multinary projection mode (4D system projected into 3D), runtime projection axis
      switching in the 3D controls pane (X/Y/Z selectors + presets), and formula overlay
      tooling (searchable picker, surface/neighbor quick-select actions).
    </p>
    {#if ytos_entries.length > 0}
      <ChemPotDiagram3D
        entries={ytos_entries}
        config={{
          elements: [`Ti`, `S`, `Y`],
          formulas_to_draw: [`O5S2Ti2Y2`],
        }}
        width={550}
        height={500}
      />
    {:else}
      <p>No YTOS entries found.</p>
    {/if}
  </section>

  <section>
    <h2>YTOS &mdash; Ti-Y-O with Y<sub>2</sub>Ti<sub>2</sub>O<sub>7</sub></h2>
    <p>
      Same quaternary data projected onto Ti-Y-O axes.
    </p>
    <p>
      <strong>Features in this demo:</strong>
      alternative projection of the same multinary dataset, showing how domain geometry
      and visible phase relationships change with axis selection while preserving the same
      underlying computed chemical-potential domains.
    </p>
    {#if ytos_entries.length > 0}
      <ChemPotDiagram3D
        entries={ytos_entries}
        config={{
          elements: [`Ti`, `Y`, `O`],
          formulas_to_draw: [`O7Ti2Y2`],
        }}
        width={550}
        height={500}
      />
    {:else}
      <p>No YTOS entries found.</p>
    {/if}
  </section>
{/if}

<style>
  h1 {
    margin-bottom: 0.5em;
  }
  section {
    margin: 2em 0;
  }
  h2 {
    margin-bottom: 0.3em;
  }
  p {
    max-width: 70ch;
    line-height: 1.5;
  }
  .error {
    color: red;
  }
  .loading-state {
    min-height: 30vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
