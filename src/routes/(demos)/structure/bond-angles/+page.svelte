<script lang="ts">
  import type { Crystal } from '$lib'
  import { SETTINGS_CONFIG } from '$lib'
  import type { NormalizeMode, SplitMode } from '$lib/bond-angles'
  import {
    BondAnglePlot,
    DEFAULT_BIN_WIDTH,
    NORMALIZE_MODES,
    SPLIT_MODES,
  } from '$lib/bond-angles'
  import FilePicker from '$lib/FilePicker.svelte'
  import { Structure } from '$lib/structure'
  import type { BondingStrategy } from '$lib/structure/bonding'
  import { structure_files, structure_map } from '$site/structures'
  import EnumSelect from '../../EnumSelect.svelte'
  import StructurePicker, { labeled_structures } from '../../StructurePicker.svelte'

  const strategies = SETTINGS_CONFIG.structure.bonding_strategy.enum ?? {}

  // Zr16Bi16O56 spans several coordination environments, so its ADF shows well separated
  // tetrahedral, octahedral and cubic angle families
  let single_id = $state(`mp-756175`)
  let single_strategy = $state<BondingStrategy>(
    SETTINGS_CONFIG.structure.bonding_strategy.value,
  )
  let single_split_mode = $state<SplitMode>(`by_triplet`)
  let bin_width = $state(DEFAULT_BIN_WIDTH)

  const single_struct = $derived<Crystal | null>(structure_map.get(single_id) ?? null)
  const single_scene_props = $derived({ bonding_strategy: single_strategy })

  let selected_ids = $state([`mp-1`, `mp-2`, `mp-1234`])
  let multi_normalize = $state<NormalizeMode>(`density`)
  let multi_strategy = $state<BondingStrategy>(
    SETTINGS_CONFIG.structure.bonding_strategy.value,
  )

  const selected_structures = $derived(labeled_structures(selected_ids))
</script>

<h1>Bond-Angle Distributions (ADF)</h1>

<p>
  The angular distribution function counts, for every atom, the angle subtended at it by each
  pair of its bonded neighbours. Splitting by triplet type separates the coordination
  environments: a silicate shows a sharp tetrahedral <code>O-Si-O</code> peak near 109.5°
  alongside a much broader <code>Si-O-Si</code> linkage distribution. Angles that close through a
  periodic boundary are included. The cell is expanded with image atoms before the bond search, so
  boundary atoms are not under-coordinated.
</p>

<div class="bleed-1400">
  <h2>Single Structure</h2>

  <div class="demo-controls">
    <EnumSelect label="Strategy" options={strategies} bind:value={single_strategy} />
    <EnumSelect label="Split Mode" options={SPLIT_MODES} bind:value={single_split_mode} />
    <label>
      Bin width:
      <input type="range" min="0.5" max="10" step="0.5" bind:value={bin_width} />
      <span class="demo-value">{bin_width}°</span>
    </label>
  </div>

  <StructurePicker bind:selected={single_id} />

  <section class="demo-2col">
    {#if single_struct}
      <BondAnglePlot
        structures={single_struct}
        strategy={single_strategy}
        split_mode={single_split_mode}
        {bin_width}
        style="height: 500px"
      />
      <Structure
        structure={single_struct}
        scene_props={single_scene_props}
        style="height: 500px"
      />
    {/if}
  </section>

  <h2>Compare Structures</h2>
  <p>
    Raw counts scale with the number of atoms in the cell, so structures of different size are
    only comparable as densities. In density mode each structure contributes a distribution of
    unit area.
  </p>

  <div class="demo-controls">
    <EnumSelect label="Strategy" options={strategies} bind:value={multi_strategy} />
    <EnumSelect label="Normalization" options={NORMALIZE_MODES} bind:value={multi_normalize} />
  </div>

  <StructurePicker bind:selected={selected_ids} />

  <BondAnglePlot
    structures={selected_structures}
    strategy={multi_strategy}
    split_mode="by_structure"
    normalize={multi_normalize}
    {bin_width}
    style="height: 500px"
  />

  <h2>Try Your Own Structure</h2>
  <p>Pick a file below or drag &amp; drop onto the plot.</p>
  <FilePicker files={structure_files} show_category_filters style="margin-bottom: 1em" />
  <BondAnglePlot structures={{}} split_mode="by_triplet" style="height: 500px" />
</div>

<style>
  h2,
  p {
    text-align: center;
  }
  .demo-2col {
    margin: 2em 0;
  }
</style>
