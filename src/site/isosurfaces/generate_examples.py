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
    """Sum of Gaussians at centers with periodic images along lattice vectors."""
    result = 0.0
    for (cx, cy, cz), weight, sigma in zip(centers, weights, sigmas):
        for dx_img in (-1, 0, 1):
            for dy_img in (-1, 0, 1):
                for dz_img in (-1, 0, 1):
                    ix = cx
                    iy = cy
                    iz = cz
                    for dim, (lx, ly, lz) in zip(
                        (dx_img, dy_img, dz_img), lattice_vecs
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
    origin_bohr = [c * ANG_TO_BOHR for c in origin]

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
    all_blocks = [(density_fn, None)]
    if extra_blocks:
        all_blocks.extend(extra_blocks)

    for block_fn, aug_text in all_blocks:
        lines.append(f"   {nx}   {ny}   {nz}")
        values = []
        for ix in range(nx):
            for iy in range(ny):
                for iz in range(nz):
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

    atom_cart = [frac_to_cart(*f) for f in bn_frac]
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


def generate_al_slab_locpot() -> str:
    """Al(111) slab local potential (LOCPOT, 12x12x40)."""
    a_surf, c_slab = 2.86, 25.0
    a2_x, a2_y = a_surf / 2, a_surf * math.sqrt(3) / 2
    lattice = [(a_surf, 0.0, 0.0), (a2_x, a2_y, 0.0), (0.0, 0.0, c_slab)]
    al_frac: list[FracCoord] = [
        (0.0, 0.0, 0.30),
        (1 / 3, 2 / 3, 0.35),
        (2 / 3, 1 / 3, 0.40),
        (0.0, 0.0, 0.45),
    ]
    volume = a_surf * a2_y * c_slab
    # Only use in-plane PBC images (no z images for slab)
    lat_vecs_xy = [lattice[0], lattice[1], (0.0, 0.0, 0.0)]

    def frac_to_cart(fx: float, fy: float, fz: float) -> tuple[float, float, float]:
        return (fx * a_surf + fy * a2_x, fy * a2_y, fz * c_slab)

    atom_cart = [frac_to_cart(*f) for f in al_frac]

    def density(
        x: float, y: float, z: float, _fx: float, _fy: float, fz: float
    ) -> float:
        pot = -pbc_gaussian_sum(x, y, z, atom_cart, [13.0] * 4, [0.5] * 4, lat_vecs_xy)
        slab_center, slab_width = 0.375, 0.10
        in_slab = math.exp(-((fz - slab_center) ** 2) / (2 * slab_width**2))
        pot += -2.0 * in_slab + 0.5 * (1 - in_slab)
        return pot * volume

    return write_chgcar(
        "Al(111) slab - local potential",
        lattice,
        [("Al", al_frac)],
        (12, 12, 40),
        density,
    )


# === Main ===

if __name__ == "__main__":
    import os

    out_dir = os.path.dirname(__file__)
    generators: dict[str, Callable[[], str]] = {
        "h2o-density.cube.gz": generate_h2o_cube,
        "Si-CHGCAR.gz": generate_si_chgcar,
        "benzene-orbital.cube.gz": generate_benzene_orbital_cube,
        "Fe-spin-CHGCAR.gz": generate_fe_bcc_spin_chgcar,
        "ch4-esp.cube.gz": generate_ch4_esp_cube,
        "hBN-CHGCAR.gz": generate_hbn_chgcar,
        "Al-slab-LOCPOT.gz": generate_al_slab_locpot,
    }

    for filename, gen_fn in generators.items():
        print(f"Generating {filename} ...")
        content = gen_fn()
        with gzip.open(f"{out_dir}/{filename}", "wt") as fh:
            fh.write(content)
        print(f"  -> {len(content)} bytes uncompressed")

    print("Done!")
