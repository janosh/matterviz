<script lang="ts">
  import { page } from '$app/state'
  import { demos } from './state.svelte'

  interface Props {
    routes?: string[]
    labels?: Record<string, string>
  }
  let { routes = demos.routes, labels = {} }: Props = $props()

  let is_current = $derived((path: string) => {
    if (page.url.pathname.startsWith(path)) return `page`
    return undefined
  })
</script>

<nav>
  <a href="/" aria-current={page.url.pathname === `/` ? `page` : undefined}>/home</a>
  {#each routes as href (href)}
    <a {href} aria-current={is_current(href)}>{labels[href] ?? href}</a>
  {/each}
</nav>

<style>
  nav {
    display: flex;
    gap: 1em calc(2pt + 1cqw);
    place-content: center;
    margin: -1em auto 2em;
    padding: 1em;
    max-width: 45em;
    flex-wrap: wrap;
  }
  nav > a {
    padding: 0 4pt;
    background-color: var(--nav-link-bg);
    border-radius: 3pt;
    transition: 0.2s;
  }
  nav > a:hover {
    background-color: var(--nav-link-hover-bg);
  }
  nav > a[aria-current='page'] {
    color: var(--nav-link-active-color);
  }
</style>
