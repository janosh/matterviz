<script lang="ts">
  import { page } from '$app/state'
  import ErrorPage from 'svelte-widgets/ErrorPage.svelte'
  import pkg from '#root/package.json'
</script>

<ErrorPage
  status={page.status}
  message={page.error?.message}
  name={pkg.name}
  bugs_url={pkg.bugs}
  status_page_url="https://githubstatus.com"
/>
