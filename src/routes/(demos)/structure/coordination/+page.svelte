<script lang="ts">
  import { type Crystal, SETTINGS_CONFIG } from '$lib'
  import { PLOT_COLORS } from '$lib/colors'
  import type { SplitMode } from '$lib/coordination'
  import { CoordinationBarPlot, SPLIT_MODES } from '$lib/coordination'
  import { type AtomColorConfig, Structure } from '$lib/structure'
  import type { BondingStrategy } from '$lib/structure/bonding'
  import { structure_map } from '$site/structures'
  import EnumSelect from '../../EnumSelect.svelte'
  import StructurePicker, {
    hex_with_alpha,
    labeled_structures,
  } from '../../StructurePicker.svelte'

  // Single structure example. Default to a complex oxide (Zr16Bi16O56) whose sites span
  // coordination numbers 4, 6 and 8, so the discrete color bar shows several segments.
  let single_id = $state<string>(`mp-756175`)
  let single_strategy = $state<BondingStrategy>(
    SETTINGS_CONFIG.structure.bonding_strategy.value,
  )
  let single_split_mode = $state<SplitMode>(`by_element`)

  const single_struct = $derived<Crystal | null>(structure_map.get(single_id) ?? null)

  // Color the structure viewers by coordination number so the discrete color bar shows
  // live next to the histogram; each section's scene_props links its bonding strategy so
  // changing a dropdown updates that section's structure(s) and histogram together.
  const coord_coloring: AtomColorConfig = {
    mode: `coordination`,
    scale: `interpolateViridis`,
    scale_type: `continuous`,
  }
  let single_color_config = $state({ ...coord_coloring })
  let single_scene_props = $derived({ bonding_strategy: single_strategy })

  // Multiple structures example. Default to structures spanning low, medium and high
  // coordination: Ag4Hg4S4BrCl3 (CN 2-4), Zr18Pd24 (CN 6,7,9), Ac4Mg2 (CN 8,11,12).
  let selected_ids = $state<string[]>([
    `mp-1229155`,
    `mp-12712`,
    `mp-1183089-Ac4Mg2-monoclinic`,
  ])
  let multi_split_mode = $state<SplitMode>(`by_element`)
  let multi_strategy = $state<BondingStrategy>(
    SETTINGS_CONFIG.structure.bonding_strategy.value,
  )

  // Overlay tiles share the same coordination coloring, linked to the multi strategy
  let multi_color_config = $state({ ...coord_coloring })
  let multi_scene_props = $derived({ bonding_strategy: multi_strategy, gizmo: false })

  const selected_structures = $derived(labeled_structures(selected_ids))

  const strategies = SETTINGS_CONFIG.structure.bonding_strategy.enum ?? {}
</script>

<h1>Coordination Number Histograms</h1>

<p>
  Histograms and structure colors share the selected bonding strategy. Click a discrete
  color-bar segment to hide that coordination number.
</p>

<div class="bleed-1400">
  <h2>Single Structure</h2>

  <div class="demo-controls">
    <EnumSelect label="Strategy" options={strategies} bind:value={single_strategy} />
    <EnumSelect label="Split Mode" options={SPLIT_MODES} bind:value={single_split_mode} />
  </div>

  <StructurePicker bind:selected={single_id} />

  <section>
    {#if single_struct}
      <CoordinationBarPlot
        structures={single_struct}
        strategy={single_strategy}
        split_mode={single_split_mode}
        style="height: 500px"
      />
      <Structure
        structure={single_struct}
        bind:atom_color_config={single_color_config}
        scene_props={single_scene_props}
        style="height: 500px"
      />
    {/if}
  </section>

  <h2>Multiple Structures Overlay</h2>

  <div class="demo-controls">
    <EnumSelect label="Strategy" options={strategies} bind:value={multi_strategy} />
    <EnumSelect label="Split Mode" options={SPLIT_MODES} bind:value={multi_split_mode} />
  </div>

  <StructurePicker bind:selected={selected_ids} />

  <section class="multi-structure-layout" style="height: 400px">
    <CoordinationBarPlot
      structures={selected_structures}
      strategy={multi_strategy}
      split_mode={multi_split_mode}
      padding={{ l: 50 }}
      style="height: 100%"
    />
    <div class="selected-structures-grid">
      {#each selected_ids as struct_id, idx (struct_id)}
        {@const struct_obj = structure_map.get(struct_id)}
        {@const series_color = PLOT_COLORS[idx % PLOT_COLORS.length]}
        {#if struct_obj}
          <div
            class="structure-tile"
            style:background-color={hex_with_alpha(series_color, 0.15)}
          >
            <h3>{struct_id}</h3>
            <Structure
              structure={struct_obj}
              atom_color_config={multi_color_config}
              scene_props={multi_scene_props}
              style="height: 100%"
              enable_info_pane={false}
              enable_measure_mode={false}
            />
          </div>
        {/if}
      {/each}
    </div>
  </section>
</div>

<style>
  .bleed-1400 {
    container-type: inline-size;
  }
  .bleed-1400 > section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1em;
  }
  .selected-structures-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: minmax(0, 1fr);
    gap: 0.5em;
  }
  @container (min-width: 901px) {
    .structure-tile:last-child:nth-child(odd) {
      grid-column: 1 / -1;
    }
  }
  @container (max-width: 900px) {
    .bleed-1400 > .multi-structure-layout {
      --barplot-min-height: 0;
      grid-template:
        minmax(0, 1.1fr) minmax(0, 0.9fr) /
        minmax(0, 1.1fr) minmax(0, 0.9fr);
      gap: 0.5em;
    }
    .selected-structures-grid {
      display: contents;
    }
  }
  .structure-tile {
    --struct-min-width: 0;
    min-width: 0;
    min-height: 0;
    border-radius: 4px;
    position: relative;
    h3 {
      margin: 0;
      font-size: 14px;
      position: absolute;
      top: 3pt;
      left: 1ex;
      z-index: 1;
    }
  }
</style>
