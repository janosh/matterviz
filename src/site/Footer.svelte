<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import { show_icons } from '$lib/stores'
  import { repository } from '$root/package.json'
  import { Toggle } from 'svelte-zoo'
</script>

<footer>
  <a href="{repository}/blob/main/license">
    <Icon icon="octicon:law" />License
  </a>
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="/acknowledgements">
    <Icon icon="fa6-solid:hands-clapping" />Acknowledgements
  </a>
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="/changelog">
    <Icon icon="octicon:history" />Changelog
  </a>
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="/contributing">
    <Icon icon="octicon:repo-forked" />Contributing
  </a>
  <p class="toggle-icons">
    <Toggle bind:checked={$show_icons} style="transform: scale(0.8);" />Icons
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
    gap: 3pt;
  }
</style>
