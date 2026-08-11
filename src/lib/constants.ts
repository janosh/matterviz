// Shared constants with no dependencies of their own, so build scripts can import them:
// physical unit conversions, export defaults, then file type detection keywords.

// === physical constants ===

// Bohr radius in Angstroms (CODATA 2022). Single source of truth so the Gaussian .cube
// reader (isosurface/parse.ts) and the FRMSF reciprocal-lattice reader (fermi-surface/
// parse.ts) can't drift apart again — they previously carried 0.529177249 (CODATA 1986)
// and 0.529177, which disagreed by 4.7e-7 relative.
export const BOHR_TO_ANGSTROM = 0.529177210544

// Hartree energy in eV (CODATA 2022). Same drift story as BOHR_TO_ANGSTROM: the FRMSF
// band reader carried 27.2114 while the phonon unit table carried 27.211386245988, which
// disagreed by 5.1e-7 relative — 2.3e9x f64 eps, so not round-off.
export const HARTREE_TO_EV = 27.211386245981

// Exact by SI definition. Shared so the phonon unit table (spectral/helpers.ts) and the
// X-ray wavelength math (xrd/calc-xrd.ts) can't drift apart the way the Hartree values did.
export const PLANCK_J_S = 6.62607015e-34 // J*s
export const ELEMENTARY_CHARGE_C = 1.602176634e-19 // C (numerically also 1 eV in J)
export const SPEED_OF_LIGHT_M_S = 299792458 // m/s

// Wavenumber of a 1 THz vibration, i.e. 1e12 Hz over c in cm/s. The phonon unit table and
// the VDOS frequency axis both need it and had derived it separately.
export const THZ_TO_INVERSE_CM = 1e12 / (SPEED_OF_LIGHT_M_S * 100)

// Shared playback bounds keep trajectory and reaction-path controls consistent.
export const DEFAULT_FPS_RANGE = [0, 300] as const
export const FPS_STEP = 0.1

// Default resolution for PNG export, shared by every viewer's export pane and by the
// export helpers themselves — it was previously written out as a literal in 11 files.
export const DEFAULT_PNG_DPI = 150

// === file type detection ===

// compression formats and their file extensions
export const COMPRESSION_FORMATS = {
  gzip: [`.gz`, `.gzip`],
  deflate: [`.deflate`],
  'deflate-raw': [`.z`],
  zip: [`.zip`], // Browser DecompressionStream doesn't support ZIP
  xz: [`.xz`], // Browser DecompressionStream doesn't support XZ
  bz2: [`.bz2`], // Browser DecompressionStream doesn't support BZ2
} as const satisfies Record<string, readonly string[]>

// All detectable compression extensions
export const COMPRESSION_EXTENSIONS = Object.freeze(Object.values(COMPRESSION_FORMATS).flat())

// Keywords that indicate a file is likely a trajectory file.
// `dpmd` (DeePMD trajectory outputs) precedes `md` so the longer token wins.
// oxfmt-ignore
export const TRAJ_KEYWORDS = Object.freeze([
  `trajectory`, `traj`, `relaxation`, `relax`, `npt`, `nvt`, `nve`, `qha`, `dpmd`, `md`,
  `dynamics`, `simulation`,
])

// Keywords that indicate a file is likely a structure file
// oxfmt-ignore
export const STRUCT_KEYWORDS = Object.freeze([
  `structure`, `phono`, `vasp`, `crystal`, `material`, `lattice`, `geometry`, `unit_cell`,
  `unitcell`, `atoms`, `sites`, `data`, `phono3py`, `phonopy`,
])

// More restrictive keywords for JSON/YAML files (excludes generic terms like "data")
export const STRUCT_KEYWORDS_STRICT = Object.freeze(
  STRUCT_KEYWORDS.filter((keyword) => keyword !== `data`),
)

// Regex patterns for keyword matching. Keywords must be delimited on both sides
// (`md_300K`, `si_md.log`) so bare prefixes like `md/notes.log` or `mdp_run` do not
// match. `relaxation` is listed explicitly (not only via the `relax` prefix).
export const TRAJ_KEYWORDS_REGEX = new RegExp(
  `(^|[-_.])(${TRAJ_KEYWORDS.join(`|`)})([-_.]|$)`,
  `i`,
)

export const STRUCT_KEYWORDS_REGEX = new RegExp(`(${STRUCT_KEYWORDS.join(`|`)})`, `i`)

export const STRUCT_KEYWORDS_STRICT_REGEX = new RegExp(
  `(${STRUCT_KEYWORDS_STRICT.join(`|`)})`,
  `i`,
)

// Build a case-insensitive `\.(ext1|ext2|...)$` regex from extensions (leading dots stripped)
export const ext_regex = (exts: readonly string[]): RegExp =>
  new RegExp(`\\.(${exts.map((ext) => ext.replace(/^\./, ``)).join(`|`)})$`, `i`)

const filename_token_regex = (filenames: readonly string[]): RegExp =>
  new RegExp(`(?:^|[\\\\/_.-])(?:${filenames.join(`|`)})(?:[\\\\/_.-]|$)`, `i`)

// File extensions for different file types
export const TRAJ_EXTENSIONS = Object.freeze([`.traj`, `.xtc`, `.lammpstrj`])
export const TRAJ_EXTENSIONS_REGEX = ext_regex(TRAJ_EXTENSIONS)
// oxfmt-ignore
export const STRUCTURE_EXTENSIONS = Object.freeze([
  `.cif`, `.mcif`, `.poscar`, `.vasp`, `.cube`, `.lmp`, `.data`, `.dump`, `.pdb`, `.mol`,
  `.mol2`, `.sdf`, `.mmcif`,
])
export const STRUCTURE_EXTENSIONS_REGEX = ext_regex(STRUCTURE_EXTENSIONS)
export const TRAJ_FALLBACK_EXTENSIONS = Object.freeze([
  `.dat`,
  `.data`,
  `.log`,
  `.out`,
  `.json`,
])
export const TRAJ_FALLBACK_EXTENSIONS_REGEX = ext_regex(TRAJ_FALLBACK_EXTENSIONS)

// Special regex patterns
// Bare VASP filenames that the structure parser supports. OUTCAR, INCAR, KPOINTS and
// POTCAR are left out because advertising unparsable run inputs only earns the caller
// `Unable to determine file format`.
export const VASP_STRUCTURE_FILES = Object.freeze([`poscar`, `contcar`])
export const VASP_FILES_REGEX = filename_token_regex(VASP_STRUCTURE_FILES)
// oxfmt-ignore
export const VASP_VOLUMETRIC_FILES = Object.freeze([
  `chgcar`, `aeccar`, `aeccar0`, `aeccar1`, `aeccar2`, `elfcar`, `locpot`, `parchg`,
])
export const VASP_VOLUMETRIC_REGEX = filename_token_regex(VASP_VOLUMETRIC_FILES)
export const XDATCAR_REGEX = /xdatcar/i
export const CONFIG_DIRS_REGEX =
  /(?:^|[\\/])(?:\.vscode|\.idea|\.nyc_output|\.cache|\.tmp|\.temp|node_modules|dist|build|coverage)(?:[\\/]|$)/i
export const MD_SIM_EXCLUDE_REGEX = /md_simulation\.(?:out|txt|yml|py|csv|html|css|md|js|ts)$/i
export const XYZ_EXTENSIONS = Object.freeze([`.xyz`, `.extxyz`])
export const XYZ_EXTXYZ_REGEX = ext_regex(XYZ_EXTENSIONS)
// Lives here rather than in file-viewer/types (which re-exports it) so this module stays a
// dependency-free leaf that build scripts can import — see the host vocabularies below.
export const FERMI_FILE_EXTENSIONS = Object.freeze([`.bxsf`, `.frmsf`])

// === host opener vocabularies ===
// VS Code matches globs declared in its package.json and JupyterLab registers file types up
// front, so both need literal extension lists rather than the predicates in
// file-viewer/eligibility. Deriving them from here is what stops the two extensions drifting
// from $lib and from each other — they already had: VS Code alone claimed .dcd/.trr,
// JupyterLab alone left .xtc unclaimed. Listed without a leading dot, the form hosts want.

// Formats a UTF-8 decode can hand straight to a parser.
// .lammpstrj is the one text member of TRAJ_EXTENSIONS; .traj and .xtc are binary.
export const TEXT_VIEWER_EXTENSIONS = Object.freeze(
  [...STRUCTURE_EXTENSIONS, ...XYZ_EXTENSIONS, `.lammpstrj`, ...FERMI_FILE_EXTENSIONS].map(
    (ext) => ext.slice(1),
  ),
)

// Binary containers MatterViz can actually decode, i.e. the payloads a host must hand over
// as bytes rather than text. .xtc/.dcd/.trr are absent on purpose: there is no reader for
// them, so claiming them as an opener only replaces a working handler with an error.
export const BINARY_VIEWER_EXTENSIONS = Object.freeze([`traj`, `h5`, `hdf5`])

// VASP's canonical filenames carry no extension, so hosts have to match them as name stems.
export const VASP_VIEWER_STEMS = Object.freeze([
  ...new Set([...VASP_STRUCTURE_FILES, `xdatcar`, ...VASP_VOLUMETRIC_FILES]),
])

// Compression extensions regex (shared across files)
export const COMPRESSION_EXTENSIONS_REGEX = ext_regex(COMPRESSION_EXTENSIONS)
