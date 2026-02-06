"""Elastic Properties Calculator with Ferrox.

Demonstrates elastic tensor calculation, strain generation,
and derived mechanical properties.

**Who is this for?** Mechanical engineers predicting material stiffness,
aerospace researchers screening structural materials, and anyone calculating
bulk/shear moduli from DFT stress-strain data.

Run with: marimo edit 09_elastic_properties.py --no-sandbox
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
    from ferrox import elastic, structure
    from pymatgen.core import Lattice, Structure

    return (
        Lattice,
        Structure,
        elastic,
        ferrox,
        mo,
        np,
        pmv,
        structure,
        time,
        mo.md("""
        # Elastic Properties Calculator

        This notebook demonstrates ferrox's elastic tensor calculation:

        - **Strain generation**: Independent strain matrices for elastic constants
        - **Strain application**: Apply deformations to structures
        - **Tensor calculation**: Elastic tensor from stress-strain data
        - **Derived properties**: Bulk modulus, shear modulus, Young's modulus

        **Key ferrox functions:**
        - `elastic.generate_strains()` - Generate strain matrices
        - `elastic.apply_strain()` - Apply strain to structure
        - `elastic.tensor_from_stresses()` - Calculate elastic tensor
        - `elastic.bulk_modulus()`, `shear_modulus()` - Derived properties
        """),
    )


@app.cell
def _(Lattice, Structure, mo, pmv):
    """Create test structure for elastic calculations."""

    # FCC Aluminum (well-studied elastic material)
    al = Structure(
        Lattice.cubic(4.05),
        ["Al", "Al", "Al", "Al"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    return (al,
        mo.md("""
        ## Test Structure: FCC Aluminum

        Aluminum is a well-studied material with known elastic constants:
        - **Lattice parameter**: 4.05 Å
        - **Space group**: Fm-3m (225)
        - **Crystal system**: Cubic

        **Experimental elastic constants (GPa)**:
        - C₁₁ = 108
        - C₁₂ = 62
        - C₄₄ = 28
        """),
)


@app.cell
def _(al, mo, pmv):
    """Visualize aluminum structure."""
    return mo.vstack(
        [
            mo.md("### FCC Aluminum Unit Cell"),
            pmv.StructureWidget(structure=al, style="height: 250px;"),
        ]
    )


@app.cell
def _(mo):
    """Interactive strain controls."""
    max_strain_slider = mo.ui.slider(
        0.005, 0.05, value=0.01, step=0.005, label="Max strain"
    )
    return (max_strain_slider,)


@app.cell
def _(elastic, max_strain_slider, mo):
    """Generate strain matrices with interactive control."""

    max_strain = max_strain_slider.value
    strains = elastic.generate_strains(max_strain=max_strain)

    return (
        max_strain,
        strains,
        mo.vstack([
            mo.md("## Strain Matrix Generation"),
            max_strain_slider,
            mo.md(f"""
Generated independent strain matrices for elastic tensor:

- **Maximum strain**: ±{max_strain * 100:.1f}%
- **Total strain matrices**: {len(strains)}

Drag the slider to adjust strain magnitude. Larger strains give better
signal-to-noise but risk leaving the linear elastic regime.
            """),
        ]),
    )


@app.cell
def _(mo, np, strains):
    """Display sample strain matrices."""

    # Show first few strains
    _strain_displays = []
    for _idx, _strain in enumerate(strains[:3]):
        _strain_arr = np.array(_strain)
        _strain_displays.append(f"**Strain {_idx + 1}**:\n```\n{_strain_arr}\n```")

    return mo.md(f"""
    ### Sample Strain Matrices

    {_strain_displays[0]}

    {_strain_displays[1]}

    {_strain_displays[2]}

    Each strain matrix defines a specific deformation type.
    """)


@app.cell
def _(Lattice, Structure, al, elastic, ferrox, mo, pmv, strains):
    """Apply strains to structure."""

    al_dict = ferrox.io.from_pymatgen_structure(al)

    # Apply first strain (tensile in x)
    _strain_xx = [[0.01, 0, 0], [0, 0, 0], [0, 0, 0]]
    _strained_xx = elastic.apply_strain(al_dict, _strain_xx)

    # Apply shear strain
    _strain_xy = [[0, 0.005, 0], [0.005, 0, 0], [0, 0, 0]]
    _strained_xy = elastic.apply_strain(al_dict, _strain_xy)

    # Convert strained structures to pymatgen for visualization
    strained_xx_pmg = ferrox.io.to_pymatgen_structure(_strained_xx)
    strained_xy_pmg = ferrox.io.to_pymatgen_structure(_strained_xy)

    return (
        al_dict,
        strained_xx_pmg,
        strained_xy_pmg,
        mo.md(f"""
        ## Strain Application

        Applied strains to create deformed structures:

        **Original lattice**:
        - a = {al.lattice.a:.4f} Å
        - b = {al.lattice.b:.4f} Å
        - c = {al.lattice.c:.4f} Å

        **After 1% tensile strain (xx)**:
        - a = {strained_xx_pmg.lattice.a:.4f} Å
        - b = {strained_xx_pmg.lattice.b:.4f} Å
        - c = {strained_xx_pmg.lattice.c:.4f} Å

        **After shear strain (xy)**:
        - α = {strained_xy_pmg.lattice.alpha:.2f}°
        - β = {strained_xy_pmg.lattice.beta:.2f}°
        - γ = {strained_xy_pmg.lattice.gamma:.2f}°
        """),
    )


@app.cell
def _(al, mo, pmv, strained_xx_pmg, strained_xy_pmg):
    """Visualize strained structures."""
    return mo.hstack(
        [
            mo.vstack(
                [
                    mo.md("**Original**"),
                    pmv.StructureWidget(structure=al, style="height: 250px;"),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**Tensile (1%)**"),
                    pmv.StructureWidget(
                        structure=strained_xx_pmg, style="height: 250px;"
                    ),
                ]
            ),
            mo.vstack(
                [
                    mo.md("**Shear**"),
                    pmv.StructureWidget(
                        structure=strained_xy_pmg, style="height: 250px;"
                    ),
                ]
            ),
        ],
        gap=2,
    )


@app.cell
def _(elastic, mo, np):
    """Demonstrate stress-strain relationship."""

    # Generate strain-stress data for demonstration
    # In practice, stresses come from DFT calculations

    # Synthetic stress data (approximately matching Al elastic constants)
    # C11 ~ 108 GPa, C12 ~ 62 GPa, C44 ~ 28 GPa
    n_points = 10
    strain_magnitudes = np.linspace(-0.01, 0.01, n_points)

    # Strain matrices (xx component only for simplicity)
    demo_strains = []
    demo_stresses = []

    _c11 = 108.0  # GPa
    _c12 = 62.0

    for _eps in strain_magnitudes:
        # Uniaxial strain in x
        _strain = [[_eps, 0, 0], [0, 0, 0], [0, 0, 0]]
        # Stress response (linear elasticity)
        _stress = [[_c11 * _eps, 0, 0], [0, _c12 * _eps, 0], [0, 0, _c12 * _eps]]
        demo_strains.append(_strain)
        demo_stresses.append(_stress)

    return mo.md(f"""
    ## Stress-Strain Relationship

    Linear elastic response: σ = C · ε

    For uniaxial strain εxx:
    - σxx = C₁₁ · εxx
    - σyy = σzz = C₁₂ · εxx

    Using **synthetic** data with known constants to demonstrate the API:
    - C₁₁ = {_c11} GPa, C₁₂ = {_c12} GPa

    In practice, stresses come from DFT calculations on strained structures.
    Generated {len(demo_strains)} strain-stress pairs.
    """)


@app.cell
def _(elastic, mo):
    """Demonstrate Voigt notation conversion."""

    # Example 3x3 stress tensor
    stress_3x3 = [[100.0, 10.0, 5.0], [10.0, 80.0, 3.0], [5.0, 3.0, 60.0]]

    # Convert to Voigt notation
    stress_voigt = elastic.stress_to_voigt(stress_3x3)

    # Example strain tensor
    strain_3x3 = [[0.01, 0.002, 0.001], [0.002, 0.008, 0.0005], [0.001, 0.0005, 0.005]]
    strain_voigt = elastic.strain_to_voigt(strain_3x3)

    return (
        strain_3x3,
        strain_voigt,
        stress_3x3,
        stress_voigt,
        mo.md(f"""
        ## Voigt Notation

        Elastic calculations use Voigt (engineering) notation:

        **3×3 tensor → 6-component vector**

        **Stress tensor**:
        ```
        [[σxx, σxy, σxz],     →  [σxx, σyy, σzz, σyz, σxz, σxy]
         [σxy, σyy, σyz],         (Voigt: 1, 2, 3, 4, 5, 6)
         [σxz, σyz, σzz]]
        ```

        **Example stress**: {stress_voigt}

        **Example strain**: {strain_voigt}

        Voigt notation simplifies the 6×6 elastic tensor representation.
        """),
    )


@app.cell
def _(elastic, mo, np):
    """Calculate elastic tensor from strain-stress data."""

    # Create more complete synthetic data for tensor calculation
    # For cubic symmetry: C11, C12, C44 are the only independent constants

    # Synthetic elastic tensor (approximate Al values in GPa)
    c11 = 108.0
    c12 = 62.0
    c44 = 28.0

    # Create synthetic strains and stresses
    _synthetic_strains = [
        # Tensile strains
        [[0.01, 0, 0], [0, 0, 0], [0, 0, 0]],  # e1
        [[0, 0, 0], [0, 0.01, 0], [0, 0, 0]],  # e2
        [[0, 0, 0], [0, 0, 0], [0, 0, 0.01]],  # e3
        # Shear strains
        [[0, 0, 0], [0, 0, 0.01], [0, 0.01, 0]],  # e4
        [[0, 0, 0.01], [0, 0, 0], [0.01, 0, 0]],  # e5
        [[0, 0.01, 0], [0.01, 0, 0], [0, 0, 0]],  # e6
    ]

    # Corresponding stresses (calculated from elastic constants)
    _synthetic_stresses = [
        [[c11 * 0.01, 0, 0], [0, c12 * 0.01, 0], [0, 0, c12 * 0.01]],  # s1
        [[c12 * 0.01, 0, 0], [0, c11 * 0.01, 0], [0, 0, c12 * 0.01]],  # s2
        [[c12 * 0.01, 0, 0], [0, c12 * 0.01, 0], [0, 0, c11 * 0.01]],  # s3
        [[0, 0, 0], [0, 0, c44 * 0.02], [0, c44 * 0.02, 0]],  # s4
        [[0, 0, c44 * 0.02], [0, 0, 0], [c44 * 0.02, 0, 0]],  # s5
        [[0, c44 * 0.02, 0], [c44 * 0.02, 0, 0], [0, 0, 0]],  # s6
    ]

    # Calculate elastic tensor
    calc_tensor = elastic.tensor_from_stresses(_synthetic_strains, _synthetic_stresses)

    return (
        c11,
        c12,
        c44,
        calc_tensor,
        mo.md(f"""
        ## Elastic Tensor Calculation

        Calculated 6×6 elastic tensor (Voigt notation) from strain-stress data:

        **Elastic tensor C (GPa)**:
        ```
        C11={calc_tensor[0][0]:.1f}  C12={calc_tensor[0][1]:.1f}  C13={calc_tensor[0][2]:.1f}
        C21={calc_tensor[1][0]:.1f}  C22={calc_tensor[1][1]:.1f}  C23={calc_tensor[1][2]:.1f}
        C31={calc_tensor[2][0]:.1f}  C32={calc_tensor[2][1]:.1f}  C33={calc_tensor[2][2]:.1f}
                            C44={calc_tensor[3][3]:.1f}
                                        C55={calc_tensor[4][4]:.1f}
                                                    C66={calc_tensor[5][5]:.1f}
        ```

        For cubic symmetry: C11 ≈ C22 ≈ C33, C12 ≈ C13 ≈ C23, C44 ≈ C55 ≈ C66
        """),
    )


@app.cell
def _(calc_tensor, elastic, mo):
    """Calculate derived elastic properties."""

    # Bulk modulus (Voigt average)
    bulk = elastic.bulk_modulus(calc_tensor)

    # Shear modulus (Voigt average)
    shear = elastic.shear_modulus(calc_tensor)

    # Young's modulus and Poisson's ratio from Voigt averages
    youngs = 9 * bulk * shear / (3 * bulk + shear)
    poisson = (3 * bulk - 2 * shear) / (2 * (3 * bulk + shear))

    return (
        bulk,
        poisson,
        shear,
        youngs,
        mo.md(f"""
        ## Derived Mechanical Properties

        From the elastic tensor:

        | Property | Value | Experimental Al |
        |----------|-------|-----------------|
        | Bulk modulus K | {bulk:.1f} GPa | ~77 GPa |
        | Shear modulus G | {shear:.1f} GPa | ~26 GPa |
        | Young's modulus E | {youngs:.1f} GPa | ~70 GPa |
        | Poisson's ratio ν | {poisson:.3f} | ~0.35 |

        **Voigt-Reuss-Hill averaging**:
        - Voigt: upper bound (uniform strain assumption)
        - Reuss: lower bound (uniform stress assumption)
        - Hill: arithmetic mean of Voigt and Reuss
        """),
    )


@app.cell
def _(Lattice, Structure, elastic, ferrox, mo):
    """Edge case: Highly anisotropic material."""

    # Graphite-like layered structure (highly anisotropic)
    graphite = Structure(
        Lattice.hexagonal(2.46, 6.71),
        ["C", "C", "C", "C"],
        [
            [0, 0, 0],
            [1 / 3, 2 / 3, 0],
            [0, 0, 0.5],
            [2 / 3, 1 / 3, 0.5],
        ],
    )

    _graphite_dict = ferrox.io.from_pymatgen_structure(graphite)

    # Apply in-plane vs out-of-plane strains
    _strain_inplane = [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0]]
    _strain_outplane = [[0, 0, 0], [0, 0, 0], [0, 0, 0.01]]

    _strained_in = elastic.apply_strain(_graphite_dict, _strain_inplane)
    _strained_out = elastic.apply_strain(_graphite_dict, _strain_outplane)

    return (graphite,
        mo.md("""
        ## Edge Case: Anisotropic Materials (Graphite)

        Layered materials have very different in-plane vs out-of-plane properties:

        **Graphite elastic constants (typical values)**:
        - C₁₁ ≈ 1060 GPa (in-plane, stiff)
        - C₃₃ ≈ 36 GPa (out-of-plane, soft)
        - C₄₄ ≈ 4 GPa (basal shear, very soft)

        Anisotropy ratio: C₁₁/C₃₃ ≈ 30!

        Ferrox handles anisotropic strain application correctly.
        """),
)


@app.cell
def _(graphite, mo, pmv):
    """Visualize graphite structure."""
    return mo.vstack(
        [
            mo.md("### Graphite (Layered Structure)"),
            pmv.StructureWidget(structure=graphite, style="height: 250px;"),
        ]
    )


@app.cell
def _(c11, c12, c44, mo, np):
    """Check mechanical stability."""

    # Born stability criteria for cubic crystals:
    # 1. C11 - C12 > 0
    # 2. C11 + 2*C12 > 0
    # 3. C44 > 0

    criterion1 = c11 - c12
    criterion2 = c11 + 2 * c12
    criterion3 = c44

    is_stable = criterion1 > 0 and criterion2 > 0 and criterion3 > 0

    return (
        criterion1,
        criterion2,
        criterion3,
        is_stable,
        mo.md(f"""
        ## Mechanical Stability (Born Criteria)

        For cubic crystals, mechanical stability requires:

        | Criterion | Value | Satisfied? |
        |-----------|-------|------------|
        | C₁₁ - C₁₂ > 0 | {criterion1:.1f} GPa | {"✓" if criterion1 > 0 else "✗"} |
        | C₁₁ + 2C₁₂ > 0 | {criterion2:.1f} GPa | {"✓" if criterion2 > 0 else "✗"} |
        | C₄₄ > 0 | {criterion3:.1f} GPa | {"✓" if criterion3 > 0 else "✗"} |

        **Stability**: {"Mechanically stable" if is_stable else "Unstable!"}

        Negative eigenvalues of the elastic tensor indicate instability.
        """),
    )


@app.cell
def _(c11, c12, c44, mo):
    """Calculate Zener anisotropy ratio."""

    # Zener ratio for cubic crystals
    zener = 2 * c44 / (c11 - c12)

    return (zener,
        mo.md(f"""
        ## Anisotropy Measures

        **Zener ratio** for cubic crystals:

        A = 2C₄₄ / (C₁₁ - C₁₂) = {zener:.3f}

        Interpretation:
        - A = 1: Isotropic (same stiffness in all directions)
        - A > 1: Stiffer in <110> than <100>
        - A < 1: Stiffer in <100> than <110>

        **Aluminum Zener ratio**: A ≈ 1.2 (slightly anisotropic)
        """),
)


@app.cell
def _(al, elastic, ferrox, mo, np, time):
    """Batch strain application for efficiency testing."""

    _al_dict = ferrox.io.from_pymatgen_structure(al)

    # Generate many strains
    _n_strains = 100
    _random_strains = []
    _np_rng = np.random.default_rng(seed=42)

    for _ in range(_n_strains):
        # Random symmetric strain matrix
        _strain = _np_rng.uniform(-0.01, 0.01, (3, 3))
        _strain = (_strain + _strain.T) / 2  # Symmetrize
        _random_strains.append(_strain.tolist())

    # Benchmark
    _start = time.perf_counter()
    for _strain in _random_strains:
        _ = elastic.apply_strain(_al_dict, _strain)
    _batch_time = time.perf_counter() - _start

    return mo.md(f"""
    ## Batch Strain Application

    Applied {_n_strains} random strains:

    - **Total time**: {_batch_time:.4f}s
    - **Time per strain**: {_batch_time / _n_strains * 1000:.2f} ms

    Note: strain application is inherently fast (just matrix math). The bottleneck
    in elastic constant workflows is the DFT/force calculation on each strained
    structure, which dominates by orders of magnitude.
    """)


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return mo.md("""
    ## Summary

    Ferrox provides comprehensive elastic tensor tools:

    1. **Strain generation**: Independent strain matrices for elastic constants
    2. **Strain application**: Deform structures with arbitrary strain tensors
    3. **Voigt conversion**: 3×3 tensor ↔ 6-component vector
    4. **Tensor calculation**: Elastic tensor from stress-strain data
    5. **Derived properties**: Bulk, shear, Young's moduli

    ### Key Functions

    ```python
    from ferrox import elastic

    # Generate strains for elastic constant calculation
    strains = elastic.generate_strains(max_strain=0.01)

    # Apply strain to structure (returns strained structure dict)
    strained_struct = elastic.apply_strain(structure_dict, strain_matrix)

    # Convert to Voigt notation
    stress_voigt = elastic.stress_to_voigt(stress_3x3)
    strain_voigt = elastic.strain_to_voigt(strain_3x3)

    # Calculate elastic tensor from DFT data
    C = elastic.tensor_from_stresses(strains, stresses)

    # Derived properties
    K = elastic.bulk_modulus(C)
    G = elastic.shear_modulus(C)
    ```

    ### Elastic Tensor Workflow

    1. **Generate strains** - Independent deformations
    2. **Create strained structures** - Apply to unit cell
    3. **Calculate stresses** - From DFT (external)
    4. **Fit elastic tensor** - Linear regression
    5. **Derive properties** - K, G, E, ν

    ### Use Cases

    - **Mechanical property prediction**: High-throughput screening
    - **Stability analysis**: Born criteria checking
    - **Anisotropy characterization**: Direction-dependent properties
    - **Phase transition detection**: Soft modes near instabilities
    """)


if __name__ == "__main__":
    app.run()
