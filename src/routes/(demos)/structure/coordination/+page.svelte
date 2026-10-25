<script lang="ts">
  import LazyDemo from '#site/LazyDemo.svelte'
  import { type Crystal, SETTINGS_CONFIG } from '#lib'
  import type { CoordinationSplitMode } from '#lib/coordination/index.js'
  import { COORDINATION_SPLIT_MODES, CoordinationBarPlot } from '#lib/coordination/index.js'
  import type { StructureSiteHighlight } from '#lib/plot/core/structure-input.js'
  import { type AtomColorConfig, type AnyStructure, Structure } from '#lib/structure/index.js'
  import type { BondingStrategy } from '#lib/structure/bonding.js'
  import { structure_map } from '#site/structures.js'
  import EnumSelect from '../../EnumSelect.svelte'
  import StructurePicker, { labeled_structures } from '../../StructurePicker.svelte'
  import StructureTiles from '../../StructureTiles.svelte'

  const { value: default_strategy, enum: strategy_options = {} } =
    SETTINGS_CONFIG.structure.bonding_strategy

  // Single structure example. Default to a complex oxide (Zr16Bi16O56) whose sites span
  // coordination numbers 4, 6 and 8, so the discrete color bar shows several segments.
  let single_id = $state<string>(`mp-756175`)
  let single_strategy = $state<BondingStrategy>(default_strategy)
  let single_split_mode = $state<CoordinationSplitMode>(`by_element`)

  const single_struct = $derived<Crystal | null>(structure_map.get(single_id) ?? null)

  // Color the structure viewers by coordination number so the discrete color bar shows
  // live next to the histogram; each section's scene_props links its bonding strategy so
  // changing a dropdown updates that section's structure(s) and histogram together.
  const coord_coloring: AtomColorConfig = {
    mode: `coordination`,
    color_scale: `interpolateViridis`,
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
  let multi_split_mode = $state<CoordinationSplitMode>(`by_element`)
  let multi_strategy = $state<BondingStrategy>(default_strategy)

  // Overlay tiles share the same coordination coloring, linked to the multi strategy
  let multi_color_config = $state({ ...coord_coloring })
  let multi_scene_props = $derived({ bonding_strategy: multi_strategy, gizmo: false })

  const selected_structures = $derived(labeled_structures(selected_ids))

  let single_highlight = $state<number[]>([])
  let multi_highlights = $state.raw<StructureSiteHighlight[]>([])
  const highlight_of = (structure: AnyStructure): number[] =>
    multi_highlights.find((highlight) => highlight.structure === structure)?.site_indices ?? []
</script>

<h1 id="coordination-number-histograms">Coordination Number Histograms</h1>

<p class="demo-intro">
  Histograms and structure colors share the selected bonding strategy. Hover a bar to highlight
  the sites it counts. Click a discrete color-bar segment to hide that coordination number.
</p>

<div class="bleed-1400">
  <h2 id="single-structure">Single Structure</h2>

  <div class="demo-controls">
    <EnumSelect label="Strategy" options={strategy_options} bind:value={single_strategy} />
    <EnumSelect
      label="Split Mode"
      options={COORDINATION_SPLIT_MODES}
      bind:value={single_split_mode}
    />
  </div>

  <StructurePicker bind:selected={single_id} />

  <section class="demo-2col">
    {#if single_struct}
      <LazyDemo label="Single Structure">
        <CoordinationBarPlot
          structures={single_struct}
          strategy={single_strategy}
          split_mode={single_split_mode}
          style="height: 500px"
          on_sites_hover={(highlights) =>
            (single_highlight = highlights?.[0]?.site_indices ?? [])}
        />
      </LazyDemo>
      <Structure
        structure={single_struct}
        bind:highlighted_sites={single_highlight}
        bind:atom_color_config={single_color_config}
        scene_props={single_scene_props}
        style="height: 500px"
      />
    {/if}
  </section>

  <h2 id="multiple-structures-overlay">Multiple Structures Overlay</h2>

  <div class="demo-controls">
    <EnumSelect label="Strategy" options={strategy_options} bind:value={multi_strategy} />
    <EnumSelect
      label="Split Mode"
      options={COORDINATION_SPLIT_MODES}
      bind:value={multi_split_mode}
    />
  </div>

  <StructurePicker bind:selected={selected_ids} />

  <LazyDemo label="Multiple Structures Overlay" height="400px">
    <section class="multi-structure-layout" style="height: 400px">
      <CoordinationBarPlot
        structures={selected_structures}
        strategy={multi_strategy}
        split_mode={multi_split_mode}
        style="height: 100%"
        on_sites_hover={(highlights) => (multi_highlights = highlights ?? [])}
      />
      <StructureTiles struct_ids={selected_ids}>
        {#snippet tile(struct_obj)}
          <Structure
            structure={struct_obj}
            highlighted_sites={highlight_of(struct_obj)}
            bind:atom_color_config={multi_color_config}
            scene_props={multi_scene_props}
            style="height: 100%"
            enable_info_pane={false}
            enable_measure_mode={false}
          />
        {/snippet}
      </StructureTiles>
    </section>
  </LazyDemo>
</div>

<style>
  .bleed-1400 {
    container-type: inline-size;
  }
  .multi-structure-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1em;
  }
  .multi-structure-layout :global(.selected-structures-grid) {
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: minmax(0, 1fr);
  }
  @container (min-width: 901px) {
    .multi-structure-layout :global(.structure-tile:last-child:nth-child(odd)) {
      grid-column: 1 / -1;
    }
  }
  @container (max-width: 900px) {
    .multi-structure-layout {
      grid-template:
        minmax(0, 1.1fr) minmax(0, 0.9fr) /
        minmax(0, 1.1fr) minmax(0, 0.9fr);
      gap: 0.5em;
    }
    .multi-structure-layout :global(.selected-structures-grid) {
      display: contents;
    }
  }
</style>
