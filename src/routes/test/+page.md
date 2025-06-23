<script>
  import { DemoNav } from '$site'
  import { page } from '$app/state'

  const routes = Object.keys(import.meta.glob(`./**/+page.{svx,svelte,md}`)).map(
    (filename) => {
      const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
      return `${page.url.pathname}/${parts.slice(1, -1).join(`/`)}`
    },
  )
</script>

<main style="max-width: 45em; margin: 0 auto;">

# End-to-End Testing

The files in this directory are used for end-to-end testing with Playwright. Run with `pnpm test:e2e`.

<DemoNav {routes} />

</main>
