<script lang="ts">
  import type { Trajectory } from '$lib/trajectory'
  import { TrajectoryViewer } from '$lib/trajectory'
  import { full_data_extractor } from '$lib/trajectory/extract'
  import { FileCarousel, type FileInfo } from '$site'

  let trajectories = $state<(Trajectory | undefined)[]>([
    undefined,
    undefined,
    undefined,
    undefined,
  ])
  let active_trajectory_files = $state<string[]>([])

  let default_trajectory_urls = $state([
    `/trajectories/torch-sim-gold-cluster-55-atoms.h5`,
    `/trajectories/vasp-XDATCAR-traj.gz`,
    `/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`,
    `/trajectories/ase-images-Ag-0-to-97.xyz.gz`,
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
      return parts.slice(0, mid_point).join(`-`) + `\n` +
        parts.slice(mid_point).join(`-`)
    }

    // Fallback: break in the middle
    const mid: number = Math.floor(clean_filename.length / 2)
    return clean_filename.slice(0, mid) + `\n` + clean_filename.slice(mid)
  }

  // Unified file loader utility
  async function load_file_from_url(
    url: string,
    filename: string,
  ): Promise<FileInfo> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch file: ${response.status} ${response.statusText}`,
      )
    }

    const is_binary = filename.toLowerCase().endsWith(`.h5`) ||
      filename.toLowerCase().endsWith(`.hdf5`)

    if (is_binary) {
      const buffer = await response.arrayBuffer()
      return {
        name: strip_query(filename),
        content: buffer, // used to convert buffer to data URL, much slower. using ArrayBuffer directly has no conversion overhead, >10x faster.
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

        if (format) content = await decompress_data(arrayBuffer, format)
        else content = new TextDecoder().decode(arrayBuffer)
      }

      const name = strip_query(filename)
      const formatted_name = format_filename(filename)
      const type = get_file_type(filename)
      return { name, content, formatted_name, type, content_type: `text` }
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

<div class="trajectory-container full-bleed">
  {#each trajectories as trajectory, idx (idx)}
    <TrajectoryViewer
      bind:trajectory={trajectories[idx]}
      trajectory_url={!trajectory ? default_trajectory_urls[idx] : undefined}
      data_extractor={full_data_extractor}
      layout="horizontal"
      scatter_props={{
        x_label: `Step`,
        markers: `line+points`,
        legend: { responsive: true, layout: `horizontal`, layout_tracks: 2 },
      }}
      spinner_props={{
        style: `background: rgba(0, 0, 0, 0.1); color: white;`,
      }}
    />
  {/each}
  <TrajectoryViewer />
</div>

<p style="margin: 2em auto">
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
  p {
    text-align: center;
    max-width: 800px;
    margin: 0 auto 2rem auto;
    color: var(--text-color, #1f2937);
  }
  .trajectory-container {
    display: flex;
    flex-direction: column;
    gap: 5rem;
  }
  .trajectory-files-section {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 1rem;
  }
</style>
