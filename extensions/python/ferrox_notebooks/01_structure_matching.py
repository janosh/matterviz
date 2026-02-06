"""Structure Matching at Scale with Ferrox.

Demonstrates fast batch structure deduplication - a classic O(n²) problem
that ferrox handles efficiently with parallel processing.

**Who is this for?** Database curators cleaning duplicate entries, ML researchers
building training sets, anyone comparing computed vs experimental structures.

Run with: marimo edit 01_structure_matching.py --no-sandbox
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
    import json
    import time

    import ferrox
    import marimo as mo
    import numpy as np
    import pymatviz as pmv
    from pymatgen.analysis.structure_matcher import StructureMatcher as PMGMatcher
    from pymatgen.core import Lattice, Structure

    def to_ferrox_json(struct: Structure) -> str:
        """Convert pymatgen Structure to JSON string for ferrox."""
        return json.dumps(struct.as_dict())

    return (
        Lattice,
        PMGMatcher,
        Structure,
        ferrox,
        mo,
        np,
        pmv,
        time,
        to_ferrox_json,
        mo.md("""
    # Structure Matching at Scale

    This notebook demonstrates ferrox's fast structure matching capabilities.
    Structure matching/deduplication is a classic O(n²) problem that becomes
    expensive for large datasets. Ferrox uses parallel Rayon processing to
    dramatically speed this up.

    **Key ferrox functions:**
    - `StructureMatcher.fit()` - Check if two structures match
    - `StructureMatcher.group()` - Group similar structures
    - `StructureMatcher.deduplicate()` - Remove duplicates
    """),
    )


@app.cell
def _(Lattice, Structure, np):
    """Generate test structures with intentional duplicates for realistic benchmarking."""

    # Element pools for structural diversity
    _METALS = ["Li", "Na", "Mg", "Ca", "Fe", "Co", "Ni", "Cu", "Zn", "Al", "Ti", "Cr"]
    _NONMETALS = ["O", "S", "N", "F", "Cl"]

    def create_test_structures(
        n_structures: int,
        n_unique: int = 30,
        min_atoms: int = 20,
        max_atoms: int = 60,
        seed: int = 42,
    ) -> list[Structure]:
        """Generate structures with intentional duplicates for realistic benchmarking.

        Creates n_unique base structures, then generates n_structures total as
        perturbations (small lattice scaling + coordinate noise). This ensures
        we have real duplicate groups to verify pymatgen/ferrox agreement.

        Args:
            n_structures: Total number of structures to generate.
            n_unique: Number of unique base structures (= expected number of groups).
            min_atoms: Minimum atoms per structure.
            max_atoms: Maximum atoms per structure.
            seed: Random seed for reproducibility.
        """
        _rng = np.random.default_rng(seed=seed)

        # Step 1: Create n_unique diverse base structures
        _bases: list[Structure] = []
        for _idx in range(n_unique):
            _a = _rng.uniform(4.0, 12.0)
            _b = _rng.uniform(4.0, 12.0)
            _c = _rng.uniform(4.0, 12.0)
            _alpha = _rng.uniform(70.0, 110.0)
            _beta = _rng.uniform(70.0, 110.0)
            _gamma = _rng.uniform(70.0, 110.0)
            _lat = Lattice.from_parameters(_a, _b, _c, _alpha, _beta, _gamma)

            _n_atoms = _rng.integers(min_atoms, max_atoms + 1)
            _n_metals = _rng.integers(1, _n_atoms)
            _n_nonmetals = _n_atoms - _n_metals

            _species = list(_rng.choice(_METALS, size=_n_metals))
            if _n_nonmetals > 0:
                _species.extend(_rng.choice(_NONMETALS, size=_n_nonmetals))

            _coords = _rng.random((_n_atoms, 3))

            try:
                _bases.append(Structure(_lat, _species, _coords))
            except ValueError:
                continue

        if not _bases:
            raise ValueError(
                f"Failed to create any base structures from {n_unique} attempts. "
                "Try adjusting min_atoms/max_atoms or seed."
            )

        # Step 2: Generate n_structures as perturbations of random bases
        _structures: list[Structure] = []
        for _idx in range(n_structures):
            _base = _bases[_rng.integers(0, len(_bases))]
            # Small perturbations that should still match within tolerances
            _new_coords = np.array([site.frac_coords for site in _base])
            _new_coords += _rng.uniform(-0.02, 0.02, size=_new_coords.shape)
            _new_coords = _new_coords % 1.0
            _scale = _rng.uniform(0.99, 1.01)  # ±1% lattice scaling
            _new_lat = Lattice(_base.lattice.matrix * _scale)
            try:
                _structures.append(
                    Structure(_new_lat, [site.species_string for site in _base], _new_coords)
                )
            except ValueError:
                continue

        return _structures

    # Export the function - batches will be created in cells that need them
    # This avoids serializing 750 Structure objects as cell output
    return (create_test_structures,)


@app.cell
def _(create_test_structures, mo, pmv):
    """Show sample structures in a grid."""
    _sample = create_test_structures(4, n_unique=4, min_atoms=10, max_atoms=30, seed=1)
    _grid = mo.hstack(
        [
            pmv.StructureWidget(structure=struct, style="width: 200px; height: 200px;")
            for struct in _sample
        ],
        gap=2,
    )
    return (mo.vstack([mo.md("## Sample Structures from Test Set"), _grid]),)


@app.cell
def _(mo):
    """Interactive tolerance controls."""
    latt_tol_slider = mo.ui.slider(0.05, 0.5, value=0.2, step=0.05, label="Lattice tolerance")
    site_tol_slider = mo.ui.slider(0.1, 0.6, value=0.3, step=0.05, label="Site tolerance")
    angle_tol_slider = mo.ui.slider(1.0, 15.0, value=5.0, step=1.0, label="Angle tolerance (°)")
    primitive_cell_switch = mo.ui.switch(value=False, label="Use primitive cell")

    return latt_tol_slider, site_tol_slider, angle_tol_slider, primitive_cell_switch


@app.cell
def _(
    angle_tol_slider,
    ferrox,
    latt_tol_slider,
    mo,
    primitive_cell_switch,
    site_tol_slider,
):
    """Basic structure matching demo with interactive controls."""

    matcher = ferrox.structure.StructureMatcher(
        latt_len_tol=latt_tol_slider.value,
        site_pos_tol=site_tol_slider.value,
        angle_tol=angle_tol_slider.value,
        primitive_cell=primitive_cell_switch.value,
    )

    controls = mo.hstack(
        [latt_tol_slider, site_tol_slider, angle_tol_slider, primitive_cell_switch],
        gap=2,
    )

    return (
        matcher,
        mo.vstack([
            mo.md("## Structure Matcher Configuration"),
            controls,
            mo.md(f"""
Ferrox `StructureMatcher` with **interactive** tolerances:
- **Lattice length tolerance**: {matcher.latt_len_tol}
- **Site position tolerance**: {matcher.site_pos_tol}
- **Angle tolerance**: {matcher.angle_tol}°
- **Primitive cell**: {matcher.primitive_cell}

Drag the sliders above to adjust tolerances and see how matching results change.
            """),
        ]),
    )


@app.cell
def _(PMGMatcher, create_test_structures, matcher, mo, time, to_ferrox_json):
    """Benchmark: Structure grouping."""

    def run_pymatgen_grouping(structures):
        """Group structures using pymatgen."""
        _pmg_matcher = PMGMatcher(ltol=0.2, stol=0.3, angle_tol=5.0)
        return _pmg_matcher.group_structures(structures)

    # Create batches with intentional duplicates to verify agreement
    # n_unique = expected number of groups; rest are perturbations
    _small_batch = create_test_structures(100, n_unique=25, seed=42)
    _medium_batch = create_test_structures(300, n_unique=50, seed=42)
    _large_batch = create_test_structures(500, n_unique=75, seed=42)

    bench_results = []
    for _batch_name, _batch in [
        ("100 structures", _small_batch),
        ("300 structures", _medium_batch),
        ("500 structures", _large_batch),
    ]:
        # Pre-convert to JSON (not included in benchmark - this is I/O overhead)
        _struct_jsons = [to_ferrox_json(struct) for struct in _batch]

        # Ferrox benchmark - pure matching time
        _start = time.perf_counter()
        _ferrox_groups = matcher.group_structures(_struct_jsons)
        _ferrox_time = time.perf_counter() - _start

        # Pymatgen benchmark
        _start = time.perf_counter()
        _pmg_groups = run_pymatgen_grouping(_batch)
        _pmg_time = time.perf_counter() - _start

        _speedup = _pmg_time / _ferrox_time if _ferrox_time > 0 else float("inf")
        bench_results.append(
            {
                "batch": _batch_name,
                "ferrox_time": _ferrox_time,
                "pmg_time": _pmg_time,
                "speedup": _speedup,
                "n_groups_ferrox": len(_ferrox_groups),
                "n_groups_pmg": len(_pmg_groups),
            }
        )

    # Display results table
    _table_rows = "\n".join(
        f"| {result['batch']} | {result['ferrox_time']:.3f}s | {result['pmg_time']:.3f}s | "
        f"**{result['speedup']:.1f}x** | {result['n_groups_ferrox']} | {result['n_groups_pmg']} |"
        for result in bench_results
    )

    return mo.md(f"""
    ## Performance Benchmark: Structure Grouping

    | Batch Size | Ferrox Time | Pymatgen Time | Speedup | Ferrox Groups | Pymatgen Groups |
    |------------|-------------|---------------|---------|---------------|-----------------|
    {_table_rows}

    **Notes:**
    - Structures have 20-60 atoms each (avg ~40 atoms) for realistic materials
    - JSON conversion time is excluded from ferrox timing (adds ~1ms per structure in practice)
    - Single run per batch size — results vary between runs
    - Speedup tends to increase with batch size due to Rayon parallelism
    """)


@app.cell
def _(Lattice, Structure, matcher, mo, np, to_ferrox_json):
    """Edge case: Supercell vs primitive cell matching."""

    # Create primitive cell
    primitive = Structure(
        Lattice.cubic(2.87),  # BCC Fe
        ["Fe"],
        [[0, 0, 0]],
    )

    # Create 2x2x2 supercell with tiny distortion
    supercell = primitive.copy()
    supercell.make_supercell([2, 2, 2])
    _rng = np.random.default_rng(seed=123)
    for _idx in range(len(supercell)):
        supercell.translate_sites(
            [_idx], _rng.uniform(-0.01, 0.01, 3), frac_coords=True
        )

    # Convert to ferrox JSON and test
    _prim_json = to_ferrox_json(primitive)
    _super_json = to_ferrox_json(supercell)
    supercell_match_result = matcher.fit(_prim_json, _super_json)

    return (
        primitive,
        supercell,
        mo.md(f"""
    ## Edge Case: Supercell vs Primitive Cell

    Testing if the matcher correctly identifies supercell relationships:

    - **Primitive cell**: 1 atom (BCC Fe, a = 2.87 Å)
    - **Supercell**: 8 atoms (2×2×2 with tiny distortions)
    - **Match result**: {supercell_match_result}

    The matcher uses primitive cell reduction to handle this case.
    """),
    )


@app.cell
def _(mo, pmv, primitive, supercell):
    """Visualize primitive vs supercell."""
    return mo.hstack(
        [
            mo.vstack(
                [
                    mo.md("**Primitive Cell (1 atom)**"),
                    pmv.StructureWidget(structure=primitive, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**Supercell (8 atoms)**"),
                    pmv.StructureWidget(structure=supercell, style="height: 250px;"),
                ]
            ),
        ],
        gap=4,
    )


@app.cell
def _(mo):
    """Interactive distortion control."""
    distortion_slider = mo.ui.slider(
        0.001, 0.5, value=0.1, step=0.01, label="Distortion magnitude"
    )
    return (distortion_slider,)


@app.cell
def _(Lattice, Structure, distortion_slider, matcher, mo, np, pmv, to_ferrox_json):
    """Edge case: Interactive distortion sensitivity test."""

    base_struct = Structure(
        Lattice.cubic(4.0),
        ["Ni", "Ni", "Ni", "Ni"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    # Apply user-controlled distortion
    _rng = np.random.default_rng(seed=456)
    distorted_struct = base_struct.copy()
    for _idx in range(len(distorted_struct)):
        distorted_struct.translate_sites(
            [_idx],
            _rng.uniform(-distortion_slider.value, distortion_slider.value, 3),
            frac_coords=True,
        )

    _base_json = to_ferrox_json(base_struct)
    _distorted_json = to_ferrox_json(distorted_struct)
    match_result = matcher.fit(_base_json, _distorted_json)

    # Visual comparison
    structures_viz = mo.hstack(
        [
            mo.vstack([
                mo.md("**Original**"),
                pmv.StructureWidget(structure=base_struct, style="height: 200px;"),
            ]),
            mo.vstack([
                mo.md("**Distorted**"),
                pmv.StructureWidget(structure=distorted_struct, style="height: 200px;"),
            ]),
        ],
        gap=2,
    )

    return mo.vstack([
        mo.md("## Edge Case: Interactive Distortion Sensitivity"),
        distortion_slider,
        mo.md(f"""
**Distortion**: ±{distortion_slider.value:.3f} fractional coords
**Match result**: {"✅ Match" if match_result else "❌ No match"}

Increase distortion to see when structures stop matching. The threshold
depends on `site_pos_tol` (currently {matcher.site_pos_tol}).
        """),
        structures_viz,
    ])


@app.cell
def _(Lattice, Structure, matcher, mo, to_ferrox_json):
    """Edge case: Different space groups, same composition."""

    # FCC structure
    fcc_cu = Structure(
        Lattice.cubic(3.6),
        ["Cu", "Cu", "Cu", "Cu"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    # BCC structure (same composition)
    bcc_cu = Structure(
        Lattice.cubic(2.87),
        ["Cu", "Cu"],
        [[0, 0, 0], [0.5, 0.5, 0.5]],
    )

    # HCP structure (same composition)
    hcp_cu = Structure(
        Lattice.hexagonal(2.55, 4.14),
        ["Cu", "Cu"],
        [[1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]],
    )

    # Convert and test
    _fcc_json = to_ferrox_json(fcc_cu)
    _bcc_json = to_ferrox_json(bcc_cu)
    _hcp_json = to_ferrox_json(hcp_cu)

    fcc_bcc_match = matcher.fit(_fcc_json, _bcc_json)
    fcc_hcp_match = matcher.fit(_fcc_json, _hcp_json)
    bcc_hcp_match = matcher.fit(_bcc_json, _hcp_json)

    return (
        bcc_cu,
        fcc_cu,
        hcp_cu,
        mo.md(f"""
    ## Edge Case: Different Space Groups, Same Composition

    Testing that structures with same composition but different crystal structures
    are correctly identified as non-matching:

    | Comparison | Matches? |
    |------------|----------|
    | FCC vs BCC | {fcc_bcc_match} |
    | FCC vs HCP | {fcc_hcp_match} |
    | BCC vs HCP | {bcc_hcp_match} |

    All should be `False` - same composition doesn't imply structural similarity.
    """),
    )


@app.cell
def _(bcc_cu, fcc_cu, hcp_cu, mo, pmv):
    """Visualize different crystal structures."""
    return mo.hstack(
        [
            mo.vstack(
                [
                    mo.md("**FCC**"),
                    pmv.StructureWidget(structure=fcc_cu, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**BCC**"),
                    pmv.StructureWidget(structure=bcc_cu, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**HCP**"),
                    pmv.StructureWidget(structure=hcp_cu, style="height: 250px;"),
                ]
            ),
        ],
        gap=4,
    )


@app.cell
def _(create_test_structures, matcher, mo, to_ferrox_json):
    """Demonstrate deduplication."""

    # 50 structures from 15 unique bases = ~15 groups with ~3-4 duplicates each
    _small_batch = create_test_structures(
        50, n_unique=15, min_atoms=10, max_atoms=30, seed=1
    )

    # Convert batch to JSON
    _batch_jsons = [to_ferrox_json(struct) for struct in _small_batch]

    # Get unique indices (first structure from each group)
    _groups = matcher.group_structures(_batch_jsons)
    unique_indices = [group[0] for group in _groups]

    return (
        unique_indices,
        mo.md(f"""
    ## Structure Deduplication

    From **{len(_small_batch)}** input structures with **15** unique bases:
    - **Unique structures found**: {len(unique_indices)}
    - **Duplicates removed**: {len(_small_batch) - len(unique_indices)}
    """),
    )


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return mo.md("""
    ## Summary

    Ferrox's `StructureMatcher` provides:

    1. **Significant speedup** over pymatgen for batch operations (see benchmark table above)
    2. **Parallel processing** via Rayon for O(n²) matching problems
    3. **Comparable group assignments** to pymatgen (verify agreement on your dataset)
    4. **Edge case handling** for supercells, distortions, and different space groups

    ### Key Functions

    ```python
    import json
    import ferrox

    matcher = ferrox.structure.StructureMatcher(
        latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0
    )

    # Convert pymatgen Structure to JSON for ferrox
    struct_json = json.dumps(struct.as_dict())

    # Check if two structures match
    matches = matcher.fit(struct1_json, struct2_json)

    # Group similar structures (parallel)
    groups = matcher.group_structures(list_of_json_strings)

    # Get unique structure indices (first from each group)
    unique_idx = [g[0] for g in groups]
    ```
    """)


if __name__ == "__main__":
    app.run()
