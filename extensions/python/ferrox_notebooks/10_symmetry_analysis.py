"""Symmetry Analysis Deep Dive with Ferrox.

Demonstrates comprehensive symmetry detection, space group analysis,
Wyckoff positions, and cell transformations.

**Who is this for?** Everyone working with crystal structures - symmetry is
fundamental to property prediction, database queries, and structure validation.

Run with: marimo edit 10_symmetry_analysis.py --no-sandbox
"""

# /// script
# dependencies = [
#     "marimo>=0.19.7",
#     "pymatgen>=2025.10.7",
#     "ferrox",
#     "pymatviz>=0.17.3",
#     "numpy",
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
    import numpy as np
    import pymatviz as pmv
    from ferrox import structure, symmetry
    from pymatgen.core import Lattice, Structure
    from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

    return (
        Lattice,
        SpacegroupAnalyzer,
        Structure,
        ferrox,
        mo,
        np,
        pmv,
        structure,
        symmetry,
        time,
        mo.md("""
        # Symmetry Analysis Deep Dive

        This notebook demonstrates ferrox's comprehensive symmetry analysis:

        - **Space group detection**: International and Hall symbols
        - **Crystal system identification**: Cubic, tetragonal, etc.
        - **Wyckoff positions**: Site symmetry and multiplicity
        - **Cell standardization**: Primitive and conventional cells
        - **Symmetry operations**: Rotation and translation matrices

        **Key ferrox functions:**
        - `symmetry.get_spacegroup_number()` - ITA space group number
        - `symmetry.get_spacegroup_symbol()` - Hermann-Mauguin symbol
        - `symmetry.get_wyckoff_letters()` - Wyckoff position labels
        - `symmetry.get_primitive()` - Primitive cell transformation
        - `symmetry.get_conventional()` - Conventional cell transformation
        """),
)


@app.cell
def _(Lattice, Structure, mo):
    """Create test structures with various symmetries."""

    # High symmetry: FCC (Fm-3m, #225)
    fcc = Structure(
        Lattice.cubic(4.05),
        ["Al", "Al", "Al", "Al"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    # Tetragonal: Rutile TiO2 (P42/mnm, #136)
    rutile = Structure(
        Lattice.tetragonal(4.59, 2.96),
        ["Ti", "Ti", "O", "O", "O", "O"],
        [
            [0, 0, 0],
            [0.5, 0.5, 0.5],
            [0.305, 0.305, 0],
            [0.695, 0.695, 0],
            [0.805, 0.195, 0.5],
            [0.195, 0.805, 0.5],
        ],
    )

    # Orthorhombic: Perovskite (Pnma, #62)
    perovskite = Structure(
        Lattice.orthorhombic(5.57, 7.87, 5.53),
        [
            "Ca",
            "Ca",
            "Ca",
            "Ca",
            "Ti",
            "Ti",
            "Ti",
            "Ti",
            "O",
            "O",
            "O",
            "O",
            "O",
            "O",
            "O",
            "O",
            "O",
            "O",
            "O",
            "O",
        ],
        [
            [0.0, 0.25, 0.0],
            [0.5, 0.75, 0.0],
            [0.0, 0.75, 0.5],
            [0.5, 0.25, 0.5],
            [0.0, 0.0, 0.5],
            [0.5, 0.5, 0.5],
            [0.0, 0.5, 0.0],
            [0.5, 0.0, 0.0],
            [0.25, 0.0, 0.25],
            [0.75, 0.0, 0.75],
            [0.25, 0.5, 0.75],
            [0.75, 0.5, 0.25],
            [0.0, 0.25, 0.5],
            [0.5, 0.75, 0.5],
            [0.0, 0.75, 0.0],
            [0.5, 0.25, 0.0],
            [0.25, 0.25, 0.0],
            [0.75, 0.75, 0.0],
            [0.25, 0.75, 0.5],
            [0.75, 0.25, 0.5],
        ],
    )

    return (
        fcc,
        perovskite,
        rutile,
        mo.md("""
        ## Test Structures with Various Symmetries

        | Structure | Expected Space Group | Crystal System |
        |-----------|---------------------|----------------|
        | FCC Al | Fm-3m (#225) | Cubic |
        | Rutile TiO₂ | P4₂/mnm (#136) | Tetragonal |
        | CaTiO₃ | Pnma (#62) | Orthorhombic |
        """),
    )


@app.cell
def _(fcc, mo, perovskite, pmv, rutile):
    """Visualize test structures."""
    return mo.hstack(
        [
            mo.vstack(
                [
                    mo.md("**FCC Al**"),
                    pmv.StructureWidget(structure=fcc, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**Rutile TiO₂**"),
                    pmv.StructureWidget(structure=rutile, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**CaTiO₃**"),
                    pmv.StructureWidget(structure=perovskite, style="height: 250px;"),
                ]
            ),
        ],
        gap=2,
    )


@app.cell
def _(mo):
    """Interactive symmetry tolerance control."""
    symprec_slider = mo.ui.slider(
        0.001, 0.1, value=0.01, step=0.001, label="Symmetry tolerance (Å)"
    )
    return (symprec_slider,)


@app.cell
def _(fcc, ferrox, mo, perovskite, rutile, symprec_slider, symmetry, time):
    """Detect space groups with interactive tolerance."""

    _structures = [("FCC Al", fcc), ("Rutile TiO₂", rutile), ("CaTiO₃", perovskite)]
    _symprec = symprec_slider.value

    _results = []
    for _name, _struct in _structures:
        _struct_dict = ferrox.io.from_pymatgen_structure(_struct)

        _start = time.perf_counter()
        _sg_number = symmetry.get_spacegroup_number(_struct_dict, symprec=_symprec)
        _sg_symbol = symmetry.get_spacegroup_symbol(_struct_dict, symprec=_symprec)
        _crystal_system = symmetry.get_crystal_system(_struct_dict, symprec=_symprec)
        _hall_number = symmetry.get_hall_number(_struct_dict, symprec=_symprec)
        _calc_time = time.perf_counter() - _start

        _results.append(
            {
                "name": _name,
                "sg_number": _sg_number,
                "sg_symbol": _sg_symbol,
                "crystal_system": _crystal_system,
                "hall_number": _hall_number,
                "time": _calc_time,
            }
        )

    _sg_table = "\n".join(
        f"| {result['name']} | {result['sg_number']} | {result['sg_symbol']} | {result['crystal_system']} | {result['time']:.4f}s |"
        for result in _results
    )

    return (
        mo.vstack([
            mo.md("## Space Group Detection"),
            symprec_slider,
            mo.md(f"""
Symmetry analysis with tolerance = {_symprec:.3f} Å:

| Structure | SG# | Symbol | Crystal System | Time |
|-----------|-----|--------|----------------|------|
{_sg_table}

Lower tolerance → stricter symmetry matching. Increase tolerance to detect
symmetry in slightly distorted structures.
            """),
        ]),
    )


@app.cell
def _(fcc, ferrox, mo, symmetry):
    """Get Wyckoff positions."""

    _fcc_dict = ferrox.io.from_pymatgen_structure(fcc)

    # Get Wyckoff letters for all sites
    _wyckoff = symmetry.get_wyckoff_letters(_fcc_dict, symprec=0.01)

    # Get equivalent sites (symmetry-equivalent atoms)
    _equiv_sites = symmetry.get_equivalent_sites(_fcc_dict, symprec=0.01)

    return mo.md(f"""
    ## Wyckoff Positions

    **FCC Al** (Fm-3m, #225):

    | Site | Wyckoff Letter | Equivalent Group |
    |------|----------------|------------------|
    {chr(10).join(f"| {idx} | {w} | {_equiv_sites[idx]} |" for idx, w in enumerate(_wyckoff))}

    **Interpretation**:
    - All Al atoms are on the 4a Wyckoff position
    - Equivalent sites share the same Wyckoff position
    - Higher symmetry = fewer unique Wyckoff positions
    """)


@app.cell
def _(fcc, ferrox, mo, symmetry):
    """Get primitive and conventional cells."""

    _fcc_dict = ferrox.io.from_pymatgen_structure(fcc)

    # Get primitive cell
    primitive = symmetry.get_primitive(_fcc_dict, symprec=0.01)
    primitive_pmg = ferrox.io.to_pymatgen_structure(primitive)

    # Get conventional cell
    conventional = symmetry.get_conventional(_fcc_dict, symprec=0.01)
    conventional_pmg = ferrox.io.to_pymatgen_structure(conventional)

    return (
        conventional,
        conventional_pmg,
        primitive,
        primitive_pmg,
        mo.md(f"""
        ## Cell Transformations

        **Original FCC Al**:
        - Atoms: {len(fcc)}
        - Volume: {fcc.volume:.2f} Å³

        **Primitive cell**:
        - Atoms: {len(primitive_pmg)}
        - Volume: {primitive_pmg.volume:.2f} Å³

        **Conventional cell**:
        - Atoms: {len(conventional_pmg)}
        - Volume: {conventional_pmg.volume:.2f} Å³

        The primitive cell contains the minimum number of atoms.
        """),
    )


@app.cell
def _(conventional_pmg, fcc, mo, pmv, primitive_pmg):
    """Visualize cell transformations."""
    return mo.hstack(
        [
            mo.vstack(
                [
                    mo.md(f"**Original ({len(fcc)} atoms)**"),
                    pmv.StructureWidget(structure=fcc, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md(f"**Primitive ({len(primitive_pmg)} atoms)**"),
                    pmv.StructureWidget(
                        structure=primitive_pmg, style="height: 250px;"
                    ),
                ]
            ),
            mo.vstack(
                [
                    mo.md(f"**Conventional ({len(conventional_pmg)} atoms)**"),
                    pmv.StructureWidget(
                        structure=conventional_pmg, style="height: 250px;"
                    ),
                ]
            ),
        ],
        gap=2,
    )


@app.cell
def _(fcc, ferrox, mo, symmetry):
    """Get symmetry operations."""

    _fcc_dict = ferrox.io.from_pymatgen_structure(fcc)

    # Get all symmetry operations
    sym_ops = symmetry.get_symmetry_operations(_fcc_dict, symprec=0.01)

    return mo.md(f"""
        ## Symmetry Operations

        **FCC Al** (Fm-3m) has {len(sym_ops)} symmetry operations.

        **Sample operations**:

        | # | Rotation Matrix | Translation |
        |---|-----------------|-------------|
        | 1 | {sym_ops[0]["rotation"]} | {sym_ops[0]["translation"]} |
        | 2 | {sym_ops[1]["rotation"]} | {sym_ops[1]["translation"]} |
        | 3 | {sym_ops[2]["rotation"]} | {sym_ops[2]["translation"]} |

        Each operation: r' = R·r + t (rotation + translation)

        Point group Fm-3m (Oh) has 48 rotations × 4 translations = 192 operations.
        """)


@app.cell
def _(fcc, ferrox, mo, symmetry):
    """Get full symmetry dataset."""

    _fcc_dict = ferrox.io.from_pymatgen_structure(fcc)

    # Get complete symmetry dataset
    dataset = symmetry.get_symmetry_dataset(_fcc_dict, symprec=0.01)

    # Extract key information
    info = {
        "number": dataset.get("number"),
        "hall_number": dataset.get("hall_number"),
        "international": dataset.get("international"),
        "hall": dataset.get("hall"),
        "choice": dataset.get("choice"),
        "pointgroup": dataset.get("pointgroup"),
    }

    info_table = "\n".join(f"| {k} | {v} |" for k, v in info.items() if v is not None)

    return mo.md(f"""
        ## Full Symmetry Dataset

        Complete spglib symmetry information:

        | Property | Value |
        |----------|-------|
        {info_table}

        Additional data available:
        - Transformation matrices
        - Origin shift
        - Equivalent atoms
        - Crystallographic orbits
        """)


@app.cell
def _(ferrox, Lattice, mo, Structure, symmetry):
    """Get Pearson symbol."""

    # Various structures for Pearson symbol demonstration
    test_structs = [
        (
            "FCC Cu",
            Structure(
                Lattice.cubic(3.6),
                ["Cu"] * 4,
                [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
            ),
        ),
        (
            "BCC Fe",
            Structure(Lattice.cubic(2.87), ["Fe"] * 2, [[0, 0, 0], [0.5, 0.5, 0.5]]),
        ),
        (
            "HCP Mg",
            Structure(
                Lattice.hexagonal(3.2, 5.2),
                ["Mg"] * 2,
                [[1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]],
            ),
        ),
    ]

    _pearson_results = []
    for _name, _struct in test_structs:
        _struct_dict = ferrox.io.from_pymatgen_structure(_struct)
        _pearson = symmetry.get_pearson_symbol(_struct_dict, symprec=0.01)
        _pearson_results.append({"name": _name, "pearson": _pearson})

    _pearson_table = "\n".join(
        f"| {result['name']} | {result['pearson']} |" for result in _pearson_results
    )

    return mo.md(f"""
    ## Pearson Symbols

    Compact notation for crystal structure type:

    | Structure | Pearson Symbol |
    |-----------|----------------|
    {_pearson_table}

    **Pearson symbol format**: `xYn`
    - **x**: Lattice type (c=cubic, t=tetragonal, h=hexagonal, o=ortho, m=mono, a=triclinic)
    - **Y**: Centering (P, I, F, C, R)
    - **n**: Number of atoms in conventional cell
    """)


@app.cell
def _(SpacegroupAnalyzer, fcc, ferrox, mo, symmetry, time):
    """Benchmark against pymatgen."""

    _fcc_dict = ferrox.io.from_pymatgen_structure(fcc)

    # Ferrox timing (conversion excluded — done once above)
    _start = time.perf_counter()
    for _ in range(100):
        _ = symmetry.get_spacegroup_number(_fcc_dict, symprec=0.01)
    ferrox_time = (time.perf_counter() - _start) / 100

    # Pymatgen timing — SpacegroupAnalyzer does symmetry detection in __init__,
    # so we create it once and only time the getter for a fair comparison
    sga = SpacegroupAnalyzer(fcc, symprec=0.01)
    _start = time.perf_counter()
    for _ in range(100):
        _ = sga.get_space_group_number()
    pmg_time = (time.perf_counter() - _start) / 100

    speedup = pmg_time / ferrox_time if ferrox_time > 0 else float("inf")

    return (
        _fcc_dict,
        ferrox_time,
        pmg_time,
        sga,
        speedup,
        mo.md(f"""
        ## Performance Benchmark

        Space group number retrieval (average of 100 runs):

        | Method | Time per call |
        |--------|---------------|
        | Ferrox | {ferrox_time * 1000:.3f} ms |
        | Pymatgen | {pmg_time * 1000:.3f} ms |
        | **Ratio** | **{speedup:.1f}x** |

        Both use spglib under the hood. For individual lookups both are fast;
        the difference matters mainly for batch analysis of 1000s+ structures.
        """),
    )


@app.cell
def _(Lattice, Structure, ferrox, mo, np, symmetry):
    """Edge case: Tolerance sensitivity."""

    # Create slightly distorted FCC structure
    np_rng = np.random.default_rng(seed=42)

    distorted_fcc = Structure(
        Lattice.cubic(4.05),
        ["Al"] * 4,
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    # Add small random displacements
    for site_idx in range(len(distorted_fcc)):
        distorted_fcc.translate_sites(
            [site_idx], np_rng.uniform(-0.05, 0.05, 3), frac_coords=True
        )

    dist_dict = ferrox.io.from_pymatgen_structure(distorted_fcc)

    # Test with different tolerances
    tolerances = [0.001, 0.01, 0.05, 0.1, 0.2]
    tol_results = []

    for tol in tolerances:
        _sg_num = symmetry.get_spacegroup_number(dist_dict, symprec=tol)
        _sg_sym = symmetry.get_spacegroup_symbol(dist_dict, symprec=tol)
        tol_results.append({"tol": tol, "sg_num": _sg_num, "sg_sym": _sg_sym})

    tol_table = "\n".join(
        f"| {result['tol']} | {result['sg_num']} | {result['sg_sym']} |" for result in tol_results
    )

    return (
        dist_dict,
        distorted_fcc,
        np_rng,
        tol_results,
        tol_table,
        tolerances,
        mo.md(f"""
        ## Edge Case: Tolerance Sensitivity

        Distorted FCC structure with ~0.05 fractional coordinate noise:

        | Tolerance (Å) | SG# | Symbol |
        |---------------|-----|--------|
        {tol_table}

        **Observations**:
        - Tight tolerance: Low symmetry detected (actual atomic positions)
        - Loose tolerance: Ideal symmetry recovered
        - Choose tolerance based on expected precision of coordinates
        """),
)


@app.cell
def _(distorted_fcc, fcc, mo, pmv):
    """Visualize distorted structure."""
    return mo.hstack(
        [
            mo.vstack(
                [
                    mo.md("**Ideal FCC**"),
                    pmv.StructureWidget(structure=fcc, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**Distorted FCC**"),
                    pmv.StructureWidget(
                        structure=distorted_fcc, style="height: 250px;"
                    ),
                ]
            ),
        ],
        gap=4,
    )


@app.cell
def _(Lattice, Structure, ferrox, mo, symmetry, time):
    """Batch symmetry analysis."""

    # Generate structures for batch processing
    batch_structs = []
    for idx in range(50):
        a = 3.5 + idx * 0.02
        struct = Structure(
            Lattice.cubic(a),
            ["Cu"] * 4,
            [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
        )
        batch_structs.append(struct)

    # Batch analysis
    _start = time.perf_counter()
    batch_results = []
    for _struct in batch_structs:
        _struct_dict = ferrox.io.from_pymatgen_structure(_struct)
        _sg = symmetry.get_spacegroup_number(_struct_dict, symprec=0.01)
        batch_results.append(_sg)
    batch_time = time.perf_counter() - _start

    # All should be Fm-3m (#225)
    all_fcc = all(sg == 225 for sg in batch_results)

    return mo.md(f"""
        ## Batch Symmetry Analysis

        Analyzed {len(batch_structs)} FCC structures with varying lattice parameters:

        - **Total time**: {batch_time:.3f}s
        - **Time per structure**: {batch_time / len(batch_structs) * 1000:.2f} ms
        - **All Fm-3m (#225)**: {all_fcc}

        Lattice parameter changes don't affect space group.
        """)


@app.cell
def _(Lattice, Structure, ferrox, mo, symmetry):
    """Edge case: Low symmetry structures."""

    # Triclinic structure (lowest symmetry)
    triclinic = Structure(
        Lattice.from_parameters(
            a=5.0, b=6.0, c=7.0, alpha=85.0, beta=95.0, gamma=100.0
        ),
        ["Si", "O", "O"],
        [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]],
    )

    tri_dict = ferrox.io.from_pymatgen_structure(triclinic)

    _sg_num = symmetry.get_spacegroup_number(tri_dict, symprec=0.01)
    _sg_sym = symmetry.get_spacegroup_symbol(tri_dict, symprec=0.01)
    _crystal = symmetry.get_crystal_system(tri_dict, symprec=0.01)
    _wyckoff = symmetry.get_wyckoff_letters(tri_dict, symprec=0.01)

    return (triclinic,
        mo.md(f"""
        ## Edge Case: Low Symmetry (Triclinic)

        Triclinic structure with no symmetry constraints:

        - **Space group**: {_sg_sym} (#{_sg_num})
        - **Crystal system**: {_crystal}
        - **Wyckoff positions**: {_wyckoff}

        Triclinic has only P1 or P-1 space groups (1 or 2 operations).
        """),
)


@app.cell
def _(mo, pmv, triclinic):
    """Visualize triclinic structure."""
    return mo.vstack(
        [
            mo.md("### Triclinic Structure"),
            pmv.StructureWidget(structure=triclinic, style="height: 250px;"),
        ]
    )


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return mo.md("""
    ## Summary

    Ferrox provides comprehensive symmetry analysis:

    1. **Space group detection**: Number, symbol, Hall number
    2. **Crystal system identification**: 7 crystal systems
    3. **Wyckoff positions**: Site symmetry and equivalent atoms
    4. **Cell transformations**: Primitive and conventional
    5. **Symmetry operations**: Full list of rotations and translations

    ### Key Functions

    ```python
    from ferrox import symmetry

    # Space group detection
    _sg_num = symmetry.get_spacegroup_number(struct, symprec=0.01)
    _sg_sym = symmetry.get_spacegroup_symbol(struct, symprec=0.01)

    # Crystal system
    _crystal = symmetry.get_crystal_system(struct, symprec=0.01)

    # Wyckoff positions
    _wyckoff = symmetry.get_wyckoff_letters(struct, symprec=0.01)
    equiv = symmetry.get_equivalent_sites(struct, symprec=0.01)

    # Cell transformations
    primitive = symmetry.get_primitive(struct, symprec=0.01)
    conventional = symmetry.get_conventional(struct, symprec=0.01)

    # Symmetry operations
    ops = symmetry.get_symmetry_operations(struct, symprec=0.01)

    # Full dataset
    dataset = symmetry.get_symmetry_dataset(struct, symprec=0.01)

    # Pearson symbol
    pearson = symmetry.get_pearson_symbol(struct, symprec=0.01)
    ```

    ### Tolerance Guidelines

    | Precision | symprec | Use Case |
    |-----------|---------|----------|
    | High | 0.001 Å | DFT-relaxed structures |
    | Standard | 0.01 Å | Most applications |
    | Loose | 0.1 Å | Experimental XRD data |

    ### Use Cases

    - **Structure validation**: Verify expected symmetry
    - **Database organization**: Group by space group
    - **Property prediction**: Symmetry-constrained properties
    - **Phase identification**: Match to known structure types
    """)


if __name__ == "__main__":
    app.run()
