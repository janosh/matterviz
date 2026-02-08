"""Generate small example volumetric data files for the isosurface demo."""

import gzip
import math

BOHR_TO_ANG = 0.529177249
ANG_TO_BOHR = 1.0 / BOHR_TO_ANG


def gaussian(
    x: float, y: float, z: float, cx: float, cy: float, cz: float, sigma: float
) -> float:
    """3D Gaussian function centered at (cx, cy, cz)."""
    r2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
    return math.exp(-r2 / (2 * sigma**2))


def generate_h2o_cube() -> str:
    """Generate a .cube file for a water molecule with simulated electron density.

    Atom positions in Angstrom, file written in Bohr (positive grid dims).
    Grid: 30x30x30 centered on the molecule.
    """
    # Water geometry (Angstrom)
    atoms = [
        (8, 0.0000, 0.0000, 0.1173),  # O
        (1, 0.0000, 0.7572, -0.4692),  # H
        (1, 0.0000, -0.7572, -0.4692),  # H
    ]

    # Grid setup: 6 Angstrom box centered at origin
    box_size = 6.0  # Angstrom
    n_grid = 30
    origin = [-box_size / 2, -box_size / 2, -box_size / 2]  # Angstrom
    voxel = box_size / n_grid  # Angstrom

    # Convert to Bohr for .cube format
    origin_bohr = [c * ANG_TO_BOHR for c in origin]
    voxel_bohr = voxel * ANG_TO_BOHR

    lines = []
    lines.append("Water molecule electron density")
    lines.append("Generated for matterviz isosurface demo")

    # Line 3: n_atoms, origin (Bohr, positive n_atoms = Bohr units)
    lines.append(
        f"    {len(atoms)}   {origin_bohr[0]:.6f}   {origin_bohr[1]:.6f}   {origin_bohr[2]:.6f}"
    )

    # Lines 4-6: grid dimensions and voxel vectors (Bohr, positive N = Bohr)
    lines.append(f"   {n_grid}   {voxel_bohr:.6f}   0.000000   0.000000")
    lines.append(f"   {n_grid}   0.000000   {voxel_bohr:.6f}   0.000000")
    lines.append(f"   {n_grid}   0.000000   0.000000   {voxel_bohr:.6f}")

    # Atom lines: atomic_number charge x y z (Bohr)
    for z_num, ax, ay, az in atoms:
        lines.append(
            f"    {z_num}   0.000000   {ax * ANG_TO_BOHR:.6f}   {ay * ANG_TO_BOHR:.6f}   {az * ANG_TO_BOHR:.6f}"
        )

    # Volumetric data: simulate electron density as sum of Gaussians
    # O has larger sigma (more diffuse), H smaller
    sigma_o = 0.7  # Angstrom
    sigma_h = 0.4
    # Add bond density between O-H
    sigma_bond = 0.35
    bond_centers = [
        (0.0, 0.7572 / 2, (0.1173 - 0.4692) / 2),  # O-H1 midpoint
        (0.0, -0.7572 / 2, (0.1173 - 0.4692) / 2),  # O-H2 midpoint
    ]

    values = []
    for ix in range(n_grid):
        x = origin[0] + ix * voxel
        for iy in range(n_grid):
            y = origin[1] + iy * voxel
            for iz in range(n_grid):
                z = origin[2] + iz * voxel

                # Atomic contributions
                rho = 8.0 * gaussian(x, y, z, 0.0, 0.0, 0.1173, sigma_o)
                rho += 1.0 * gaussian(x, y, z, 0.0, 0.7572, -0.4692, sigma_h)
                rho += 1.0 * gaussian(x, y, z, 0.0, -0.7572, -0.4692, sigma_h)

                # Bond density
                for bx, by, bz in bond_centers:
                    rho += 2.0 * gaussian(x, y, z, bx, by, bz, sigma_bond)

                values.append(rho)

    # Write volumetric data (6 values per line)
    for idx in range(0, len(values), 6):
        chunk = values[idx : idx + 6]
        lines.append("  ".join(f"{val:.5E}" for val in chunk))

    return "\n".join(lines) + "\n"


def generate_si_chgcar() -> str:
    """Generate a CHGCAR file for bulk Si (diamond) with simulated charge density.

    Grid: 24x24x24 for a reasonable isosurface.
    """
    # Si diamond structure
    lat_a = 5.43  # lattice parameter in Angstrom

    # Si positions in fractional coordinates
    si_frac = [
        (0.0, 0.0, 0.0),
        (0.5, 0.5, 0.0),
        (0.5, 0.0, 0.5),
        (0.0, 0.5, 0.5),
        (0.25, 0.25, 0.25),
        (0.75, 0.75, 0.25),
        (0.75, 0.25, 0.75),
        (0.25, 0.75, 0.75),
    ]

    lines = []
    lines.append("Si8 diamond structure - simulated charge density")
    lines.append("   1.0")
    lines.append(f"     {lat_a:.2f}  0.00  0.00")
    lines.append(f"     0.00  {lat_a:.2f}  0.00")
    lines.append(f"     0.00  0.00  {lat_a:.2f}")
    lines.append("   Si")
    lines.append(f"   {len(si_frac)}")
    lines.append("Direct")

    for fx, fy, fz in si_frac:
        lines.append(f"  {fx:.4f}  {fy:.4f}  {fz:.4f}")

    lines.append("")  # blank line before volumetric data

    n_grid = 24
    lines.append(f"   {n_grid}   {n_grid}   {n_grid}")

    # Generate charge density: Gaussians at each Si site + bond charge
    sigma_atom = 0.8  # Angstrom
    sigma_bond = 0.5

    # Si-Si bond midpoints in the diamond structure (nearest neighbors)
    bond_midpoints_frac = [
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
    values = []
    voxel = lat_a / n_grid

    for ix in range(n_grid):
        x = ix * voxel
        for iy in range(n_grid):
            y = iy * voxel
            for iz in range(n_grid):
                z = iz * voxel

                rho = 0.0

                # Atomic contributions (with PBC images)
                for frac_x, frac_y, frac_z in si_frac:
                    ax, ay, az = frac_x * lat_a, frac_y * lat_a, frac_z * lat_a
                    # Check nearest image
                    for dx in [-lat_a, 0, lat_a]:
                        for dy in [-lat_a, 0, lat_a]:
                            for dz in [-lat_a, 0, lat_a]:
                                rho += 14.0 * gaussian(
                                    x, y, z, ax + dx, ay + dy, az + dz, sigma_atom
                                )

                # Bond charge (with PBC images)
                for frac_x, frac_y, frac_z in bond_midpoints_frac:
                    bx, by, bz = frac_x * lat_a, frac_y * lat_a, frac_z * lat_a
                    for dx in [-lat_a, 0, lat_a]:
                        for dy in [-lat_a, 0, lat_a]:
                            for dz in [-lat_a, 0, lat_a]:
                                rho += 4.0 * gaussian(
                                    x, y, z, bx + dx, by + dy, bz + dz, sigma_bond
                                )

                # CHGCAR stores rho * V_cell
                values.append(rho * volume)

    # Write volumetric data (5 values per line, Fortran style)
    for idx in range(0, len(values), 5):
        chunk = values[idx : idx + 5]
        lines.append(" ".join(f"{val:18.11E}" for val in chunk))

    return "\n".join(lines) + "\n"


def generate_benzene_orbital_cube() -> str:
    """Generate a .cube file for benzene with a simulated pi orbital.

    This shows positive and negative lobes (good for testing show_negative).
    Grid: 30x30x30.
    """
    # Benzene geometry (Angstrom) - flat in xy plane
    r_cc = 1.397  # C-C bond length
    r_ch = 1.087  # C-H bond length

    c_atoms = []
    h_atoms = []
    for idx in range(6):
        angle = idx * math.pi / 3
        cx = r_cc * math.cos(angle)
        cy = r_cc * math.sin(angle)
        c_atoms.append((6, cx, cy, 0.0))

        hx = (r_cc + r_ch) * math.cos(angle)
        hy = (r_cc + r_ch) * math.sin(angle)
        h_atoms.append((1, hx, hy, 0.0))

    all_atoms = c_atoms + h_atoms

    # Grid: 8 Angstrom box, 30 points
    box_size = 8.0
    n_grid = 30
    origin = [-box_size / 2, -box_size / 2, -box_size / 2]
    voxel = box_size / n_grid

    origin_bohr = [c * ANG_TO_BOHR for c in origin]
    voxel_bohr = voxel * ANG_TO_BOHR

    lines = []
    lines.append("Benzene pi orbital (HOMO)")
    lines.append("Generated for matterviz isosurface demo")

    # Negative n_atoms indicates orbital data
    lines.append(
        f"   -{len(all_atoms)}   {origin_bohr[0]:.6f}   {origin_bohr[1]:.6f}   {origin_bohr[2]:.6f}"
    )
    lines.append(f"   {n_grid}   {voxel_bohr:.6f}   0.000000   0.000000")
    lines.append(f"   {n_grid}   0.000000   {voxel_bohr:.6f}   0.000000")
    lines.append(f"   {n_grid}   0.000000   0.000000   {voxel_bohr:.6f}")

    for z_num, ax, ay, az in all_atoms:
        lines.append(
            f"    {z_num}   0.000000   {ax * ANG_TO_BOHR:.6f}   {ay * ANG_TO_BOHR:.6f}   {az * ANG_TO_BOHR:.6f}"
        )

    # Orbital header line (1 MO, index 1)
    lines.append("    1    1")

    # Simulate pi orbital: pz-like lobes above and below the ring
    # Each carbon contributes a p_z orbital (positive above, negative below)
    # With alternating signs for the HOMO pattern
    sigma_pz = 0.6
    signs = [1, -1, 1, -1, 1, -1]  # alternating for HOMO

    values = []
    for ix in range(n_grid):
        x = origin[0] + ix * voxel
        for iy in range(n_grid):
            y = origin[1] + iy * voxel
            for iz in range(n_grid):
                z = origin[2] + iz * voxel
                psi = 0.0

                for (_z_num, cx, cy, _cz), sign in zip(c_atoms, signs):
                    r_xy2 = (x - cx) ** 2 + (y - cy) ** 2
                    # p_z orbital: z * exp(-r^2/2sigma^2)
                    psi += sign * z * math.exp(-(r_xy2 + z**2) / (2 * sigma_pz**2))

                values.append(psi)

    for idx in range(0, len(values), 6):
        chunk = values[idx : idx + 6]
        lines.append("  ".join(f"{val:.5E}" for val in chunk))

    return "\n".join(lines) + "\n"


def generate_fe_bcc_spin_chgcar() -> str:
    """Generate a spin-polarized CHGCAR for BCC Fe with two data blocks.

    Tests the spin-polarized code path: total charge density + magnetization density.
    Grid: 20x20x20 for compact file size.
    """
    lat_a = 2.87  # Fe BCC lattice parameter (Angstrom)

    # BCC: atoms at (0,0,0) and (0.5,0.5,0.5) fractional
    fe_frac = [
        (0.0, 0.0, 0.0),
        (0.5, 0.5, 0.5),
    ]

    lines = []
    lines.append("Fe2 BCC - spin-polarized charge density")
    lines.append("   1.0")
    lines.append(f"     {lat_a:.2f}  0.00  0.00")
    lines.append(f"     0.00  {lat_a:.2f}  0.00")
    lines.append(f"     0.00  0.00  {lat_a:.2f}")
    lines.append("   Fe")
    lines.append(f"   {len(fe_frac)}")
    lines.append("Direct")

    for frac_x, frac_y, frac_z in fe_frac:
        lines.append(f"  {frac_x:.4f}  {frac_y:.4f}  {frac_z:.4f}")

    lines.append("")

    n_grid = 20
    lines.append(f"   {n_grid}   {n_grid}   {n_grid}")

    volume = lat_a**3
    sigma_atom = 0.6

    # Generate total charge density (block 1)
    total_values = []
    voxel = lat_a / n_grid
    for ix in range(n_grid):
        x = ix * voxel
        for iy in range(n_grid):
            y = iy * voxel
            for iz in range(n_grid):
                z = iz * voxel
                rho = 0.0
                for frac_x, frac_y, frac_z in fe_frac:
                    ax, ay, az = frac_x * lat_a, frac_y * lat_a, frac_z * lat_a
                    for dx in [-lat_a, 0, lat_a]:
                        for dy in [-lat_a, 0, lat_a]:
                            for dz in [-lat_a, 0, lat_a]:
                                rho += 26.0 * gaussian(
                                    x, y, z, ax + dx, ay + dy, az + dz, sigma_atom
                                )
                total_values.append(rho * volume)

    for idx in range(0, len(total_values), 5):
        chunk = total_values[idx : idx + 5]
        lines.append(" ".join(f"{val:18.11E}" for val in chunk))

    # Augmentation occupancies placeholder (common in real CHGCAR files)
    lines.append("augmentation occupancies   1  16")
    lines.append("  0.100E+01  0.000E+00  0.000E+00  0.000E+00")
    lines.append("  0.000E+00  0.000E+00  0.000E+00  0.000E+00")
    lines.append("  0.000E+00  0.000E+00  0.000E+00  0.000E+00")
    lines.append("  0.000E+00  0.000E+00  0.000E+00  0.000E+00")
    lines.append("augmentation occupancies   2  16")
    lines.append("  0.100E+01  0.000E+00  0.000E+00  0.000E+00")
    lines.append("  0.000E+00  0.000E+00  0.000E+00  0.000E+00")
    lines.append("  0.000E+00  0.000E+00  0.000E+00  0.000E+00")
    lines.append("  0.000E+00  0.000E+00  0.000E+00  0.000E+00")

    # Generate magnetization density (block 2) - spin-polarized
    lines.append(f"   {n_grid}   {n_grid}   {n_grid}")

    sigma_mag = 0.5  # slightly tighter than charge density
    mag_values = []
    for ix in range(n_grid):
        x = ix * voxel
        for iy in range(n_grid):
            y = iy * voxel
            for iz in range(n_grid):
                z = iz * voxel
                mag = 0.0
                for frac_x, frac_y, frac_z in fe_frac:
                    ax, ay, az = frac_x * lat_a, frac_y * lat_a, frac_z * lat_a
                    for dx in [-lat_a, 0, lat_a]:
                        for dy in [-lat_a, 0, lat_a]:
                            for dz in [-lat_a, 0, lat_a]:
                                # Magnetic moment ~2.2 muB per Fe atom
                                mag += 2.2 * gaussian(
                                    x, y, z, ax + dx, ay + dy, az + dz, sigma_mag
                                )
                mag_values.append(mag * volume)

    for idx in range(0, len(mag_values), 5):
        chunk = mag_values[idx : idx + 5]
        lines.append(" ".join(f"{val:18.11E}" for val in chunk))

    return "\n".join(lines) + "\n"


def generate_gaas_chgcar() -> str:
    """Generate a CHGCAR for GaAs zinc blende with two element species.

    Tests multi-element VASP parsing. Grid: 20x20x20.
    """
    lat_a = 5.65  # GaAs lattice parameter (Angstrom)

    # Zinc blende: Ga at FCC positions, As at FCC + (1/4,1/4,1/4) offset
    ga_frac = [
        (0.0, 0.0, 0.0),
        (0.5, 0.5, 0.0),
        (0.5, 0.0, 0.5),
        (0.0, 0.5, 0.5),
    ]
    as_frac = [
        (0.25, 0.25, 0.25),
        (0.75, 0.75, 0.25),
        (0.75, 0.25, 0.75),
        (0.25, 0.75, 0.75),
    ]

    lines = []
    lines.append("GaAs zinc blende - charge density")
    lines.append("   1.0")
    lines.append(f"     {lat_a:.2f}  0.00  0.00")
    lines.append(f"     0.00  {lat_a:.2f}  0.00")
    lines.append(f"     0.00  0.00  {lat_a:.2f}")
    lines.append("   Ga   As")
    lines.append(f"   {len(ga_frac)}   {len(as_frac)}")
    lines.append("Direct")

    for frac_x, frac_y, frac_z in ga_frac:
        lines.append(f"  {frac_x:.4f}  {frac_y:.4f}  {frac_z:.4f}")
    for frac_x, frac_y, frac_z in as_frac:
        lines.append(f"  {frac_x:.4f}  {frac_y:.4f}  {frac_z:.4f}")

    lines.append("")

    n_grid = 20
    lines.append(f"   {n_grid}   {n_grid}   {n_grid}")

    volume = lat_a**3
    sigma_ga = 0.75
    sigma_as = 0.8
    sigma_bond = 0.45

    # Ga-As bond midpoints (nearest neighbors in zinc blende)
    bond_midpoints = []
    for ga in ga_frac:
        for a_site in as_frac:
            # Check if nearest neighbor (distance ~ lat_a*sqrt(3)/4)
            d2 = sum(
                (min(abs(ga[idx] - a_site[idx]), 1 - abs(ga[idx] - a_site[idx]))) ** 2
                for idx in range(3)
            )
            if d2 < 0.2:  # nearest neighbors only
                mid = tuple((ga[idx] + a_site[idx]) / 2 for idx in range(3))
                bond_midpoints.append(mid)

    values = []
    voxel = lat_a / n_grid
    for ix in range(n_grid):
        x = ix * voxel
        for iy in range(n_grid):
            y = iy * voxel
            for iz in range(n_grid):
                z = iz * voxel
                rho = 0.0

                # Ga contributions (Z=31)
                for frac_x, frac_y, frac_z in ga_frac:
                    ax, ay, az = frac_x * lat_a, frac_y * lat_a, frac_z * lat_a
                    for ddx in [-lat_a, 0, lat_a]:
                        for ddy in [-lat_a, 0, lat_a]:
                            for ddz in [-lat_a, 0, lat_a]:
                                rho += 31.0 * gaussian(
                                    x, y, z, ax + ddx, ay + ddy, az + ddz, sigma_ga
                                )

                # As contributions (Z=33)
                for frac_x, frac_y, frac_z in as_frac:
                    ax, ay, az = frac_x * lat_a, frac_y * lat_a, frac_z * lat_a
                    for ddx in [-lat_a, 0, lat_a]:
                        for ddy in [-lat_a, 0, lat_a]:
                            for ddz in [-lat_a, 0, lat_a]:
                                rho += 33.0 * gaussian(
                                    x, y, z, ax + ddx, ay + ddy, az + ddz, sigma_as
                                )

                # Bond charge
                for mid in bond_midpoints:
                    bx, by, bz = mid[0] * lat_a, mid[1] * lat_a, mid[2] * lat_a
                    for ddx in [-lat_a, 0, lat_a]:
                        for ddy in [-lat_a, 0, lat_a]:
                            for ddz in [-lat_a, 0, lat_a]:
                                rho += 5.0 * gaussian(
                                    x, y, z, bx + ddx, by + ddy, bz + ddz, sigma_bond
                                )

                values.append(rho * volume)

    for idx in range(0, len(values), 5):
        chunk = values[idx : idx + 5]
        lines.append(" ".join(f"{val:18.11E}" for val in chunk))

    return "\n".join(lines) + "\n"


def generate_ch4_esp_cube() -> str:
    """Generate a .cube file for methane (CH4) electrostatic potential.

    Tests tetrahedral geometry and ESP-like data with both positive and negative values.
    Grid: 30x30x30. Uses negative n_atoms=0 (no orbital header) to test standard cube path.
    """
    # Tetrahedral geometry (Angstrom)
    # C at origin, H at tetrahedral vertices
    r_ch = 1.089
    # Tetrahedral vertices: distance from center to vertex along each axis
    tet = r_ch / math.sqrt(3)
    atoms = [
        (6, 0.0, 0.0, 0.0),  # C
        (1, tet, tet, tet),  # H
        (1, tet, -tet, -tet),  # H
        (1, -tet, tet, -tet),  # H
        (1, -tet, -tet, tet),  # H
    ]

    box_size = 7.0
    n_grid = 30
    origin = [-box_size / 2, -box_size / 2, -box_size / 2]
    voxel = box_size / n_grid

    origin_bohr = [coord * ANG_TO_BOHR for coord in origin]
    voxel_bohr = voxel * ANG_TO_BOHR

    file_lines = []
    file_lines.append("Methane electrostatic potential")
    file_lines.append("Generated for matterviz isosurface demo")

    # Positive n_atoms -> Bohr units, no orbital header
    file_lines.append(
        f"    {len(atoms)}   {origin_bohr[0]:.6f}   {origin_bohr[1]:.6f}   {origin_bohr[2]:.6f}"
    )
    file_lines.append(f"   {n_grid}   {voxel_bohr:.6f}   0.000000   0.000000")
    file_lines.append(f"   {n_grid}   0.000000   {voxel_bohr:.6f}   0.000000")
    file_lines.append(f"   {n_grid}   0.000000   0.000000   {voxel_bohr:.6f}")

    for z_num, ax, ay, az in atoms:
        charge = float(z_num)
        file_lines.append(
            f"    {z_num}   {charge:.6f}   {ax * ANG_TO_BOHR:.6f}   {ay * ANG_TO_BOHR:.6f}   {az * ANG_TO_BOHR:.6f}"
        )

    # Generate ESP: nuclear potential (positive near nuclei) minus electron cloud (negative)
    # Creates +/- isosurface regions around the molecule
    sigma_nuc = 0.4
    sigma_elec = 0.9
    values = []
    for ix in range(n_grid):
        x = origin[0] + ix * voxel
        for iy in range(n_grid):
            y = origin[1] + iy * voxel
            for iz in range(n_grid):
                z = origin[2] + iz * voxel
                pot = 0.0
                for z_num, ax, ay, az in atoms:
                    # Nuclear potential (positive, sharp)
                    pot += z_num * gaussian(x, y, z, ax, ay, az, sigma_nuc)
                    # Electron screening (negative, diffuse)
                    pot -= z_num * 0.8 * gaussian(x, y, z, ax, ay, az, sigma_elec)
                values.append(pot)

    for idx in range(0, len(values), 6):
        chunk = values[idx : idx + 6]
        file_lines.append("  ".join(f"{val:.5E}" for val in chunk))

    return "\n".join(file_lines) + "\n"


def generate_ethylene_orbital_cube() -> str:
    """Generate a .cube file for ethylene (C2H4) pi orbital.

    Tests a planar molecule with a different orbital shape from benzene.
    Has negative n_atoms to indicate orbital data. Grid: 28x28x28.
    """
    # Ethylene geometry (Angstrom) - in xy plane, C=C along x
    r_cc = 1.339
    r_ch = 1.087
    hcc_angle = math.radians(121.3)

    h_dx = r_ch * math.cos(hcc_angle)
    h_dy = r_ch * math.sin(hcc_angle)

    atoms = [
        (6, -r_cc / 2, 0.0, 0.0),  # C1
        (6, r_cc / 2, 0.0, 0.0),  # C2
        (1, -r_cc / 2 + h_dx, h_dy, 0.0),  # H1
        (1, -r_cc / 2 + h_dx, -h_dy, 0.0),  # H2
        (1, r_cc / 2 - h_dx, h_dy, 0.0),  # H3
        (1, r_cc / 2 - h_dx, -h_dy, 0.0),  # H4
    ]

    box_size = 7.0
    n_grid = 28
    origin = [-box_size / 2, -box_size / 2, -box_size / 2]
    voxel = box_size / n_grid

    origin_bohr = [coord * ANG_TO_BOHR for coord in origin]
    voxel_bohr = voxel * ANG_TO_BOHR

    file_lines = []
    file_lines.append("Ethylene pi* orbital (LUMO)")
    file_lines.append("Generated for matterviz isosurface demo")

    # Negative n_atoms -> orbital data with extra header line
    file_lines.append(
        f"   -{len(atoms)}   {origin_bohr[0]:.6f}   {origin_bohr[1]:.6f}   {origin_bohr[2]:.6f}"
    )
    file_lines.append(f"   {n_grid}   {voxel_bohr:.6f}   0.000000   0.000000")
    file_lines.append(f"   {n_grid}   0.000000   {voxel_bohr:.6f}   0.000000")
    file_lines.append(f"   {n_grid}   0.000000   0.000000   {voxel_bohr:.6f}")

    for z_num, ax, ay, az in atoms:
        file_lines.append(
            f"    {z_num}   0.000000   {ax * ANG_TO_BOHR:.6f}   {ay * ANG_TO_BOHR:.6f}   {az * ANG_TO_BOHR:.6f}"
        )

    # Orbital header: 1 MO, index 1
    file_lines.append("    1    1")

    # Simulate pi* orbital: p_z lobes on each carbon with OPPOSITE sign (anti-bonding)
    sigma_pz = 0.55
    c1_x = -r_cc / 2
    c2_x = r_cc / 2

    values = []
    for ix in range(n_grid):
        x = origin[0] + ix * voxel
        for iy in range(n_grid):
            y = origin[1] + iy * voxel
            for iz in range(n_grid):
                z = origin[2] + iz * voxel
                # pi* orbital: opposite sign p_z on each carbon (anti-bonding)
                r1_xy2 = (x - c1_x) ** 2 + y**2
                r2_xy2 = (x - c2_x) ** 2 + y**2
                psi = z * math.exp(-(r1_xy2 + z**2) / (2 * sigma_pz**2))
                psi -= z * math.exp(-(r2_xy2 + z**2) / (2 * sigma_pz**2))
                values.append(psi)

    for idx in range(0, len(values), 6):
        chunk = values[idx : idx + 6]
        file_lines.append("  ".join(f"{val:.5E}" for val in chunk))

    return "\n".join(file_lines) + "\n"


def generate_mgo_elfcar() -> str:
    """Generate an ELFCAR-style file for MgO rocksalt structure.

    Tests ELFCAR filename detection and non-diamond lattice type.
    ELF values range from 0 to 1. Grid: 20x20x20.
    """
    lat_a = 4.21  # MgO lattice parameter (Angstrom)

    # Rocksalt: Mg at (0,0,0)+FCC, O at (0.5,0.5,0.5)+FCC
    mg_frac = [
        (0.0, 0.0, 0.0),
        (0.5, 0.5, 0.0),
        (0.5, 0.0, 0.5),
        (0.0, 0.5, 0.5),
    ]
    o_frac = [
        (0.5, 0.5, 0.5),
        (0.0, 0.0, 0.5),
        (0.0, 0.5, 0.0),
        (0.5, 0.0, 0.0),
    ]

    lines = []
    lines.append("MgO rocksalt - electron localization function")
    lines.append("   1.0")
    lines.append(f"     {lat_a:.2f}  0.00  0.00")
    lines.append(f"     0.00  {lat_a:.2f}  0.00")
    lines.append(f"     0.00  0.00  {lat_a:.2f}")
    lines.append("   Mg   O")
    lines.append(f"   {len(mg_frac)}   {len(o_frac)}")
    lines.append("Direct")

    for frac_x, frac_y, frac_z in mg_frac:
        lines.append(f"  {frac_x:.4f}  {frac_y:.4f}  {frac_z:.4f}")
    for frac_x, frac_y, frac_z in o_frac:
        lines.append(f"  {frac_x:.4f}  {frac_y:.4f}  {frac_z:.4f}")

    lines.append("")

    n_grid = 20
    lines.append(f"   {n_grid}   {n_grid}   {n_grid}")

    # ELF is not multiplied by volume (unlike CHGCAR), but ELFCAR uses same format
    # where the parser divides by volume. So we multiply by volume here.
    volume = lat_a**3
    sigma_core = 0.4  # core ELF (high localization near nuclei)
    sigma_bond = 0.55  # bonding ELF regions

    # Compute nearest-neighbor Mg-O bond midpoints using minimum image convention.
    # In rocksalt, nearest neighbors are separated by (±1/2, 0, 0) etc. in fractional coords.
    nn_offsets = [
        (0.5, 0.0, 0.0),
        (-0.5, 0.0, 0.0),
        (0.0, 0.5, 0.0),
        (0.0, -0.5, 0.0),
        (0.0, 0.0, 0.5),
        (0.0, 0.0, -0.5),
    ]
    bond_midpoints_frac: set[tuple[float, float, float]] = set()
    for mg in mg_frac:
        for offset in nn_offsets:
            mx = (mg[0] + offset[0] / 2) % 1.0
            my = (mg[1] + offset[1] / 2) % 1.0
            mz = (mg[2] + offset[2] / 2) % 1.0
            bond_midpoints_frac.add((mx, my, mz))

    values = []
    voxel = lat_a / n_grid
    for ix in range(n_grid):
        x = ix * voxel
        for iy in range(n_grid):
            y = iy * voxel
            for iz in range(n_grid):
                z = iz * voxel
                elf = 0.1  # homogeneous electron gas baseline

                # High ELF at atomic cores
                for frac_x, frac_y, frac_z in mg_frac + o_frac:
                    ax, ay, az = frac_x * lat_a, frac_y * lat_a, frac_z * lat_a
                    for ddx in [-lat_a, 0, lat_a]:
                        for ddy in [-lat_a, 0, lat_a]:
                            for ddz in [-lat_a, 0, lat_a]:
                                elf += 0.8 * gaussian(
                                    x, y, z, ax + ddx, ay + ddy, az + ddz, sigma_core
                                )

                # ELF at nearest-neighbor bond midpoints (ionic bond character)
                for mid in bond_midpoints_frac:
                    bx, by, bz = mid[0] * lat_a, mid[1] * lat_a, mid[2] * lat_a
                    for ddx in [-lat_a, 0, lat_a]:
                        for ddy in [-lat_a, 0, lat_a]:
                            for ddz in [-lat_a, 0, lat_a]:
                                elf += 0.3 * gaussian(
                                    x, y, z, bx + ddx, by + ddy, bz + ddz, sigma_bond
                                )

                # Clamp ELF to [0, 1] range
                elf = max(0.0, min(1.0, elf))
                values.append(elf * volume)

    for idx in range(0, len(values), 5):
        chunk = values[idx : idx + 5]
        lines.append(" ".join(f"{val:18.11E}" for val in chunk))

    return "\n".join(lines) + "\n"


def generate_hbn_chgcar() -> str:
    """Generate a CHGCAR for hexagonal BN with non-orthogonal lattice vectors.

    Tests non-cubic lattice handling in the marching cubes algorithm.
    Hexagonal cell: a=b=2.50 A, c=6.66 A, gamma=120 degrees.
    Grid: 20x20x16.
    """
    lat_a = 2.50  # in-plane lattice parameter (Angstrom)
    lat_c = 6.66  # out-of-plane

    # Hexagonal lattice vectors
    # a1 = (lat_a, 0, 0)
    # a2 = (lat_a/2, lat_a*sqrt(3)/2, 0)
    # a3 = (0, 0, lat_c)
    a2_x = lat_a / 2
    a2_y = lat_a * math.sqrt(3) / 2

    # BN positions in fractional coords (AB stacking, 2 layers)
    bn_frac = [
        (0.0, 0.0, 0.0),  # B layer 1
        (1 / 3, 2 / 3, 0.0),  # N layer 1
        (0.0, 0.0, 0.5),  # B layer 2
        (2 / 3, 1 / 3, 0.5),  # N layer 2
    ]

    lines = []
    lines.append("hBN hexagonal - charge density")
    lines.append("   1.0")
    lines.append(f"     {lat_a:.4f}  0.0000  0.0000")
    lines.append(f"     {a2_x:.4f}  {a2_y:.4f}  0.0000")
    lines.append(f"     0.0000  0.0000  {lat_c:.4f}")
    lines.append("   B   N")
    lines.append("   2   2")
    lines.append("Direct")

    for frac_x, frac_y, frac_z in bn_frac:
        lines.append(f"  {frac_x:.6f}  {frac_y:.6f}  {frac_z:.6f}")

    lines.append("")

    nx, ny, nz = 20, 20, 16
    lines.append(f"   {nx}   {ny}   {nz}")

    volume = lat_a * a2_y * lat_c  # det of lattice matrix
    sigma_atom = 0.45
    sigma_bond = 0.3

    # Convert fractional to Cartesian for Gaussian evaluation
    def frac_to_cart(
        frac_x: float, frac_y: float, frac_z: float
    ) -> tuple[float, float, float]:
        """Convert fractional coordinates to Cartesian."""
        cx = frac_x * lat_a + frac_y * a2_x
        cy = frac_y * a2_y
        cz = frac_z * lat_c
        return (cx, cy, cz)

    atom_cart = [frac_to_cart(*frac) for frac in bn_frac]
    z_nums = [5, 7, 5, 7]  # B, N, B, N

    # B-N bond midpoints within each layer
    bond_fracs = [
        (1 / 6, 1 / 3, 0.0),
        (1 / 6, 1 / 3, 0.5),
    ]
    bond_cart = [frac_to_cart(*bf) for bf in bond_fracs]

    values = []
    for ix in range(nx):
        for iy in range(ny):
            for iz in range(nz):
                x = (ix / nx) * lat_a + (iy / ny) * a2_x
                y = (iy / ny) * a2_y
                z = (iz / nz) * lat_c

                rho = 0.0
                # Atomic contributions with PBC images
                for atom_idx, (ax, ay, az) in enumerate(atom_cart):
                    z_num = z_nums[atom_idx]
                    for dx_img in [-1, 0, 1]:
                        for dy_img in [-1, 0, 1]:
                            for dz_img in [-1, 0, 1]:
                                img_x = ax + dx_img * lat_a + dy_img * a2_x
                                img_y = ay + dy_img * a2_y
                                img_z = az + dz_img * lat_c
                                rho += z_num * gaussian(
                                    x, y, z, img_x, img_y, img_z, sigma_atom
                                )

                # Bond contributions
                for bx, by, bz in bond_cart:
                    for dx_img in [-1, 0, 1]:
                        for dy_img in [-1, 0, 1]:
                            for dz_img in [-1, 0, 1]:
                                img_x = bx + dx_img * lat_a + dy_img * a2_x
                                img_y = by + dy_img * a2_y
                                img_z = bz + dz_img * lat_c
                                rho += 3.0 * gaussian(
                                    x, y, z, img_x, img_y, img_z, sigma_bond
                                )

                values.append(rho * volume)

    for idx in range(0, len(values), 5):
        chunk = values[idx : idx + 5]
        lines.append(" ".join(f"{val:18.11E}" for val in chunk))

    return "\n".join(lines) + "\n"


def generate_al_slab_locpot() -> str:
    """Generate a LOCPOT for an Al(111) slab with vacuum.

    Tests LOCPOT filename detection and slab geometry (vacuum gap).
    The potential oscillates inside the slab and decays to ~0 in vacuum.
    Grid: 12x12x40 (fine z-sampling across vacuum).
    """
    # Al(111) slab: hexagonal surface cell
    a_surf = 2.86  # surface lattice parameter
    c_slab = 25.0  # large c for slab + vacuum

    a2_x = a_surf / 2
    a2_y = a_surf * math.sqrt(3) / 2

    # 4-layer Al slab centered in cell (fractional z from 0.3 to 0.5)
    al_frac = [
        (0.0, 0.0, 0.30),
        (1 / 3, 2 / 3, 0.35),
        (2 / 3, 1 / 3, 0.40),
        (0.0, 0.0, 0.45),
    ]

    lines = []
    lines.append("Al(111) slab - local potential")
    lines.append("   1.0")
    lines.append(f"     {a_surf:.4f}  0.0000  0.0000")
    lines.append(f"     {a2_x:.4f}  {a2_y:.4f}  0.0000")
    lines.append(f"     0.0000  0.0000  {c_slab:.4f}")
    lines.append("   Al")
    lines.append(f"   {len(al_frac)}")
    lines.append("Direct")

    for frac_x, frac_y, frac_z in al_frac:
        lines.append(f"  {frac_x:.6f}  {frac_y:.6f}  {frac_z:.6f}")

    lines.append("")

    nx, ny, nz = 12, 12, 40
    lines.append(f"   {nx}   {ny}   {nz}")

    volume = a_surf * a2_y * c_slab
    sigma_core = 0.5

    # LOCPOT: electrostatic potential in eV
    # Negative near nuclei, oscillating in bulk, zero in vacuum
    values = []
    for ix in range(nx):
        for iy in range(ny):
            for iz in range(nz):
                x = (ix / nx) * a_surf + (iy / ny) * a2_x
                y = (iy / ny) * a2_y
                z_frac = iz / nz
                z_cart = z_frac * c_slab

                pot = 0.0

                # Deep negative potential near atomic cores
                for frac_x, frac_y, frac_z in al_frac:
                    ax = frac_x * a_surf + frac_y * a2_x
                    ay = frac_y * a2_y
                    az = frac_z * c_slab
                    for dx_img in [-1, 0, 1]:
                        for dy_img in [-1, 0, 1]:
                            img_x = ax + dx_img * a_surf + dy_img * a2_x
                            img_y = ay + dy_img * a2_y
                            pot -= 13.0 * gaussian(
                                x, y, z_cart, img_x, img_y, az, sigma_core
                            )

                # Smooth background: positive in vacuum, slightly negative in slab
                # Slab region: z_frac ~ 0.28-0.47
                slab_center = 0.375
                slab_width = 0.10
                in_slab = math.exp(-((z_frac - slab_center) ** 2) / (2 * slab_width**2))
                pot += -2.0 * in_slab  # negative work function region
                pot += 0.5 * (1 - in_slab)  # vacuum level

                # LOCPOT is NOT multiplied by volume (unlike CHGCAR)
                # but our parser always divides by volume, so multiply here
                values.append(pot * volume)

    for idx in range(0, len(values), 5):
        chunk = values[idx : idx + 5]
        lines.append(" ".join(f"{val:18.11E}" for val in chunk))

    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    import os

    out_dir = os.path.dirname(__file__)

    generators: list[tuple[str, str]] = [
        ("H2O electron density .cube", "h2o-density.cube.gz"),
        ("Si CHGCAR", "Si-CHGCAR.gz"),
        ("benzene pi orbital .cube", "benzene-orbital.cube.gz"),
        ("Fe BCC spin-polarized CHGCAR", "Fe-spin-CHGCAR.gz"),
        ("GaAs zinc blende CHGCAR", "GaAs-CHGCAR.gz"),
        ("CH4 electrostatic potential .cube", "ch4-esp.cube.gz"),
        ("ethylene pi* orbital .cube", "ethylene-orbital.cube.gz"),
        ("MgO rocksalt ELFCAR", "MgO-ELFCAR.gz"),
        ("hBN hexagonal CHGCAR", "hBN-CHGCAR.gz"),
        ("Al(111) slab LOCPOT", "Al-slab-LOCPOT.gz"),
    ]

    # Map filename to generator function
    from collections.abc import Callable

    gen_funcs: dict[str, Callable[[], str]] = {
        "h2o-density.cube.gz": generate_h2o_cube,
        "Si-CHGCAR.gz": generate_si_chgcar,
        "benzene-orbital.cube.gz": generate_benzene_orbital_cube,
        "Fe-spin-CHGCAR.gz": generate_fe_bcc_spin_chgcar,
        "GaAs-CHGCAR.gz": generate_gaas_chgcar,
        "ch4-esp.cube.gz": generate_ch4_esp_cube,
        "ethylene-orbital.cube.gz": generate_ethylene_orbital_cube,
        "MgO-ELFCAR.gz": generate_mgo_elfcar,
        "hBN-CHGCAR.gz": generate_hbn_chgcar,
        "Al-slab-LOCPOT.gz": generate_al_slab_locpot,
    }

    for label, filename in generators:
        print(f"Generating {label} ...")
        content = gen_funcs[filename]()
        with gzip.open(f"{out_dir}/{filename}", "wt") as fh:
            fh.write(content)
        print(f"  -> {filename} ({len(content)} bytes uncompressed)")

    print("Done!")
