<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { element_data } from '$lib'
  import { theme_state } from '$lib/state.svelte'
  import { apply_theme_to_dom, AUTO_THEME, COLOR_THEMES } from '$lib/theme'
  import ThemeControl from '$lib/theme/ThemeControl.svelte'
  import pkg from '$root/package.json'
  import { DemoNav, Footer } from '$site'
  import { demos } from '$site/state.svelte'
  import type { Snippet } from 'svelte'
  import { CmdPalette } from 'svelte-multiselect'
  import { CopyButton, GitHubCorner } from 'svelte-zoo'
  import '../app.css'

  interface Props {
    children?: Snippet
  }
  let { children }: Props = $props()

  // Apply theme changes when mode changes (after SSR)
  $effect(() => {
    if (typeof window !== `undefined`) {
      apply_theme_to_dom(theme_state.mode)
    }
  })

  // Update system preference when it changes
  $effect(() => {
    if (typeof window !== `undefined`) {
      const media_query = window.matchMedia(`(prefers-color-scheme: dark)`)

      const update_system_mode = () => {
        const new_preference = media_query.matches
          ? COLOR_THEMES.dark
          : COLOR_THEMES.light
        theme_state.system_mode = new_preference

        // If user is on auto mode, update the theme
        if (theme_state.mode === AUTO_THEME) apply_theme_to_dom(AUTO_THEME)
      }

      // Set initial value
      update_system_mode()

      // Listen for changes
      media_query.addEventListener(`change`, update_system_mode)

      // Cleanup
      return () => {
        media_query.removeEventListener(`change`, update_system_mode)
      }
    }
  })

  const routes = Object.keys(import.meta.glob(`./**/+page.{svx,svelte,md}`)).map(
    (filename) => {
      const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
      return { route: `/${parts.slice(1, -1).join(`/`)}`, filename }
    },
  )

  if (routes.length < 3) {
    console.error(`Too few demo routes found: ${routes.length}`)
  }

  demos.routes = routes
    .filter(({ filename }) => filename.includes(`/(demos)/`))
    .map(({ route }) => route)

  const actions = routes
    .map(({ route }) => route)
    .concat(element_data.map(({ name }) => `/${name.toLowerCase()}`))
    .map((name) => {
      return { label: name, action: () => goto(name) }
    })
</script>

<CmdPalette {actions} placeholder="Go to..." />
<GitHubCorner href={pkg.repository} />
{#if typeof window !== `undefined`}
  <CopyButton global />
{/if}

<ThemeControl />

<DemoNav />

{#if !page.error && page.url.pathname !== `/`}
  <a href="." aria-label="Back to index page">&laquo; home</a>
{/if}

{@render children?.()}

<Footer />

<style>
  a[href='.'] {
    font-size: 13pt;
    position: absolute;
    top: 2em;
    left: 2em;
    background-color: var(--home-btn-bg);
    padding: 1pt 5pt;
    border-radius: 3pt;
    transition: 0.2s;
    z-index: 1;
  }
  a[href='.']:hover {
    background-color: var(--home-btn-hover-bg);
  }
</style>
