<script lang="ts">
  import {
    import_pymatgen_pourbaix,
    nernst_slope,
    POURBAIX_DEFAULTS,
    PourbaixControls,
    PourbaixDiagram,
  } from '#lib/pourbaix/index'
  import FilePicker from '#lib/FilePicker.svelte'
  import { as_text, file_drop_zone } from '#lib/io/index'
  import { pourbaix_systems } from '#site/pourbaix'
  import { set_url_param, url_selection } from '#site/state.svelte'
  import { format_num } from 'svelte-widgets/format'

  const system = url_selection(`system`, Object.keys(pourbaix_systems))
  // a dropped pymatgen JSON file replaces the picked system until the next pick
  let dropped = $state<ReturnType<typeof import_pymatgen_pourbaix> | null>(null)
  let drop_error = $state(``)
  const { entries, water_energy, element_log_conc, ...current } = $derived(
    dropped ?? pourbaix_systems[system.value],
  )
  // a new system resets its own composition and activity
  let composition = $derived(current.composition ?? null)
  let log_conc = $derived(current.log_conc ?? POURBAIX_DEFAULTS.log_conc)
  let temperature = $state(POURBAIX_DEFAULTS.temperature)
  let show_water_lines = $state(true)
  let show_labels = $state(true)
  let heatmap_formula = $state<string | null>(null)
</script>

<h1>Pourbaix Diagram</h1>

<p>
  Potential–pH (Pourbaix) diagrams show which species of a metal is thermodynamically stable in
  water at a given electrode potential <em>E</em> (V vs the standard hydrogen electrode) and
  pH. Each species' free energy of formation from the metal and water is a plane over (pH,
  <em>E</em>) per metal atom; the lowest plane wins. Dashed lines bound water's own stability
  window: below the lower one water is reduced to H₂, above the upper one oxidized to O₂. Hover
  a domain for its species and free energy, drag or scroll to pan and zoom. With two metals, a
  domain is the lowest-energy pair of species (one per metal, or a mixed solid) at the chosen
  metal ratio. Drop a pymatgen JSON file onto the plot: a list of <code>PourbaixEntry</code>
  dicts (e.g. <code>MPRester().get_pourbaix_entries(["Fe", "Cr"])</code> saved with
  <code>monty.serialization.dumpfn</code>) or a <code>PourbaixDiagram.as_dict()</code>.
</p>

<!-- the same controls sit in the plot's settings pane (gear icon) -->
<section class="controls">
  <!-- a heatmap species of the previous system would name no entry of the new one -->
  <FilePicker
    {...system.picker(`system`)}
    active_files={dropped ? [] : [system.value]}
    on_click={({ name }) => {
      system.value = name
      ;[dropped, heatmap_formula, drop_error] = [null, null, ``]
    }}
  />
  <PourbaixControls
    bind:log_conc
    bind:temperature
    bind:show_water_lines
    bind:show_labels
    bind:heatmap_formula
    bind:composition
    formulas={entries.map((entry) => entry.formula)}
  />
</section>

{#if drop_error}<p style="color: var(--error-color, crimson)">{drop_error}</p>{/if}

<!-- not keyed on the system: new entries recompute in place, a remount cost ~9 ms -->
<div
  {@attach file_drop_zone({
    allow: () => true,
    max_files: 1,
    on_drop: (content) => {
      dropped = import_pymatgen_pourbaix(JSON.parse(as_text(content)))
      ;[drop_error, heatmap_formula] = [``, null]
      set_url_param(`system`, null)
    },
    on_error: (msg) => (drop_error = msg),
  })}
>
  <PourbaixDiagram
    {entries}
    {water_energy}
    {element_log_conc}
    bind:composition
    bind:log_conc
    bind:temperature
    bind:show_water_lines
    bind:show_labels
    bind:heatmap_formula
    style="--scatter-height: 520px"
  />
</div>

<section>
  <h2>Try it</h2>
  <ul>
    <li>
      Raise the ion activity: the dissolved (corrosion) domains such as Fe²⁺, Cu²⁺ and Zn²⁺
      shrink while the metal and oxide (passivation) domains grow. Each decade moves a redox
      boundary like Fe/Fe²⁺ by 2.303 RT/(nF) (29.6 mV for n = 2 at 298 K) and an acid–base
      boundary like Zn²⁺/ZnO by 1/m pH units for m protons released per metal atom (½ here).
    </li>
    <li>
      In Cu–H₂O, lower the activity below 10<sup>−6.1</sup>: Cu⁺ gets a sliver of its own
      between Cu and Cu²⁺. At higher activities it disproportionates (2Cu⁺ → Cu + Cu²⁺).
    </li>
    <li>
      Raise the temperature: the water lines steepen with the Nernst slope −2.303 RT/F = −{format_num(
        nernst_slope(temperature) * 1000,
        `.1f`,
      )} mV/pH.
    </li>
    <li>
      In Ag–Te–H₂O, drag the x<sub>Ag</sub> slider past ⅔, Ag₂Te's own ratio: the Ag₂Te + TeH₂(aq)
      domain near pH 0 and 0 V turns into Ag + Ag₂Te, and the Te-rich domains vanish (30 domains
      drop to 25).
    </li>
    <li>
      Pick a species for the stability heatmap to shade how far (eV per metal atom) it lies
      above the stable one, e.g. how strongly Fe₂O₃ is driven to dissolve in acid.
    </li>
  </ul>
  <h2>Data</h2>
  <p>
    ΔfG° values (kJ/mol, 298.15 K) of every species and of H₂O(l) are from
    <a
      href="https://openstax.org/books/chemistry-2e/pages/g-standard-thermodynamic-properties-for-selected-substances"
      >OpenStax Chemistry 2e, Appendix G</a
    >, converted to eV. <strong>Simplified diagrams:</strong> that table lists no hydroxo-anions
    (HFeO₂⁻, HCuO₂⁻, ZnO₂²⁻), so the oxides here extend to high pH where full Pourbaix-atlas diagrams
    show the metal redissolving. Temperature changes only the RT terms; ΔfG° stay at their 298.15
    K values.
  </p>
  <p>
    Ag–Te–H₂O (MP) is the Materials Project data of pymatgen's binary Pourbaix test (<a
      href="https://github.com/materialsproject/pymatgen/blob/master/test-files/analysis/pourbaix_diagram/pourbaix_test_data.json"
      >pourbaix_test_data.json</a
    >, MIT license): DFT formation energies of the solids with experimental ion energies, at
    ion activities of 10<sup>−8</sup>. As in pymatgen, solids off the hull of formation
    energies are filtered out and water's ΔfG° is pymatgen's −2.4583 eV; its stable domains
    match pymatgen's.
  </p>
</section>

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1em 2em;
    margin-block: 1em;
  }
</style>
