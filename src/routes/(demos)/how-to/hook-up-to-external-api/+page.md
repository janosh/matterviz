<script lang="ts">
  import { OptimadeStructureViewer } from '$site'
  import { FileDetails } from 'svelte-widgets'
  import optimade_viewer_src from '$site/OptimadeStructureViewer.svelte?raw'

  let structure_id = $state(`mp-756175`)
  let selected_provider = $state(`mp`)

  const src_file = {
    title: `OptimadeStructureViewer.svelte`,
    content: optimade_viewer_src,
    language: `svelte`,
  }
</script>

# Hooking Up to External APIs

A common use case is to fetch materials data from external APIs and databases and visualize them using MatterViz components, most commonly the `Structure`, `PeriodicTable`, and `Trajectory` viewers.

## OPTIMADE Example

The [OPTIMADE](https://www.optimade.org) standard gives a common API over 50+ materials databases. The demo below fetches and renders a structure from any OPTIMADE provider:

<OptimadeStructureViewer structure_id={structure_id} selected_provider={selected_provider} />

## Source Code

<FileDetails files={[src_file]} />
