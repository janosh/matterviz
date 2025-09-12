// Shared keyword constants for file type detection across the codebase

// compression formats and their file extensions
export const COMPRESSION_FORMATS = {
  gzip: [`.gz`, `.gzip`] as const,
  deflate: [`.deflate`] as const,
  'deflate-raw': [`.z`] as const,
  zip: [`.zip`] as const, // Browser DecompressionStream doesn't support ZIP
  xz: [`.xz`] as const, // Browser DecompressionStream doesn't support XZ
  bz2: [`.bz2`] as const, // Browser DecompressionStream doesn't support BZ2
} as const satisfies Record<string, readonly string[]>

// All detectable compression extensions
export const COMPRESSION_EXTENSIONS = Object.freeze([
  ...Object.values(COMPRESSION_FORMATS).flat(),
]) as readonly string[]

// Keywords that indicate a file is likely a trajectory file
export const TRAJ_KEYWORDS = Object.freeze([
  `trajectory`,
  `traj`,
  `relax`,
  `npt`,
  `nvt`,
  `nve`,
  `qha`,
  `md`,
  `dynamics`,
  `simulation`,
]) as readonly string[]

// Keywords that indicate a file is likely a structure file
export const STRUCT_KEYWORDS = Object.freeze([
  `structure`,
  `phono`,
  `vasp`,
  `crystal`,
  `material`,
  `lattice`,
  `geometry`,
  `unit_cell`,
  `unitcell`,
  `atoms`,
  `sites`,
  `data`,
  `phono3py`,
  `phonopy`,
]) as readonly string[]

// Regex patterns for keyword matching
export const TRAJ_KEYWORDS_REGEX = new RegExp(
  `(^|[-_.])(${TRAJ_KEYWORDS.join(`|`)})([-_.]|$)`,
  `i`,
)

export const STRUCT_KEYWORDS_REGEX = new RegExp(`(${STRUCT_KEYWORDS.join(`|`)})`, `i`)

export const TRAJ_KEYWORDS_SIMPLE_REGEX = new RegExp(`(${TRAJ_KEYWORDS.join(`|`)})`, `i`)

// File extensions for different file types
export const TRAJ_EXTENSIONS = Object.freeze([`.traj`, `.xtc`]) as readonly string[]
export const TRAJ_EXTENSIONS_REGEX = new RegExp(
  `\\.(${TRAJ_EXTENSIONS.map((ext) => ext.slice(1)).join(`|`)})$`,
  `i`,
)
export const STRUCTURE_EXTENSIONS = Object.freeze([
  `.cif`,
  `.mcif`,
  `.poscar`,
  `.vasp`,
  `.lmp`,
  `.data`,
  `.dump`,
  `.pdb`,
  `.mol`,
  `.mol2`,
  `.sdf`,
  `.mmcif`,
]) as readonly string[]
export const STRUCTURE_EXTENSIONS_REGEX = new RegExp(
  `\\.(${STRUCTURE_EXTENSIONS.map((ext) => ext.slice(1)).join(`|`)})$`,
  `i`,
)
export const TRAJ_FALLBACK_EXTENSIONS = Object.freeze([
  `.dat`,
  `.data`,
  `.log`,
  `.out`,
  `.json`,
]) as readonly string[]
export const TRAJ_FALLBACK_EXTENSIONS_REGEX = new RegExp(
  `\\.(${TRAJ_FALLBACK_EXTENSIONS.map((ext) => ext.slice(1)).join(`|`)})$`,
  `i`,
)

// Special regex patterns
export const VASP_FILES_REGEX =
  /(?:^|[\\/_.-])(poscar|contcar|potcar|incar|kpoints|outcar)(?:[\\/_.-]|$)/i
export const XDATCAR_REGEX = /xdatcar/i
export const CONFIG_DIRS_REGEX =
  /(?:^|[\\/])(\.vscode|\.idea|\.nyc_output|\.cache|\.tmp|\.temp|node_modules|dist|build|coverage)(?:[\\/]|$)/i
export const MD_SIM_EXCLUDE_REGEX =
  /md_simulation\.(out|txt|yml|py|csv|html|css|md|js|ts)$/i
export const XYZ_EXTXYZ_REGEX = /\.(xyz|extxyz)$/i

// Compression extensions regex (shared across files)
export const COMPRESSION_EXTENSIONS_REGEX = new RegExp(
  `\\.(${COMPRESSION_EXTENSIONS.map((ext) => ext.slice(1)).join(`|`)})$`,
  `i`,
)
