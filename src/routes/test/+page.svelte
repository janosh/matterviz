<script>
  import { page } from '$app/state'
  import { routes as all_routes } from '$site/state.svelte'
  import { Nav } from 'svelte-multiselect'

  const routes = all_routes
    .filter(({ filename }) => /\/test\/.+\/.+/.test(filename))
    .map(({ route }) => route)
</script>

<h1>Pages for End-to-End Testing</h1>

The files in this directory are used for end-to-end testing with Playwright.

<Nav {routes} {page} />
