<script lang="ts">
  import { page } from '$app/stores'
  import { repository } from '../../package.json'
</script>

<footer>
  <a href="{repository}/blob/main/license">MIT License 2022</a>
  {#if $page.url.pathname !== `/acknowledgements`}
    <strong>&ensp;&bull;&ensp;</strong>
    <a href="acknowledgements">Acknowledgements</a>
  {/if}
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="/bohr-atoms">Bohr Atoms</a>
</footer>

<style>
  footer {
    margin: 6em 0 2em;
    text-align: center;
  }
</style>
