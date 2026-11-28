import { add_alpha, is_concrete_color } from '#lib/colors/index'

// Separate fills for the two surfaces a file type colors: the small uppercase badge
// (saturated) and the file row behind it (a wash). Keeping them apart means neither is
// derived from the other by string surgery, which only ever worked for one rgba spelling.
export interface FileTypePaint {
  badge: string
  item: string
}

// Builds a paint pair from any concrete CSS badge color: the row is a 20% wash of the badge.
export const file_type_paint = (badge: string): FileTypePaint => {
  if (!is_concrete_color(badge))
    throw new Error(`Cannot derive file row paint from unsupported color: ${badge}`)
  return { badge, item: add_alpha(badge, 0.2) }
}

export const DEFAULT_FILE_TYPE_PAINTS: Record<string, FileTypePaint> = Object.fromEntries(
  Object.entries({
    // Hues picked so the row borders of types shown side by side (structures, trajectories,
    // volumetric grids, phase diagrams) stay apart in both themes; family members share one
    cif: `rgba(100, 149, 237, 0.8)`,
    mmcif: `rgba(0, 163, 163, 0.8)`,
    pdb: `rgba(107, 142, 35, 0.8)`,
    xyz: `rgba(50, 205, 50, 0.8)`,
    extxyz: `rgba(50, 205, 50, 0.8)`,
    poscar: `rgba(255, 140, 0, 0.8)`,
    json: `rgba(138, 43, 226, 0.8)`,
    yaml: `rgba(255, 0, 255, 0.8)`,
    data: `rgba(220, 20, 60, 0.8)`, // LAMMPS data, dump and input share one color
    dump: `rgba(220, 20, 60, 0.8)`,
    lmp: `rgba(220, 20, 60, 0.8)`,
    traj: `rgba(255, 105, 180, 0.8)`,
    hdf5: `rgba(255, 69, 0, 0.8)`,
    xdatcar: `rgba(255, 215, 0, 0.8)`,
    md: `rgba(128, 128, 0, 0.8)`,
    outcar: `rgba(184, 134, 11, 0.8)`,
    gz: `rgba(169, 169, 169, 0.8)`,
    tdb: `rgba(0, 188, 212, 0.8)`,
    chgcar: `rgba(37, 99, 235, 0.8)`,
    parchg: `rgba(236, 72, 153, 0.8)`,
    locpot: `rgba(234, 179, 8, 0.8)`,
    elfcar: `rgba(16, 185, 129, 0.8)`,
    cube: `rgba(168, 85, 247, 0.8)`,
  }).map(([type, badge]) => [type, file_type_paint(badge)]),
)

export const FALLBACK_FILE_TYPE_PAINT: FileTypePaint = file_type_paint(
  `rgba(128, 128, 128, 0.8)`,
)
