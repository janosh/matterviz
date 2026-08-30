// Shared constants with no dependencies of their own, so build scripts can import them:
// physical unit conversions, export defaults, then file type detection keywords.

// === physical constants ===

// CODATA 2022. One definition each so the Gaussian .cube reader (isosurface/parse.ts), the
// FRMSF reader (fermi-surface/parse.ts) and the phonon unit table cannot drift apart.
export const BOHR_TO_ANGSTROM = 0.529177210544
export const HARTREE_TO_EV = 27.211386245981

// Exact by SI definition; shared by the phonon unit table (spectral/helpers.ts) and the X-ray
// wavelength math (xrd/calc-xrd.ts)
export const PLANCK_J_S = 6.62607015e-34 // J*s
export const ELEMENTARY_CHARGE_C = 1.602176634e-19 // C (numerically also 1 eV in J)
export const SPEED_OF_LIGHT_M_S = 299792458 // m/s
export const BOLTZMANN_J_PER_K = 1.380649e-23 // J/K
export const AVOGADRO_PER_MOL = 6.02214076e23 // 1/mol
// k_B in eV/K (8.617333262e-5) for gas and phonon thermodynamics; 1 eV per particle
// in kJ/mol (96.485332) for the phonon thermal plot's molar units
export const BOLTZMANN_EV_PER_K = BOLTZMANN_J_PER_K / ELEMENTARY_CHARGE_C
export const EV_TO_KJ_PER_MOL = (ELEMENTARY_CHARGE_C * AVOGADRO_PER_MOL) / 1000
// 1 eV/A^3 in GPa (160.2176634): bulk moduli from equation-of-state fits (eos/fit.ts)
export const EV_PER_A3_TO_GPA = ELEMENTARY_CHARGE_C * 1e21

// Wavenumber of a 1 THz vibration, i.e. 1e12 Hz over c in cm/s (phonon unit table, VDOS axis)
export const THZ_TO_INVERSE_CM = 1e12 / (SPEED_OF_LIGHT_M_S * 100)

// Shared playback bounds keep trajectory and reaction-path controls consistent.
export const DEFAULT_FPS_RANGE = [0, 300] as const
export const FPS_STEP = 0.1

// Default resolution for PNG export, shared by every viewer's export pane and the export helpers
export const DEFAULT_PNG_DPI = 150

// Canonical element-color scheme names live in this dependency-free module because settings
// and extension build scripts need the choices without loading the color tables themselves.
export const ELEMENT_COLOR_SCHEME_NAMES = [
  `Vesta`,
  `Jmol`,
  `Alloy`,
  `Pastel`,
  `Muted`,
  `Dark Mode`,
] as const
export type ColorSchemeName = (typeof ELEMENT_COLOR_SCHEME_NAMES)[number]

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
const COMPRESSION_EXTENSIONS = Object.freeze(Object.values(COMPRESSION_FORMATS).flat())

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
const STRUCT_KEYWORDS_STRICT = STRUCT_KEYWORDS.filter((keyword) => keyword !== `data`)

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

export const filename_token_regex = (filenames: readonly string[]): RegExp =>
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
export const TRAJ_FALLBACK_EXTENSIONS_REGEX = ext_regex([
  `.dat`,
  `.data`,
  `.log`,
  `.out`,
  `.json`,
])

// Special regex patterns
// Bare VASP filenames that the structure parser supports. INCAR, KPOINTS and POTCAR are
// left out because advertising unparsable run inputs only earns the caller `Unable to
// determine file format`; OUTCAR, XDATCAR and vasprun.xml are trajectories, not structures.
export const VASP_STRUCTURE_FILES = Object.freeze([`poscar`, `contcar`])
export const VASP_FILES_REGEX = filename_token_regex(VASP_STRUCTURE_FILES)
// oxfmt-ignore
export const VASP_VOLUMETRIC_FILES = Object.freeze([
  `chgcar`, `aeccar`, `aeccar0`, `aeccar1`, `aeccar2`, `elfcar`, `locpot`, `parchg`,
])
export const VASP_VOLUMETRIC_REGEX = filename_token_regex(VASP_VOLUMETRIC_FILES)
// Bare VASP run outputs the trajectory parsers read
export const VASP_TRAJECTORY_FILES = Object.freeze([`xdatcar`, `outcar`])
export const VASP_TRAJECTORY_REGEX = filename_token_regex(VASP_TRAJECTORY_FILES)
// vasprun.xml plus decorated names such as vasprun_relax.xml or run1.vasprun.xml
export const VASPRUN_REGEX = /(?:^|[\\/_.-])vasprun[^/\\]*\.xml$/i
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
// file-viewer/eligibility. Deriving them from here keeps the two extensions in step with $lib
// and with each other. Listed without a leading dot, the form hosts want.

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
const HDF5_EXTENSIONS = Object.freeze([`h5`, `hdf5`])
export const HDF5_EXT_REGEX = ext_regex(HDF5_EXTENSIONS)
export const BINARY_VIEWER_EXTENSIONS = Object.freeze([`traj`, ...HDF5_EXTENSIONS])
export const BINARY_VIEWER_EXT_REGEX = ext_regex(BINARY_VIEWER_EXTENSIONS)

// VASP's canonical filenames carry no extension, so hosts have to match them as name stems.
export const VASP_VIEWER_STEMS = Object.freeze([
  ...VASP_STRUCTURE_FILES,
  ...VASP_TRAJECTORY_FILES,
  ...VASP_VOLUMETRIC_FILES,
])

// Compression extensions regex (shared across files)
export const COMPRESSION_EXTENSIONS_REGEX = ext_regex(COMPRESSION_EXTENSIONS)
