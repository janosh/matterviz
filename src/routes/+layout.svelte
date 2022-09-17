<script lang="ts">
  import { page } from '$app/stores'
  import Footer from '$lib/Footer.svelte'
  import GitHubCorner from 'svelte-github-corner'
  import { repository } from '../../package.json'
  import '../app.css'
</script>

<GitHubCorner href={repository} />
{#if $page.url.pathname !== `/`}
  <a href="/" class="back" data-sveltekit-prefetch>&laquo; back</a>
  <main>
    <slot />
  </main>
{:else}
  <slot />
{/if}

<Footer />

<style>
  :global(:root) {
    --ghc-color: var(--page-bg);
    --ghc-bg: white;
    --sms-options-bg: black;
    --sms-max-width: 22em;
    --sms-border: 1px dotted teal;
    --sms-focus-border: 1px dotted cornflowerblue;
    --sms-active-color: cornflowerblue;
  }
  :global(div.multiselect) {
    margin: auto;
  }
  :global(div.multiselect input::placeholder) {
    opacity: 0.7;
    padding: 1ex;
  }
  main {
    margin: auto;
    max-width: 75em;
  }
  a.back {
    padding: 2pt 1ex;
    border-radius: 4pt;
    background: rgba(255, 255, 255, 0.1);
    transition: color 0.3s, background-color 0.3s;
    position: absolute;
    top: 2em;
    left: 2em;
  }
  a.back:hover {
    background: rgba(255, 255, 255, 0.2);
  }
</style>
