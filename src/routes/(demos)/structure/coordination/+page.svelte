<script lang="ts">
  import { sanitize_html } from '$lib/sanitize'
  import { type Crystal, SETTINGS_CONFIG } from '$lib'
  import { PLOT_COLORS } from '$lib/colors'
  import { get_electro_neg_formula } from '$lib/composition'
  import type { SplitMode } from '$lib/coordination'
  import { CoordinationBarPlot, SPLIT_MODES } from '$lib/coordination'
  import { type AtomColorConfig, Structure } from '$lib/structure'
  import type { BondingStrategy } from '$lib/structure/bonding'
  import { structures } from '$site/structures'

  // Map structures by id for O(1) lookup (structures is a static import, not reactive)
  const structures_by_id: Record<string, Crystal> = Object.fromEntries(
    structures.map((struct) => [struct.id, struct]),
  )

  // Helper: convert #rrggbb to #rrggbbaa
  function hex_with_alpha(hex_color: string, alpha_frac: number): string {
    const clamped = Math.max(0, Math.min(1, alpha_frac))
    const alpha_byte = Math.round(clamped * 255)
    const alpha_hex = alpha_byte.toString(16).padStart(2, `0`)
    return hex_color.length === 7 ? `${hex_color}${alpha_hex}` : hex_color
  }

  // Single structure example. Default to a complex oxide (Zr16Bi16O56) whose sites span
  // coordination numbers 4, 6 and 8, so the discrete color bar shows several segments.
  let single_id = $state<string>(`mp-756175`)
  let single_strategy = $state<BondingStrategy>(
    SETTINGS_CONFIG.structure.bonding_strategy.value,
  )
  let single_split_mode = $state<SplitMode>(`by_element`)

  const single_struct = $derived<Crystal | null>(structures_by_id[single_id] ?? null)

  // Color the structure viewers by coordination number so the discrete color bar shows
  // live next to the histogram; each section's scene_props links its bonding strategy so
  // changing a dropdown updates that section's structure(s) and histogram together.
  const coord_coloring: Partial<AtomColorConfig> = {
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

  function toggle_select(id: string) {
    selected_ids = selected_ids.includes(id)
      ? selected_ids.filter((selected_id) => selected_id !== id)
      : [...selected_ids, id]
  }

  const selected_structures = $derived<Record<string, Crystal>>(
    Object.fromEntries(
      selected_ids
        .map((id) => structures_by_id[id])
        // oxlint-disable-next-line eslint-plugin-unicorn/prefer-native-coercion-functions -- type predicate needed for narrowing
        .filter((struct): struct is Crystal => Boolean(struct))
        .map((struct) => [`${struct.id} ${formula_for(struct.id ?? ``)}`, struct]),
    ),
  )

  function formula_for(id: string): string {
    const struct = structures_by_id[id]
    if (!struct) return ``
    try {
      return get_electro_neg_formula(struct, false)
    } catch {
      return ``
    }
  }

  const strategies = Object.entries(SETTINGS_CONFIG.structure.bonding_strategy.enum ?? {}).map(
    ([value, label]) => ({ value, label }),
  )

  const split_modes = Object.entries(SPLIT_MODES).map(([value, label]) => ({ value, label }))
</script>

<h1>Coordination Number Histograms</h1>

<p>
  Visualize coordination numbers in crystal structures using different bonding strategies. The
  coordination number (CN) is the number of nearest neighbors around each atom. The structure
  viewers color each atom by its CN and show a <strong>discrete color bar</strong>
  legend (bottom-right) with one labeled segment per integer CN value. Click a segment to hide atoms
  with that CN; changing the strategy updates both the histogram and the bar.
</p>

<div class="bleed-1400">
  <h2>Single Structure</h2>

  <div class="controls">
    <label>
      Strategy:
      <select bind:value={single_strategy}>
        {#each strategies as { value, label } (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>

    <label>
      Split Mode:
      <select bind:value={single_split_mode}>
        {#each split_modes as { value, label } (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
  </div>

  <nav>
    {#each structures as struct (struct.id)}
      {@const struct_id = struct.id ?? ``}
      <button
        class:selected={struct_id === single_id}
        onclick={() => (single_id = struct_id)}
        title={struct_id}
      >
        <span class="id">{struct_id}</span>
        <span class="formula">{@html sanitize_html(formula_for(struct_id))}</span>
      </button>
    {/each}
  </nav>

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

  <div class="controls">
    <label>
      Strategy:
      <select bind:value={multi_strategy}>
        {#each strategies as { value, label } (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>

    <label>
      Split Mode:
      <select bind:value={multi_split_mode}>
        {#each split_modes as { value, label } (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
  </div>

  <nav>
    {#each structures as struct (struct.id)}
      {@const struct_id = struct.id ?? ``}
      {@const sel_idx = selected_ids.indexOf(struct_id)}
      {@const series_color = sel_idx >= 0 ? PLOT_COLORS[sel_idx % PLOT_COLORS.length] : null}
      {@const btn_bg = series_color ? hex_with_alpha(series_color, 0.15) : null}
      <button
        class:active={sel_idx >= 0}
        onclick={() => toggle_select(struct_id)}
        title={struct_id}
        style:background-color={btn_bg}
      >
        <span class="id">{struct_id}</span>
        <span class="formula">{@html sanitize_html(formula_for(struct_id))}</span>
      </button>
    {/each}
  </nav>

  <section>
    <CoordinationBarPlot
      structures={selected_structures}
      strategy={multi_strategy}
      split_mode={multi_split_mode}
      style="height: 400px"
    />
    <div class="selected-structures-grid">
      {#each selected_ids as struct_id, idx (struct_id)}
        {@const struct_obj = structures_by_id[struct_id]}
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
              style="height: 180px; width: 100%"
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
  .controls {
    display: flex;
    gap: 1em;
    margin: 1em 0;
    flex-wrap: wrap;
  }
  .controls label {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    place-content: center;
    gap: 6px;
    margin: 1em;
  }
  nav button {
    font-size: 0.8em;
    flex: 0 0 auto;
    padding: 6px 8px 3px;
    background: color-mix(in srgb, var(--nav-link-bg) 40%, transparent);
  }
  nav button.selected {
    outline: 1px solid var(--accent-color, #4e79a7);
  }
  nav .id {
    font-weight: 500;
  }
  nav .formula {
    color: var(--text-color-muted);
    font-size: 0.9em;
  }
  .bleed-1400 > section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1em;
  }
  .selected-structures-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5em;
    align-content: start;
  }
  .structure-tile {
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
