"""Generate small example volumetric data files for the isosurface demo.

Run: uv run src/scripts/generate_isosurface_examples.py
"""

import gzip
import math
from collections.abc import Callable
from itertools import product
from typing import NamedTuple

# CODATA 2022, kept in sync with BOHR_TO_ANGSTROM in src/lib/constants.ts so generated
# fixtures round-trip through the .cube reader on the same constant
BOHR_TO_ANG = 0.529177210544
ANG_TO_BOHR = 1.0 / BOHR_TO_ANG

Atom = tuple[int, float, float, float]  # (Z, x, y, z) in Angstrom
Vec3 = tuple[float, float, float]


def gaussian(position: Vec3, center: Vec3, sigma: float) -> float:
    """3D Gaussian centered at the given Cartesian position."""
    delta_x, delta_y, delta_z = (
        coord - origin for coord, origin in zip(position, center, strict=True)
    )
    return math.exp(-(delta_x**2 + delta_y**2 + delta_z**2) / (2 * sigma**2))


def gaussian_coulomb(
    position: Vec3, center: Vec3, charge: float, sigma: float
) -> float:
    """Softened Coulomb potential, with the finite Gaussian-charge limit at r=0."""
    dist = math.dist(position, center)
    if dist < 1e-9:
        return charge * math.sqrt(2.0 / math.pi) / sigma
    return charge * math.erf(dist / (math.sqrt(2.0) * sigma)) / dist


# === Shared helpers ===


def periodic_field(
    centers: list[Vec3], weights: list[float], sigma: float, lattice: list[Vec3]
) -> Callable[[Vec3], float]:
    """Prepare Gaussian images once; a zero lattice vector disables that axis's images."""
    images = list(product(*[(-1, 0, 1) if any(vector) else (0,) for vector in lattice]))
    terms: list[tuple[Vec3, float]] = []
    for center, weight in zip(centers, weights, strict=True):
        for image in images:
            shifted = list(center)
            for offset, vector in zip(image, lattice, strict=True):
                for axis, component in enumerate(vector):
                    shifted[axis] += offset * component
            terms.append(((shifted[0], shifted[1], shifted[2]), weight))

    def evaluate(position: Vec3) -> float:
        """Accumulate the prepared images in site/image order."""
        result = 0.0
        for center, weight in terms:
            result += weight * gaussian(position, center, sigma)
        return result

    return evaluate


def frac_to_cart(frac: Vec3, lattice: list[Vec3]) -> Vec3:
    """Convert fractional coordinates, preserving the lattice-vector addition order."""
    cart = [
        frac[0] * row[0] + frac[1] * row[1] + frac[2] * row[2]
        for row in zip(*lattice, strict=True)
    ]
    return cart[0], cart[1], cart[2]


def write_cube(
    title: str,
    atoms: list[Atom],
    n_grid: int | tuple[int, int, int],
    box_size: float,
    density_fn: Callable[[Vec3], float],
    orbital: bool = False,
) -> str:
    """Write a Gaussian .cube file from a density function.

    Args:
        title: two-line title for the file header
        atoms: list of (Z, x, y, z) in Angstrom
        n_grid: grid points per axis (int for cubic, tuple for non-cubic)
        box_size: box side length in Angstrom (centered at origin)
        density_fn: Cartesian position in Angstrom -> value
        orbital: if True, write negative n_atoms + orbital header line
    """
    count_x, count_y, count_z = (
        (n_grid, n_grid, n_grid) if isinstance(n_grid, int) else n_grid
    )
    origin = [-box_size / 2] * 3
    voxel = box_size / max(count_x, count_y, count_z)
    voxel_bohr = voxel * ANG_TO_BOHR
    origin_bohr = [coord * ANG_TO_BOHR for coord in origin]

    lines = [title, "Generated for matterviz isosurface demo"]
    n_sign = -len(atoms) if orbital else len(atoms)
    lines.append(
        f"    {n_sign}   {origin_bohr[0]:.6f}   {origin_bohr[1]:.6f}   {origin_bohr[2]:.6f}"
    )
    lines.append(f"   {count_x}   {voxel_bohr:.6f}   0.000000   0.000000")
    lines.append(f"   {count_y}   0.000000   {voxel_bohr:.6f}   0.000000")
    lines.append(f"   {count_z}   0.000000   0.000000   {voxel_bohr:.6f}")

    for z_num, atom_x, atom_y, atom_z in atoms:
        charge = float(z_num) if not orbital else 0.0
        lines.append(
            f"    {z_num}   {charge:.6f}   {atom_x * ANG_TO_BOHR:.6f}"
            f"   {atom_y * ANG_TO_BOHR:.6f}   {atom_z * ANG_TO_BOHR:.6f}"
        )
    if orbital:
        lines.append("    1    1")

    values = []
    for index_x in range(count_x):
        coord_x = origin[0] + index_x * voxel
        for index_y in range(count_y):
            coord_y = origin[1] + index_y * voxel
            for index_z in range(count_z):
                coord_z = origin[2] + index_z * voxel
                values.append(density_fn((coord_x, coord_y, coord_z)))

    for idx in range(0, len(values), 6):
        lines.append("  ".join(f"{val:.5E}" for val in values[idx : idx + 6]))
    return "\n".join(lines) + "\n"


def write_chgcar(
    comment: str,
    lattice: list[Vec3],
    elements: list[tuple[str, list[Vec3]]],
    grid_dims: tuple[int, int, int],
    density_fn: Callable[[Vec3, Vec3], float],
    extra_blocks: list[tuple[Callable[[Vec3, Vec3], float], str | None]] | None = None,
) -> str:
    """Write a VASP CHGCAR/ELFCAR/LOCPOT file from a density function.

    Args:
        comment: header comment line
        lattice: 3 lattice vectors as (x, y, z) tuples
        elements: list of (symbol, [fractional_coords]) pairs
        grid_dims: (nx, ny, nz) grid dimensions
        density_fn: (Cartesian position, fractional position) -> rho*volume
        extra_blocks: optional additional volumetric blocks (e.g. magnetization)
            each is (density_fn, augmentation_text or None)
    """
    lines = [comment, "   1.0"]
    for vector_x, vector_y, vector_z in lattice:
        lines.append(f"     {vector_x:.4f}  {vector_y:.4f}  {vector_z:.4f}")

    elem_names = "   ".join(sym for sym, _ in elements)
    elem_counts = "   ".join(str(len(coords)) for _, coords in elements)
    lines.extend([f"   {elem_names}", f"   {elem_counts}", "Direct"])

    for _, coords in elements:
        for frac_x, frac_y, frac_z in coords:
            lines.append(f"  {frac_x:.6f}  {frac_y:.6f}  {frac_z:.6f}")
    lines.append("")

    count_x, count_y, count_z = grid_dims
    all_blocks: list[tuple[Callable[[Vec3, Vec3], float], str | None]] = [
        (density_fn, None)
    ]
    if extra_blocks:
        all_blocks.extend(extra_blocks)

    for block_fn, aug_text in all_blocks:
        lines.append(f"   {count_x}   {count_y}   {count_z}")
        values = []
        # VASP volumetric ordering: x varies fastest, then y, then z.
        for index_z in range(count_z):
            for index_y in range(count_y):
                for index_x in range(count_x):
                    frac_x, frac_y, frac_z = (
                        index_x / count_x,
                        index_y / count_y,
                        index_z / count_z,
                    )
                    frac = (frac_x, frac_y, frac_z)
                    values.append(block_fn(frac_to_cart(frac, lattice), frac))

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

    def density(position: Vec3) -> float:
        """Oxygen, hydrogen, and bond-centered electron density."""
        rho = 8.0 * gaussian(position, (0.0, 0.0, 0.1173), 0.7)
        rho += gaussian(position, (0.0, 0.7572, -0.4692), 0.4)
        rho += gaussian(position, (0.0, -0.7572, -0.4692), 0.4)
        for bond_x, bond_y, bond_z in bond_mids:
            rho += 2.0 * gaussian(position, (bond_x, bond_y, bond_z), 0.35)
        return rho

    return write_cube("Water molecule electron density", atoms, 30, 6.0, density)


def generate_benzene_orbital_cube() -> str:
    """Benzene pi orbital (.cube, 30x30x30, orbital mode)."""
    r_cc, r_ch = 1.397, 1.087
    atoms: list[Atom] = []
    c_positions: list[tuple[float, float]] = []
    for idx in range(6):
        angle = idx * math.pi / 3
        center_x, center_y = r_cc * math.cos(angle), r_cc * math.sin(angle)
        c_positions.append((center_x, center_y))
        atoms.append((6, center_x, center_y, 0.0))
        atoms.append(
            (1, (r_cc + r_ch) * math.cos(angle), (r_cc + r_ch) * math.sin(angle), 0.0)
        )

    signs = [1, -1, 1, -1, 1, -1]

    def density(position: Vec3) -> float:
        """Alternating p orbitals on the six carbon atoms."""
        coord_x, coord_y, coord_z = position
        psi = 0.0
        for (center_x, center_y), sign in zip(c_positions, signs, strict=True):
            psi += (
                sign
                * coord_z
                * math.exp(
                    -(
                        (coord_x - center_x) ** 2
                        + (coord_y - center_y) ** 2
                        + coord_z**2
                    )
                    / 0.72
                )
            )
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

    def density(position: Vec3) -> float:
        """Nuclear wells screened by diffuse electronic clouds."""
        pot = 0.0
        for z_num, atom_x, atom_y, atom_z in atoms:
            pot += z_num * gaussian(position, (atom_x, atom_y, atom_z), 0.4)
            pot -= z_num * 0.8 * gaussian(position, (atom_x, atom_y, atom_z), 0.9)
        return pot

    return write_cube("Methane electrostatic potential", atoms, 30, 7.0, density)


def generate_si_chgcar() -> str:
    """Silicon diamond charge density (CHGCAR, 24x24x24)."""
    lat_a = 5.43
    lattice = [(lat_a, 0.0, 0.0), (0.0, lat_a, 0.0), (0.0, 0.0, lat_a)]
    si_frac: list[Vec3] = [
        (0.0, 0.0, 0.0),
        (0.5, 0.5, 0.0),
        (0.5, 0.0, 0.5),
        (0.0, 0.5, 0.5),
        (0.25, 0.25, 0.25),
        (0.75, 0.75, 0.25),
        (0.75, 0.25, 0.75),
        (0.25, 0.75, 0.75),
    ]
    bond_frac: list[Vec3] = [
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
    atom_cart = [
        (frac_x * lat_a, frac_y * lat_a, frac_z * lat_a)
        for frac_x, frac_y, frac_z in si_frac
    ]
    bond_cart = [
        (frac_x * lat_a, frac_y * lat_a, frac_z * lat_a)
        for frac_x, frac_y, frac_z in bond_frac
    ]

    atoms = periodic_field(atom_cart, [14.0] * len(atom_cart), 0.8, lattice)
    bonds = periodic_field(bond_cart, [4.0] * len(bond_cart), 0.5, lattice)

    def density(position: Vec3, _frac: Vec3) -> float:
        """Atomic and covalent-bond density in VASP's volume-scaled units."""
        return (atoms(position) + bonds(position)) * volume

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
    fe_frac: list[Vec3] = [(0.0, 0.0, 0.0), (0.5, 0.5, 0.5)]
    volume = lat_a**3
    atom_cart = [
        (frac_x * lat_a, frac_y * lat_a, frac_z * lat_a)
        for frac_x, frac_y, frac_z in fe_frac
    ]

    charge = periodic_field(atom_cart, [26.0] * 2, 0.6, lattice)
    magnetization = periodic_field(atom_cart, [2.2] * 2, 0.5, lattice)

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
        lambda position, _frac: charge(position) * volume,
        extra_blocks=[
            (lambda position, _frac: magnetization(position) * volume, aug_text)
        ],
    )


# Hexagonal BN geometry shared by the CHGCAR and ELFCAR generators (grids must
# match exactly so the demo can color the density surface by localization)
HBN_B_FRAC: list[Vec3] = [(0.0, 0.0, 0.0), (0.0, 0.0, 0.5)]
HBN_N_FRAC: list[Vec3] = [(1 / 3, 2 / 3, 0.0), (2 / 3, 1 / 3, 0.5)]
HBN_BOND_FRAC: list[Vec3] = [(1 / 6, 1 / 3, 0.0), (1 / 6, 1 / 3, 0.5)]


class HexagonalCell(NamedTuple):
    """Hexagonal lattice and volume shared by paired example grids."""

    lattice: list[Vec3]
    volume: float


def hexagonal_cell(lat_a: float, lat_c: float) -> HexagonalCell:
    """Build a cell with 60° between the in-plane lattice vectors."""
    a2_x, a2_y = lat_a / 2, lat_a * math.sqrt(3) / 2
    return HexagonalCell(
        [(lat_a, 0.0, 0.0), (a2_x, a2_y, 0.0), (0.0, 0.0, lat_c)],
        lat_a * a2_y * lat_c,
    )


def generate_hbn_chgcar() -> str:
    """Hexagonal BN charge density (CHGCAR, 20x20x16, non-orthogonal)."""
    geom = hexagonal_cell(2.50, 6.66)
    bn_frac = [HBN_B_FRAC[0], HBN_N_FRAC[0], HBN_B_FRAC[1], HBN_N_FRAC[1]]
    z_nums = [5, 7, 5, 7]
    atom_cart = [frac_to_cart(frac, geom.lattice) for frac in bn_frac]
    bond_cart = [frac_to_cart(frac, geom.lattice) for frac in HBN_BOND_FRAC]

    atoms = periodic_field(
        atom_cart, [float(number) for number in z_nums], 0.45, geom.lattice
    )
    bonds = periodic_field(bond_cart, [3.0] * 2, 0.3, geom.lattice)

    def density(position: Vec3, _frac: Vec3) -> float:
        """Gaussian charge on B/N atoms plus bond-midpoint density."""
        return (atoms(position) + bonds(position)) * geom.volume

    return write_chgcar(
        "hBN hexagonal - charge density",
        geom.lattice,
        [("B", HBN_B_FRAC), ("N", HBN_N_FRAC)],
        (20, 20, 16),
        density,
    )


# Al(111) slab geometry shared by the LOCPOT and CHGCAR generators (grids must
# match exactly so the demo can color the density surface by the potential)
AL_SLAB_A, AL_SLAB_C = 2.86, 25.0
AL_SLAB_FRAC: list[Vec3] = [
    (0.0, 0.0, 0.30),
    (1 / 3, 2 / 3, 0.35),
    (2 / 3, 1 / 3, 0.40),
    (0.0, 0.0, 0.45),
]


def al_slab_geometry() -> tuple[list[Vec3], list[Vec3], list[Vec3], float]:
    """Return lattice, atomic positions, in-plane PBC vectors, and volume."""
    lattice, volume = hexagonal_cell(AL_SLAB_A, AL_SLAB_C)
    atom_cart = [frac_to_cart(frac, lattice) for frac in AL_SLAB_FRAC]
    # Zero z vector: no periodic images across the vacuum gap
    return lattice, atom_cart, [lattice[0], lattice[1], (0.0, 0.0, 0.0)], volume


def generate_al_slab_locpot() -> str:
    """Al(111) slab local potential (LOCPOT, 12x12x40)."""
    lattice, atom_cart, lat_vecs_xy, volume = al_slab_geometry()

    atoms = periodic_field(atom_cart, [13.0] * 4, 0.5, lat_vecs_xy)

    def density(position: Vec3, frac: Vec3) -> float:
        """Attractive atomic wells plus a slab-vs-vacuum background step."""
        pot = -atoms(position)
        slab_center, slab_width = 0.375, 0.10
        in_slab = math.exp(-((frac[2] - slab_center) ** 2) / (2 * slab_width**2))
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
    atoms: list[Atom] = [
        (number, coord_x, coord_y, coord_z)
        for number, coord_x, coord_y, coord_z, _charge in GLYCINE_ATOMS_CHARGES
    ]
    # Bond midpoints add covalent-bond density between heavy atoms
    bond_mids = [
        (
            (atoms[first][1] + atoms[second][1]) / 2,
            (atoms[first][2] + atoms[second][2]) / 2,
            (atoms[first][3] + atoms[second][3]) / 2,
        )
        for first, second in [(0, 3), (3, 6), (6, 7), (6, 8)]
    ]

    def density(position: Vec3) -> float:
        """Core, valence, and covalent-bond electron density."""
        rho = 0.0
        for z_num, atom_x, atom_y, atom_z, _charge in GLYCINE_ATOMS_CHARGES:
            # Tight core + diffuse valence tail so a vdW-like outer surface still
            # follows the molecular skeleton instead of merging into one blob
            sigma_core = 0.28 if z_num == 1 else 0.38
            rho += z_num * gaussian(position, (atom_x, atom_y, atom_z), sigma_core)
            rho += (
                0.4
                * z_num
                * gaussian(position, (atom_x, atom_y, atom_z), sigma_core * 1.8)
            )
        for center in bond_mids:
            rho += 1.2 * gaussian(position, center, 0.3)
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
    atoms: list[Atom] = [
        (number, coord_x, coord_y, coord_z)
        for number, coord_x, coord_y, coord_z, _charge in GLYCINE_ATOMS_CHARGES
    ]

    def potential(position: Vec3) -> float:
        """Sum of softened Coulomb potentials of the atomic partial charges."""
        pot = 0.0
        for _z_num, atom_x, atom_y, atom_z, charge in GLYCINE_ATOMS_CHARGES:
            pot += gaussian_coulomb(position, (atom_x, atom_y, atom_z), charge, 0.5)
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

    atoms = periodic_field(atom_cart, [13.0] * 4, 0.55, lat_vecs_xy)

    return write_chgcar(
        "Al(111) slab - charge density (pairs with Al-slab-LOCPOT)",
        lattice,
        [("Al", AL_SLAB_FRAC)],
        (12, 12, 40),
        lambda position, _frac: atoms(position) * volume,
    )


def generate_hbn_elfcar() -> str:
    """Hexagonal BN localization function (ELFCAR, 20x20x16, non-orthogonal).

    Pairs with hBN-CHGCAR on an identical grid so density surfaces can be
    colored by localization on a non-orthogonal lattice.
    """
    geom = hexagonal_cell(2.50, 6.66)

    # ELF-like field: high (~0.9) at B-N bond midpoints and N lone-pair regions,
    # moderate at atoms, low in interstitial space
    bond_cart = [frac_to_cart(frac, geom.lattice) for frac in HBN_BOND_FRAC]
    n_cart = [frac_to_cart(frac, geom.lattice) for frac in HBN_N_FRAC]
    b_cart = [frac_to_cart(frac, geom.lattice) for frac in HBN_B_FRAC]

    bonds = periodic_field(bond_cart, [1.0] * 2, 0.45, geom.lattice)
    nitrogen = periodic_field(n_cart, [1.0] * 2, 0.4, geom.lattice)
    boron = periodic_field(b_cart, [1.0] * 2, 0.35, geom.lattice)

    def elf(position: Vec3, _frac: Vec3) -> float:
        """Bounded [0, 1] localization built from bond, N, and B Gaussians."""
        val = 0.05  # interstitial baseline
        val += 0.85 * bonds(position)
        val += 0.6 * nitrogen(position)
        val += 0.3 * boron(position)
        return min(val, 1.0) * geom.volume

    return write_chgcar(
        "hBN hexagonal - simulated ELF (pairs with hBN-CHGCAR)",
        geom.lattice,
        [("B", HBN_B_FRAC), ("N", HBN_N_FRAC)],
        (20, 20, 16),
        elf,
    )


def generate_large_grid_locpot() -> str:
    """Large 80x80x96 LOCPOT matching large-grid-CHGCAR for perf testing.

    Same 12x12x14.4 Angstrom cell and Si4 sites as the large CHGCAR so
    cross-volume coloring can be stress-tested at full grid resolution.
    """
    lattice = [(12.0, 0.0, 0.0), (0.0, 12.0, 0.0), (0.0, 0.0, 14.4)]
    si_frac: list[Vec3] = [
        (0.0, 0.0, 0.0),
        (0.5, 0.5, 0.0),
        (0.5, 0.0, 0.5),
        (0.0, 0.5, 0.5),
    ]
    volume = 12.0 * 12.0 * 14.4
    atom_cart = [
        (frac_x * 12.0, frac_y * 12.0, frac_z * 14.4)
        for frac_x, frac_y, frac_z in si_frac
    ]

    atoms = periodic_field(atom_cart, [10.0] * 4, 0.9, lattice)

    def potential(position: Vec3, frac: Vec3) -> float:
        """Attractive wells at nuclei plus a long-wavelength periodic modulation."""
        frac_x, frac_y, frac_z = frac
        pot = -atoms(position)
        pot += 0.8 * math.sin(2 * math.pi * frac_x) * math.cos(2 * math.pi * frac_y)
        pot += 0.5 * math.cos(2 * math.pi * frac_z)
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

    output_dir = f"{os.path.dirname(os.path.dirname(__file__))}/site/isosurfaces"
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
    # uv run src/scripts/generate_isosurface_examples.py glycine-density.cube.gz glycine-esp.cube.gz
    selected = sys.argv[1:] or list(generators)
    if unknown := [name for name in selected if name not in generators]:
        known = "\n  ".join(generators)
        raise SystemExit(f"Unknown file(s): {', '.join(unknown)}. Known:\n  {known}")

    for filename in selected:
        print(f"Generating {filename} ...")
        content = generators[filename]()
        with gzip.open(f"{output_dir}/{filename}", "wt") as file:
            file.write(content)
        print(f"  -> {len(content)} bytes uncompressed")

    print("Done!")
