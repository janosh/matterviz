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
  import { link_source_mentions } from '$site/source-links'
  import { nav_routes, routes } from '$site/state.svelte'
  import type { Snippet } from 'svelte'
  import type { CmdAction } from 'svelte-widgets'
  import { CopyButton, GitHubCorner, Icon, Nav, PageSearch } from 'svelte-widgets'
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

  // Matched locally by the palette, so page navigation works in dev where the Pagefind index
  // (generated after production builds) is absent.
  const route_actions: CmdAction[] = routes
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
      action: () => void goto(url),
    }))
  const theme_actions: CmdAction[] = THEME_OPTIONS.map(({ icon, label, value }) => ({
    id: `theme:${value}`,
    label: `${icon} ${label} color theme`,
    keywords: [`mode`, `colour`, `appearance`],
    action: () => (theme_mode = value),
  }))

  const pagefind_enabled = $derived(
    !page.url.pathname.startsWith(`/test`) && page.url.pathname !== `/404`,
  )
</script>

<!-- z-index: above nav dropdown and Structure control toggles.
     --text: svelte-widgets paints the mobile burger bars with var(--text), which matterviz
     does not define (it uses --text-color); without it the bars fall back to currentColor. -->
<PageSearch
  bind:open={cmd_palette_open}
  fallback_actions={[...route_actions, ...theme_actions]}
  navigate={(url) => goto(url)}
  strip_html_suffix
  aria_label="Search the MatterViz site"
  placeholder="Search pages and commands..."
  noMatchingOptionsMsg="No matches"
  maxOptions={12}
  dialog_props={{
    class: `site-search-dialog`,
    style: `left: 50%; margin: 0; transform: translateX(-50%); z-index: var(--z-index-overlay-dialog); --sms-width: min(42em, 90vw); --sms-options-li-padding: 2pt 1ex`,
  }}
/>
<GitHubCorner id="github-corner" href={pkg.repository} />
<CopyButton
  global
  style="top: 9pt; inset-inline-end: 9pt; background: var(--btn-bg); color: var(--btn-color)"
/>

<ThemeControl bind:theme_mode />

<!-- menu_props: inline until svelte-widgets ships the same defaults. Its mobile menu hugs its
     content and anchors to the start edge, so page text shows beside the open menu; spanning
     the viewport fixes that. `max-width` clears its 90vw cap, which would re-narrow the panel. -->
<Nav
  routes={[[`/`, `Home`], ...nav_routes]}
  route_labels={{
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
  menu_props={{ style: `inset-inline: 0.5rem; max-width: none` }}
  aria-label="Main navigation"
  {page}
  --nav-dropdown-z-index="var(--z-index-overlay-nav)"
  --text="var(--text-color)"
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
  {@attach link_source_mentions}
>
  {@render children?.()}
</main>

<Footer />

<style>
  /* Shim reproducing the svelte-widgets fix until it ships (see its Nav.svelte). Its mobile
     rule pads `.menu > span` — the element that paints a plain link's pill — but `.dropdown`,
     whose *child* paints the pill, so plain-link rows rendered wider and taller pills than
     dropdown rows. Move the padding onto the pill in both cases. `!important` because the
     widget's rules carry its scoping class and out-specify anything writable from here. */
  :global(nav.mobile .dropdown) {
    padding: 0 !important;
  }
  :global(nav.mobile .menu > span),
  :global(nav.mobile .dropdown > div:first-child) {
    padding: 0 6pt !important;
  }
  :global(nav.mobile .menu > span > a) {
    flex: 1;
    padding: var(--nav-item-padding, 1pt 4pt) !important;
  }
  :global(nav.mobile .dropdown > div:last-child a) {
    /* 8pt of its own indent plus the 8pt the `.dropdown` padding no longer contributes */
    margin-inline-start: 16pt !important;
  }
  /* svelte-widgets sizes the burger and caps/scrolls the mobile menu itself; only the row
     touch targets are still missing. Its mobile rules carry the widget's scoping class, so a
     plain `padding` override here would lose on specificity — these set only properties the
     widget never sets on these rows. With the row padding down to nothing, this min-height is
     what sets row height; 1.5rem trades some of the ~32px touch-target floor for density. */
  :global(nav.mobile .menu > span > a),
  :global(nav.mobile .dropdown > div:first-child > :is(a, span)),
  :global(nav.mobile .dropdown > div:last-child a) {
    display: inline-flex;
    align-items: center;
    min-height: 1.5rem;
    box-sizing: border-box;
  }
  :global(nav.mobile .dropdown > div:first-child > button) {
    min-height: 1.5rem;
    /* Finger-sized target, but grown leading-side only so the caret still hugs the row's
       trailing edge instead of floating in the slack */
    min-width: 2.5rem;
    justify-content: flex-end;
  }
  /* Same shim: the widget offsets the open burger's two strokes by a hardcoded 0.4rem, but
     under `space-around` adjacent bar centres are height/3 (0.4667rem) apart, so the X met
     ~1px off centre and read as lopsided. */
  :global(nav .burger[aria-expanded='true'] span:first-child) {
    transform: translateY(calc(1.4rem / 3)) rotate(45deg) !important;
  }
  :global(nav .burger[aria-expanded='true'] span:nth-child(3)) {
    transform: translateY(calc(1.4rem / -3)) rotate(-45deg) !important;
  }
  /* Caret against the row's trailing edge; the row padding is the only gap wanted */
  :global(nav.mobile .dropdown > div:first-child > button) {
    padding-inline-end: 0 !important;
  }
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
    padding: 0 6pt;
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
