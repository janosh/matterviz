<script lang="ts">
  import { Icon } from '$lib'
  import pkg from '$root/package.json'
</script>

<footer>
  <a href="{pkg.repository}/blob/main/license">
    <Icon icon="License" /> License
  </a>
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="/acknowledgements">
    <Icon icon="HandsClapping" /> Acknowledgements
  </a>
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="/contributing">
    <Icon icon="RepoFork" /> Contributing
  </a>
  <small>
    Built with Svelte by
    <a href="https://github.com/janosh">Janosh</a>
    &copy; 2022
  </small>
</footer>

<style>
  footer {
    margin: 6em 0 2em;
    text-align: center;
  }
  footer small {
    display: block;
    margin-top: 1em;
  }
</style>
