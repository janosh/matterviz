<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import Icon from '$lib/Icon.svelte'
  import '$lib/app.css'
  import { element_data } from '$lib/element'
  import { theme_state } from '$lib/state.svelte'
  import { apply_theme_to_dom, AUTO_THEME, COLOR_THEMES } from '$lib/theme'
  import ThemeControl from '$lib/theme/ThemeControl.svelte'
  import pkg from '$root/package.json'
  import { Footer } from '$site'
  import { demo_routes, routes } from '$site/state.svelte'
  import type { Snippet } from 'svelte'
  import { CmdPalette, CopyButton, GitHubCorner, Nav } from 'svelte-multiselect'
  import { tooltip } from 'svelte-multiselect/attachments'
  import { heading_anchors } from 'svelte-multiselect/heading-anchors'

  let { children }: { children?: Snippet<[]> } = $props()

  let cmd_palette_open = $state(false)

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
    .map((name) => ({ label: name, action: () => goto(name) }))
</script>

<!-- z-index: 10000000001 needed to render above Structure control toggles -->
<CmdPalette
  bind:open={cmd_palette_open}
  {actions}
  placeholder="Go to..."
  dialog_style="z-index: 10000000001"
/>
<GitHubCorner href={pkg.repository} />
<CopyButton global class="copy-btn" />

<ThemeControl />

<Nav
  routes={[
    [`/`, `Home`],
    ...demo_routes.filter((route) => {
      const path = typeof route === `string` ? route : route[0]
      return !path.startsWith(`/layout`)
    }),
  ]}
  labels={{
    '/how-to/hook-up-to-external-api': `Hook up to external API`,
    '/how-to/use-without-svelte': `Use without Svelte`,
    '/structure/rdf': `RDF`,
    '/structure/xrd': `XRD`,
    '/reciprocal/dos': `DOS`,
    '/reciprocal/bands-and-dos': `Bands + DOS`,
    '/reciprocal/brillouin-bands-dos': `Brillouin + Bands + DOS`,
  }}
  menu_props={{
    style: `display: flex; flex-wrap: wrap; max-width: 80vw; margin: auto;`,
  }}
  aria-label="Main navigation"
  {page}
  --nav-dropdown-z-index="100000001"
>
  <!-- Nav dropdown must be above Structure.svelte's --struct-buttons-z-index (100000000) -->
  <button
    onclick={() => cmd_palette_open = true}
    aria-label="Open search"
    style="background: transparent"
    {@attach tooltip({ content: `Search (⌘K)` })}
  >
    <Icon icon="Search" style="width: 1.4em; height: 1.4em" />
  </button>
</Nav>

<main {@attach heading_anchors()}>
  {@render children?.()}
</main>

<Footer />
