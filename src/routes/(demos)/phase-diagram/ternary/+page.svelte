<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import type { PhaseData } from '$lib/convex-hull/types'
  import FilePicker from '$lib/FilePicker.svelte'
  import { format_num } from '$lib/labels'
  import {
    format_reaction,
    IsobaricTernaryPhaseDiagram,
    type TernaryPhaseDiagram,
  } from '$lib/phase-diagram'
  import { to_error } from '$lib/utils'
  import { ternary_system_files } from '$site/phase-diagrams/ternary'
  import { replace_url } from '$site/state.svelte'

  const DEFAULT_FILE = `Li-Mn-O.json.gz`

  // Raw: hundreds of entries and the computed diagram must not be wrapped in deep proxies
  let current_entries = $state.raw<PhaseData[] | null>(null)
  let current_file = $state(``)
  let loading = $state(false)
  let error_message = $state<string | null>(null)
  // Stale-load guard: only the newest request may write state
  let active_load: symbol | null = null

  function update_url(filename: string): void {
    if (!browser) return
    const url = new URL(page.url) // page.url is read-only state: never mutate it in place
    url.searchParams.set(`file`, filename)
    void replace_url(url)
  }

  async function load_system(filename: string, update_url_param = true): Promise<void> {
    const file = ternary_system_files.find((info) => info.name === filename)
    if (!file) {
      error_message = `Unknown system: ${filename}`
      return
    }
    const token = Symbol(filename)
    active_load = token
    loading = true
    error_message = null
    try {
      const entries = await file.load()
      if (active_load !== token) return
      current_entries = entries
      current_file = filename
      if (update_url_param) update_url(filename)
    } catch (exc) {
      if (active_load === token) {
        error_message = `Failed to load ${filename}: ${to_error(exc).message}`
      }
    } finally {
      if (active_load === token) loading = false
    }
  }

  // FilePicker chips dropped anywhere on the viewer load their system; captured before the
  // viewer's own drop handler, which takes care of real files (.json / .json.gz)
  function handle_picker_drop(event: DragEvent): void {
    const url = event.dataTransfer?.getData(`text/plain`)
    const picked = url && ternary_system_files.find((info) => info.url === url)
    if (!picked) return
    event.preventDefault()
    event.stopPropagation()
    void load_system(picked.name)
  }

  $effect(() => {
    if (!browser) return
    const file_param = page.url.searchParams.get(`file`)
    if (
      file_param &&
      file_param !== current_file &&
      ternary_system_files.some((file) => file.name === file_param)
    ) {
      void load_system(file_param, false)
      return
    }
    if (!current_entries && !loading) void load_system(DEFAULT_FILE, false)
  })

  let temperature = $state(300)
  let diagram = $state.raw<TernaryPhaseDiagram | null>(null)
  let selected_phase = $state<number | null>(null)

  const selected = $derived(
    diagram && selected_phase !== null ? diagram.phases[selected_phase] : null,
  )
  const selected_events = $derived(
    diagram && selected_phase !== null
      ? diagram.events.filter((event) =>
          event.reactions.some((rxn) =>
            [...rxn.reactants, ...rxn.products].some((item) => item.phase === selected_phase),
          ),
        )
      : [],
  )
  const system_title = $derived(current_file.replace(/\.json(?:\.gz)?$/, ``))
</script>

<svelte:head>
  <title>MatterViz Ternary T–x Phase Diagram</title>
  <meta
    name="description"
    content="Temperature-dependent ternary phase diagrams from convex-hull entries with G(T): isothermal sections, a composition-temperature prism, stability maps and transition reactions"
  />
</svelte:head>

<h1>Ternary Composition–Temperature Phase Diagrams</h1>

<p>
  The stability landscape of a ternary system as a function of temperature, computed from the
  same convex-hull entries that feed the <a href="/convex-hull">convex hull</a> viewers. Every
  phase gets a Gibbs energy of formation ΔG<sub>f</sub>(T) — from its own tabulated
  <code>free_energies</code>, or estimated with the Bartel et al. (2018) SISSO descriptor from
  volume per atom and reduced mass with experimental elemental references — and the lower hull
  is swept over temperature. Hull topology is piecewise constant, so the whole diagram is a
  sequence of isothermal sections separated by exactly located transitions: decompositions,
  polymorph changes and tie-line flips, each with its balanced reaction.
</p>

<p>
  Pick a system below, drag one onto the viewer, or drop your own <code>.json</code> /
  <code>.json.gz</code> array of convex-hull entries. The Alexandria sets hold every binary and
  ternary PBE entry within 0.3 eV/atom of the hull (<code>fetch-alexandria-ternaries.py</code
  >); the Materials Project sets are ternary slices of the quaternaries used on the convex-hull
  page.
</p>

<FilePicker
  files={ternary_system_files}
  active_files={current_file ? [current_file] : []}
  show_category_filters
  style="margin-bottom: 1em"
  on_click={(file) => load_system(file.name)}
/>

<div
  class={[`diagram-container`, `full-bleed`, { loading }]}
  ondropcapture={handle_picker_drop}
  ondragover={(event) => event.preventDefault()}
  role="region"
  aria-label="Ternary phase diagram viewer - drag and drop files here"
>
  {#if loading}
    <div class="loading-overlay">Loading {system_title || `entries`}…</div>
  {/if}
  {#if error_message}
    <div class="error-message" role="alert">{error_message}</div>
  {/if}
  {#if current_entries}
    <IsobaricTernaryPhaseDiagram
      entries={current_entries}
      bind:temperature
      bind:diagram
      bind:selected_phase
      title="{system_title} · {current_entries.length} entries"
      style="height: 780px"
      on_file_drop={(entries, filename) => {
        current_entries = entries
        current_file = filename
      }}
    />
  {/if}
</div>

{#if diagram}
  {@const bound = diagram}
  {@const windows = selected ? bound.stability_windows[selected.idx] : []}
  <section class="demo-section">
    <h2>Bound state</h2>
    <p>
      T = <strong>{format_num(temperature, `.0f`)} K</strong> · {bound.events.length} transitions
      between {format_num(bound.t_range[0], `.0f`)} and {format_num(bound.t_range[1], `.0f`)} K ·
      {bound.stability_windows.filter((list) => list.length > 0).length} phases stable somewhere
      in range · G(T) from {bound.sources.join(` + `)}.
      {#if selected}
        Selected <strong>{selected.label}</strong>
        {#if selected.entry.entry_id}<code>{selected.entry.entry_id}</code>{/if}
        — stable {windows
          .map(([lo, hi]) => `${format_num(lo, `.0f`)}–${format_num(hi, `.0f`)} K`)
          .join(`, `) || `nowhere`}{#each selected_events as event, idx (idx)};
          {format_num(event.temperature, `.0f`)} K: {event.reactions
            .map((rxn) => format_reaction(bound, rxn))
            .join(`; `)}{/each}.
      {:else}
        Click a phase (triangle, prism rod, map row or reaction formula) to inspect it.
      {/if}
    </p>
  </section>
{/if}

<section class="demo-section">
  <h2>How to read it</h2>
  <ul class="feature-list">
    <li>
      <strong>Isothermal section</strong>: tie-triangles are the three-phase regions at the
      current temperature; hovering any composition gives its equilibrium assemblage with atom
      fractions (the ternary lever rule). Unstable phases are coloured by their hull distance;
      orange rings mark the phases that change at the next transition on heating.
    </li>
    <li>
      <strong>3D prism</strong>: the same data as a composition–temperature prism. Stable
      phases are vertical rods over their stability windows, tie-lines sweep out the vertical
      sheets that bound the three-phase volumes, and the isothermal cutting plane can be
      dragged up and down (or driven by the slider) to slice the prism at any temperature;
      everything above the plane is ghosted so the slice reads like a cut-away. Orbit with the
      mouse, toggle with the 2D/3D buttons.
    </li>
    <li>
      <strong>Stability map</strong>: one row per phase across temperature. Solid bars are the
      exact stability windows; the colour ramp is the energy above hull elsewhere. Drag to
      scrub the temperature, click a formula to select the phase.
    </li>
    <li>
      <strong>Transitions</strong>: every change of hull topology, bisected to 0.5 K, with a
      balanced reaction in the heating direction. ▼ decomposition, ▲ new phase, ⇅ polymorph
      change, ⤭ tie-line flip (four-phase reaction).
    </li>
    <li>
      <strong>Gas atmosphere</strong>: for systems with O, N, H or F the controls pane can
      treat the element as a gas at a chosen partial pressure; lower p(O₂) drives reductions to
      lower temperatures. Keyboard: ←/→ step T, shift+←/→ jump between transitions, space plays
      a heating ramp.
    </li>
    <li>
      <strong>Caveats</strong>: the SISSO descriptor is a ~50 meV/atom estimate for solids and
      ignores melting, solid solutions and configurational entropy; PBE overbinds O₂, which is
      why oxygen-rich phases such as LiO₈ sit on the 0 K hull. Read transition temperatures as
      trends, not measurements.
    </li>
  </ul>
</section>

<style>
  .diagram-container {
    position: relative;
    margin-block: 1em 2em; /* not the shorthand: bleed-1400 owns margin-left */
    &.loading {
      opacity: 0.7;
    }
  }
  .loading-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 1em 2em;
    border-radius: 8px;
    z-index: 10;
  }
  .error-message {
    background: rgba(255, 0, 0, 0.1);
    color: #d32f2f;
    padding: 0.5em 1em;
    border-radius: 4px;
    margin: 0.5em;
  }
  .feature-list li {
    margin: 0.4em 0;
  }
</style>
