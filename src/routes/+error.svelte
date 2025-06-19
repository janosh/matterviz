<script lang="ts">
  import { page } from '$app/state'
  import { Icon } from '$lib'

  import pkg from '$root/package.json'

  let online: boolean = $state(true)
</script>

<svelte:head>
  <title>Error {page.status} &bull; {pkg.name}</title>
</svelte:head>

<svelte:window bind:online />

<div>
  <h1>Error {String(page.status).replace(`0`, `😵`)}: {page.error?.message}</h1>
  {#if page.status >= 500}
    <p>
      If page reloading doesn't help, please raise an issue on
      <a href="{pkg.homepage}/issues" target="_blank" rel="noreferrer">GitHub</a>. Thanks!
      🙏
    </p>
  {/if}
  {#if online === false}
    Looks like you're offline. If you think your connection is fine, check the
    <a href="https://githubstatus.com">GitHub status page</a>
    as this site is hosted by &thinsp;<Icon icon="GitHub" />&thinsp; GitHub Pages.
  {/if}

  <p>
    Back to <a href=".">
      landing page
    </a>.
  </p>
</div>

<style>
  div {
    font-size: 1.2em;
    max-width: 45em;
    padding: 5em 3em 1em;
    margin: auto;
    text-align: center;
  }
</style>
