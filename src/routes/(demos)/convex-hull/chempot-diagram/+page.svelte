<script lang="ts">
  import {
    ChemPotDiagram,
    ChemPotDiagram3D,
    type ChemPotDiagramConfig,
  } from '$lib/chempot-diagram'
  import type { ElementSymbol } from '$lib/element'
  import type { PhaseData } from '$lib/convex-hull'
  import { filter_by_elements, quaternary_loader } from '$site/convex-hull'
  import { create_temp_ternary_entries_li_fe_o } from '$site/convex-hull/demo-temperature'
  import { Spinner } from 'svelte-widgets'
  import LazyDemo from '$site/LazyDemo.svelte'

  // Each compressed fixture remains a separate lazy chunk.
  const chempot_files = import.meta.glob<{ default: PhaseData[] }>(
    `/src/site/chempot-diagram/*.json.gz`,
  )
  const datasets = {
    'Li-Co-Ni-O': quaternary_loader(`Li-Co-Ni-O`),
    'Li-Fe-O': chempot_files[`/src/site/chempot-diagram/li-fe-o-entries.json.gz`],
    YTOS: chempot_files[`/src/site/chempot-diagram/ytos_entries.json.gz`],
  }
  let temp_demo_temperature = $state<number | undefined>(700)
  const temp_ternary_entries = create_temp_ternary_entries_li_fe_o()
</script>

{#snippet diagram(
  dataset: keyof typeof datasets,
  {
    subset,
    config = { elements: subset },
    width = 550,
    height = 500,
  }: {
    subset?: ElementSymbol[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
  } = {},
)}
  <LazyDemo label="Chemical potential diagram" height="{height}px">
    {#await datasets[dataset]()}
      <Spinner text="Loading {dataset} data…" />
    {:then { default: entries }}
      {@const selected_entries = subset ? filter_by_elements(entries, subset) : entries}
      {#if selected_entries.length}
        <ChemPotDiagram entries={selected_entries} {config} {width} {height} />
      {:else}
        <p>No {subset?.join(`-`) ?? dataset} entries found.</p>
      {/if}
    {:catch error}
      <p role="alert">Failed to load {dataset}: {String(error)}</p>
    {/await}
  </LazyDemo>
{/snippet}

<h1 id="chemical-potential-diagram">Chemical Potential Diagram</h1>

<section data-demo-id="binary">
  <h2 id="binary-system-li-o-mdash-2d">Binary System (Li-O) &mdash; 2D</h2>
  <p>
    Demonstrates pinned tooltips, formal-potential and bounds controls, color modes, and
    export.
  </p>
  {@render diagram(`Li-Co-Ni-O`, { subset: [`Li`, `O`], width: 650, height: 550 })}
</section>

<section data-demo-id="ternary">
  <h2 id="ternary-system-li-co-o-mdash-3d">Ternary System (Li-Co-O) &mdash; 3D</h2>
  <p>
    Demonstrates pinned tooltips, camera and display controls, color modes, and 3D export.
    Projection axis switching is hidden here since it only appears for systems with 4+
    elements.
  </p>
  {@render diagram(`Li-Co-Ni-O`, { subset: [`Li`, `Co`, `O`] })}
</section>

<section data-demo-id="li_fe_o">
  <h2 id="ternary-system-li-fe-o-mdash-3d">Ternary System (Li-Fe-O) &mdash; 3D</h2>
  <p>
    Reference data from pymatgen for checking domain topology, labels, and energy-aware
    coloring.
  </p>
  {@render diagram(`Li-Fe-O`, { config: { elements: [`Li`, `Fe`, `O`] } })}
</section>

<section data-demo-id="temp_li_fe_o">
  <h2 id="ternary-system-li-fe-o-with-temperature-slider-mdash-3d">
    Ternary System (Li-Fe-O) with Temperature Slider &mdash; 3D
  </h2>
  <p>
    This demo uses the same synthetic G(T) dataset recipe as the convex-hull demo page. Drag
    the temperature slider to recompute stability domains from free energies.
  </p>
  <LazyDemo label="Temperature-dependent chemical potentials">
    <ChemPotDiagram3D
      entries={temp_ternary_entries}
      config={{
        elements: [`Li`, `Fe`, `O`],
      }}
      bind:temperature={temp_demo_temperature}
      width={550}
      height={500}
    />
  </LazyDemo>
</section>

<section data-demo-id="quaternary">
  <h2 id="quaternary-system-li-co-ni-o-mdash-all-ternary-projections">
    Quaternary System (Li-Co-Ni-O) &mdash; All Ternary Projections
  </h2>
  <p>
    Grid mode exposes all C(n,3) ternary projections instead of hiding the unselected chemical
    potentials behind one projection.
  </p>
  {@render diagram(`Li-Co-Ni-O`, {
    config: { projection_mode: `grid` },
    width: 900,
    height: 700,
  })}
</section>

<section data-demo-id="ytos_ti_s_y">
  <h2 id="ytos-quaternary-mdash-ti-s-y-projection">
    YTOS Quaternary &mdash; Ti-S-Y Projection
  </h2>
  <p>
    Y-Ti-O-S projected onto Ti-S-Y, with runtime axis switching and a Y<sub>2</sub>Ti<sub
      >2</sub
    >S<sub>2</sub>O<sub>5</sub> formula overlay.
  </p>
  {@render diagram(`YTOS`, {
    config: { elements: [`Ti`, `S`, `Y`], formulas_to_draw: [`O5S2Ti2Y2`] },
  })}
</section>

<section data-demo-id="ytos_ti_y_o">
  <h2 id="ytos-mdash-ti-y-o-with-y2ti2o7">
    YTOS &mdash; Ti-Y-O with Y<sub>2</sub>Ti<sub>2</sub>O<sub>7</sub>
  </h2>
  <p>
    The same domains projected onto Ti-Y-O with a Y<sub>2</sub>Ti<sub>2</sub>O<sub>7</sub>
    overlay.
  </p>
  {@render diagram(`YTOS`, {
    config: { elements: [`Ti`, `Y`, `O`], formulas_to_draw: [`O7Ti2Y2`] },
  })}
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
</style>
