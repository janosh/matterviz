<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import { repository } from '$root/package.json'
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
</style>
