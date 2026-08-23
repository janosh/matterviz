// Time-averaged radial distribution functions of an MD run: every element pair's g_ab(r)
// averaged over evenly spaced frames, plus the shell summary a materials scientist reads off
// each curve (first-peak position, first minimum, coordination number out to it).
//
// Frames are analysed one at a time in the RDF worker and only the n_pairs x n_bins
// histograms come back, so a 100k-frame run never needs its positions in memory at once
// (unlike MSD/VACF, which are lag analyses and need the whole series).
import { calc_lattice_params } from '$lib/math'
import { get_majority_element } from '$lib/structure/bonding'
import { is_crystal } from '$lib/structure/validation'
import type { TrajectoryRun } from '$lib/trajectory'
import { sweep_frames } from '$lib/trajectory/analysis'
import { calc_frame_rdfs_async } from './async-compute.svelte'
import type { FrameRdfOptions } from './calc-rdf'

// Default sample: neighbour lists at the 10 A cutoff cost ~30-60 ms per 2000-atom frame, so
// 100 frames stay a wait a user will sit through; a liquid's g(r) converges well within that.
export const DEFAULT_RDF_MAX_FRAMES = 100
export const DEFAULT_RDF_CUTOFF = 10
export const DEFAULT_RDF_BINS = 200

export interface TrajectoryRdfOptions extends FrameRdfOptions {
  max_frames?: number
  on_progress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export interface RdfShell {
  // Position and height of the first maximum of g(r), or null when the curve never rises
  // above 1 within the cutoff
  first_peak_r: number | null
  first_peak_height: number | null
  // First minimum after that peak: where the first coordination shell ends. Null when the
  // curve is still falling at the cutoff.
  first_min_r: number | null
  // Neighbours of the second element around one atom of the first, out to first_min_r:
  // 4π ρ_b ∫ g_ab(r) r² dr with ρ_b the second element's mean number density
  coordination: number | null
}

export interface TrajectoryRdfCurve {
  element_pair: [string, string]
  // `A-B`
  label: string
  // Mean over analysed frames, one entry per bin of `TrajectoryRdf.r`
  g_r: number[]
  // Shell of B atoms around an A atom (`shell.coordination` counts B neighbours of A)
  shell: RdfShell
  // A neighbours of a B atom out to the same first minimum: CN_ab · N_a / N_b
  coordination_reverse: number | null
}

export interface TrajectoryRdf {
  // Bin centres in A
  r: number[]
  curves: TrajectoryRdfCurve[]
  // SOURCE frame index of each analysed frame
  frame_numbers: number[]
  frame_stride: number
  cutoff: number
  n_bins: number
  n_atoms: number
  // Mean cell volume over analysed frames, A^3
  mean_volume: number
}

const EMPTY_SHELL: RdfShell = {
  first_peak_r: null,
  first_peak_height: null,
  first_min_r: null,
  coordination: null,
}

// Shell extrema are located on a 3-bin running mean so a thin-sample wiggle is not taken for
// a shell boundary; the coordination integral uses the raw curve.
export function rdf_shell(r: number[], g_r: number[], rho_b: number): RdfShell {
  const n_bins = g_r.length
  if (n_bins < 3 || r.length !== n_bins) return EMPTY_SHELL
  const smooth = g_r.map(
    (_unused, idx) =>
      (g_r[Math.max(idx - 1, 0)] + g_r[idx] + g_r[Math.min(idx + 1, n_bins - 1)]) / 3,
  )
  let peak = -1
  for (let idx = 1; idx < n_bins - 1 && peak < 0; idx++) {
    if (smooth[idx] > 1 && smooth[idx] >= smooth[idx - 1] && smooth[idx] > smooth[idx + 1]) {
      peak = idx
    }
  }
  if (peak < 0) return EMPTY_SHELL
  // the raw bin of the peak within the smoothed maximum's neighbourhood
  let raw_peak = peak
  for (const idx of [peak - 1, peak + 1]) if (g_r[idx] > g_r[raw_peak]) raw_peak = idx
  const shell = { ...EMPTY_SHELL, first_peak_r: r[raw_peak], first_peak_height: g_r[raw_peak] }
  // The shell closes where the curve turns back up, or where it hits zero (a crystal's gap
  // between shells may run to the cutoff without ever rising again)
  let first_min = -1
  for (let idx = peak + 1; idx < n_bins - 1 && first_min < 0; idx++) {
    if (
      smooth[idx] <= smooth[idx - 1] &&
      (smooth[idx] < smooth[idx + 1] || smooth[idx] === 0)
    ) {
      first_min = idx
    }
  }
  if (first_min < 0) return shell
  const bin_size = r[1] - r[0]
  let integral = 0
  for (let idx = 0; idx <= first_min; idx++) integral += g_r[idx] * r[idx] ** 2 * bin_size
  return { ...shell, first_min_r: r[first_min], coordination: 4 * Math.PI * rho_b * integral }
}

export async function collect_trajectory_rdf(
  run: TrajectoryRun,
  options: TrajectoryRdfOptions = {},
): Promise<TrajectoryRdf> {
  const {
    max_frames = DEFAULT_RDF_MAX_FRAMES,
    cutoff = DEFAULT_RDF_CUTOFF,
    n_bins = DEFAULT_RDF_BINS,
    on_progress,
    signal,
  } = options
  let reference: { frame_number: number; elements: string[] } | undefined
  let sums: Float64Array[] = []
  let r: number[] = []
  let pairs: [string, string][] = []
  const {
    results: volumes,
    frame_numbers,
    frame_stride,
  } = await sweep_frames(
    run,
    { max_frames, on_progress, signal },
    async ({ structure }, frame_number) => {
      const elements = structure.sites.map((site) => get_majority_element(site) ?? `X`)
      reference ??= { frame_number, elements }
      if (
        elements.length !== reference.elements.length ||
        elements.some((element, idx) => element !== reference?.elements[idx])
      ) {
        throw new Error(
          `collect_trajectory_rdf: frame ${frame_number} has a different composition or atom ` +
            `order than frame ${reference.frame_number}; a time-averaged g(r) needs one composition`,
        )
      }
      if (!is_crystal(structure)) {
        throw new Error(
          `collect_trajectory_rdf: frame ${frame_number} needs a periodic cell to normalise against`,
        )
      }
      const patterns = await calc_frame_rdfs_async(structure, { cutoff, n_bins }, { signal })
      if (sums.length === 0) {
        r = patterns[0]?.r ?? []
        pairs = patterns.map((pattern) => pattern.element_pair ?? [`X`, `X`])
        sums = patterns.map(() => new Float64Array(n_bins))
      }
      for (const [pair_idx, pattern] of patterns.entries()) {
        const sum = sums[pair_idx]
        for (let bin = 0; bin < n_bins; bin++) sum[bin] += pattern.g_r[bin]
      }
      return calc_lattice_params(structure.lattice.matrix).volume
    },
  )
  const n_frames = frame_numbers.length
  // ρ_b averaged as <N_b / V>, the density the per-frame normalisation used
  const inverse_volume = volumes.reduce((total, volume) => total + 1 / volume, 0) / n_frames
  const counts = new Map<string, number>()
  for (const element of reference?.elements ?? []) {
    counts.set(element, (counts.get(element) ?? 0) + 1)
  }
  const curves = pairs.map(([el_a, el_b], pair_idx): TrajectoryRdfCurve => {
    const g_r = Array.from(sums[pair_idx], (sum) => sum / n_frames)
    const [n_a, n_b] = [counts.get(el_a) ?? 0, counts.get(el_b) ?? 0]
    const shell = rdf_shell(r, g_r, n_b * inverse_volume)
    return {
      element_pair: [el_a, el_b],
      label: `${el_a}-${el_b}`,
      g_r,
      shell,
      coordination_reverse:
        shell.coordination === null || n_b === 0 ? null : (shell.coordination * n_a) / n_b,
    }
  })
  return {
    r,
    curves,
    frame_numbers,
    frame_stride,
    cutoff,
    n_bins,
    n_atoms: reference?.elements.length ?? 0,
    mean_volume: volumes.reduce((total, volume) => total + volume, 0) / n_frames,
  }
}
