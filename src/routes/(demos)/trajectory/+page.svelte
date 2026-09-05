<script lang="ts">
  import FilePicker from '$lib/FilePicker.svelte'
  import { trajectory_files } from '$site/trajectories'
  import { TrajectoryFileViewer, type TrajHandlerData } from 'matterviz/trajectory'

  let active_file = $state(``) // last drag-and-dropped trajectory file
  let visible_props_cantor_qha = $state<string[] | undefined>(undefined)
  const handle_file_load = ({ source_filename }: TrajHandlerData): void => {
    if (source_filename) active_file = source_filename
  }

  const viewer_style = `max-height: 700px; --traj-border-radius: 6pt; --traj-overflow: clip; --sequence-controls-border-radius: 0`
  // The sample LAMMPS dumps in the picker name atoms by bare integer type, which the parser
  // would otherwise read as atomic numbers (H, He) with a warning. Only the LAMMPS parser
  // reads this mapping, so it goes to the empty drop target meant for those dumps, not to
  // the HDF5 / XDATCAR / extXYZ viewers
  const lammps_loading_options = { atom_type_mapping: { 1: `Cu`, 2: `Zr` } } as const
</script>

<h1>Trajectory</h1>

<p>
  Every viewer on this page is a <code>TrajectoryFileViewer</code>: it fetches <code>src</code>
  (a URL, <code>File</code>, <code>ArrayBuffer</code> or <code>Blob</code>), accepts drops,
  decompresses, resolves ambiguous HDF5 groups, opens large files in a Web Worker and disposes
  each run when it is replaced or unmounted. The <code>Trajectory</code> component underneath
  is a pure viewer that borrows a <code>TrajectoryRun</code> you already hold (from
  <code>open_trajectory</code> or <code>trajectory_from_frames</code>) and never loads or
  disposes anything itself.
</p>

<details class="analysis-notes">
  <summary>What the analysis panes compute</summary>
  <p>
    <strong>MSD / diffusion</strong> (the orbit icon) averages |r(t₀+Δt) − r(t₀)|² over all
    atoms and time origins after unwrapping across periodic boundaries (LAMMPS
    <code>xu/yu/zu</code>
    coordinates are taken as already unwrapped), decomposes by element and fits
    <code>D = slope / 2d</code> over an adjustable lag window; the lag axis is in frames unless
    the file records a timestep or you enter one. Analyses use the selected frame window
    (zero-based start, exclusive end), including indexed trajectories. Time-window controls
    appear when every frame has a known, increasing physical time.
    <strong>VACF / vibrational DOS</strong> shares those controls. <strong>RDF</strong> averages
    every element pair's g(r) over a capped sample of frames, each normalised by its own cell volume
    (so NPT runs work), and reads the first-shell position and coordination numbers off each curve.
    Analysis tables export curves as CSV; RDF also exports JSON with shell summaries, coordination
    numbers, source metadata, sampled frames, units, cutoff and binning. The info pane reports mean
    ± σ, range and least-squares drift for up to eight prioritised properties so equilibration can
    be judged at a glance.
  </p>
</details>

<div class="full-bleed traj-pair">
  <TrajectoryFileViewer
    src="/trajectories/flame-gold-cluster-55-atoms.h5"
    style={viewer_style}
    on_file_load={handle_file_load}
  />
  <TrajectoryFileViewer
    src="/trajectories/vasp-XDATCAR-traj.gz"
    style={viewer_style}
    on_file_load={handle_file_load}
  />
</div>

<h2>Bindable <code>visible_properties</code></h2>
<p>Legend toggles update the bound list of displayed trajectory properties.</p>
<strong
  style="display: block; margin: 1em auto; padding: 1em; background: var(--surface-bg-hover); border-radius: var(--border-radius); font-family: monospace; font-size: 0.9em"
>
  bind:visible_properties = {JSON.stringify(visible_props_cantor_qha)}
</strong>
<TrajectoryFileViewer
  src="/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz"
  bind:visible_properties={visible_props_cantor_qha}
  class="full-bleed"
  style="margin-top: 1em; {viewer_style}"
  on_file_load={handle_file_load}
/>
<TrajectoryFileViewer
  src="/trajectories/ase-images-Ag-0-to-97.xyz.gz"
  class="full-bleed"
  style="margin-top: 5em; {viewer_style}"
  on_file_load={handle_file_load}
/>
<TrajectoryFileViewer
  class="full-bleed"
  style="margin-top: 5em; {viewer_style}"
  on_file_load={handle_file_load}
  loading_options={lammps_loading_options}
/>

<p style="margin: 2em auto; text-align: center">
  Drag any of these trajectory files onto a viewer above to load them:
</p>

<FilePicker
  files={trajectory_files}
  active_files={[active_file]}
  show_category_filters={false}
/>

<style>
  .traj-pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 560px), 1fr));
    gap: 1em;
    margin-top: 5em;
    > :global(.trajectory-file-viewer) {
      min-width: 0;
    }
  }
</style>
