<script>
  import { page } from '$app/state'
  import { DemoNav } from '$site'

  const routes = Object.keys(import.meta.glob(`./*/+page.{svx,svelte,md}`)).map(
    (filename) => {
      const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
      return `${page.url.pathname}/${parts.slice(1, -1).join(`/`)}`
    },
  )
</script>

<h1>Pages for End-to-End Testing</h1>

The files in this directory are used for end-to-end testing with Playwright.

<DemoNav {routes} />
