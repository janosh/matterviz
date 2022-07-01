<script lang="ts">
  import { page } from '$app/stores'
</script>

<footer>
  <a href="https://github.com/janosh">&copy; Janosh Riebesell</a>
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="https://github.com/janosh/periodic-table/blob/main/license">
    MIT License 2022
  </a>
  {#if $page.url.pathname !== `/acknowledgements`}
    <strong>&ensp;&bull;&ensp;</strong>
    <a href="acknowledgements">Acknowledgements</a>
  {/if}
</footer>

<style>
  footer {
    margin: 6em 0 0;
    text-align: center;
  }
</style>
