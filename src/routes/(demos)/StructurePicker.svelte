<script module lang="ts">
  import type { Crystal } from '$lib'
  import { get_electro_neg_formula } from '$lib/composition'
  import { clamp01 } from '$lib/utils'
  import { structure_map } from '$site/structures'

  // Electronegativity-ordered HTML formula of a demo structure, empty when the id is
  // unknown or the structure has no parseable composition (a formula is decoration here,
  // never a reason to blank out the picker)
  export const formula_for = (struct_id: string): string => {
    const struct = structure_map.get(struct_id)
    if (!struct) return ``
    try {
      return get_electro_neg_formula(struct, false)
    } catch {
      return ``
    }
  }

  // Picked structures keyed by the "<id> <formula>" label the plots show in their legend.
  // Unknown ids drop out rather than inserting a hole in the series list.
  export const labeled_structures = (struct_ids: string[]): Record<string, Crystal> =>
    Object.fromEntries(
      struct_ids
        .map((struct_id) => structure_map.get(struct_id))
        .filter((struct) => struct !== undefined)
        .map((struct) => [`${struct.id} ${formula_for(struct.id ?? ``)}`, struct]),
    )

  // #rrggbb -> #rrggbbaa, for tinting a swatch with a plot series color
  export const hex_with_alpha = (hex_color: string, alpha_frac: number): string => {
    const alpha_hex = Math.round(clamp01(alpha_frac) * 255)
      .toString(16)
      .padStart(2, `0`)
    return hex_color.length === 7 ? `${hex_color}${alpha_hex}` : hex_color
  }
</script>

<script lang="ts">
  import { PLOT_COLORS } from '$lib/colors'
  import { sanitize_html } from '$lib/sanitize'
  import { structures } from '$site/structures'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLElement> {
    // A single id selects one structure, a list of ids selects many. Multi-select
    // buttons are tinted with the plot color of their position in the list, so they
    // match the series colors of whatever plot they feed.
    selected: string | string[]
  }
  let { selected = $bindable(), ...rest }: Props = $props()

  const toggle = (struct_id: string) => {
    if (!Array.isArray(selected)) selected = struct_id
    else if (selected.includes(struct_id)) {
      selected = selected.filter((sel_id) => sel_id !== struct_id)
    } else selected = [...selected, struct_id]
  }

  // -1 when unselected, else the series index (always 0 for single-select)
  const series_idx = (struct_id: string): number => {
    if (Array.isArray(selected)) return selected.indexOf(struct_id)
    return selected === struct_id ? 0 : -1
  }
</script>

<nav class="structure-picker" aria-label="Structure picker" {...rest}>
  {#each structures as struct (struct.id)}
    {@const struct_id = struct.id ?? ``}
    {@const sel_idx = series_idx(struct_id)}
    {@const color =
      sel_idx >= 0 && Array.isArray(selected)
        ? PLOT_COLORS[sel_idx % PLOT_COLORS.length]
        : null}
    <button
      class:selected={sel_idx >= 0}
      onclick={() => toggle(struct_id)}
      title={struct_id}
      style:background-color={color ? hex_with_alpha(color, 0.15) : null}
    >
      <span class="id">{struct_id}</span>
      <span class="formula">{@html sanitize_html(formula_for(struct_id))}</span>
    </button>
  {/each}
</nav>

<style>
  nav.structure-picker {
    display: flex;
    flex-wrap: wrap;
    place-content: center;
    gap: 6px;
    margin: 1em;
    button {
      font-size: 0.8em;
      flex: 0 0 auto;
      padding: 6px 8px 3px;
      background: color-mix(in srgb, var(--nav-link-bg) 40%, transparent);
      border: 1px solid transparent;
    }
    button.selected {
      outline: 1px solid var(--accent-color, #4e79a7);
    }
    .id {
      font-weight: 500;
    }
    .formula {
      color: var(--text-color-muted);
      font-size: 0.9em;
    }
  }
</style>
