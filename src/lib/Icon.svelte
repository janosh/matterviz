<script lang="ts">
  import { show_icons } from '$lib/stores'
  import Icon from '@iconify/svelte'
</script>

{#if $show_icons}
  <Icon inline {...$$props} style="padding: 0 5pt 0 0;" />
{/if}
