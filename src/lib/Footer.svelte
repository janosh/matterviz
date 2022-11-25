<script lang="ts">
  import { page } from '$app/stores'
  import { repository } from '../../package.json'
  import Icon from './Icon.svelte'
  import { show_icons } from './stores'
  import Toggle from './Toggle.svelte'
</script>

<footer>
  <a href="{repository}/blob/main/license">
    <Icon icon="octicon:law" />
    MIT License 2022
  </a>
  {#if $page.url.pathname !== `/acknowledgements`}
    <strong>&ensp;&bull;&ensp;</strong>
    <a href="acknowledgements">
      <Icon icon="fa6-solid:hands-clapping" />
      Acknowledgements
    </a>
  {/if}
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="bohr-atoms">
    <Icon icon="mdi:atom-variant" />
    Bohr Atoms
  </a>
  <p class="toggle-icons">
    <Toggle bind:checked={$show_icons} style="transform: scale(0.8);" />Icons?
  </p>
</footer>

<style>
  footer {
    margin: 6em 0 2em;
    text-align: center;
  }
  p.toggle-icons {
    display: flex;
    place-content: center;
    place-items: center;
    gap: 1ex;
  }
</style>
