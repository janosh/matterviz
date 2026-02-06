"""Defect Engineering Workshop with Ferrox.

Demonstrates comprehensive point defect generation including vacancies,
substitutions, interstitials, antisites, and defect perturbations.

**Who is this for?** Semiconductor physicists studying dopants, battery researchers
modeling ion migration, and anyone calculating defect formation energies.

Run with: marimo edit 04_defect_engineering.py --no-sandbox
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
    from ferrox import defects, structure
    from pymatgen.core import Lattice, Structure

    return (
        Lattice,
        Structure,
        defects,
        ferrox,
        mo,
        pmv,
        structure,
        time,
        mo.md("""
        # Defect Engineering Workshop

        This notebook demonstrates ferrox's comprehensive defect generation capabilities
        for materials modeling:

        - **Point defects**: Vacancies, substitutions, interstitials, antisites
        - **Defect finding**: Voronoi-based interstitial site detection
        - **Perturbations**: Bond distortions, rattling
        - **Supercell optimization**: Find optimal supercell for defect calculations

        **Key ferrox functions:**
        - `defects.create_vacancy()`, `create_substitution()`, `create_interstitial()`
        - `defects.generate_all()` - Generate all symmetry-distinct defects
        - `defects.find_voronoi_interstitials()` - Find interstitial sites
        - `defects.find_supercell()` - Optimal supercell for defect calculations
        """),
)


@app.cell
def _(Lattice, Structure, mo):
    """Create pristine MgO structure."""

    # Rock salt MgO
    mgo = Structure(
        Lattice.cubic(4.212),
        ["Mg", "Mg", "Mg", "Mg", "O", "O", "O", "O"],
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

    return (mgo,
        mo.md(f"""
        ## Pristine MgO Structure

        Rock salt MgO (a = 4.212 Å):
        - **Space group**: Fm-3m (225)
        - **Mg atoms**: 4
        - **O atoms**: 4
        - **Total**: {len(mgo)} atoms
        """),
)


@app.cell
def _(mgo, mo, pmv):
    """Visualize pristine structure."""
    return mo.vstack(
        [
            mo.md("### Pristine MgO Structure"),
            pmv.StructureWidget(structure=mgo, style="height: 250px;"),
        ]
    )


@app.cell
def _(mgo, mo):
    """Interactive vacancy site selection."""
    # Build site options with element labels
    site_options = {
        f"Site {idx}: {site.species_string} ({site.frac_coords[0]:.2f}, {site.frac_coords[1]:.2f}, {site.frac_coords[2]:.2f})": idx
        for idx, site in enumerate(mgo)
    }
    vacancy_site_select = mo.ui.dropdown(
        options=site_options,
        value=next(iter(site_options)),
        label="Vacancy site",
    )
    return (vacancy_site_select,)


@app.cell
def _(defects, ferrox, mgo, mo, vacancy_site_select):
    """Create vacancy defects with interactive site selection."""

    mgo_dict = ferrox.io.from_pymatgen_structure(mgo)
    selected_site = vacancy_site_select.value

    # Create vacancy at selected site
    selected_vacancy = defects.create_vacancy(mgo_dict, site_idx=selected_site)
    removed_species = mgo[selected_site].species_string

    # Also create reference vacancies for comparison
    mg_vacancy = defects.create_vacancy(mgo_dict, site_idx=0)
    o_vacancy = defects.create_vacancy(mgo_dict, site_idx=4)

    return (
        mg_vacancy,
        mgo_dict,
        o_vacancy,
        selected_vacancy,
        mo.vstack([
            mo.md("## Vacancy Defects"),
            vacancy_site_select,
            mo.md(f"""
Created vacancy by removing **{removed_species}** at site {selected_site}:

- **Vacancy type**: V_{removed_species}
- **Remaining atoms**: {len(selected_vacancy["structure"]["sites"])}
- **Original position**: {mgo[selected_site].frac_coords}

Select different sites to create Mg or O vacancies. Vacancies are the simplest
point defects and dominate diffusion in ionic crystals.
            """),
        ]),
    )


@app.cell
def _(ferrox, mg_vacancy, mo, o_vacancy, pmv):
    """Visualize vacancy structures."""
    mg_vac_struct = ferrox.io.to_pymatgen_structure(mg_vacancy["structure"])
    o_vac_struct = ferrox.io.to_pymatgen_structure(o_vacancy["structure"])

    return (
        mg_vac_struct,
        o_vac_struct,
        mo.hstack(
            [
                mo.vstack(
                    [
                        mo.md("**Mg Vacancy (V_Mg)**"),
                        pmv.StructureWidget(
                            structure=mg_vac_struct, style="height: 250px;"
                        ),
                    ]
                ),
                mo.vstack(
                    [
                        mo.md("**O Vacancy (V_O)**"),
                        pmv.StructureWidget(
                            structure=o_vac_struct, style="height: 250px;"
                        ),
                    ]
                ),
            ],
            gap=4,
        ),
    )


@app.cell
def _(defects, mgo_dict, mo):
    """Create substitutional defects."""

    # Substitute Mg with Ca
    ca_sub = defects.create_substitution(mgo_dict, site_idx=0, new_species="Ca")

    # Substitute O with S
    s_sub = defects.create_substitution(mgo_dict, site_idx=4, new_species="S")

    return (
        ca_sub,
        s_sub,
        mo.md("""
        ## Substitutional Defects

        Created substitutions by replacing atoms:

        **Ca substitution (Ca_Mg)**:
        - Replaced Mg at site 0 with Ca
        - Common dopant for MgO

        **S substitution (S_O)**:
        - Replaced O at site 4 with S
        - Changes local electronic structure
        """),
    )


@app.cell
def _(ca_sub, ferrox, mo, pmv, s_sub):
    """Visualize substitution structures."""
    ca_struct = ferrox.io.to_pymatgen_structure(ca_sub["structure"])
    s_struct = ferrox.io.to_pymatgen_structure(s_sub["structure"])

    return (
        ca_struct,
        s_struct,
        mo.hstack(
            [
                mo.vstack(
                    [
                        mo.md("**Ca Substitution (Ca_Mg)**"),
                        pmv.StructureWidget(
                            structure=ca_struct, style="height: 250px;"
                        ),
                    ]
                ),
                mo.vstack(
                    [
                        mo.md("**S Substitution (S_O)**"),
                        pmv.StructureWidget(structure=s_struct, style="height: 250px;"),
                    ]
                ),
            ],
            gap=4,
        ),
    )


@app.cell
def _(defects, mgo_dict, mo):
    """Find and create interstitial defects."""

    # Find interstitial sites using Voronoi analysis
    interstitial_sites = defects.find_voronoi_interstitials(mgo_dict, min_dist=1.0)

    return (interstitial_sites,
        mo.md(f"""
        ## Interstitial Site Finding

        Using Voronoi analysis to find interstitial positions:

        - **Sites found**: {len(interstitial_sites)}
        - **Minimum distance from atoms**: 1.0 Å

        First 5 sites (fractional coordinates):
        {interstitial_sites[:5]}
        """),
)


@app.cell
def _(defects, ferrox, interstitial_sites, mgo_dict, mo, pmv):
    """Create interstitial at first Voronoi site."""

    li_inter = None
    li_inter_struct = None

    # Find a site with valid 3D coordinates
    _frac_coords = None
    for _site in interstitial_sites:
        _coords = _site.get("frac_coords", _site) if isinstance(_site, dict) else _site
        if len(_coords) == 3:
            _frac_coords = list(_coords)
            break

    if _frac_coords is not None:
        try:
            li_inter = defects.create_interstitial(mgo_dict, "Li", _frac_coords)
            li_inter_struct = ferrox.io.to_pymatgen_structure(li_inter["structure"])
            _display = mo.vstack(
                [
                    mo.md(f"""
                    ### Interstitial Defect

                    Created Li interstitial (Li_i):
                    - **Position**: {_frac_coords}
                    - **Total atoms**: {len(li_inter_struct)}
                    """),
                    pmv.StructureWidget(structure=li_inter_struct, style="height: 250px;"),
                ]
            )
        except (ValueError, KeyError) as exc:
            _display = mo.md(f"⚠️ Interstitial creation failed: {exc}")
    else:
        _display = mo.md("No valid 3D interstitial sites found.")

    return li_inter, li_inter_struct, _display


@app.cell
def _(defects, mgo_dict, mo):
    """Create antisite defects."""

    # Create antisite by swapping Mg and O positions
    antisite = defects.create_antisite(mgo_dict, 0, 4)

    return (antisite,
        mo.md("""
        ## Antisite Defects

        Antisite defects swap species between sites:

        **Mg-O antisite**:
        - Swapped Mg (site 0) ↔ O (site 4)
        - Creates Mg_O and O_Mg pair

        Antisites are common in binary compounds and affect electronic properties.
        """),
)


@app.cell
def _(antisite, ferrox, mo, pmv):
    """Visualize antisite structure."""
    antisite_struct = ferrox.io.to_pymatgen_structure(antisite["structure"])

    return (
        antisite_struct,
        mo.vstack(
            [
                mo.md("### Antisite Defect (Mg_O + O_Mg)"),
                pmv.StructureWidget(structure=antisite_struct, style="height: 250px;"),
            ]
        ),
    )


@app.cell
def _(ferrox, mgo, mo, structure):
    """Generate all symmetry-distinct defects."""

    # First create a supercell for realistic defect calculations
    _mgo_dict2 = ferrox.io.from_pymatgen_structure(mgo)
    supercell = structure.make_supercell_diag(_mgo_dict2, [2, 2, 2])

    return (supercell,
        mo.md(f"""
        ## Supercell for Defect Calculations

        Created 2x2x2 supercell:
        - **Original atoms**: {len(mgo)}
        - **Supercell atoms**: {len(supercell["sites"])}

        Larger supercells reduce defect-defect interactions in periodic calculations.
        """),
)


@app.cell
def _(defects, mo, supercell, time):
    """Generate all defects in supercell."""

    _start = time.perf_counter()
    all_defects = defects.generate_all(
        supercell,
        extrinsic=["Li", "Ca"],  # Extrinsic dopants to consider
        symprec=0.01,
        interstitial_min_dist=1.0,
    )
    gen_time = time.perf_counter() - _start

    defect_counts = {k: len(v) for k, v in all_defects.items()}
    defect_table = "\n".join(f"| {k} | {v} |" for k, v in defect_counts.items())

    return (
        all_defects,
        defect_counts,
        defect_table,
        gen_time,
        mo.md(f"""
        ## All Symmetry-Distinct Defects

        Generated all unique defects in 2x2x2 supercell:

        | Defect Type | Count |
        |-------------|-------|
        {defect_table}

        **Total defects**: {sum(defect_counts.values())}
        **Generation time**: {gen_time:.3f}s

        Symmetry analysis ensures only unique defects are generated.
        """),
    )


@app.cell
def _(defects, mo):
    """Guess charge states for defects."""

    # Guess charge states for different defect types
    charge_states = {
        "V_Mg": defects.guess_charge_states("vacancy", species="Mg"),
        "V_O": defects.guess_charge_states("vacancy", species="O"),
        "Ca_Mg": defects.guess_charge_states("substitution", species="Ca"),
        "Li_i": defects.guess_charge_states("interstitial", species="Li"),
    }

    charge_table = "\n".join(
        f"| {name} | {states} |" for name, states in charge_states.items()
    )

    return (
        charge_states,
        charge_table,
        mo.md(f"""
        ## Defect Charge States

        Predicted charge states based on oxidation state analysis:

        | Defect | Possible Charges |
        |--------|------------------|
        {charge_table}

        Charge states determine defect formation energies and concentrations.
        """),
    )


@app.cell
def _(defects, ferrox, mgo, mo):
    """Demonstrate bond distortion around defect."""

    _mgo_dict3 = ferrox.io.from_pymatgen_structure(mgo)

    # Apply bond distortion around site 0
    _distorted_results = defects.distort_bonds(
        _mgo_dict3,
        site_idx=0,
        distortion=1.1,  # 10% expansion
        cutoff=3.0,
    )
    # Take the first result (structure dict)
    distorted = _distorted_results[0]["structure"] if _distorted_results else _mgo_dict3

    return (distorted,
        mo.md("""
        ## Bond Distortion Around Defect

        Local distortion: **10%** magnitude within **3.0 Å** cutoff (simulates relaxation).
        """),
)


@app.cell
def _(distorted, ferrox, mgo, mo, pmv):
    """Compare pristine and distorted structures."""
    distorted_struct = ferrox.io.to_pymatgen_structure(distorted)

    return (
        distorted_struct,
        mo.hstack(
            [
                mo.vstack(
                    [
                        mo.md("**Pristine**"),
                        pmv.StructureWidget(structure=mgo, style="height: 250px;"),
                    ]
                ),
                mo.vstack(
                    [
                        mo.md("**Distorted**"),
                        pmv.StructureWidget(
                            structure=distorted_struct, style="height: 250px;"
                        ),
                    ]
                ),
            ],
            gap=4,
        ),
    )


@app.cell
def _(defects, ferrox, mgo, mo):
    """Apply random rattling to structure."""

    _mgo_dict4 = ferrox.io.from_pymatgen_structure(mgo)

    # Rattle all atoms randomly
    rattled = defects.rattle(_mgo_dict4, amplitude=0.1, seed=42)

    return (rattled,
        mo.md("""
        ## Random Rattling

        Random displacements: **0.1 Å** amplitude, seed=42 (for ML training data, stability tests).
        """),
)


@app.cell
def _(ferrox, mgo, mo, pmv, rattled):
    """Visualize rattled structure."""
    rattled_struct = ferrox.io.to_pymatgen_structure(rattled["structure"])

    return (
        rattled_struct,
        mo.hstack(
            [
                mo.vstack(
                    [
                        mo.md("**Pristine**"),
                        pmv.StructureWidget(structure=mgo, style="height: 250px;"),
                    ]
                ),
                mo.vstack(
                    [
                        mo.md("**Rattled (0.1 Å)**"),
                        pmv.StructureWidget(
                            structure=rattled_struct, style="height: 250px;"
                        ),
                    ]
                ),
            ],
            gap=4,
        ),
    )


@app.cell
def _(defects, ferrox, mgo, mo):
    """Find optimal supercell for defect calculations."""

    _mgo_dict5 = ferrox.io.from_pymatgen_structure(mgo)

    # Find supercell with at least 10 Å between defect images
    supercell_matrix = defects.find_supercell(_mgo_dict5, min_image_dist=10.0)

    return (supercell_matrix,
        mo.md(f"""
        ## Optimal Supercell Finding

        Find supercell ensuring minimum distance between periodic images:

        **Target minimum image distance**: 10.0 Å

        **Supercell matrix**:
        ```
        {supercell_matrix}
        ```

        This ensures defect-defect interactions are minimized in DFT calculations.
        """),
)


@app.cell
def _(Lattice, Structure, defects, ferrox, mo, time):
    """Edge case: Defects in low-symmetry structure."""

    # Create a low-symmetry monoclinic structure
    monoclinic = Structure(
        Lattice.monoclinic(5.0, 6.0, 4.0, beta=100.0),
        ["Fe", "Fe", "O", "O", "O"],
        [
            [0, 0, 0],
            [0.5, 0.5, 0],
            [0.25, 0.25, 0.5],
            [0.75, 0.25, 0.5],
            [0.25, 0.75, 0.5],
        ],
    )

    mono_dict = ferrox.io.from_pymatgen_structure(monoclinic)

    _start = time.perf_counter()
    mono_defects = defects.generate_all(mono_dict, symprec=0.01)
    mono_time = time.perf_counter() - _start

    mono_counts = {k: len(v) for k, v in mono_defects.items()}

    return (
        mono_counts,
        mono_defects,
        mono_dict,
        mono_time,
        monoclinic,
        mo.md(f"""
        ## Edge Case: Low-Symmetry Structure

        Monoclinic structure (lower symmetry = more unique sites):

        - **Space group**: Monoclinic
        - **Unique defect sites**: {sum(mono_counts.values())}
        - **Generation time**: {mono_time:.3f}s

        Defect counts: {mono_counts}
        """),
    )


@app.cell
def _(Lattice, Structure, defects, ferrox, mo):
    """Edge case: Interstitials in densely packed structure."""

    # FCC gold - densely packed
    fcc_au = Structure(
        Lattice.cubic(4.08),
        ["Au", "Au", "Au", "Au"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    au_dict = ferrox.io.from_pymatgen_structure(fcc_au)

    # Find interstitial sites with different min_dist thresholds
    site_counts = {}
    for min_d in [0.5, 1.0, 1.5, 2.0]:
        sites = defects.find_voronoi_interstitials(au_dict, min_dist=min_d)
        site_counts[min_d] = len(sites)

    site_table = "\n".join(f"| {d} Å | {n} |" for d, n in site_counts.items())

    return (
        au_dict,
        fcc_au,
        mo.md(f"""
## Edge Case: Dense Packing

Interstitial finding in FCC Au (close-packed):

| min_dist | Sites Found |
|----------|-------------|
{site_table}

Increasing `min_dist` filters out sites too close to existing atoms.
In close-packed structures, octahedral and tetrahedral holes are the
main interstitial sites.
        """),
    )


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return (
        mo.md("""
    ## Summary

    Ferrox provides comprehensive defect engineering tools:

    1. **Point defects**: Vacancies, substitutions, interstitials, antisites
    2. **Automatic generation**: All symmetry-distinct defects at once
    3. **Interstitial finding**: Voronoi-based site detection
    4. **Perturbations**: Bond distortion, rattling
    5. **Supercell optimization**: Minimize image interactions

    ### Key Functions

    ```python
    from ferrox import defects

    # Simple defect creation
    vacancy = defects.create_vacancy(struct, site_idx=0)
    substitution = defects.create_substitution(struct, 0, "Ca")
    interstitial = defects.create_interstitial(struct, "Li", [0.25, 0.25, 0.25])
    antisite = defects.create_antisite(struct, site_idx1=0, site_idx2=4)

    # Find interstitial sites
    sites = defects.find_voronoi_interstitials(struct, min_dist=1.0)

    # Generate all unique defects
    all_defects = defects.generate_all(struct, extrinsic=["Li", "Ca"])

    # Optimal supercell for defect calculations
    matrix = defects.find_supercell(struct, min_image_dist=10.0)

    # Perturbations
    distorted = defects.distort_bonds(struct, site_idx=0, distortion=0.1)
    rattled = defects.rattle(struct, amplitude=0.1, seed=42)

    # Charge state prediction
    charges = defects.guess_charge_states("vacancy", species="O")
    ```

    ### Use Cases

    - **DFT defect calculations**: Generate input structures
    - **Defect thermodynamics**: Calculate formation energies
    - **Doping studies**: Explore dopant configurations
    - **ML training data**: Generate diverse defect structures
    """),
    )


if __name__ == "__main__":
    app.run()
