"""Phase Classification with Steinhardt Q Parameters.

Demonstrates local structure classification using Steinhardt order parameters
to identify FCC, BCC, HCP, icosahedral, and liquid-like environments.

**Who is this for?** MD simulators studying melting/solidification, nanoparticle
researchers analyzing crystallinity, and glass scientists detecting local order.

Run with: marimo edit 06_phase_classification.py --no-sandbox
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
    from ferrox import coordination, order_params
    from pymatgen.core import Lattice, Structure

    return (
        Lattice,
        Structure,
        coordination,
        ferrox,
        mo,
        np,
        order_params,
        pmv,
        time,
        mo.md("""
        # Phase Classification with Steinhardt Q Parameters

        Steinhardt bond-orientational order parameters (Q4, Q6, etc.) quantify
        local atomic environments and can distinguish between:

        - **FCC**: Face-centered cubic (Q4 ≈ 0.19, Q6 ≈ 0.57)
        - **BCC**: Body-centered cubic (Q4 ≈ 0.04, Q6 ≈ 0.51)
        - **HCP**: Hexagonal close-packed (Q4 ≈ 0.10, Q6 ≈ 0.48)
        - **Icosahedral**: 5-fold symmetric (Q4 ≈ 0, Q6 ≈ 0.66)
        - **Liquid**: Disordered (low Q4, Q6)

        **Key ferrox functions:**
        - `order_params.compute_steinhardt_q()` - Calculate Q parameters
        - `order_params.classify_local_structure()` - Classify from Q4/Q6
        - `order_params.classify_all_atoms()` - Classify entire structure
        """),
)


@app.cell
def _(Lattice, Structure, mo):
    """Create reference structures for each phase."""

    # FCC (e.g., Cu, Al, Au)
    fcc = Structure(
        Lattice.cubic(3.6),
        ["Cu", "Cu", "Cu", "Cu"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )
    fcc.make_supercell([3, 3, 3])

    # BCC (e.g., Fe, W, Cr)
    bcc = Structure(
        Lattice.cubic(2.87),
        ["Fe", "Fe"],
        [[0, 0, 0], [0.5, 0.5, 0.5]],
    )
    bcc.make_supercell([4, 4, 4])

    # HCP (e.g., Mg, Ti, Zn)
    hcp = Structure(
        Lattice.hexagonal(2.95, 4.68),
        ["Mg", "Mg"],
        [[1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]],
    )
    hcp.make_supercell([4, 4, 3])

    return (
        bcc,
        fcc,
        hcp,
        mo.md(f"""
        ## Reference Crystal Structures

        Created supercells for phase classification:

        | Structure | Atoms | Lattice Type |
        |-----------|-------|--------------|
        | FCC Cu | {len(fcc)} | Cubic |
        | BCC Fe | {len(bcc)} | Cubic |
        | HCP Mg | {len(hcp)} | Hexagonal |

        These will serve as reference structures for Q parameter calculation.
        """),
    )


@app.cell
def _(bcc, fcc, hcp, mo, pmv):
    """Visualize reference structures."""
    return mo.hstack(
        [
            mo.vstack(
                [
                    mo.md("**FCC Cu**"),
                    pmv.StructureWidget(structure=fcc, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**BCC Fe**"),
                    pmv.StructureWidget(structure=bcc, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**HCP Mg**"),
                    pmv.StructureWidget(structure=hcp, style="height: 250px;"),
                ]
            ),
        ],
        gap=2,
    )


@app.cell
def _(mo):
    """Interactive order parameter controls."""
    cutoff_slider = mo.ui.slider(2.5, 6.0, value=4.0, step=0.25, label="Cutoff (Å)")
    q_degree_slider = mo.ui.slider(4, 12, value=6, step=2, label="Q degree")

    return cutoff_slider, q_degree_slider


@app.cell
def _(bcc, cutoff_slider, fcc, ferrox, hcp, mo, np, order_params, q_degree_slider, time):
    """Calculate Steinhardt Q parameters with interactive controls."""

    cutoff = cutoff_slider.value
    q_degree = q_degree_slider.value

    def calc_q_stats(struct, name):
        """Calculate Q4 and Q6 statistics for a structure."""
        struct_dict = ferrox.io.from_pymatgen_structure(struct)

        _start = time.perf_counter()
        q4_vals = order_params.compute_steinhardt_q(struct_dict, deg=4, cutoff=cutoff)
        q6_vals = order_params.compute_steinhardt_q(struct_dict, deg=6, cutoff=cutoff)
        calc_time = time.perf_counter() - _start

        return {
            "name": name,
            "n_atoms": len(struct),
            "q4_mean": np.mean(q4_vals),
            "q6_mean": np.mean(q6_vals),
            "q4_std": np.std(q4_vals),
            "q6_std": np.std(q6_vals),
            "time": calc_time,
        }

    fcc_stats = calc_q_stats(fcc, "FCC")
    bcc_stats = calc_q_stats(bcc, "BCC")
    hcp_stats = calc_q_stats(hcp, "HCP")

    stats_table = "\n".join(
        f"| {stat['name']} | {stat['n_atoms']} | {stat['q4_mean']:.4f} ± {stat['q4_std']:.4f} | "
        f"{stat['q6_mean']:.4f} ± {stat['q6_std']:.4f} | {stat['time']:.3f}s |"
        for stat in [fcc_stats, bcc_stats, hcp_stats]
    )

    controls = mo.hstack([cutoff_slider, q_degree_slider], gap=2)

    return (
        bcc_stats,
        calc_q_stats,
        cutoff,
        fcc_stats,
        hcp_stats,
        stats_table,
        mo.vstack([
            mo.md("## Steinhardt Q Parameters for Reference Phases"),
            controls,
            mo.md(f"""
Calculated Q4 and Q6 with cutoff = {cutoff} Å:

| Phase | Atoms | Q4 | Q6 | Time |
|-------|-------|-----|-----|------|
{stats_table}

**Reference values from literature**:
- FCC: Q4 ≈ 0.19, Q6 ≈ 0.57
- BCC: Q4 ≈ 0.04, Q6 ≈ 0.51
- HCP: Q4 ≈ 0.10, Q6 ≈ 0.48

Adjust cutoff to see how neighbor selection affects Q values.
            """),
        ]),
    )


@app.cell
def _(bcc, fcc, ferrox, hcp, mo, order_params, time):
    """Classify atoms in each structure."""

    cutoff_class = 4.0

    def classify_structure(struct, name):
        """Classify all atoms in a structure."""
        struct_dict = ferrox.io.from_pymatgen_structure(struct)

        _start = time.perf_counter()
        classifications = order_params.classify_all_atoms(
            struct_dict, cutoff=cutoff_class, tolerance=0.1
        )
        class_time = time.perf_counter() - _start

        # Count classifications
        counts = {}
        for label in classifications:
            counts[label] = counts.get(label, 0) + 1

        return {
            "name": name,
            "counts": counts,
            "time": class_time,
            "n_atoms": len(struct),
        }

    fcc_class = classify_structure(fcc, "FCC")
    bcc_class = classify_structure(bcc, "BCC")
    hcp_class = classify_structure(hcp, "HCP")

    return (
        bcc_class,
        classify_structure,
        cutoff_class,
        fcc_class,
        hcp_class,
        mo.md(f"""
        ## Automatic Phase Classification

        Using `classify_all_atoms()` with tolerance = 0.1:

        **FCC structure** ({fcc_class["n_atoms"]} atoms):
        - Classifications: {fcc_class["counts"]}
        - Time: {fcc_class["time"]:.3f}s

        **BCC structure** ({bcc_class["n_atoms"]} atoms):
        - Classifications: {bcc_class["counts"]}
        - Time: {bcc_class["time"]:.3f}s

        **HCP structure** ({hcp_class["n_atoms"]} atoms):
        - Classifications: {hcp_class["counts"]}
        - Time: {hcp_class["time"]:.3f}s

        Interior atoms are correctly classified; surface atoms may appear different.
        """),
)


@app.cell
def _(mo, order_params):
    """Demonstrate single point classification."""

    # Test classification from Q4/Q6 values
    test_cases = [
        (0.19, 0.57, "Expected: FCC"),
        (0.04, 0.51, "Expected: BCC"),
        (0.10, 0.48, "Expected: HCP"),
        (0.00, 0.66, "Expected: Icosahedral"),
        (0.05, 0.20, "Expected: Liquid"),
    ]

    results = []
    for q4, q6, expected in test_cases:
        classification = order_params.classify_local_structure(q4, q6, tolerance=0.1)
        results.append((q4, q6, expected, classification))

    class_table = "\n".join(
        f"| {q4:.2f} | {q6:.2f} | {expected} | **{label}** |"
        for q4, q6, expected, label in results
    )

    return (
        class_table,
        results,
        test_cases,
        mo.md(f"""
        ## Manual Classification from Q4/Q6

        Using `classify_local_structure()` with known Q values:

        | Q4 | Q6 | Expected | Result |
        |----|-----|----------|--------|
        {class_table}

        This allows classification based on pre-computed Q parameters.
        """),
    )


@app.cell
def _(Lattice, Structure, mo):
    """Edge case: Grain boundary with mixed phases."""

    # Create a structure with FCC and BCC regions (simplified)
    # In reality, this would be more complex

    # FCC region
    fcc_region = Structure(
        Lattice.cubic(3.6),
        ["Cu", "Cu", "Cu", "Cu"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )
    fcc_region.make_supercell([3, 3, 2])

    return (fcc_region,
        mo.md("""
        ## Edge Case: Phase Boundary Analysis

        For structures with multiple phases or grain boundaries,
        atom-by-atom classification reveals the local structure.

        A typical analysis workflow:
        1. Calculate Q4, Q6 for each atom
        2. Classify each atom based on Q values
        3. Identify phase boundaries from classification changes
        4. Visualize with atoms colored by phase
        """),
)


@app.cell
def _(Lattice, Structure, ferrox, mo, order_params):
    """Edge case: Nanoparticle with surface effects."""

    # Create a small nanoparticle-like cluster
    # FCC cluster with surface atoms

    # Start with FCC structure
    cluster = Structure(
        Lattice.cubic(4.0),
        ["Au", "Au", "Au", "Au"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )
    cluster.make_supercell([2, 2, 2])

    cluster_dict = ferrox.io.from_pymatgen_structure(cluster)

    # Calculate Q parameters
    q4_cluster = order_params.compute_steinhardt_q(cluster_dict, deg=4, cutoff=4.0)
    q6_cluster = order_params.compute_steinhardt_q(cluster_dict, deg=6, cutoff=4.0)

    # Classify all atoms
    classifications = order_params.classify_all_atoms(cluster_dict, cutoff=4.0)

    # Count classifications
    class_counts = {}
    for label in classifications:
        class_counts[label] = class_counts.get(label, 0) + 1

    return (
        class_counts,
        classifications,
        cluster,
        cluster_dict,
        q4_cluster,
        q6_cluster,
        mo.md(f"""
        ## Edge Case: Nanoparticle Surface Effects

        Small clusters have many surface atoms with incomplete coordination:

        **32-atom Au cluster**:
        - Classifications: {class_counts}

        **Q parameter statistics**:
        - Q4: {sum(q4_cluster) / len(q4_cluster):.4f} (range: {min(q4_cluster):.4f} - {max(q4_cluster):.4f})
        - Q6: {sum(q6_cluster) / len(q6_cluster):.4f} (range: {min(q6_cluster):.4f} - {max(q6_cluster):.4f})

        Surface atoms typically show lower/different Q values due to
        incomplete coordination shells.
        """),
)


@app.cell
def _(cluster, mo, pmv):
    """Visualize nanoparticle."""
    return mo.vstack(
        [
            mo.md("### Au Nanoparticle Cluster"),
            pmv.StructureWidget(structure=cluster, style="height: 250px;"),
        ]
    )


@app.cell
def _(Lattice, Structure, ferrox, mo, np, order_params, time):
    """Simulate liquid-like disorder."""

    # Create structure with random displacements (liquid-like)
    liquid = Structure(
        Lattice.cubic(6.0),
        ["Ar"] * 32,
        np.random.default_rng(42).random((32, 3)),  # Random positions
    )

    liquid_dict = ferrox.io.from_pymatgen_structure(liquid)

    _start = time.perf_counter()
    q4_liquid = order_params.compute_steinhardt_q(liquid_dict, deg=4, cutoff=4.0)
    q6_liquid = order_params.compute_steinhardt_q(liquid_dict, deg=6, cutoff=4.0)
    liquid_time = time.perf_counter() - _start

    _liquid_classifications = order_params.classify_all_atoms(liquid_dict, cutoff=4.0)
    _liquid_class_counts = {}
    for _cls in _liquid_classifications:
        _liquid_class_counts[_cls] = _liquid_class_counts.get(_cls, 0) + 1

    return (
        liquid,
        liquid_dict,
        liquid_time,
        q4_liquid,
        q6_liquid,
        mo.md(f"""
        ## Liquid-Like Disorder

        Random atomic positions simulate a liquid:

        **Q parameter statistics**:
        - Q4: {sum(q4_liquid) / len(q4_liquid):.4f} ± {np.std(q4_liquid):.4f}
        - Q6: {sum(q6_liquid) / len(q6_liquid):.4f} ± {np.std(q6_liquid):.4f}

        **Classifications**: {_liquid_class_counts}

        Liquids have low, random Q values compared to crystalline phases.
        """),
)


@app.cell
def _(liquid, mo, pmv):
    """Visualize liquid structure."""
    return mo.vstack(
        [
            mo.md("### Liquid-Like Disordered Structure"),
            pmv.StructureWidget(structure=liquid, style="height: 250px;"),
        ]
    )


@app.cell
def _(fcc, ferrox, mo, order_params, time):
    """Benchmark: Large-scale classification."""

    # Create large structures for benchmarking
    large_fcc = fcc.copy()
    large_fcc.make_supercell([2, 2, 2])

    large_dict = ferrox.io.from_pymatgen_structure(large_fcc)

    _start = time.perf_counter()
    q4_large = order_params.compute_steinhardt_q(large_dict, deg=4, cutoff=4.0)
    q6_large = order_params.compute_steinhardt_q(large_dict, deg=6, cutoff=4.0)
    large_time = time.perf_counter() - _start

    atoms_per_second = len(large_fcc) / large_time

    return (
        atoms_per_second,
        large_dict,
        large_fcc,
        large_time,
        q4_large,
        q6_large,
        mo.md(f"""
        ## Performance Benchmark

        Large-scale Q parameter calculation:

        - **Structure**: FCC Cu supercell
        - **Atoms**: {len(large_fcc)}
        - **Calculation time**: {large_time:.3f}s
        - **Speed**: {atoms_per_second:.0f} atoms/s

        Note: this notebook tests on perfect crystals where classification is trivial.
        The real value of Q parameters is for partially disordered systems (grain
        boundaries, nucleation, melting) where visual identification fails.
        """),
    )


@app.cell
def _(coordination, ferrox, large_fcc, mo):
    """Compare with Voronoi coordination."""

    _large_dict = ferrox.io.from_pymatgen_structure(large_fcc)

    # Get Voronoi coordination numbers
    cn_voronoi = coordination.get_cn_voronoi_all(_large_dict, min_solid_angle=0.1)

    # Statistics
    cn_mean = sum(cn_voronoi) / len(cn_voronoi)
    cn_min = min(cn_voronoi)
    cn_max = max(cn_voronoi)

    return (
        cn_max,
        cn_mean,
        cn_min,
        cn_voronoi,
        mo.md(f"""
        ## Voronoi Coordination Analysis

        Voronoi tessellation provides coordination numbers:

        **FCC structure** (expected CN = 12):
        - Mean CN: {cn_mean:.2f}
        - Range: {cn_min:.1f} - {cn_max:.1f}

        Voronoi CN complements Steinhardt Q for local structure analysis.
        """),
    )


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return mo.md("""
    ## Summary

    Ferrox provides powerful tools for local structure analysis:

    1. **Steinhardt Q parameters**: Rotationally invariant order parameters
    2. **Phase classification**: Automatic identification of FCC/BCC/HCP/etc.
    3. **Voronoi coordination**: Geometric coordination numbers
    4. **Batch computation**: Scales to thousands of atoms

    ### Key Functions

    ```python
    from ferrox import order_params, coordination

    # Calculate Steinhardt Q parameters
    q4 = order_params.compute_steinhardt_q(struct, deg=4, cutoff=4.0)
    q6 = order_params.compute_steinhardt_q(struct, deg=6, cutoff=4.0)

    # Classify single atom from Q values
    phase = order_params.classify_local_structure(q4_val, q6_val, tolerance=0.1)

    # Classify all atoms in structure
    classifications = order_params.classify_all_atoms(struct, cutoff=4.0)

    # Voronoi coordination numbers
    cn = coordination.get_cn_voronoi_all(struct, min_solid_angle=0.1)
    ```

    ### Reference Q Values

    | Phase | Q4 | Q6 |
    |-------|-----|-----|
    | FCC | 0.19 | 0.57 |
    | BCC | 0.04 | 0.51 |
    | HCP | 0.10 | 0.48 |
    | Icosahedral | 0.00 | 0.66 |
    | Liquid | ~0.05 | ~0.20 |

    ### Use Cases

    - **Phase identification**: Distinguish crystal structures
    - **Grain boundaries**: Identify interface regions
    - **Nucleation**: Track crystallization in MD
    - **Defect detection**: Find disordered regions
    """)


if __name__ == "__main__":
    app.run()
