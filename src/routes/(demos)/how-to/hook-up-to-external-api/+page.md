<script lang="ts">
  import { OptimadeStructureViewer } from '#site'
  import FileDetails from 'svelte-widgets/FileDetails.svelte'
  import { default_highlighter } from 'svelte-widgets/highlight'
  import optimade_viewer_src from '#site/OptimadeStructureViewer.svelte?raw'

  const src_file = {
    title: `OptimadeStructureViewer.svelte`,
    content: optimade_viewer_src,
    language: `svelte`,
  }
</script>

# Hooking Up to External APIs

## OPTIMADE Example

The [OPTIMADE](https://www.optimade.org) standard gives a common API over 50+ materials databases. The demo below fetches and renders a structure from any OPTIMADE provider:

<OptimadeStructureViewer structure_id="mp-756175" selected_provider="mp" />

## Source Code

<FileDetails files={[src_file]} highlight={default_highlighter.highlight} />
