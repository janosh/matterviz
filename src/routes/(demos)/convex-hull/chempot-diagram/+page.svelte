<script lang="ts">
  import { ChemPotDiagram, ChemPotDiagram2D, ChemPotDiagram3D } from '$lib/chempot-diagram'
  import type { PhaseData } from '$lib/convex-hull'
  import { filter_by_elements, quaternary_loader } from '$site/convex-hull'
  import { create_temp_ternary_entries_li_fe_o } from '$site/convex-hull/demo-temperature'
  import { Spinner } from 'svelte-widgets'
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { to_error } from '$lib/utils'

  // vite-plugin-json-gz decompresses each .json.gz at build time.
  // Lazy chunks are code-split and loaded on demand.
  // Do NOT use query:'?url' here: Rolldown doesn't emit .json.gz as assets for globs.
  const chempot_files = import.meta.glob<PhaseData[]>(`/src/site/chempot-diagram/*.json.gz`, {
    eager: true,
    import: `default`,
  })

  function get_chempot_data(filename: string): PhaseData[] {
    const data = Object.entries(chempot_files).find(([path]) => path.endsWith(filename))?.[1]
    if (!data) throw new Error(`Missing chempot demo data: ${filename}`)
    return data
  }

  let all_entries = $state<PhaseData[]>([])
  const li_fe_o_entries = get_chempot_data(`li-fe-o-entries.json.gz`)
  const ytos_entries = get_chempot_data(`ytos_entries.json.gz`)
  let temp_demo_temperature = $state<number | undefined>(700)
  let quaternary_loading = $state(true)
  let quaternary_error = $state<string | null>(null)
  const visible_demo_ids = $state(new SvelteSet<string>())

  function reveal_demo(section: HTMLElement): void {
    const demo_id = section.dataset.demoId
    if (demo_id) visible_demo_ids.add(demo_id)
  }

  function observe_demo_sections(): () => void {
    const demo_sections = document.querySelectorAll<HTMLElement>(`[data-demo-id]`)
    if (!(`IntersectionObserver` in globalThis)) {
      for (const section of demo_sections) reveal_demo(section)
      return () => {}
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          if (!(entry.target instanceof HTMLElement)) continue
          reveal_demo(entry.target)
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: `1000px 0px` },
    )
    for (const section of demo_sections) observer.observe(section)

    return () => observer.disconnect()
  }

  async function load_quaternary_entries(): Promise<void> {
    try {
      all_entries = (await quaternary_loader(`Li-Co-Ni-O`)()).default
    } catch (error) {
      quaternary_error = `Failed to load data: ${to_error(error).message}`
    } finally {
      quaternary_loading = false
    }
  }

  // Binary subset for 2D demo
  const binary_entries = $derived(filter_by_elements(all_entries, [`Li`, `O`]))
  // Ternary subset for 3D demo
  const ternary_entries = $derived(filter_by_elements(all_entries, [`Li`, `Co`, `O`]))

  const temp_ternary_entries = create_temp_ternary_entries_li_fe_o()

  onMount(() => {
    const stop_observing = observe_demo_sections()
    void load_quaternary_entries()
    return stop_observing
  })
</script>

<h1>Chemical Potential Diagram</h1>

<section data-demo-id="binary">
  <h2>Binary System (Li-O) &mdash; 2D</h2>
  <p>
    Demonstrates pinned tooltips, formal-potential and bounds controls, color modes, and
    export.
  </p>
  {#if !visible_demo_ids.has(`binary`)}
    <div class="deferred-diagram" style:height="550px"></div>
  {:else if binary_entries.length > 0}
    <ChemPotDiagram2D
      entries={binary_entries}
      config={{ elements: [`Li`, `O`] }}
      width={650}
      height={550}
    />
  {:else if quaternary_loading}
    <Spinner text="Loading Li-Co-Ni-O data..." style="--spinner-size: 1.2em" />
  {:else}
    <p>No binary Li-O entries found in the dataset.</p>
  {/if}
</section>

<section data-demo-id="ternary">
  <h2>Ternary System (Li-Co-O) &mdash; 3D</h2>
  <p>
    Demonstrates pinned tooltips, camera and display controls, color modes, and 3D export.
    Projection axis switching is hidden here since it only appears for systems with 4+
    elements.
  </p>
  {#if !visible_demo_ids.has(`ternary`)}
    <div class="deferred-diagram" style:height="500px"></div>
  {:else if ternary_entries.length > 0}
    <ChemPotDiagram3D
      entries={ternary_entries}
      config={{ elements: [`Li`, `Co`, `O`] }}
      width={550}
      height={500}
    />
  {:else if quaternary_loading}
    <Spinner text="Loading Li-Co-Ni-O data..." style="--spinner-size: 1.2em" />
  {:else}
    <p>No ternary Li-Co-O entries found.</p>
  {/if}
</section>

<section data-demo-id="li_fe_o">
  <h2>Ternary System (Li-Fe-O) &mdash; 3D</h2>
  <p>
    Reference data from pymatgen for checking domain topology, labels, and energy-aware
    coloring.
  </p>
  {#if !visible_demo_ids.has(`li_fe_o`)}
    <div class="deferred-diagram" style:height="500px"></div>
  {:else if li_fe_o_entries.length > 0}
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

<section data-demo-id="temp_li_fe_o">
  <h2>Ternary System (Li-Fe-O) with Temperature Slider &mdash; 3D</h2>
  <p>
    This demo uses the same synthetic G(T) dataset recipe as the convex-hull demo page. Drag
    the temperature slider to recompute stability domains from free energies.
  </p>
  {#if visible_demo_ids.has(`temp_li_fe_o`)}
    <ChemPotDiagram3D
      entries={temp_ternary_entries}
      config={{
        elements: [`Li`, `Fe`, `O`],
      }}
      bind:temperature={temp_demo_temperature}
      width={550}
      height={500}
    />
  {:else}
    <div class="deferred-diagram" style:height="500px"></div>
  {/if}
</section>

<section data-demo-id="quaternary">
  <h2>Quaternary System (Li-Co-Ni-O) &mdash; All Ternary Projections</h2>
  <p>
    Grid mode exposes all C(n,3) ternary projections instead of hiding the unselected chemical
    potentials behind one projection.
  </p>
  {#if !visible_demo_ids.has(`quaternary`)}
    <div class="deferred-diagram" style:height="700px"></div>
  {:else if quaternary_loading}
    <Spinner text="Loading Li-Co-Ni-O data..." style="--spinner-size: 1.2em" />
  {:else if quaternary_error}
    <p style="color: red">{quaternary_error}</p>
  {:else if all_entries.length > 0}
    <ChemPotDiagram
      entries={all_entries}
      config={{ projection_mode: `grid` }}
      width={900}
      height={700}
    />
  {:else}
    <p>No Li-Co-Ni-O entries found.</p>
  {/if}
</section>

<section data-demo-id="ytos_ti_s_y">
  <h2>YTOS Quaternary &mdash; Ti-S-Y Projection</h2>
  <p>
    Y-Ti-O-S projected onto Ti-S-Y, with runtime axis switching and a Y<sub>2</sub>Ti<sub
      >2</sub
    >S<sub>2</sub>O<sub>5</sub> formula overlay.
  </p>
  {#if !visible_demo_ids.has(`ytos_ti_s_y`)}
    <div class="deferred-diagram" style:height="500px"></div>
  {:else if ytos_entries.length > 0}
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

<section data-demo-id="ytos_ti_y_o">
  <h2>YTOS &mdash; Ti-Y-O with Y<sub>2</sub>Ti<sub>2</sub>O<sub>7</sub></h2>
  <p>
    The same domains projected onto Ti-Y-O with a Y<sub>2</sub>Ti<sub>2</sub>O<sub>7</sub>
    overlay.
  </p>
  {#if !visible_demo_ids.has(`ytos_ti_y_o`)}
    <div class="deferred-diagram" style:height="500px"></div>
  {:else if ytos_entries.length > 0}
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

<style>
  h1 {
    margin-bottom: 0.5em;
  }
  /* Headings and blurbs centered like the page title; the fixed-width diagrams center too */
  section {
    margin: 2em 0;
    text-align: center;
  }
  h2 {
    margin-bottom: 0.3em;
  }
  p {
    max-width: 70ch;
    line-height: 1.5;
    margin-inline: auto;
  }
  .deferred-diagram {
    max-width: min(100%, 900px);
    margin-inline: auto;
  }
</style>
