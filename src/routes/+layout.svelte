<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { element_data } from '$lib'
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

  const routes = Object.keys(import.meta.glob(`./**/+page.{svx,svelte,md}`)).map(
    (filename) => {
      const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
      return { route: `/${parts.slice(1, -1).join(`/`)}`, filename }
    },
  )
  let mp_id = `/mp-1234`

  if (routes.length < 3) {
    console.error(`Too few demo routes found: ${routes.length}`)
  }

  demos.routes = [
    ...routes
      .filter(({ filename }) => filename.includes(`/(demos)/`))
      .map(({ route }) => route),
    mp_id,
  ]

  const actions = routes
    .map(({ route }) => route)
    .concat(element_data.map(({ name }) => `/${name.toLowerCase()}`))
    .map((name) => {
      return { label: name, action: () => goto(name) }
    })
</script>

<CmdPalette {actions} placeholder="Go to..." />
<GitHubCorner href={pkg.repository} />
<CopyButton global />

<DemoNav labels={{ [mp_id]: `/mp-details-pages` }} />

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
    background-color: rgba(255, 255, 255, 0.1);
    padding: 1pt 5pt;
    border-radius: 3pt;
    transition: 0.2s;
    z-index: 1;
  }
  a[href='.']:hover {
    background-color: rgba(255, 255, 255, 0.2);
  }
</style>
