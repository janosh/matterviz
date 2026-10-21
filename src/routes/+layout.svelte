<script lang="ts">
  import { dev } from '$app/env'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  // oxlint-disable-next-line import/no-unassigned-import -- global app styles
  import '#lib/app.css'
  // Starry-night syntax highlighting. Imported here (not via app.css @import) so
  // starry_night_theme_plugin in vite.config.ts can re-target its dark palette
  // from OS preference to the app's data-theme. See that plugin for details.
  // oxlint-disable-next-line import/no-unassigned-import -- global syntax-highlight styles
  import '@wooorm/starry-night/style/both'
  import { theme_state } from '#lib/state.svelte.js'
  import {
    apply_theme_to_dom,
    get_theme_preference,
    THEME_OPTIONS,
    THEME_STORAGE_KEY,
  } from '#lib/theme/index.js'
  import ThemeControl from '#lib/theme/ThemeControl.svelte'
  import pkg from '#root/package.json'
  import Footer from '#site/Footer.svelte'
  import { nav_routes, routes } from '#site/state.svelte.js'
  import type { Snippet } from 'svelte'
  import type { Attachment } from 'svelte/attachments'
  import { MediaQuery } from 'svelte/reactivity'
  import type { CmdAction } from 'svelte-widgets'
  import CopyButton from 'svelte-widgets/CopyButton.svelte'
  import GitHubCorner from 'svelte-widgets/GitHubCorner.svelte'
  import Icon from 'svelte-widgets/Icon.svelte'
  import Nav from 'svelte-widgets/Nav.svelte'
  import PageSearch from 'svelte-widgets/PageSearch.svelte'
  import { Search } from 'svelte-widgets/icons'
  import { tooltip } from 'svelte-widgets/attachments'
  import { heading_anchors } from 'svelte-widgets/heading-anchors'

  let { children }: { children?: Snippet<[]> } = $props()
  let cmd_palette_open = $state(false)
  let theme_mode = $derived(theme_state.mode)

  // Apply the chosen mode, re-resolving `auto` when the OS preference flips; a preference saved
  // by another tab is followed below. Everything else reads the root's resulting color-scheme.
  const prefers_dark = new MediaQuery(`(prefers-color-scheme: dark)`)
  $effect(() => {
    void prefers_dark.current
    apply_theme_to_dom(theme_state.mode)
  })

  // Matched locally by the palette, so page navigation works in dev where the Pagefind index
  // (generated after production builds) is absent.
  const route_action = (url: string): CmdAction => ({
    id: `route:${url}`,
    label: url,
    description: `Open page`,
    action: () => void goto(url),
  })
  const route_actions: CmdAction[] = routes
    .filter(
      ({ filename, route }) =>
        !filename.includes(`/test/`) && route !== `/404` && route !== `/[slug]`,
    )
    .map(({ route }) => route_action(route))
  // The element pages' slugs need the full element dataset, which most demo pages never
  // load, so it is fetched when the palette first opens rather than in front of every route
  // (a failed fetch is retried on the next open)
  let element_actions = $state<CmdAction[]>([])
  $effect(() => {
    if (!cmd_palette_open || element_actions.length) return
    import(`#lib/element/data.js`).then(
      ({ default: element_data }) => {
        element_actions = element_data.map(({ name }) =>
          route_action(`/${name.toLowerCase()}`),
        )
      },
      (exc: unknown) => console.error(`Search palette: element pages failed to load`, exc),
    )
  })
  const theme_actions: CmdAction[] = THEME_OPTIONS.map(({ icon, label, value }) => ({
    id: `theme:${value}`,
    label: `${icon} ${label} color theme`,
    keywords: [`mode`, `colour`, `appearance`],
    action: () => (theme_mode = value),
  }))

  // `pnpm build:site` writes the Pagefind index next to the static build, so the dev server
  // has none to import: report no index hits there instead of requesting a 404 per search
  // (routes and commands in fallback_actions still match locally)
  const load_pagefind = dev ? async () => ({ search: async () => null }) : undefined

  const pagefind_enabled = $derived(
    !page.url.pathname.startsWith(`/test`) && page.url.pathname !== `/404`,
  )

  // Source links need the ~1 MB symbol table, which no page needs to render, so it loads after
  // the page instead of in front of every route
  const link_sources: Attachment<HTMLElement> = (node) => {
    let stop: (() => void) | undefined
    let detached = false
    void import('#site/source-links.js').then(({ link_source_mentions }) => {
      if (!detached) stop = link_source_mentions(node) ?? undefined
    })
    return () => {
      detached = true
      stop?.()
    }
  }
</script>

<svelte:window
  onstorage={(event) => {
    if (event.key === THEME_STORAGE_KEY) theme_state.mode = get_theme_preference()
  }}
/>

<!-- z-index: above nav dropdown and Structure control toggles -->
<PageSearch
  bind:open={cmd_palette_open}
  fallback_actions={[...route_actions, ...element_actions, ...theme_actions]}
  {load_pagefind}
  navigate={(url) => goto(url)}
  strip_html_suffix
  aria_label="Search the MatterViz site"
  placeholder="Search pages and commands..."
  no_matching_options_msg="No matches"
  max_options={12}
  dialog_props={{
    class: `site-search-dialog`,
    style: `left: 50%; margin: 0; transform: translateX(-50%); z-index: var(--z-index-overlay-dialog); --sms-width: min(42em, 90vw); --sms-options-li-padding: 2pt 1ex`,
  }}
/>
<GitHubCorner id="github-corner" href={pkg.repository} />
<CopyButton
  global
  style="top: 9pt; inset-inline-end: 9pt; background: var(--btn-bg); color: inherit"
/>

<ThemeControl bind:theme_mode />

<Nav
  routes={[{ href: `/`, label: `Home` }, ...nav_routes]}
  aria-label="Main navigation"
  pathname={page.url.pathname}
  --nav-dropdown-z-index="var(--z-index-overlay-nav)"
>
  <!-- Nav dropdown uses --z-index-overlay-nav to sit above overlay controls. -->
  <button
    onclick={(event: MouseEvent) => {
      event.stopPropagation()
      cmd_palette_open = true
    }}
    aria-label="Open search"
    class="site-search-btn"
    {@attach tooltip({ content: `Search (⌘K)` })}
  >
    <Icon icon={Search} style="width: 1.4em; height: 1.4em" />
    <!-- Only the mobile menu has room to spell it out; the desktop nav keeps the bare icon -->
    <span class="search-label">Search pages and commands...</span>
  </button>
</Nav>

<main
  data-pagefind-body={pagefind_enabled ? `` : undefined}
  {@attach heading_anchors({
    selector: `:scope > :is(h2, h3, h4, h5, h6), :scope > * > :is(h2, h3, h4, h5, h6)`,
  })}
  {@attach link_sources}
>
  {@render children?.()}
</main>

<Footer />

<style>
  .site-search-btn {
    background: transparent;
  }
  .search-label {
    display: none;
  }
  /* In the menu the icon-only button reads as a stray glyph, so give it the full row and an
     input's affordance. It still opens the command palette (which owns the real input). */
  :global(nav.mobile) .site-search-btn {
    display: flex;
    align-items: center;
    gap: 0.5em;
    width: 100%;
    min-height: 1.5rem;
    padding: 0 4pt;
    border: none;
    border-radius: var(--nav-border-radius);
    background: var(--nav-link-bg);
    color: inherit;
    text-align: start;
  }
  :global(nav.mobile) .search-label {
    display: inline;
    opacity: 0.65;
  }
  /* iOS Safari zooms the page when a focused input's font is under 16px; phones get a
     finger-sized field, the desktop palette keeps the widget's compact size */
  @media (pointer: coarse) {
    :global(dialog.site-search-dialog input) {
      font-size: 16px;
    }
  }
  /* The fixed corner sits exactly where viewers put their fullscreen/controls toggles; on a
     phone a tap there opens GitHub instead. The footer still links to the repo. */
  @media (max-width: 600px) {
    :global(#github-corner) {
      display: none;
    }
  }
  /* On phones the fixed theme select covers demo content (treemap tiles, hover readouts);
     `auto` follows the OS there and the control returns on wider screens. A landscape phone
     is wide but only ~390px tall, so the select sits on whatever is on screen there too. */
  @media (max-width: 480px), (max-height: 480px) {
    :global(.theme-control) {
      display: none;
    }
  }
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
