"""Surface Science Pipeline with Ferrox.

Demonstrates slab generation, Miller index enumeration, adsorption site finding,
and Wulff shape construction for surface science applications.

**Who is this for?** Catalysis researchers modeling reaction sites, surface chemists
studying interfaces, and anyone simulating adsorption or thin films.

Run with: marimo edit 03_surface_science.py --no-sandbox
"""

# /// script
# dependencies = [
#     "marimo>=0.19.7",
#     "pymatgen>=2025.10.7",
#     "ferrox",
#     "pymatviz>=0.17.3",
# ]
#
# [tool.marimo.runtime]
# output_max_bytes = 100_000_000
# ///

import marimo

__generated_with = "0.19.7"
app = marimo.App(width="full")


@app.cell
def _():
    """Setup and imports."""
    import time

    import ferrox
    import marimo as mo
    import pymatviz as pmv
    from ferrox import surfaces
    from pymatgen.core import Lattice, Structure
    from pymatgen.core.surface import generate_all_slabs

    return (
        Lattice,
        Structure,
        ferrox,
        generate_all_slabs,
        mo,
        pmv,
        surfaces,
        time,
        mo.md("""
        # Surface Science Pipeline

        This notebook demonstrates ferrox's comprehensive surface science capabilities:

        - **Miller index enumeration** - Generate all unique surface orientations
        - **Slab generation** - Create surface slabs with various terminations
        - **Adsorption site finding** - Identify atop, bridge, and hollow sites
        - **Wulff shape construction** - Calculate equilibrium crystal shapes

        **Key ferrox functions:**
        - `surfaces.enumerate_miller()` - List Miller indices up to max index
        - `surfaces.find_adsorption_sites()` - Find adsorption sites on slabs
        - `surfaces.compute_wulff()` - Calculate Wulff construction
        - `surfaces.get_surface_atoms()` - Identify surface atoms
        """),
)


@app.cell
def _(Lattice, Structure, mo, pmv):
    """Create bulk FCC Ni structure."""

    # FCC Nickel bulk structure
    ni_bulk = Structure(
        Lattice.cubic(3.524),
        ["Ni", "Ni", "Ni", "Ni"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    return (ni_bulk,
        mo.md(f"""
        ## Bulk FCC Nickel Structure

        Starting with FCC Ni (a = 3.524 Å):
        - **Space group**: Fm-3m (225)
        - **Number of atoms**: {len(ni_bulk)}
        - **Volume**: {ni_bulk.volume:.2f} Å³
        """),
)


@app.cell
def _(mo, ni_bulk, pmv):
    """Visualize bulk structure."""
    return mo.vstack(
        [
            mo.md("### Bulk Nickel Structure"),
            pmv.StructureWidget(structure=ni_bulk, style="height: 250px;"),
        ]
    )


@app.cell
def _(mo, surfaces):
    """Enumerate Miller indices."""

    # Get all Miller indices up to max_index=3
    miller_indices = surfaces.enumerate_miller(max_index=3)

    # Group by type for display
    low_index = [hkl for hkl in miller_indices if max(abs(comp) for comp in hkl) == 1]
    mid_index = [hkl for hkl in miller_indices if max(abs(comp) for comp in hkl) == 2]
    high_index = [hkl for hkl in miller_indices if max(abs(comp) for comp in hkl) == 3]

    return (
        high_index,
        low_index,
        mid_index,
        miller_indices,
        mo.md(f"""
        ## Miller Index Enumeration

        `surfaces.enumerate_miller(max_index=3)` → **{len(miller_indices)} unique surfaces**
        ({len(low_index)} low-index, {len(mid_index)} mid-index, {len(high_index)} high-index)
        """),
    )


@app.cell
def _(ferrox, mo, ni_bulk, surfaces):
    """Calculate d-spacings for common surfaces."""

    ni_dict = ferrox.io.from_pymatgen_structure(ni_bulk)

    common_surfaces = [[1, 0, 0], [1, 1, 0], [1, 1, 1], [2, 1, 0], [2, 1, 1], [3, 1, 1]]

    d_spacings = []
    for _hkl in common_surfaces:
        _d = surfaces.d_spacing(ni_dict, _hkl[0], _hkl[1], _hkl[2])
        d_spacings.append({"hkl": f"({_hkl[0]}{_hkl[1]}{_hkl[2]})", "d_spacing": _d})

    d_table = "\n".join(f"| {entry['hkl']} | {entry['d_spacing']:.4f} Å |" for entry in d_spacings)

    return (
        common_surfaces,
        d_spacings,
        d_table,
        ni_dict,
        mo.md(f"""
        ## D-Spacings

        | Surface | D-Spacing |
        |---------|-----------|
        {d_table}
        """),
    )


@app.cell
def _(mo, ni_dict, surfaces):
    """Calculate surface normal for (111) surface."""

    # Generate Ni(111) slab using ferrox Miller-to-normal conversion
    normal_111 = surfaces.miller_to_normal(ni_dict, [1, 1, 1])

    return (normal_111,
        mo.md(f"""
        ## Surface Normal

        (111) → Normal: [{normal_111[0]:.4f}, {normal_111[1]:.4f}, {normal_111[2]:.4f}]
        """),
)


@app.cell
def _(generate_all_slabs, mo, ni_bulk, time):
    """Generate slabs using pymatgen for comparison."""

    # Pymatgen slab generation
    _start = time.perf_counter()
    pmg_slabs = generate_all_slabs(
        ni_bulk,
        max_index=2,
        min_slab_size=8.0,
        min_vacuum_size=15.0,
        max_normal_search=5,
    )
    pmg_time = time.perf_counter() - _start

    return (
        pmg_slabs,
        pmg_time,
        mo.md(f"""
        ## Pymatgen Slab Generation (for comparison)

        Using `generate_all_slabs` with max_index=2:
        - **Slabs generated**: {len(pmg_slabs)}
        - **Time**: {pmg_time:.3f}s

        Different slabs represent different surface terminations.
        """),
    )


@app.cell
def _(mo, pmg_slabs, pmv):
    """Visualize sample slabs."""

    # Show first 4 slabs
    sample_slabs = pmg_slabs[:4]

    return (
        sample_slabs,
        mo.md("### Sample Generated Slabs"),
    )


@app.cell
def _(mo, pmv, sample_slabs):
    """Display slab grid."""
    return mo.hstack(
        [
            mo.vstack(
                [
                    mo.md(f"**{slab.miller_index}**"),
                    pmv.StructureWidget(
                        structure=slab, style="width: 200px; height: 250px;"
                    ),
                ]
            )
            for slab in sample_slabs
        ],
        gap=2,
    )


@app.cell
def _(ferrox, mo, pmg_slabs, surfaces):
    """Find adsorption sites on (111) slab."""

    # Initialize defaults to avoid NameError if no (1,1,1) slab is found
    slab_111 = None
    slab_dict = None
    ads_sites = []
    site_counts = {}
    site_table = ""

    # Get (111) slab
    for slab in pmg_slabs:
        if slab.miller_index == (1, 1, 1):
            slab_111 = slab
            break

    if slab_111 is not None:
        slab_dict = ferrox.io.from_pymatgen_structure(slab_111)

        # Find adsorption sites
        ads_sites = surfaces.find_adsorption_sites(
            slab_dict,
            height=2.0,  # Height above surface
            site_types=["atop", "bridge", "hollow"],
        )

        # Count site types
        for site in ads_sites:
            site_type = site.get("site_type", "unknown")
            site_counts[site_type] = site_counts.get(site_type, 0) + 1

        site_table = "\n".join(f"| {k} | {v} |" for k, v in site_counts.items())

        display = mo.md(f"""
## Adsorption Sites on Ni(111)

Found adsorption sites 2.0 Å above the surface:

| Site Type | Count |
|-----------|-------|
{site_table}

**Total sites**: {len(ads_sites)}

These are potential locations for adsorbate molecules.
        """)
    else:
        display = mo.md("Could not find (111) slab in generated set.")

    return ads_sites, display, slab_111, slab_dict, site_counts, site_table


@app.cell
def _(mo, pmv, slab_111):
    """Visualize (111) slab with adsorption sites."""
    if slab_111 is not None:
        _display = mo.vstack(
            [
                mo.md("### Ni(111) Slab Surface"),
                pmv.StructureWidget(structure=slab_111, style="height: 250px;"),
            ]
        )
    else:
        _display = None
    return (_display,)


@app.cell
def _(ferrox, mo, pmg_slabs, surfaces):
    """Identify surface atoms."""

    # Initialize defaults to avoid UnboundLocalError when pmg_slabs is empty
    surface_atoms = []
    test_dict = None
    test_slab = None

    if pmg_slabs:
        test_slab = pmg_slabs[0]
        test_dict = ferrox.io.from_pymatgen_structure(test_slab)

        surface_atoms = surfaces.get_surface_atoms(test_dict, tolerance=0.5)

        display = mo.md(f"""
## Surface Atom Identification

For slab {test_slab.miller_index}:
- **Total atoms**: {len(test_slab)}
- **Surface atoms**: {len(surface_atoms)}
- **Surface atom indices**: {surface_atoms}

Surface atoms are those exposed at the top/bottom of the slab.
        """)
    else:
        display = mo.md("No slabs available for surface atom identification.")

    return surface_atoms, display, test_dict, test_slab


@app.cell
def _(mo, ni_dict, surfaces):
    """Compute Wulff shape from surface energies."""

    # Example surface energies for FCC Ni (in J/m²)
    # Values are illustrative - real values from DFT calculations
    surface_energies = [
        ([1, 1, 1], 1.85),  # Close-packed, lowest energy
        ([1, 0, 0], 2.10),
        ([1, 1, 0], 2.05),
        ([2, 1, 0], 2.30),
        ([2, 1, 1], 2.25),
        ([3, 1, 1], 2.40),
    ]

    wulff = None
    try:
        wulff = surfaces.compute_wulff(ni_dict, surface_energies)

        display = mo.md(f"""
        ## Wulff Shape Construction

        Equilibrium crystal shape from surface energies:

        | Surface | Energy (J/m²) |
        |---------|---------------|
        | (111) | 1.85 |
        | (100) | 2.10 |
        | (110) | 2.05 |
        | (210) | 2.30 |
        | (211) | 2.25 |
        | (311) | 2.40 |

        **Wulff shape properties**:
        - Total surface area: {wulff.get("total_area", "N/A")}
        - Dominant facet: (111) - close-packed surface
        """)
    except Exception as exc:
        display = mo.md(f"Wulff calculation not available: {exc}")

    return surface_energies, wulff, display


@app.cell
def _(mo, ni_dict, surfaces):
    """Calculate surface area of slabs."""

    # Create a simple slab-like structure for area calculation
    test_areas = []
    for _hkl in [[1, 0, 0], [1, 1, 0], [1, 1, 1]]:
        _d = surfaces.d_spacing(ni_dict, _hkl[0], _hkl[1], _hkl[2])
        test_areas.append({"hkl": f"({_hkl[0]}{_hkl[1]}{_hkl[2]})", "d_spacing": _d})

    area_table = "\n".join(f"| {a['hkl']} | {a['d_spacing']:.4f} |" for a in test_areas)

    return (
        area_table,
        test_areas,
        mo.md(f"""
        ## Surface Properties Summary

        | Surface | D-Spacing (Å) |
        |---------|---------------|
        {area_table}

        The d-spacing relates to atomic density at the surface.
        """),
    )


@app.cell
def _(Lattice, Structure, ferrox, mo, surfaces):
    """Edge case: Complex oxide surface."""

    # Create a complex oxide (SrTiO3 perovskite)
    sto = Structure(
        Lattice.cubic(3.905),
        ["Sr", "Ti", "O", "O", "O"],
        [
            [0, 0, 0],  # Sr at corner
            [0.5, 0.5, 0.5],  # Ti at body center
            [0.5, 0.5, 0],  # O at face centers
            [0.5, 0, 0.5],
            [0, 0.5, 0.5],
        ],
    )

    sto_dict = ferrox.io.from_pymatgen_structure(sto)

    # Calculate d-spacings
    sto_d_spacings = []
    for _hkl in [[1, 0, 0], [1, 1, 0], [1, 1, 1]]:
        _d = surfaces.d_spacing(sto_dict, _hkl[0], _hkl[1], _hkl[2])
        sto_d_spacings.append({"hkl": f"({_hkl[0]}{_hkl[1]}{_hkl[2]})", "d": _d})

    sto_table = "\n".join(f"| {s['hkl']} | {s['d']:.4f} |" for s in sto_d_spacings)

    return (
        sto,
        sto_d_spacings,
        sto_dict,
        sto_table,
        mo.md(f"""
        ## Edge Case: Complex Oxide (SrTiO₃)

        Perovskite oxides have multiple possible terminations:
        - SrO-terminated
        - TiO₂-terminated

        | Surface | D-Spacing (Å) |
        |---------|---------------|
        {sto_table}

        The (100) surface of SrTiO₃ can have either SrO or TiO₂ termination.
        """),
    )


@app.cell
def _(mo, pmv, sto):
    """Visualize SrTiO3."""
    return mo.vstack(
        [
            mo.md("### SrTiO₃ Perovskite Structure"),
            pmv.StructureWidget(structure=sto, style="height: 250px;"),
        ]
    )


@app.cell
def _(Lattice, Structure, ferrox, mo, surfaces):
    """Edge case: High Miller index surface."""

    # Create simple FCC structure
    fcc = Structure(
        Lattice.cubic(4.0),
        ["Au", "Au", "Au", "Au"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    fcc_dict = ferrox.io.from_pymatgen_structure(fcc)

    # High Miller indices
    high_miller = [[3, 2, 1], [5, 3, 1], [7, 5, 3]]
    high_d = []
    for _hkl in high_miller:
        _d = surfaces.d_spacing(fcc_dict, _hkl[0], _hkl[1], _hkl[2])
        high_d.append({"hkl": f"({_hkl[0]}{_hkl[1]}{_hkl[2]})", "d": _d})

    high_table = "\n".join(f"| {h['hkl']} | {h['d']:.4f} |" for h in high_d)

    return (
        fcc,
        fcc_dict,
        high_d,
        high_miller,
        high_table,
        mo.md(f"""
        ## Edge Case: High Miller Index Surfaces

        Stepped/kinked surfaces with high Miller indices:

        | Surface | D-Spacing (Å) |
        |---------|---------------|
        {high_table}

        High-index surfaces have:
        - Lower atomic density
        - Step edges and kinks
        - Often higher catalytic activity
        """),
    )


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return mo.md("""
    ## Summary

    Ferrox provides a comprehensive surface science toolkit:

    1. **Miller index enumeration** - Generate all unique surface orientations
    2. **D-spacing calculation** - Determine layer separations
    3. **Adsorption site finding** - Locate atop, bridge, hollow sites
    4. **Surface atom identification** - Find exposed atoms
    5. **Wulff construction** - Calculate equilibrium crystal shapes

    ### Key Functions

    ```python
    from ferrox import surfaces

    # Enumerate Miller indices
    millers = surfaces.enumerate_miller(max_index=3)

    # Calculate d-spacing
    d = surfaces.d_spacing(struct, h=1, k=1, l=1)

    # Convert Miller to normal vector
    normal = surfaces.miller_to_normal(struct, [1, 1, 1])

    # Find adsorption sites
    sites = surfaces.find_adsorption_sites(slab, height=2.0)

    # Get surface atoms
    surface_idx = surfaces.get_surface_atoms(slab, tolerance=0.5)

    # Compute Wulff shape
    wulff = surfaces.compute_wulff(struct, surface_energies)
    ```

    ### Use Cases

    - **Catalysis**: Find active sites on metal surfaces
    - **Crystal growth**: Predict equilibrium crystal shapes
    - **Thin films**: Generate substrate surface models
    - **Electrochemistry**: Model electrode surfaces
    """)


if __name__ == "__main__":
    app.run()
