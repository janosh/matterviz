<script lang="ts">
  import { goto } from '$app/navigation'
  import { element_data } from '$lib'
  import '$lib/app.css'
  import { theme_state } from '$lib/state.svelte'
  import { apply_theme_to_dom, AUTO_THEME, COLOR_THEMES } from '$lib/theme'
  import ThemeControl from '$lib/theme/ThemeControl.svelte'
  import pkg from '$root/package.json'
  import { DemoNav, Footer } from '$site'
  import { demos } from '$site/state.svelte'
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
<!-- TODO update to pass class="copy-btn" in next svelte-multiselect -->
<CopyButton
  global="position: absolute; top: 9pt; right: 9pt; background: var(--btn-bg); color: var(--btn-color)"
/>

<ThemeControl />

<DemoNav />

{@render children?.()}

<Footer />
