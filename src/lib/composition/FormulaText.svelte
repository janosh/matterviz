<script lang="ts">
  import { formula_text_tokens } from './formula-markup'

  // Free text with its chemical formulas marked up ("BaTiO3 cubic" -> BaTiO₃ cubic), for labels
  // and table cells whose plain string stays the value that is exported and filtered
  let { text }: { text: string } = $props()
</script>

{#each formula_text_tokens(text) as { text: plain, sub, sup }, idx (idx)}{#if sub}<sub
      >{sub}</sub
    >{:else if sup}<sup>{sup}</sup>{:else}{plain}{/if}{/each}

<style>
  /* small scripts that sit within the line instead of growing it */
  :is(sub, sup) {
    font-size: 0.7em;
    line-height: 0;
  }
</style>
