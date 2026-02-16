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
  import type { RouteEntry } from '$site/state.svelte'
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

  function route_path(route_entry: RouteEntry): string {
    return typeof route_entry === `string` ? route_entry : route_entry[0]
  }

  // Nest chempot-diagram as a child of convex-hull in the nav tree.
  // If convex-hull is absent, keep chempot-diagram as a standalone route.
  function nest_chempot_under_convex_hull(route_entries: RouteEntry[]): RouteEntry[] {
    const chempot_path = `/chempot-diagram`
    const convex_hull_path = `/convex-hull`
    const has_chempot = route_entries.some((entry) =>
      route_path(entry) === chempot_path
    )
    const has_convex = route_entries.some((entry) =>
      route_path(entry) === convex_hull_path
    )
    if (!has_chempot || !has_convex) return route_entries
    return route_entries
      .filter((entry) => route_path(entry) !== chempot_path)
      .map((entry) => {
        if (route_path(entry) !== convex_hull_path) return entry
        if (typeof entry === `string`) {
          return [entry, [chempot_path]] satisfies [string, string[]]
        }
        const [parent, existing] = entry
        const existing_arr = typeof existing === `string` ? [existing] : existing
        if (existing_arr.includes(chempot_path)) return entry
        return [parent, [...existing_arr, chempot_path]] satisfies [string, string[]]
      })
  }

  const nav_routes = $derived.by(() => {
    const nested_demo_routes = nest_chempot_under_convex_hull(demo_routes)
    return nested_demo_routes.filter((route_entry) => {
      const path = route_path(route_entry)
      return !path.startsWith(`/layout`)
    })
  })
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
    ...nav_routes,
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

<main
  {@attach heading_anchors({
    selector: `:scope > :is(h2, h3, h4, h5, h6), :scope > * > :is(h2, h3, h4, h5, h6)`,
  })}
>
  {@render children?.()}
</main>

<Footer />
