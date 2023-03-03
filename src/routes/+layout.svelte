<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { repository } from '$root/package.json'
  import { Footer } from '$site'
  import { CmdPalette } from 'svelte-multiselect'
  import { GitHubCorner } from 'svelte-zoo'
  import '../app.css'
  import { element_data } from '../lib'

  const file_routes = Object.keys(import.meta.glob(`./**/+page.{svx,svelte,md}`)).map(
    (filename) => {
      const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
      return parts.slice(1, -1).join(`/`)
    }
  )

  const actions = element_data
    .map(({ name }) => name)
    .concat(file_routes.filter((name) => !name.includes(`[slug]`)))
    .map((name) => {
      return { label: name, action: () => goto(name.toLowerCase()) }
    })
</script>

<CmdPalette {actions} span_style="text-transform: capitalize;" />

<GitHubCorner href={repository} />

{#if !$page.error && $page.url.pathname !== `/`}
  <a href="." aria-label="Back to index page">&laquo; home</a>
{/if}

<slot />

<Footer />

<style>
  a[href='.'] {
    font-size: 15pt;
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
