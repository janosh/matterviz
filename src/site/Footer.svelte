<script lang="ts">
  import pkg from '$root/package.json'
</script>

<footer>
  <a href="{pkg.repository}/blob/main/license">
    <svg><use href="#icon-license" /></svg> License
  </a>
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="/acknowledgements">
    <svg><use href="#icon-hands-clapping" /></svg> Acknowledgements
  </a>
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="/changelog">
    <svg><use href="#icon-changelog" /></svg> Changelog
  </a>
  <strong>&ensp;&bull;&ensp;</strong>
  <a href="/contributing">
    <svg><use href="#icon-repo-fork" /></svg> Contributing
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
