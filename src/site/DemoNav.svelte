<script lang="ts">
  import { page } from '$app/state'
  import { click_outside } from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLElementTagNameMap[`nav`]> {
    routes: (string | [string, string])[]
  }
  let { routes = [], ...rest }: Props = $props()

  let is_open = $state(false)

  let is_current = $derived((path: string) => {
    if (path === `/`) return page.url.pathname === `/` ? `page` : undefined
    if (page.url.pathname.startsWith(path)) return `page`
    return undefined
  })
</script>

<nav {...rest} {@attach click_outside({ callback: () => is_open = false })}>
  <button
    class="burger-button"
    onclick={() => is_open = !is_open}
    aria-label="Toggle navigation menu"
    aria-expanded={is_open}
  >
    <span class="burger-line"></span>
    <span class="burger-line"></span>
    <span class="burger-line"></span>
  </button>

  <div class="menu-content" class:open={is_open}>
    {#each routes as route (JSON.stringify(route))}
      {@const [href, label] = Array.isArray(route) ? route : [route, route]}
      <a {href} aria-current={is_current(href)} onclick={() => is_open = false}>{
        label
      }</a>
    {/each}
  </div>
</nav>

<style>
  nav {
    position: relative;
    margin: -0.75em auto 1.25em;
    max-width: 55em;
  }
  /* Desktop navigation (default) */
  .menu-content {
    display: flex;
    gap: 1ex 1em;
    place-content: center;
    flex-wrap: wrap;
    padding: 0.5em;
  }
  .menu-content > a {
    line-height: 1.3;
    padding: 0 2pt;
    border-radius: 2pt;
    text-decoration: none;
    color: inherit;
    transition: background-color 0.2s;
  }
  .menu-content > a:hover {
    background-color: var(--nav-link-bg-hover);
  }
  .menu-content > a[aria-current='page'] {
    color: var(--nav-link-active-color);
    background-color: var(--nav-link-bg-hover, rgba(128, 128, 128, 0.24));
  }
  /* Mobile burger button */
  .burger-button {
    position: fixed;
    top: 1rem;
    left: 1rem;
    flex-direction: column;
    justify-content: space-around;
    width: 1.4rem;
    height: 1.4rem;
    background: transparent;
    padding: 0;
    z-index: var(--nav-toggle-btn-z-index, 10);
  }
  .burger-line {
    height: 0.18rem;
    background-color: var(--text-color);
    border-radius: 8px;
    transition: all 0.2s linear;
    transform-origin: 1px;
  }
  .burger-button[aria-expanded='true'] .burger-line:first-child {
    transform: rotate(45deg);
  }
  .burger-button[aria-expanded='true'] .burger-line:nth-child(2) {
    opacity: 0;
  }
  .burger-button[aria-expanded='true'] .burger-line:nth-child(3) {
    transform: rotate(-45deg);
  }
  /* Mobile styles */
  @media (max-width: 767px) {
    .burger-button {
      display: flex;
    }
    .menu-content {
      position: fixed;
      top: 3rem;
      background-color: var(--surface-bg, var(--bg-color, #ffffff));
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
      z-index: var(--nav-mobile-z-index, 2);
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      gap: 0.2em;
      max-width: 90vw;
      border: 1px solid var(--border-color, rgba(128, 128, 128, 0.25));
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    .menu-content.open {
      opacity: 1;
      visibility: visible;
    }
    .menu-content > a {
      padding: 2pt 8pt;
    }
  }
</style>
