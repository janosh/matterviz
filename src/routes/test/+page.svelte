<script>
  import { DemoNav } from '$lib'
  import { routes as all_routes } from '$site/state.svelte'

  const routes = all_routes
    .filter(({ filename }) => /\/test\/.+\/.+/.test(filename))
    .map(({ route }) => route)
</script>

<h1>Pages for End-to-End Testing</h1>

The files in this directory are used for end-to-end testing with Playwright.

<DemoNav {routes} />
