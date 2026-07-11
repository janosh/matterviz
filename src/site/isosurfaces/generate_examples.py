"""Generate small example volumetric data files for the isosurface demo.

Run: python src/site/isosurfaces/generate_examples.py
"""

import gzip
import math
from collections.abc import Callable

BOHR_TO_ANG = 0.529177249
ANG_TO_BOHR = 1.0 / BOHR_TO_ANG

Atom = tuple[int, float, float, float]  # (Z, x, y, z) in Angstrom
FracCoord = tuple[float, float, float]


def gaussian(
    x: float, y: float, z: float, cx: float, cy: float, cz: float, sigma: float
) -> float:
    """3D Gaussian function centered at (cx, cy, cz)."""
    r2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
    return math.exp(-r2 / (2 * sigma**2))


def gaussian_coulomb(
    x: float,
    y: float,
    z: float,
    cx: float,
    cy: float,
    cz: float,
    charge: float,
    sigma: float,
) -> float:
    """Coulomb potential of a Gaussian charge distribution (softened 1/r).

    V(r) = q * erf(r / (sqrt(2) * sigma)) / r, with the finite r -> 0 limit
    q * sqrt(2/pi) / sigma. Far from the charge this decays like q/r, giving a
    physically shaped electrostatic potential for point partial charges.
    """
    dist = math.dist((x, y, z), (cx, cy, cz))
    if dist < 1e-9:
        return charge * math.sqrt(2.0 / math.pi) / sigma
    return charge * math.erf(dist / (math.sqrt(2.0) * sigma)) / dist


# === Shared helpers ===


def pbc_gaussian_sum(
    x: float,
    y: float,
    z: float,
    centers: list[tuple[float, float, float]],
    weights: list[float],
    sigmas: list[float],
    lattice_vecs: list[tuple[float, float, float]],
) -> float:
    """Sum of Gaussians at centers with periodic images along lattice vectors.

    A zero lattice vector disables periodic images along that axis (used for
    slabs), rather than adding coincident duplicate images.
    """
    image_ranges = [
        (-1, 0, 1) if any(abs(comp) > 0 for comp in vec) else (0,)
        for vec in lattice_vecs
    ]
    result = 0.0
    for (cx, cy, cz), weight, sigma in zip(centers, weights, sigmas, strict=True):
        for dx_img in image_ranges[0]:
            for dy_img in image_ranges[1]:
                for dz_img in image_ranges[2]:
                    ix = cx
                    iy = cy
                    iz = cz
                    for dim, (lx, ly, lz) in zip(
                        (dx_img, dy_img, dz_img), lattice_vecs, strict=True
                    ):
                        ix += dim * lx
                        iy += dim * ly
                        iz += dim * lz
                    result += weight * gaussian(x, y, z, ix, iy, iz, sigma)
    return result


def write_cube(
    title: str,
    atoms: list[Atom],
    n_grid: int | tuple[int, int, int],
    box_size: float,
    density_fn: Callable[[float, float, float], float],
    orbital: bool = False,
) -> str:
    """Write a Gaussian .cube file from a density function.

    Args:
        title: two-line title for the file header
        atoms: list of (Z, x, y, z) in Angstrom
        n_grid: grid points per axis (int for cubic, tuple for non-cubic)
        box_size: box side length in Angstrom (centered at origin)
        density_fn: function(x, y, z) -> value, called in Angstrom coords
        orbital: if True, write negative n_atoms + orbital header line
    """
    nx, ny, nz = (n_grid, n_grid, n_grid) if isinstance(n_grid, int) else n_grid
    origin = [-box_size / 2] * 3
    voxel = box_size / max(nx, ny, nz)
    voxel_bohr = voxel * ANG_TO_BOHR
    origin_bohr = [coord * ANG_TO_BOHR for coord in origin]

    lines = [title, "Generated for matterviz isosurface demo"]
    n_sign = -len(atoms) if orbital else len(atoms)
    lines.append(
        f"    {n_sign}   {origin_bohr[0]:.6f}   {origin_bohr[1]:.6f}   {origin_bohr[2]:.6f}"
    )
    lines.append(f"   {nx}   {voxel_bohr:.6f}   0.000000   0.000000")
    lines.append(f"   {ny}   0.000000   {voxel_bohr:.6f}   0.000000")
    lines.append(f"   {nz}   0.000000   0.000000   {voxel_bohr:.6f}")

    for z_num, ax, ay, az in atoms:
        charge = float(z_num) if not orbital else 0.0
        lines.append(
            f"    {z_num}   {charge:.6f}   {ax * ANG_TO_BOHR:.6f}"
            f"   {ay * ANG_TO_BOHR:.6f}   {az * ANG_TO_BOHR:.6f}"
        )
    if orbital:
        lines.append("    1    1")

    values = []
    for ix in range(nx):
        x = origin[0] + ix * voxel
        for iy in range(ny):
            y = origin[1] + iy * voxel
            for iz in range(nz):
                z = origin[2] + iz * voxel
                values.append(density_fn(x, y, z))

    for idx in range(0, len(values), 6):
        lines.append("  ".join(f"{val:.5E}" for val in values[idx : idx + 6]))
    return "\n".join(lines) + "\n"


def write_chgcar(
    comment: str,
    lattice: list[tuple[float, float, float]],
    elements: list[tuple[str, list[FracCoord]]],
    grid_dims: tuple[int, int, int],
    density_fn: Callable[[float, float, float, float, float, float], float],
    extra_blocks: list[
        tuple[Callable[[float, float, float, float, float, float], float], str | None]
    ]
    | None = None,
) -> str:
    """Write a VASP CHGCAR/ELFCAR/LOCPOT file from a density function.

    Args:
        comment: header comment line
        lattice: 3 lattice vectors as (x, y, z) tuples
        elements: list of (symbol, [fractional_coords]) pairs
        grid_dims: (nx, ny, nz) grid dimensions
        density_fn: function(x, y, z, lat_a, lat_b, lat_c) -> rho*volume
            Called with Cartesian coords and lattice params.
        extra_blocks: optional additional volumetric blocks (e.g. magnetization)
            each is (density_fn, augmentation_text or None)
    """
    lines = [comment, "   1.0"]
    for vx, vy, vz in lattice:
        lines.append(f"     {vx:.4f}  {vy:.4f}  {vz:.4f}")

    elem_names = "   ".join(sym for sym, _ in elements)
    elem_counts = "   ".join(str(len(coords)) for _, coords in elements)
    lines.extend([f"   {elem_names}", f"   {elem_counts}", "Direct"])

    for _, coords in elements:
        for fx, fy, fz in coords:
            lines.append(f"  {fx:.6f}  {fy:.6f}  {fz:.6f}")
    lines.append("")

    nx, ny, nz = grid_dims
    all_blocks: list[
        tuple[Callable[[float, float, float, float, float, float], float], str | None]
    ] = [(density_fn, None)]
    if extra_blocks:
        all_blocks.extend(extra_blocks)

    for block_fn, aug_text in all_blocks:
        lines.append(f"   {nx}   {ny}   {nz}")
        values = []
        # VASP volumetric ordering: x varies fastest, then y, then z.
        for iz in range(nz):
            for iy in range(ny):
                for ix in range(nx):
                    fx, fy, fz = ix / nx, iy / ny, iz / nz
                    # Convert fractional to Cartesian
                    x = fx * lattice[0][0] + fy * lattice[1][0] + fz * lattice[2][0]
                    y = fx * lattice[0][1] + fy * lattice[1][1] + fz * lattice[2][1]
                    z = fx * lattice[0][2] + fy * lattice[1][2] + fz * lattice[2][2]
                    values.append(block_fn(x, y, z, fx, fy, fz))

        for idx in range(0, len(values), 5):
            lines.append(" ".join(f"{val:18.11E}" for val in values[idx : idx + 5]))

        if aug_text:
            lines.append(aug_text)

    return "\n".join(lines) + "\n"


# === Generator functions ===


def generate_h2o_cube() -> str:
    """Water molecule electron density (.cube, 30x30x30)."""
    atoms: list[Atom] = [
        (8, 0.0, 0.0, 0.1173),
        (1, 0.0, 0.7572, -0.4692),
        (1, 0.0, -0.7572, -0.4692),
    ]
    bond_mids = [(0.0, 0.3786, -0.176), (0.0, -0.3786, -0.176)]

    def density(x: float, y: float, z: float) -> float:
        rho = 8.0 * gaussian(x, y, z, 0.0, 0.0, 0.1173, 0.7)
        rho += gaussian(x, y, z, 0.0, 0.7572, -0.4692, 0.4)
        rho += gaussian(x, y, z, 0.0, -0.7572, -0.4692, 0.4)
        for bx, by, bz in bond_mids:
            rho += 2.0 * gaussian(x, y, z, bx, by, bz, 0.35)
        return rho

    return write_cube("Water molecule electron density", atoms, 30, 6.0, density)


def generate_benzene_orbital_cube() -> str:
    """Benzene pi orbital (.cube, 30x30x30, orbital mode)."""
    r_cc, r_ch = 1.397, 1.087
    atoms: list[Atom] = []
    c_positions: list[tuple[float, float]] = []
    for idx in range(6):
        angle = idx * math.pi / 3
        cx, cy = r_cc * math.cos(angle), r_cc * math.sin(angle)
        c_positions.append((cx, cy))
        atoms.append((6, cx, cy, 0.0))
        atoms.append(
            (1, (r_cc + r_ch) * math.cos(angle), (r_cc + r_ch) * math.sin(angle), 0.0)
        )

    signs = [1, -1, 1, -1, 1, -1]

    def density(x: float, y: float, z: float) -> float:
        psi = 0.0
        for (cx, cy), sign in zip(c_positions, signs):
            psi += sign * z * math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + z**2) / 0.72)
        return psi

    return write_cube(
        "Benzene pi orbital (HOMO)", atoms, 30, 8.0, density, orbital=True
    )


def generate_ch4_esp_cube() -> str:
    """Methane electrostatic potential (.cube, 30x30x30)."""
    r_ch = 1.089
    tet = r_ch / math.sqrt(3)
    atoms: list[Atom] = [
        (6, 0.0, 0.0, 0.0),
        (1, tet, tet, tet),
        (1, tet, -tet, -tet),
        (1, -tet, tet, -tet),
        (1, -tet, -tet, tet),
    ]

    def density(x: float, y: float, z: float) -> float:
        pot = 0.0
        for z_num, ax, ay, az in atoms:
            pot += z_num * gaussian(x, y, z, ax, ay, az, 0.4)
            pot -= z_num * 0.8 * gaussian(x, y, z, ax, ay, az, 0.9)
        return pot

    return write_cube("Methane electrostatic potential", atoms, 30, 7.0, density)


def generate_si_chgcar() -> str:
    """Silicon diamond charge density (CHGCAR, 24x24x24)."""
    lat_a = 5.43
    lattice = [(lat_a, 0.0, 0.0), (0.0, lat_a, 0.0), (0.0, 0.0, lat_a)]
    si_frac: list[FracCoord] = [
        (0.0, 0.0, 0.0),
        (0.5, 0.5, 0.0),
        (0.5, 0.0, 0.5),
        (0.0, 0.5, 0.5),
        (0.25, 0.25, 0.25),
        (0.75, 0.75, 0.25),
        (0.75, 0.25, 0.75),
        (0.25, 0.75, 0.75),
    ]
    bond_frac: list[FracCoord] = [
        (0.125, 0.125, 0.125),
        (0.375, 0.375, 0.125),
        (0.375, 0.125, 0.375),
        (0.125, 0.375, 0.375),
        (0.625, 0.625, 0.125),
        (0.875, 0.875, 0.125),
        (0.875, 0.625, 0.375),
        (0.625, 0.875, 0.375),
        (0.625, 0.125, 0.625),
        (0.875, 0.375, 0.625),
        (0.875, 0.125, 0.875),
        (0.625, 0.375, 0.875),
        (0.125, 0.625, 0.625),
        (0.375, 0.875, 0.625),
        (0.375, 0.625, 0.875),
        (0.125, 0.875, 0.875),
    ]
    volume = lat_a**3
    lat_vecs = [lattice[0], lattice[1], lattice[2]]
    atom_cart = [(fx * lat_a, fy * lat_a, fz * lat_a) for fx, fy, fz in si_frac]
    bond_cart = [(fx * lat_a, fy * lat_a, fz * lat_a) for fx, fy, fz in bond_frac]

    def density(
        x: float, y: float, z: float, _fx: float, _fy: float, _fz: float
    ) -> float:
        rho = pbc_gaussian_sum(
            x,
            y,
            z,
            atom_cart,
            [14.0] * len(atom_cart),
            [0.8] * len(atom_cart),
            lat_vecs,
        )
        rho += pbc_gaussian_sum(
            x, y, z, bond_cart, [4.0] * len(bond_cart), [0.5] * len(bond_cart), lat_vecs
        )
        return rho * volume

    return write_chgcar(
        "Si8 diamond structure - simulated charge density",
        lattice,
        [("Si", si_frac)],
        (24, 24, 24),
        density,
    )


def generate_fe_bcc_spin_chgcar() -> str:
    """Fe BCC spin-polarized charge + magnetization (CHGCAR, 20x20x20)."""
    lat_a = 2.87
    lattice = [(lat_a, 0.0, 0.0), (0.0, lat_a, 0.0), (0.0, 0.0, lat_a)]
    fe_frac: list[FracCoord] = [(0.0, 0.0, 0.0), (0.5, 0.5, 0.5)]
    volume = lat_a**3
    lat_vecs = [lattice[0], lattice[1], lattice[2]]
    atom_cart = [(fx * lat_a, fy * lat_a, fz * lat_a) for fx, fy, fz in fe_frac]

    def charge(
        x: float, y: float, z: float, _fx: float, _fy: float, _fz: float
    ) -> float:
        return (
            pbc_gaussian_sum(x, y, z, atom_cart, [26.0] * 2, [0.6] * 2, lat_vecs)
            * volume
        )

    def magnetization(
        x: float, y: float, z: float, _fx: float, _fy: float, _fz: float
    ) -> float:
        return (
            pbc_gaussian_sum(x, y, z, atom_cart, [2.2] * 2, [0.5] * 2, lat_vecs)
            * volume
        )

    aug_text = "\n".join(
        [
            "augmentation occupancies   1  16",
            *["  0.100E+01" + "  0.000E+00" * 3] * 4,
            "augmentation occupancies   2  16",
            *["  0.100E+01" + "  0.000E+00" * 3] * 4,
        ]
    )

    return write_chgcar(
        "Fe2 BCC - spin-polarized charge density",
        lattice,
        [("Fe", fe_frac)],
        (20, 20, 20),
        charge,
        extra_blocks=[(magnetization, aug_text)],
    )


def generate_hbn_chgcar() -> str:
    """Hexagonal BN charge density (CHGCAR, 20x20x16, non-orthogonal)."""
    lat_a, lat_c = 2.50, 6.66
    a2_x, a2_y = lat_a / 2, lat_a * math.sqrt(3) / 2
    lattice = [(lat_a, 0.0, 0.0), (a2_x, a2_y, 0.0), (0.0, 0.0, lat_c)]
    bn_frac: list[FracCoord] = [
        (0.0, 0.0, 0.0),
        (1 / 3, 2 / 3, 0.0),
        (0.0, 0.0, 0.5),
        (2 / 3, 1 / 3, 0.5),
    ]
    volume = lat_a * a2_y * lat_c
    lat_vecs = [lattice[0], lattice[1], lattice[2]]
    z_nums = [5, 7, 5, 7]

    def frac_to_cart(fx: float, fy: float, fz: float) -> tuple[float, float, float]:
        return (fx * lat_a + fy * a2_x, fy * a2_y, fz * lat_c)

    atom_cart = [frac_to_cart(*frac) for frac in bn_frac]
    bond_cart = [frac_to_cart(1 / 6, 1 / 3, 0.0), frac_to_cart(1 / 6, 1 / 3, 0.5)]

    def density(
        x: float, y: float, z: float, _fx: float, _fy: float, _fz: float
    ) -> float:
        rho = pbc_gaussian_sum(
            x,
            y,
            z,
            atom_cart,
            [float(zn) for zn in z_nums],
            [0.45] * 4,
            lat_vecs,
        )
        rho += pbc_gaussian_sum(x, y, z, bond_cart, [3.0] * 2, [0.3] * 2, lat_vecs)
        return rho * volume

    return write_chgcar(
        "hBN hexagonal - charge density",
        lattice,
        [("B", [bn_frac[0], bn_frac[2]]), ("N", [bn_frac[1], bn_frac[3]])],
        (20, 20, 16),
        density,
    )


# Al(111) slab geometry shared by the LOCPOT and CHGCAR generators (grids must
# match exactly so the demo can color the density surface by the potential)
AL_SLAB_A, AL_SLAB_C = 2.86, 25.0
AL_SLAB_FRAC: list[FracCoord] = [
    (0.0, 0.0, 0.30),
    (1 / 3, 2 / 3, 0.35),
    (2 / 3, 1 / 3, 0.40),
    (0.0, 0.0, 0.45),
]


def al_slab_geometry() -> tuple[
    list[tuple[float, float, float]],
    list[tuple[float, float, float]],
    list[tuple[float, float, float]],
    float,
]:
    """Return (lattice, atom Cartesian coords, in-plane PBC vectors, cell volume)."""
    a2_x, a2_y = AL_SLAB_A / 2, AL_SLAB_A * math.sqrt(3) / 2
    lattice = [(AL_SLAB_A, 0.0, 0.0), (a2_x, a2_y, 0.0), (0.0, 0.0, AL_SLAB_C)]
    atom_cart = [
        (fx * AL_SLAB_A + fy * a2_x, fy * a2_y, fz * AL_SLAB_C)
        for fx, fy, fz in AL_SLAB_FRAC
    ]
    # Zero z vector: no periodic images across the vacuum gap
    lat_vecs_xy = [lattice[0], lattice[1], (0.0, 0.0, 0.0)]
    volume = AL_SLAB_A * a2_y * AL_SLAB_C
    return lattice, atom_cart, lat_vecs_xy, volume


def generate_al_slab_locpot() -> str:
    """Al(111) slab local potential (LOCPOT, 12x12x40)."""
    lattice, atom_cart, lat_vecs_xy, volume = al_slab_geometry()

    def density(
        x: float, y: float, z: float, _fx: float, _fy: float, fz: float
    ) -> float:
        """Attractive atomic wells plus a slab-vs-vacuum background step."""
        pot = -pbc_gaussian_sum(x, y, z, atom_cart, [13.0] * 4, [0.5] * 4, lat_vecs_xy)
        slab_center, slab_width = 0.375, 0.10
        in_slab = math.exp(-((fz - slab_center) ** 2) / (2 * slab_width**2))
        pot += -2.0 * in_slab + 0.5 * (1 - in_slab)
        return pot * volume

    return write_chgcar(
        "Al(111) slab - local potential",
        lattice,
        [("Al", AL_SLAB_FRAC)],
        (12, 12, 40),
        density,
    )


# === Multi-volume demo generators (matching-grid pairs for cross-volume coloring) ===

# Glycine NH2-CH2-COOH geometry in Angstrom, roughly centered at the origin
# (Z, x, y, z) with approximate partial charges (summing to zero for the
# neutral molecule) used for the simulated ESP
GLYCINE_ATOMS_CHARGES: list[tuple[int, float, float, float, float]] = [
    (7, -1.45, 0.01, -0.93, -0.60),  # N (amine)
    (1, -1.82, 0.86, -0.50, 0.28),  # H on N
    (1, -1.99, -0.78, -0.62, 0.28),  # H on N
    (6, -0.03, -0.05, -0.90, -0.05),  # C alpha
    (1, 0.31, -1.05, -1.19, 0.10),  # H on C alpha
    (1, 0.36, 0.66, -1.63, 0.10),  # H on C alpha
    (6, 0.63, 0.26, 0.43, 0.55),  # C carboxyl
    (8, 0.22, 1.11, 1.21, -0.50),  # O double-bonded
    (8, 1.71, -0.45, 0.76, -0.55),  # O hydroxyl
    (1, 2.05, -0.18, 1.63, 0.39),  # H on O
]

assert abs(sum(atom[4] for atom in GLYCINE_ATOMS_CHARGES)) < 1e-9, (
    "glycine partial charges must sum to zero"
)

GLYCINE_GRID = 50
GLYCINE_BOX = 10.0


def generate_glycine_density_cube() -> str:
    """Glycine electron density (.cube, 50x50x50) — pairs with glycine-esp."""
    atoms: list[Atom] = [(z, x, y, zc) for z, x, y, zc, _q in GLYCINE_ATOMS_CHARGES]
    # Bond midpoints add covalent-bond density between heavy atoms
    bonds = [(0, 3), (3, 6), (6, 7), (6, 8)]

    def density(x: float, y: float, z: float) -> float:
        rho = 0.0
        for z_num, ax, ay, az, _q in GLYCINE_ATOMS_CHARGES:
            # Tight core + diffuse valence tail so a vdW-like outer surface still
            # follows the molecular skeleton instead of merging into one blob
            sigma_core = 0.28 if z_num == 1 else 0.38
            rho += z_num * gaussian(x, y, z, ax, ay, az, sigma_core)
            rho += 0.4 * z_num * gaussian(x, y, z, ax, ay, az, sigma_core * 1.8)
        for idx_a, idx_b in bonds:
            _, ax, ay, az, _ = GLYCINE_ATOMS_CHARGES[idx_a]
            _, bx, by, bz, _ = GLYCINE_ATOMS_CHARGES[idx_b]
            mx, my, mz = (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2
            rho += 1.2 * gaussian(x, y, z, mx, my, mz, 0.3)
        return rho

    return write_cube(
        "Glycine electron density (pairs with glycine-esp.cube)",
        atoms,
        GLYCINE_GRID,
        GLYCINE_BOX,
        density,
    )


def generate_glycine_esp_cube() -> str:
    """Glycine electrostatic potential (.cube, 50x50x50) on the density grid."""
    atoms: list[Atom] = [(z, x, y, zc) for z, x, y, zc, _q in GLYCINE_ATOMS_CHARGES]

    def potential(x: float, y: float, z: float) -> float:
        """Sum of softened Coulomb potentials of the atomic partial charges."""
        pot = 0.0
        for _z_num, ax, ay, az, charge in GLYCINE_ATOMS_CHARGES:
            pot += gaussian_coulomb(x, y, z, ax, ay, az, charge, 0.5)
        return pot

    return write_cube(
        "Glycine electrostatic potential (pairs with glycine-density.cube)",
        atoms,
        GLYCINE_GRID,
        GLYCINE_BOX,
        potential,
    )


def generate_al_slab_chgcar() -> str:
    """Al(111) slab charge density (CHGCAR, 12x12x40) on the LOCPOT grid."""
    lattice, atom_cart, lat_vecs_xy, volume = al_slab_geometry()

    def density(
        x: float, y: float, z: float, _fx: float, _fy: float, _fz: float
    ) -> float:
        """Gaussian charge blobs on the four slab atoms."""
        rho = pbc_gaussian_sum(x, y, z, atom_cart, [13.0] * 4, [0.55] * 4, lat_vecs_xy)
        return rho * volume

    return write_chgcar(
        "Al(111) slab - charge density (pairs with Al-slab-LOCPOT)",
        lattice,
        [("Al", AL_SLAB_FRAC)],
        (12, 12, 40),
        density,
    )


def generate_hbn_elfcar() -> str:
    """Hexagonal BN localization function (ELFCAR, 20x20x16, non-orthogonal).

    Pairs with hBN-CHGCAR on an identical grid so density surfaces can be
    colored by localization on a non-orthogonal lattice.
    """
    lat_a, lat_c = 2.50, 6.66
    a2_x, a2_y = lat_a / 2, lat_a * math.sqrt(3) / 2
    lattice = [(lat_a, 0.0, 0.0), (a2_x, a2_y, 0.0), (0.0, 0.0, lat_c)]
    volume = lat_a * a2_y * lat_c
    lat_vecs = [lattice[0], lattice[1], lattice[2]]

    def frac_to_cart(fx: float, fy: float, fz: float) -> tuple[float, float, float]:
        return (fx * lat_a + fy * a2_x, fy * a2_y, fz * lat_c)

    # ELF-like field: high (~0.9) at B-N bond midpoints and N lone-pair regions,
    # moderate at atoms, low in interstitial space
    bond_cart = [frac_to_cart(1 / 6, 1 / 3, 0.0), frac_to_cart(1 / 6, 1 / 3, 0.5)]
    n_cart = [frac_to_cart(1 / 3, 2 / 3, 0.0), frac_to_cart(2 / 3, 1 / 3, 0.5)]
    b_cart = [frac_to_cart(0.0, 0.0, 0.0), frac_to_cart(0.0, 0.0, 0.5)]

    def elf(x: float, y: float, z: float, _fx: float, _fy: float, _fz: float) -> float:
        val = 0.05  # interstitial baseline
        val += 0.85 * pbc_gaussian_sum(
            x, y, z, bond_cart, [1.0] * 2, [0.45] * 2, lat_vecs
        )
        val += 0.6 * pbc_gaussian_sum(x, y, z, n_cart, [1.0] * 2, [0.4] * 2, lat_vecs)
        val += 0.3 * pbc_gaussian_sum(x, y, z, b_cart, [1.0] * 2, [0.35] * 2, lat_vecs)
        return min(val, 1.0) * volume

    return write_chgcar(
        "hBN hexagonal - simulated ELF (pairs with hBN-CHGCAR)",
        lattice,
        [
            ("B", [(0.0, 0.0, 0.0), (0.0, 0.0, 0.5)]),
            ("N", [(1 / 3, 2 / 3, 0.0), (2 / 3, 1 / 3, 0.5)]),
        ],
        (20, 20, 16),
        elf,
    )


def generate_large_grid_locpot() -> str:
    """Large 80x80x96 LOCPOT matching large-grid-CHGCAR for perf testing.

    Same 12x12x14.4 Angstrom cell and Si4 sites as the large CHGCAR so
    cross-volume coloring can be stress-tested at full grid resolution.
    """
    lattice = [(12.0, 0.0, 0.0), (0.0, 12.0, 0.0), (0.0, 0.0, 14.4)]
    si_frac: list[FracCoord] = [
        (0.0, 0.0, 0.0),
        (0.5, 0.5, 0.0),
        (0.5, 0.0, 0.5),
        (0.0, 0.5, 0.5),
    ]
    volume = 12.0 * 12.0 * 14.4
    lat_vecs = [lattice[0], lattice[1], lattice[2]]
    atom_cart = [(fx * 12.0, fy * 12.0, fz * 14.4) for fx, fy, fz in si_frac]

    def potential(
        x: float, y: float, z: float, fx: float, fy: float, fz: float
    ) -> float:
        """Attractive wells at nuclei plus a long-wavelength periodic modulation."""
        pot = -pbc_gaussian_sum(x, y, z, atom_cart, [10.0] * 4, [0.9] * 4, lat_vecs)
        pot += 0.8 * math.sin(2 * math.pi * fx) * math.cos(2 * math.pi * fy)
        pot += 0.5 * math.cos(2 * math.pi * fz)
        # Round to 6 significant digits so the gzipped file stays small
        return float(f"{pot * volume:.5e}")

    return write_chgcar(
        "Large grid LOCPOT - perf test (pairs with large-grid-CHGCAR)",
        lattice,
        [("Si", si_frac)],
        (80, 80, 96),
        potential,
    )


# === Main ===

if __name__ == "__main__":
    import os
    import sys

    out_dir = os.path.dirname(__file__)
    generators: dict[str, Callable[[], str]] = {
        "h2o-density.cube.gz": generate_h2o_cube,
        "Si-CHGCAR.gz": generate_si_chgcar,
        "benzene-orbital.cube.gz": generate_benzene_orbital_cube,
        "Fe-spin-CHGCAR.gz": generate_fe_bcc_spin_chgcar,
        "ch4-esp.cube.gz": generate_ch4_esp_cube,
        "hBN-CHGCAR.gz": generate_hbn_chgcar,
        "Al-slab-LOCPOT.gz": generate_al_slab_locpot,
        # Matching-grid pairs for multi-volume cross-coloring demos
        "glycine-density.cube.gz": generate_glycine_density_cube,
        "glycine-esp.cube.gz": generate_glycine_esp_cube,
        "Al-slab-CHGCAR.gz": generate_al_slab_chgcar,
        "hBN-ELFCAR.gz": generate_hbn_elfcar,
        "large-grid-LOCPOT.gz": generate_large_grid_locpot,
    }

    # Pass filenames as args to regenerate a subset, e.g.
    # python generate_examples.py glycine-density.cube.gz glycine-esp.cube.gz
    selected = sys.argv[1:] or list(generators)
    if unknown := [name for name in selected if name not in generators]:
        known = "\n  ".join(generators)
        raise SystemExit(f"Unknown file(s): {', '.join(unknown)}. Known:\n  {known}")

    for filename in selected:
        gen_fn = generators[filename]
        print(f"Generating {filename} ...")
        content = gen_fn()
        with gzip.open(f"{out_dir}/{filename}", "wt") as fh:
            fh.write(content)
        print(f"  -> {len(content)} bytes uncompressed")

    print("Done!")
