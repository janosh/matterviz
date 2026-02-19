import type { ElementSymbol } from '$lib/element'

export type AtomTypeMapping = Record<number, ElementSymbol>

export interface LoadingOptions {
  use_indexing?: boolean
  buffer_size?: number
  index_sample_rate?: number
  extract_plot_metadata?: boolean
  bin_file_threshold?: number // Threshold in bytes for ArrayBuffer files (default: MAX_BIN_FILE_SIZE)
  text_file_threshold?: number // Threshold in bytes for string files (default: MAX_TEXT_FILE_SIZE)
  atom_type_mapping?: AtomTypeMapping // Map LAMMPS atom types to element symbols (e.g. {1: 'Na', 2: 'Cl'})
}
