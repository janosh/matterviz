<script lang="ts">
  import { page } from '$app/state'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLElementTagNameMap[`nav`]> {
    routes: (string | [string, string])[]
  }
  let { routes = [], ...rest }: Props = $props()

  let is_current = $derived((path: string) => {
    if (path === `/`) return page.url.pathname === `/` ? `page` : undefined
    if (page.url.pathname.startsWith(path)) return `page`
    return undefined
  })
</script>

<nav {...rest}>
  {#each routes as route (JSON.stringify(route))}
    {@const [href, label] = Array.isArray(route) ? route : [route, route]}
    <a {href} aria-current={is_current(href)}>{label}</a>
  {/each}
</nav>

<style>
  nav {
    display: flex;
    gap: 1em calc(2pt + 1cqw);
    place-content: center;
    margin: -1em auto 2em;
    padding: 1em;
    max-width: 55em;
    flex-wrap: wrap;
  }
  nav > a {
    padding: 0 4pt;
    border-radius: 3pt;
    transition: 0.2s;
  }
  nav > a:hover {
    background-color: var(--nav-link-bg-hover);
  }
  nav > a[aria-current='page'] {
    color: var(--nav-link-active-color);
  }
</style>
