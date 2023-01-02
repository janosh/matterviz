<script lang="ts">
  import Icon from '@iconify/svelte'
  import { show_icons } from './stores'
</script>

{#if $show_icons}
  <Icon inline {...$$props} style="padding: 0 5pt 0 0;" />
{/if}
