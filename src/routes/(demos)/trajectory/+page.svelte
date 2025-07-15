<script lang="ts">
  import { TrajectoryViewer } from '$lib/trajectory'
  import { FileCarousel } from '$site'

  let active_trajectory_files = $state<string[]>([])

  let trajectory_files_paths = $state([
    `/trajectories/torch-sim-gold-cluster-55-atoms.h5`,
    `/trajectories/vasp-XDATCAR-traj.gz`,
    `/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`,
    `/trajectories/ase-images-Ag-0-to-97.xyz.gz`,
    undefined, //create one empty viewer
  ])
  const trajectory_files_raw = import.meta.glob(
    `$site/trajectories/*`,
    { eager: true, query: `?url`, import: `default` },
  ) as Record<string, string>
</script>

<h1>Trajectory Viewer</h1>

{#each trajectory_files_paths as file (file)}
  <TrajectoryViewer
    data_url={file}
    spinner_props={{ style: `background: transparent; color: white` }}
    class="full-bleed"
    style="margin-top: 5em"
  />
{/each}

<p style="margin: 2em auto">
  Drag any of these trajectory files onto the second viewer above to load them:
</p>

<FileCarousel
  files={Object.entries(trajectory_files_raw).map(([file_path, url]) => ({
    name: file_path.split(`/`).pop() || file_path,
    url,
  }))}
  active_files={active_trajectory_files}
  show_category_filters={false}
/>

<style>
  p {
    text-align: center;
    max-width: 800px;
    margin: 0 auto 2rem auto;
    color: var(--text-color, #1f2937);
  }
</style>
