"""Ordering Disordered Structures with Ferrox.

Demonstrates enumeration of ordered configurations from disordered structures,
with Ewald energy ranking and structure deduplication.

**Who is this for?** Alloy researchers, high-entropy alloy (HEA) specialists,
and DFT practitioners who need ordered inputs from experimental solid solutions.

Run with: marimo edit 02_ordering_disordered.py --no-sandbox
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
    from ferrox import structure
    from pymatgen.core import Lattice, Structure
    from pymatgen.transformations.standard_transformations import (
        OrderDisorderedStructureTransformation,
    )

    return (
        Lattice,
        OrderDisorderedStructureTransformation,
        Structure,
        ferrox,
        mo,
        pmv,
        structure,
        time,
        mo.md("""
        # Ordering Disordered Structures

        This notebook demonstrates ferrox's enumeration of ordered configurations
        from disordered (partially occupied) structures. This is essential for:

        - High-entropy alloy (HEA) modeling
        - Solid solution phase diagram calculations
        - DFT calculations (require ordered structures)

        **Key ferrox functions:**
        - `structure.order_disordered()` - Generate ordered structures
        - `structure.enumerate_derivatives()` - Enumerate derivative structures
        - `structure.ewald_energy()` - Rank by electrostatic energy
        """),
)


@app.cell
def _(Lattice, Structure, mo):
    """Create a disordered CuAu alloy structure."""

    # Create disordered CuAu (50% Cu, 50% Au on each FCC site)
    cuau_disordered = Structure(
        Lattice.cubic(3.8),  # FCC lattice parameter
        [
            {"Cu": 0.5, "Au": 0.5},
            {"Cu": 0.5, "Au": 0.5},
            {"Cu": 0.5, "Au": 0.5},
            {"Cu": 0.5, "Au": 0.5},
        ],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    return (cuau_disordered,
        mo.md(f"""
        ## Disordered CuAu Structure

        FCC structure with 50% Cu / 50% Au occupancy on each site:
        - **Lattice parameter**: 3.8 Å
        - **Number of sites**: {len(cuau_disordered)}
        - **Composition**: {cuau_disordered.composition}

        This represents a solid solution that needs ordering for DFT calculations.
        """),
)


@app.cell
def _(cuau_disordered, mo, pmv):
    """Visualize the disordered structure."""
    return mo.vstack(
        [
            mo.md("### Disordered Input Structure"),
            pmv.StructureWidget(structure=cuau_disordered, style="height: 250px;"),
        ]
    )


@app.cell
def _(mo):
    """Interactive ordering controls."""
    max_structs_slider = mo.ui.slider(10, 200, value=100, step=10, label="Max structures")
    return (max_structs_slider,)


@app.cell
def _(cuau_disordered, ferrox, max_structs_slider, mo, structure, time):
    """Enumerate ordered configurations using ferrox with interactive controls."""

    # Convert to ferrox dict
    disordered_dict = ferrox.io.from_pymatgen_structure(cuau_disordered)

    # Enumerate orderings with user-controlled limit
    _start = time.perf_counter()
    orderings = structure.order_disordered(
        disordered_dict, max_structures=max_structs_slider.value
    )
    ferrox_time = time.perf_counter() - _start

    return (
        ferrox_time,
        orderings,
        mo.vstack([
            mo.md("## Ferrox Ordering Enumeration"),
            max_structs_slider,
            mo.md(f"""
- **Number of orderings found**: {len(orderings)}
- **Enumeration time**: {ferrox_time:.3f}s

Increase max structures to explore more configurations. The enumeration
time scales with the number of symmetry-distinct orderings.
            """),
        ]),
    )


@app.cell
def _(mo):
    """Section header for sample ordered structures."""
    return (mo.md("### Sample Ordered Configurations"),)


@app.cell
def _(ferrox, mo, orderings, pmv):
    """Display grid of ordered structures."""
    _sample_orderings = orderings[:6]
    pmg_orderings = [ferrox.io.to_pymatgen_structure(ordering) for ordering in _sample_orderings]

    return (
        pmg_orderings,
        mo.hstack(
            [
                mo.vstack(
                    [
                        mo.md(f"**Config {idx + 1}**"),
                        pmv.StructureWidget(
                            structure=struct, style="width: 180px; height: 180px;"
                        ),
                    ]
                )
                for idx, struct in enumerate(pmg_orderings)
            ],
            gap=2,
        ),
    )


@app.cell
def _(
    OrderDisorderedStructureTransformation,
    cuau_disordered,
    ferrox_time,
    mo,
    orderings,
    time,
):
    """Benchmark against pymatgen."""

    # Pymatgen ordering
    pmg_transform = OrderDisorderedStructureTransformation(algo=2)

    _start = time.perf_counter()
    try:
        pmg_orderings_list = pmg_transform.apply_transformation(
            cuau_disordered, return_ranked_list=100
        )
        pmg_time = time.perf_counter() - _start
        n_pmg = len(pmg_orderings_list)
    except (ValueError, RuntimeError, AttributeError) as exc:
        pmg_time = time.perf_counter() - _start
        n_pmg = f"Error: {exc}"

    speedup = pmg_time / ferrox_time if ferrox_time > 0 else float("inf")

    return mo.md(f"""
    ## Performance Benchmark

    | Method | Time | Structures Found |
    |--------|------|------------------|
    | **Ferrox** | {ferrox_time:.3f}s | {len(orderings)} |
    | **Pymatgen** | {pmg_time:.3f}s | {n_pmg} |
    | **Speedup** | **{speedup:.1f}x** | - |

    Single run on a 4-atom structure — results vary. Speedup is more pronounced
    for larger unit cells with more combinatorial possibilities.
    """)


@app.cell
def _(Lattice, Structure, ferrox, mo, structure, time):
    """Edge case: High-entropy alloy with 5 elements."""

    # Create 5-element HEA on BCC lattice
    hea_disordered = Structure(
        Lattice.cubic(2.87),  # BCC lattice
        [
            {"Fe": 0.2, "Co": 0.2, "Ni": 0.2, "Cr": 0.2, "Mn": 0.2},
            {"Fe": 0.2, "Co": 0.2, "Ni": 0.2, "Cr": 0.2, "Mn": 0.2},
        ],
        [[0, 0, 0], [0.5, 0.5, 0.5]],
    )

    hea_dict = ferrox.io.from_pymatgen_structure(hea_disordered)

    _start = time.perf_counter()
    hea_orderings = structure.order_disordered(hea_dict, max_structures=50)
    hea_time = time.perf_counter() - _start

    return (hea_disordered,
        mo.md(f"""
        ## Edge Case: High-Entropy Alloy (5 Elements)

        Testing with Cantor alloy composition (Fe-Co-Ni-Cr-Mn):

        - **Elements**: Fe, Co, Ni, Cr, Mn (20% each)
        - **Structure type**: BCC
        - **Orderings found**: {len(hea_orderings)}
        - **Enumeration time**: {hea_time:.3f}s

        High-entropy alloys have combinatorially many possible orderings.
        """),
)


@app.cell
def _(hea_disordered, mo, pmv):
    """Visualize HEA structure."""
    return mo.vstack(
        [
            mo.md("### High-Entropy Alloy Structure"),
            pmv.StructureWidget(structure=hea_disordered, style="height: 250px;"),
        ]
    )


@app.cell
def _(Lattice, Structure, ferrox, mo, structure, time):
    """Edge case: Very low partial occupancies."""

    # Structure with 10% vacancy on one site
    low_occ = Structure(
        Lattice.cubic(4.0),
        [
            "Ni",
            {"Ni": 0.9},  # 10% vacancy
            "Ni",
            "Ni",
        ],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    low_occ_dict = ferrox.io.from_pymatgen_structure(low_occ)

    _start = time.perf_counter()
    low_occ_orderings = structure.order_disordered(low_occ_dict, max_structures=20)
    low_occ_time = time.perf_counter() - _start

    return mo.md(f"""
    ## Edge Case: Low Partial Occupancy

    Testing structure with 90% Ni / 10% vacancy:

    - **Orderings found**: {len(low_occ_orderings)}
    - **Time**: {low_occ_time:.3f}s

    Low occupancies can lead to many possible vacancy configurations.
    """)


@app.cell
def _(Lattice, Structure, ferrox, mo, structure):
    """Rank orderings by Ewald energy."""

    # Create ionic disordered structure (Na-K mixed on rock salt)
    ionic_disordered = Structure(
        Lattice.cubic(5.6),
        [
            {"Na": 0.5, "K": 0.5},
            {"Na": 0.5, "K": 0.5},
            {"Na": 0.5, "K": 0.5},
            {"Na": 0.5, "K": 0.5},
            "Cl",
            "Cl",
            "Cl",
            "Cl",
        ],
        [
            [0, 0, 0],
            [0.5, 0.5, 0],
            [0.5, 0, 0.5],
            [0, 0.5, 0.5],
            [0.5, 0, 0],
            [0, 0.5, 0],
            [0, 0, 0.5],
            [0.5, 0.5, 0.5],
        ],
    )

    ionic_dict = ferrox.io.from_pymatgen_structure(ionic_disordered)

    # Enumerate orderings
    ionic_orderings = structure.order_disordered(ionic_dict, max_structures=20)

    # Calculate Ewald energies for each ordering
    ewald_results = []
    for idx, ordering in enumerate(ionic_orderings[:10]):
        # Add oxidation states for Ewald calculation
        ordering_with_oxi = ferrox.oxidation.add_oxidation_state_by_element(
            ordering, {"Na": 1, "K": 1, "Cl": -1}
        )
        try:
            energy = structure.ewald_energy(ordering_with_oxi)
            ewald_results.append({"idx": idx, "energy": energy})
        except (ValueError, RuntimeError):
            ewald_results.append({"idx": idx, "energy": None})

    # Sort by energy
    valid_results = [result for result in ewald_results if result["energy"] is not None]
    valid_results.sort(key=lambda result: result["energy"])

    energy_table = "\n".join(
        f"| {result['idx'] + 1} | {result['energy']:.4f} |" for result in valid_results[:5]
    )

    return mo.md(f"""
    ## Ewald Energy Ranking

    For ionic compounds, orderings can be ranked by electrostatic energy:

    | Configuration | Ewald Energy (eV) |
    |---------------|-------------------|
    {energy_table}

    Lower Ewald energy indicates more favorable electrostatic arrangement.
    """)


@app.cell
def _(Lattice, Structure, ferrox, mo, structure, time):
    """Derivative structure enumeration."""

    # Simple parent structure for derivative enumeration
    parent = Structure(
        Lattice.cubic(3.0),
        ["Fe"],
        [[0, 0, 0]],
    )

    parent_dict = ferrox.io.from_pymatgen_structure(parent)

    _start = time.perf_counter()
    derivatives = structure.enumerate_derivatives(parent_dict, min_size=1, max_size=4)
    deriv_time = time.perf_counter() - _start

    return mo.md(f"""
    ## Derivative Structure Enumeration

    Enumerate all derivative structures within a size range:

    - **Parent structure**: Simple BCC Fe
    - **Size range**: 1-4 atoms
    - **Derivatives found**: {len(derivatives)}
    - **Time**: {deriv_time:.3f}s

    This is useful for exploring possible supercell configurations.
    """)


@app.cell
def _(Lattice, Structure, ferrox, mo, structure, time):
    """Stress test: Large supercell enumeration."""

    # Larger disordered structure
    large_disordered = Structure(
        Lattice.cubic(5.0),
        [{"Cu": 0.5, "Zn": 0.5}] * 8,  # 8-atom supercell
        [
            [0.00, 0.00, 0.00],
            [0.50, 0.50, 0.00],
            [0.50, 0.00, 0.50],
            [0.00, 0.50, 0.50],
            [0.25, 0.25, 0.25],
            [0.75, 0.75, 0.25],
            [0.75, 0.25, 0.75],
            [0.25, 0.75, 0.75],
        ],
    )

    large_dict = ferrox.io.from_pymatgen_structure(large_disordered)

    _start = time.perf_counter()
    large_orderings = structure.order_disordered(large_dict, max_structures=200)
    large_time = time.perf_counter() - _start

    return mo.md(f"""
    ## Stress Test: Large Supercell

    Testing 8-atom disordered supercell (Cu-Zn brass):

    - **Number of sites**: 8
    - **Orderings found**: {len(large_orderings)}
    - **Enumeration time**: {large_time:.3f}s

    The number of possible orderings grows combinatorially with size.
    """)


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return (
        mo.md("""
    ## Summary

    Ferrox's ordering enumeration provides:

    1. **Fast enumeration** of symmetry-distinct orderings
    2. **Ewald energy ranking** for ionic compounds
    3. **Derivative structure enumeration** for supercell exploration
    4. **Handles edge cases**: HEAs, low occupancies, vacancies

    ### Key Functions

    ```python
    from ferrox import structure, oxidation

    # Enumerate ordered configurations
    orderings = structure.order_disordered(struct, max_structures=100)

    # Enumerate derivative structures
    derivatives = structure.enumerate_derivatives(struct, min_size=1, max_size=4)

    # Add oxidation states and calculate Ewald energy
    struct_oxi = ferrox.oxidation.add_oxidation_state_by_element(struct, {"Na": 1, "Cl": -1})
    energy = structure.ewald_energy(struct_oxi)
    ```

    ### Use Cases

    - **DFT calculations**: Generate ordered input from experimental solid solutions
    - **Phase diagrams**: Enumerate configurations for cluster expansion
    - **High-entropy alloys**: Explore possible atomic arrangements
    - **Defect chemistry**: Generate vacancy/substitution configurations
    """),
    )


if __name__ == "__main__":
    app.run()
