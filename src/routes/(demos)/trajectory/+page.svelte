<script lang="ts">
  import { trajectory_labels } from '$lib/labels'
  import type { Trajectory } from '$lib/trajectory'
  import { TrajectoryViewer } from '$lib/trajectory'
  import { full_data_extractor } from '$lib/trajectory/extract'
  import { FileCarousel, type FileInfo } from '$site'

  let trajectories = $state<(Trajectory | undefined)[]>([undefined, undefined])
  let active_trajectory_files = $state<string[]>([])

  let default_trajectory_urls = $state([
    `/trajectories/torch-sim-gold-cluster-55-atoms.h5`, // Top viewer
    `/trajectories/vasp-XDATCAR-traj.gz`, // Bottom viewer
  ])

  // Load trajectory files from the trajectories directory
  // Load non-compressed files as raw text (excluding files that have compressed versions)
  const trajectory_files_raw = import.meta.glob(
    [`$site/trajectories/*.{traj}`, `$site/trajectories/pymatgen-*.json`],
    { eager: true, query: `?raw`, import: `default` },
  ) as Record<string, string>

  // Load compressed and binary files as URLs (to be fetched later)
  const trajectory_files_compressed = import.meta.glob(
    [`$site/trajectories/*.{gz,h5,hdf5}`],
    { eager: true, query: `?url`, import: `default` },
  ) as Record<string, string>

  // Helper function to remove Vite query suffixes from filenames
  const strip_query = (filename: string): string => filename.split(`?`)[0]

  const get_file_type = (filename: string) =>
    strip_query(filename).split(`.`).pop()?.toUpperCase() ?? `FILE`

  const format_filename = (filename: string) => {
    const clean_filename = strip_query(filename)
    if (clean_filename.length <= 15) return clean_filename

    // Try to break at hyphens or underscores
    const parts: string[] = clean_filename.split(/[-_]/)
    if (parts.length > 1) {
      const mid_point: number = Math.ceil(parts.length / 2)
      return parts.slice(0, mid_point).join(`-`) + `\n` + parts.slice(mid_point).join(`-`)
    }

    // Fallback: break in the middle
    const mid: number = Math.floor(clean_filename.length / 2)
    return clean_filename.slice(0, mid) + `\n` + clean_filename.slice(mid)
  }

  // Unified file loader utility
  async function load_file_from_url(url: string, filename: string): Promise<FileInfo> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
    }

    const is_binary =
      filename.toLowerCase().endsWith(`.h5`) || filename.toLowerCase().endsWith(`.hdf5`)

    if (is_binary) {
      const buffer = await response.arrayBuffer()
      const { array_buffer_to_data_url } = await import(`$lib/trajectory/parse`)
      return {
        name: strip_query(filename),
        content: array_buffer_to_data_url(buffer),
        formatted_name: format_filename(filename),
        type: get_file_type(filename),
        content_type: `binary`,
      }
    } else {
      // Handle compressed/text files
      const content_encoding = response.headers.get(`content-encoding`)
      let content: string

      if (content_encoding === `gzip`) {
        content = await response.text()
      } else {
        const arrayBuffer = await response.arrayBuffer()
        const { decompress_data, detect_compression_format } = await import(
          `$lib/io/decompress`
        )
        const format = detect_compression_format(filename)

        if (format) {
          content = await decompress_data(arrayBuffer, format)
        } else {
          content = new TextDecoder().decode(arrayBuffer)
        }
      }

      return {
        name: strip_query(filename),
        content,
        formatted_name: format_filename(filename),
        type: get_file_type(filename),
        content_type: `text`,
      }
    }
  }

  // Create file objects from trajectory files and pre-load compressed ones
  let trajectory_files = $state<FileInfo[]>([])

  // Initialize files on component mount
  $effect(() => {
    const init_files = async () => {
      const files: FileInfo[] = []

      // Add raw text files
      for (const [path, content] of Object.entries(trajectory_files_raw)) {
        const raw_filename = path.split(`/`).pop() as string
        const filename = strip_query(raw_filename)
        files.push({
          name: filename,
          content,
          formatted_name: format_filename(raw_filename),
          type: get_file_type(raw_filename),
          content_type: `text`,
        })
      }

      // Add URL-based files (compressed and binary) - load in parallel with Promise.all
      await Promise.all(
        Object.entries(trajectory_files_compressed).map(async ([path, url]) => {
          const raw_filename = path.split(`/`).pop() as string
          const clean_filename = strip_query(raw_filename)
          try {
            const file_info = await load_file_from_url(url, raw_filename)
            files.push(file_info)
          } catch (error) {
            console.error(`Failed to load file ${clean_filename}:`, error)
          }
        }),
      )

      trajectory_files = files
    }

    init_files()
  })
</script>

<h1>Trajectory Viewer</h1>

<div class="dual-trajectory-container full-bleed">
  {#each trajectories as trajectory, idx (idx)}
    <TrajectoryViewer
      bind:trajectory={trajectories[idx]}
      trajectory_url={!trajectory ? default_trajectory_urls[idx] : undefined}
      data_extractor={full_data_extractor}
      layout="horizontal"
      property_labels={trajectory_labels}
      structure_props={{
        controls_open: false,
        show_full_controls: false,
        background_color: `#1a1a1a`,
        background_opacity: 0.8,
      }}
      plot_props={{
        x_label: `Step`,
        markers: `line+points`,
        legend: {
          responsive: true,
          layout: `horizontal`,
          layout_tracks: 2,
        },
        style: `background: var(--traj-plot-bg, #2d3748); color: var(--traj-plot-text, #e2e8f0);`,
      }}
      spinner_props={{
        style: `background: rgba(0, 0, 0, 0.1); color: white;`,
      }}
    />
  {/each}
</div>

<p style="margin: 2em auto;">
  Drag any of these trajectory files onto the second viewer above to load them:
</p>
<div class="trajectory-files-section">
  <FileCarousel
    files={trajectory_files}
    active_files={active_trajectory_files}
    show_structure_filters={false}
  />
</div>

<style>
  /* CSS Custom Properties for External Customization */
  :global(:root) {
    /* Dark theme colors for trajectory demo */
    --traj-bg: #1a202c;
    --traj-surface: #2d3748;
    --traj-surface-hover: #4a5568;
    --traj-border-bg: #4a5568;
    --traj-text: #e2e8f0;
    --traj-text-muted: #a0aec0;
    --traj-accent: #63b3ed;
    --traj-accent-hover: #4299e1;
    --traj-success: #68d391;
    --traj-warning: #fbd38d;
    --traj-error: #fc8181;
    --traj-plot-bg: #2d3748;
    --traj-plot-text: #e2e8f0;

    /* Trajectory component styling */
    --trajectory-controls-bg: var(--traj-surface, #2d3748);
    --trajectory-button-bg: var(--traj-accent, #63b3ed);
    --trajectory-button-color: var(--traj-bg, #1a202c);
    --trajectory-button-hover-bg: var(--traj-accent-hover, #4299e1);
    --trajectory-panel-border: var(--traj-border-bg, #4a5568);
    --trajectory-info-bg: var(--traj-surface, rgba(45, 55, 72, 0.9));
    --trajectory-info-color: var(--traj-text, #e2e8f0);
    --trajectory-loading-bg: var(--traj-surface, rgba(45, 55, 72, 0.95));
    --trajectory-border: 1px solid var(--traj-border-bg, #4a5568);
    --trajectory-text-color: var(--traj-text, #e2e8f0);
    --trajectory-dropzone-border: var(--traj-border-bg, #4a5568);
    --trajectory-dropzone-bg: var(--traj-surface, #2d3748);
    --trajectory-dragover-border: var(--traj-accent, #63b3ed);
    --trajectory-dragover-bg: var(--traj-accent, rgba(99, 179, 237, 0.1));

    /* Dark theme overrides for error messages */
    --trajectory-error-bg: var(--traj-surface, #2d3748);
    --trajectory-error-color: var(--traj-error, #fc8181);
    --trajectory-error-border: var(--traj-error, #fc8181);
    --trajectory-error-button-bg: var(--traj-error, #fc8181);
    --trajectory-help-bg: var(--traj-bg, #1a202c);
    --trajectory-help-border: var(--traj-border-bg, #4a5568);
    --trajectory-code-bg: var(--traj-bg, #1a202c);
    --trajectory-code-border: var(--traj-border-bg, #4a5568);
    --trajectory-code-title-color: var(--traj-accent, #63b3ed);
    --trajectory-pre-bg: var(--traj-bg, #1a202c);
    --trajectory-pre-border: var(--traj-border-bg, #4a5568);
    --trajectory-inline-code-bg: var(--traj-border-bg, rgba(74, 85, 104, 0.3));
  }

  p {
    text-align: center;
    max-width: 800px;
    margin: 0 auto 2rem auto;
    color: var(--traj-text, #e2e8f0);
  }

  .dual-trajectory-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    min-height: 80vh;
  }

  .dual-trajectory-container :global(.trajectory-viewer) {
    height: 70vh;
    min-height: 500px;
    border: 1px solid var(--traj-border-bg, #4a5568);
    border-radius: 8px;
    background: var(--traj-surface, #2d3748);
  }

  .trajectory-files-section {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 1rem;
  }
</style>
