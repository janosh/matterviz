<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  // oxlint-disable-next-line import/no-unassigned-import -- global app styles
  import '$lib/app.css'
  // Starry-night syntax highlighting. Imported here (not via app.css @import) so
  // starry_night_theme_plugin in vite.config.ts can re-target its dark palette
  // from OS preference to the app's data-theme. See that plugin for details.
  // oxlint-disable-next-line import/no-unassigned-import -- global syntax-highlight styles
  import '@wooorm/starry-night/style/both'
  import { element_data } from '$lib/element'
  import { theme_state } from '$lib/state.svelte'
  import {
    apply_theme_to_dom,
    AUTO_THEME,
    get_theme_preference,
    THEME_OPTIONS,
    THEME_STORAGE_KEY,
  } from '$lib/theme'
  import ThemeControl from '$lib/theme/ThemeControl.svelte'
  import pkg from '$root/package.json'
  import { Footer } from '$site'
  import { create_site_search_loader, type SiteSearchAction } from '$site/search'
  import { link_source_mentions } from '$site/source-links'
  import type { RouteEntry } from '$site/state.svelte'
  import { demo_routes, routes } from '$site/state.svelte'
  import type { Snippet } from 'svelte'
  import { CommandMenu, CopyButton, GitHubCorner, Icon, Nav } from 'svelte-widgets'
  import { Search } from 'svelte-widgets/icons'
  import { tooltip } from 'svelte-widgets/attachments'
  import { heading_anchors } from 'svelte-widgets/heading-anchors'

  let { children }: { children?: Snippet<[]> } = $props()
  let cmd_palette_open = $state(false)
  let theme_mode = $derived(theme_state.mode)

  // Apply the chosen mode; re-resolve `auto` when the OS preference flips and follow a
  // preference saved by another tab. Everything else reads the root's resulting color-scheme.
  $effect(() => {
    apply_theme_to_dom(theme_state.mode)
    const media_query = window.matchMedia(`(prefers-color-scheme: dark)`)
    const follow_system = () => {
      if (theme_state.mode === AUTO_THEME) apply_theme_to_dom(AUTO_THEME)
    }
    const follow_other_tabs = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) theme_state.mode = get_theme_preference()
    }
    media_query.addEventListener(`change`, follow_system)
    window.addEventListener(`storage`, follow_other_tabs)
    return () => {
      media_query.removeEventListener(`change`, follow_system)
      window.removeEventListener(`storage`, follow_other_tabs)
    }
  })

  const route_actions: SiteSearchAction[] = routes
    .filter(
      ({ filename, route }) =>
        !filename.includes(`/test/`) && route !== `/404` && route !== `/[slug]`,
    )
    .map(({ route }) => route)
    .concat(element_data.map(({ name }) => `/${name.toLowerCase()}`))
    .map((url) => ({
      id: `route:${url}`,
      label: url,
      description: `Open page`,
      url,
      action: (_label) => void goto(url),
    }))
  const theme_actions = THEME_OPTIONS.map(({ icon, label, value }) => ({
    id: `theme:${value}`,
    label: `${icon} ${label} color theme`,
    keywords: [`mode`, `colour`, `appearance`],
    action: () => (theme_mode = value),
  }))
  // Routes come from loadOptions; adding them here duplicates fallback results in dev.
  const actions: ((typeof theme_actions)[number] | SiteSearchAction)[] = theme_actions
  const load_search_options = create_site_search_loader({
    route_actions,
    navigate: goto,
  })

  const route_path = (route_entry: RouteEntry): string =>
    typeof route_entry === `string` ? route_entry : route_entry[0]

  const nav_routes = $derived(
    demo_routes.filter((route_entry) => {
      const path = route_path(route_entry)
      return !path.startsWith(`/layout`)
    }),
  )
  const pagefind_enabled = $derived(
    !page.url.pathname.startsWith(`/test`) && page.url.pathname !== `/404`,
  )
</script>

<!-- z-index: above nav dropdown and Structure control toggles -->
<CommandMenu
  bind:open={cmd_palette_open}
  {actions}
  aria_label="Search the MatterViz site"
  placeholder="Search pages and commands..."
  loadOptions={{ fetch: load_search_options, debounceMs: 120, batchSize: 12 }}
  noMatchingOptionsMsg="No matches"
  maxOptions={12}
  dialog_props={{
    class: `site-search-dialog`,
    style: `left: 50%; margin: 0; transform: translateX(-50%); z-index: var(--z-index-overlay-dialog); --sms-width: min(42em, 90vw); --sms-options-li-padding: 2pt 1ex`,
  }}
/>
<GitHubCorner href={pkg.repository} --github-corner-bg-hover="var(--github-corner-bg-hover)" />
<CopyButton
  global
  style="top: 9pt; inset-inline-end: 9pt; background: var(--btn-bg); color: var(--btn-color)"
/>

<ThemeControl bind:theme_mode />

<Nav
  routes={[[`/`, `Home`], ...nav_routes]}
  labels={{
    '/how-to/hook-up-to-external-api': `Hook up to external API`,
    '/how-to/use-without-svelte': `Use without Svelte`,
    '/neb': `NEB`,
    '/structure/rdf': `RDF`,
    '/structure/xrd': `XRD`,
    '/reciprocal/dos': `DOS`,
    '/reciprocal/bands-and-dos': `Bands + DOS`,
    '/reciprocal/brillouin-bands-dos': `Brillouin + Bands + DOS`,
    '/reciprocal/ir-raman': `IR + Raman`,
    '/reciprocal/phonon-mode-explorer': `Phonon Mode Explorer`,
  }}
  menu_props={{
    style: `display: flex; flex-wrap: wrap; max-width: 80vw; margin: auto;`,
  }}
  aria-label="Main navigation"
  {page}
  --nav-dropdown-z-index="var(--z-index-overlay-nav)"
>
  <!-- Nav dropdown uses --z-index-overlay-nav to sit above overlay controls. -->
  <button
    onclick={(event: MouseEvent) => {
      event.stopPropagation()
      cmd_palette_open = true
    }}
    aria-label="Open search"
    style="background: transparent"
    {@attach tooltip({ content: `Search (⌘K)` })}
  >
    <Icon icon={Search} style="width: 1.4em; height: 1.4em" />
  </button>
</Nav>

<main
  data-pagefind-body={pagefind_enabled ? `` : undefined}
  {@attach heading_anchors({
    selector: `:scope > :is(h2, h3, h4, h5, h6), :scope > * > :is(h2, h3, h4, h5, h6)`,
  })}
  {@attach link_source_mentions}
>
  {@render children?.()}
</main>

<Footer />

<style>
  :global(dialog.site-search-dialog :is(.cmd-label, .cmd-description)) {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  :global(dialog.site-search-dialog .cmd-label) {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
  }
  :global(dialog.site-search-dialog .cmd-description) {
    text-overflow: ellipsis;
  }
</style>
