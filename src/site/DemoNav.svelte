<script lang="ts">
  import { page } from '$app/stores'
  import { demos } from './stores'

  export let routes = $demos
  export let labels: Record<string, string> = {}

  $: is_current = (path: string) => {
    if ($page.url.pathname.startsWith(path)) return `page`
    return undefined
  }
</script>

<nav>
  {#each routes as href (href)}
    <a {href} aria-current={is_current(href)}>{labels[href] ?? href}</a>
  {/each}
</nav>

<style>
  nav {
    display: flex;
    gap: 1em calc(2pt + 1cqw);
    place-content: center;
    margin: 1em auto 2em;
    padding: 1em;
    max-width: 45em;
    flex-wrap: wrap;
  }
  nav > a {
    padding: 0 4pt;
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: 3pt;
    transition: 0.2s;
  }
  nav > a[aria-current='page'] {
    color: mediumseagreen;
  }
</style>
