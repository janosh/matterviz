<script>
  import { page } from '$app/state'
  import { routes as all_routes } from '#site/state.svelte.js'
  import Nav from 'svelte-widgets/Nav.svelte'

  const routes = all_routes
    .filter(({ filename }) => /\/test\/.+\/.+/.test(filename))
    .map(({ route }) => ({ href: route, label: route.replace(`/test/`, ``) }))
</script>

<h1>E2E test pages</h1>

<p>Fixture pages for the Playwright tests in <code>tests/playwright</code>.</p>

<Nav {routes} pathname={page.url.pathname} />

<style>
  h1 + p {
    text-align: center;
    color: var(--text-muted);
  }
</style>
