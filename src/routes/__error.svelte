<script lang="ts" context="module">
  import { dev } from '$app/env'
  import type { Load } from '@sveltejs/kit'

  export const load: Load = ({ error, status, params: { slug } }) => ({
    props: { error, status, slug },
  })
</script>

<script lang="ts">
  export let status: number
  export let error: Error
  export let slug: string
</script>

<svelte:head>
  <title>{status}</title>
</svelte:head>

<div>
  {#if status === 404}
    <h1>⛔ &nbsp;{status}: Page '{slug}' not found</h1>
    <p>
      Back to
      <a sveltekit:prefetch href="/">landing page</a>.
    </p>
  {:else}
    <h1>⛔ &nbsp;{status}</h1>
  {/if}

  {#if dev && error?.stack}
    <h2>Stack Trace</h2>
    <pre>{error.stack}</pre>
  {/if}
</div>

<style>
  div {
    font-size: 1.2em;
    max-width: 45em;
    padding: 5em 3em 1em;
    margin: auto;
    text-align: center;
  }
  h2 {
    margin-top: 2em;
  }
  p {
    text-align: center;
    max-width: 35em;
    margin: auto;
  }
  pre {
    overflow: scroll;
    font-size: 0.9em;
    white-space: pre-wrap;
    background: var(--accentBg);
    padding: 5pt 1em;
    border-radius: 3pt;
  }
</style>
