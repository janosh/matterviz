<script lang="ts">
  // One tile per picked structure (styled in demo.css), tinted with its plot series color
  import type { Crystal } from '#lib'
  import { plot_color } from '#lib/colors/index.js'
  import { structure_map } from '#site/structures.js'
  import type { Snippet } from 'svelte'
  import { hex_with_alpha } from './StructurePicker.svelte'

  let { struct_ids, tile }: { struct_ids: string[]; tile: Snippet<[Crystal]> } = $props()
</script>

<div class="selected-structures-grid">
  {#each struct_ids as struct_id, idx (struct_id)}
    {@const struct_obj = structure_map.get(struct_id)}
    {#if struct_obj}
      <div
        class="structure-tile"
        style:background-color={hex_with_alpha(plot_color(idx), 0.15)}
      >
        <h3>{struct_id}</h3>
        {@render tile(struct_obj)}
      </div>
    {/if}
  {/each}
</div>
