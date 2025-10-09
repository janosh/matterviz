<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { element_data, Nav } from '$lib'
  import '$lib/app.css'
  import { theme_state } from '$lib/state.svelte'
  import { apply_theme_to_dom, AUTO_THEME, COLOR_THEMES } from '$lib/theme'
  import ThemeControl from '$lib/theme/ThemeControl.svelte'
  import pkg from '$root/package.json'
  import { Footer } from '$site'
  import { demo_routes, routes } from '$site/state.svelte'
  import type { Snippet } from 'svelte'
  import { CmdPalette, CopyButton, GitHubCorner } from 'svelte-multiselect'

  interface Props {
    children?: Snippet
  }
  let { children }: Props = $props()

  $effect(() => { // Apply theme changes when mode changes (after SSR)
    if (typeof window !== `undefined`) apply_theme_to_dom(theme_state.mode)
  })

  $effect(() => { // Update system preference when it changes
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

  const actions = routes
    .map(({ route }) => route)
    .concat(element_data.map(({ name }) => `/${name.toLowerCase()}`))
    .map((name) => {
      return { label: name, action: () => goto(name) }
    })
</script>

<CmdPalette {actions} placeholder="Go to..." />
<GitHubCorner href={pkg.repository} />
<CopyButton global class="copy-btn" />

<ThemeControl />

<Nav
  routes={[[`/`, `Home`], ...demo_routes]}
  labels={{
    '/how-to/hook-up-to-external-api': `Hook up to external API`,
    '/how-to/use-without-svelte': `Use without Svelte`,
    '/structure/rdf': `RDF`,
    '/structure/xrd': `XRD`,
  }}
  menu_style="display: flex; flex-wrap: wrap; max-width: 80vw; margin: auto;"
  aria-label="Main navigation"
  {page}
/>

<main>
  {@render children?.()}
</main>

<Footer />
