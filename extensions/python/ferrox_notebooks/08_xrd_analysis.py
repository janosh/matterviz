"""XRD Pattern Analysis with Ferrox.

Demonstrates X-ray diffraction pattern calculation, peak analysis,
and comparison with experimental data.

**Who is this for?** Experimentalists matching computed patterns to measurements,
crystallographers indexing peaks, and anyone doing phase identification.

Run with: marimo edit 08_xrd_analysis.py --no-sandbox
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

__generated_with = "0.19.8"
app = marimo.App(width="full")


@app.cell
def _():
    """Setup and imports."""
    import time

    import ferrox
    import marimo as mo
    import numpy as np
    import pymatviz as pmv
    from ferrox import symmetry, xrd
    from pymatgen.analysis.diffraction.xrd import XRDCalculator as PMGXRDCalculator
    from pymatgen.core import Lattice, Structure

    return (
        Lattice,
        PMGXRDCalculator,
        Structure,
        ferrox,
        mo,
        np,
        pmv,
        symmetry,
        time,
        xrd,
        mo.md("""
        # XRD Pattern Analysis

        This notebook demonstrates ferrox's X-ray diffraction capabilities:

        - **Pattern calculation**: Full XRD pattern from crystal structure
        - **Peak analysis**: Miller indices, d-spacings, intensities
        - **Multi-wavelength**: Cu Kα, Co Kα, Mo Kα, custom
        - **Batch processing**: Efficient multi-structure analysis

        **Key ferrox functions:**
        - `xrd.compute_xrd()` - Calculate XRD pattern
        - `xrd.get_atomic_scattering_params()` - Atomic form factors
        """),
    )


@app.cell
def _(Lattice, Structure):
    """Create test structures for XRD."""

    # FCC Aluminum
    al_fcc = Structure(
        Lattice.cubic(4.05),
        ["Al", "Al", "Al", "Al"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    # BCC Iron
    fe_bcc = Structure(
        Lattice.cubic(2.87),
        ["Fe", "Fe"],
        [[0, 0, 0], [0.5, 0.5, 0.5]],
    )

    # Rock salt NaCl
    nacl = Structure(
        Lattice.cubic(5.64),
        ["Na", "Na", "Na", "Na", "Cl", "Cl", "Cl", "Cl"],
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
    return al_fcc, fe_bcc, nacl


@app.cell
def _(al_fcc, fe_bcc, mo, nacl, pmv):
    """Visualize test structures."""
    return mo.hstack(
        [
            mo.vstack([mo.md("**Al (FCC)**"), pmv.StructureWidget(structure=al_fcc, style="height: 200px;")]),
            mo.vstack([mo.md("**Fe (BCC)**"), pmv.StructureWidget(structure=fe_bcc, style="height: 200px;")]),
            mo.vstack([mo.md("**NaCl**"), pmv.StructureWidget(structure=nacl, style="height: 200px;")]),
        ],
        gap=2,
    )


@app.cell
def _(mo):
    """Interactive XRD controls."""
    wavelength_select = mo.ui.dropdown(
        options={
            "Cu Kα (1.5406 Å)": 1.5406,
            "Mo Kα (0.7107 Å)": 0.7107,
            "Co Kα (1.7890 Å)": 1.7890,
            "Ag Kα (0.5594 Å)": 0.5594,
        },
        value="Cu Kα (1.5406 Å)",
        label="X-ray source",
    )
    theta_min_slider = mo.ui.slider(5.0, 30.0, value=10.0, step=5.0, label="2θ min (°)")
    theta_max_slider = mo.ui.slider(60.0, 150.0, value=90.0, step=10.0, label="2θ max (°)")
    return theta_max_slider, theta_min_slider, wavelength_select


@app.cell
def _(
    al_fcc,
    ferrox,
    mo,
    theta_max_slider,
    theta_min_slider,
    time,
    wavelength_select,
    xrd,
):
    """Calculate XRD pattern for Al with interactive controls."""

    al_dict = ferrox.io.from_pymatgen_structure(al_fcc)
    wavelength = wavelength_select.value

    _start = time.perf_counter()
    al_xrd = xrd.compute_xrd(
        al_dict,
        two_theta_range=(theta_min_slider.value, theta_max_slider.value),
        wavelength=wavelength,
    )
    al_time = time.perf_counter() - _start

    controls = mo.hstack(
        [wavelength_select, theta_min_slider, theta_max_slider], gap=2
    )

    return (
        al_dict,
        al_time,
        al_xrd,
        wavelength,
        mo.vstack([
            mo.md("## XRD Pattern: FCC Aluminum"),
            controls,
            mo.md(f"""
Calculated with λ = {wavelength} Å:

- **2θ range**: {theta_min_slider.value}° - {theta_max_slider.value}°
- **Calculation time**: {al_time:.4f}s
- **Number of peaks**: {len(al_xrd["two_theta"])}
            """),
        ]),
    )


@app.cell
def _(al_xrd, mo, np):
    """Display Al XRD peaks."""

    _two_theta = al_xrd["two_theta"]
    _intensities = al_xrd["intensities"]
    _d_spacings = al_xrd["d_spacings"]
    _hkls = al_xrd["hkls"]
    _sorted_idx = np.argsort(_intensities)[::-1]

    peak_table = "\n".join(
        f"| ({_hkls[idx][0][0]}{_hkls[idx][0][1]}{_hkls[idx][0][2]}) | {_two_theta[idx]:.2f}° | {_intensities[idx]:.1f} | {_d_spacings[idx]:.4f} |"
        for idx in _sorted_idx[:10]
    )

    return mo.md(f"""
### Al XRD Peak List

| hkl | 2θ (°) | Intensity | d-spacing (Å) |
|-----|--------|-----------|---------------|
{peak_table}

**Expected FCC reflections**: (111), (200), (220), (311), (222), ...
    """)


@app.cell
def _(fe_bcc, ferrox, mo, np, time, wavelength, xrd):
    """Calculate XRD pattern for Fe."""

    fe_dict = ferrox.io.from_pymatgen_structure(fe_bcc)

    _start = time.perf_counter()
    fe_xrd = xrd.compute_xrd(
        fe_dict,
        two_theta_range=(20.0, 120.0),
        wavelength=wavelength,
    )
    fe_time = time.perf_counter() - _start

    _two_theta = fe_xrd["two_theta"]
    _intensities = fe_xrd["intensities"]
    _hkls = fe_xrd["hkls"]
    _sorted_idx = np.argsort(_intensities)[::-1]

    fe_table = "\n".join(
        f"| ({_hkls[idx][0][0]}{_hkls[idx][0][1]}{_hkls[idx][0][2]}) | {_two_theta[idx]:.2f}° | {_intensities[idx]:.1f} |"
        for idx in _sorted_idx[:8]
    )

    return mo.md(f"""
## XRD Pattern: BCC Iron

| hkl | 2θ (°) | Intensity |
|-----|--------|-----------|
{fe_table}

**BCC extinction rule**: h + k + l = even. Calculation time: {fe_time:.4f}s
    """)


@app.cell
def _(ferrox, mo, nacl, np, time, wavelength, xrd):
    """Calculate XRD pattern for NaCl."""

    nacl_dict = ferrox.io.from_pymatgen_structure(nacl)

    _start = time.perf_counter()
    nacl_xrd = xrd.compute_xrd(
        nacl_dict,
        two_theta_range=(15.0, 80.0),
        wavelength=wavelength,
    )
    nacl_time = time.perf_counter() - _start

    _two_theta = nacl_xrd["two_theta"]
    _intensities = nacl_xrd["intensities"]
    _hkls = nacl_xrd["hkls"]
    _sorted_idx = np.argsort(_intensities)[::-1]

    nacl_table = "\n".join(
        f"| ({_hkls[idx][0][0]}{_hkls[idx][0][1]}{_hkls[idx][0][2]}) | {_two_theta[idx]:.2f}° | {_intensities[idx]:.1f} |"
        for idx in _sorted_idx[:8]
    )

    return mo.md(f"""
## XRD Pattern: NaCl (Rock Salt)

| hkl | 2θ (°) | Intensity |
|-----|--------|-----------|
{nacl_table}

**Rock salt extinction**: h, k, l all even or all odd. Calculation time: {nacl_time:.4f}s
    """)


@app.cell
def _(PMGXRDCalculator, al_fcc, fe_bcc, ferrox, mo, nacl, time, wavelength, xrd):
    """Benchmark against pymatgen."""

    _structures = [("Al", al_fcc), ("Fe", fe_bcc), ("NaCl", nacl)]

    _benchmark_results = []
    for _name, _struct in _structures:
        _struct_dict = ferrox.io.from_pymatgen_structure(_struct)

        # Ferrox timing
        _start = time.perf_counter()
        _ = xrd.compute_xrd(
            _struct_dict, two_theta_range=(10.0, 90.0), wavelength=wavelength
        )
        _ferrox_time = time.perf_counter() - _start

        # Pymatgen timing (use same wavelength for fair comparison)
        _pmg_calc = PMGXRDCalculator(wavelength=wavelength)
        _start = time.perf_counter()
        _ = _pmg_calc.get_pattern(_struct)
        _pmg_time = time.perf_counter() - _start

        _speedup = _pmg_time / _ferrox_time if _ferrox_time > 0 else float("inf")

        _benchmark_results.append(
            {
                "name": _name,
                "ferrox": _ferrox_time,
                "pymatgen": _pmg_time,
                "speedup": _speedup,
            }
        )

    _bench_table = "\n".join(
        f"| {result['name']} | {result['ferrox']:.4f}s | {result['pymatgen']:.4f}s | {result['speedup']:.1f}x |"
        for result in _benchmark_results
    )

    return mo.md(f"""
## Performance Benchmark

| Structure | Ferrox | Pymatgen | Speedup |
|-----------|--------|----------|---------|
{_bench_table}

For individual patterns, both are fast (sub-millisecond). The speedup becomes
relevant when computing 10k+ patterns for database generation or phase identification.
    """)


@app.cell
def _(mo, xrd):
    """Display atomic scattering parameters."""

    scattering_params = xrd.get_atomic_scattering_params()

    sample_elements = ["H", "C", "O", "Fe", "Cu", "Au"]

    param_table = "\n".join(
        f"| {elem} | {scattering_params.get(elem, [[0, 0]])[0]} |"
        for elem in sample_elements
        if elem in scattering_params
    )

    return mo.md(f"""
## Atomic Scattering Parameters

| Element | First coefficient set |
|---------|----------------------|
{param_table}

These coefficients are used in the structure factor calculation.
    """)


@app.cell
def _(Lattice, Structure, ferrox, mo, time, xrd):
    """Different wavelengths comparison."""

    # Quartz-like structure
    quartz = Structure(
        Lattice.hexagonal(4.91, 5.40),
        ["Si", "Si", "Si", "O", "O", "O", "O", "O", "O"],
        [
            [0.4697, 0.0000, 0.0000],
            [0.0000, 0.4697, 0.6667],
            [0.5303, 0.5303, 0.3333],
            [0.4135, 0.2669, 0.1191],
            [0.2669, 0.4135, 0.5476],
            [0.7331, 0.1466, 0.7858],
            [0.5865, 0.8534, 0.2142],
            [0.8534, 0.5865, 0.4524],
            [0.1466, 0.7331, 0.8809],
        ],
    )

    quartz_dict = ferrox.io.from_pymatgen_structure(quartz)

    _sources = [
        ("Cu Kα", 1.5406),
        ("Co Kα", 1.7902),
        ("Mo Kα", 0.7107),
        ("Ag Kα", 0.5594),
    ]

    _wavelength_results = []
    for _source_name, _wl in _sources:
        _start = time.perf_counter()
        _result = xrd.compute_xrd(
            quartz_dict, two_theta_range=(5.0, 80.0), wavelength=_wl
        )
        _calc_time = time.perf_counter() - _start

        _two_theta = _result["two_theta"]
        _first_peak = min(_two_theta) if _two_theta else None

        _wavelength_results.append(
            {
                "source": _source_name,
                "wavelength": _wl,
                "n_peaks": len(_two_theta),
                "first_peak": _first_peak,
                "time": _calc_time,
            }
        )

    _wl_table = "\n".join(
        f"| {result['source']} | {result['wavelength']} | {result['n_peaks']} | {f"{result['first_peak']:.1f}°" if result['first_peak'] is not None else 'N/A'} |"
        for result in _wavelength_results
    )

    return (quartz,
        mo.md(f"""
## Different X-ray Sources

XRD patterns for quartz with different wavelengths:

| Source | λ (Å) | Peaks | First Peak |
|--------|-------|-------|------------|
{_wl_table}

Shorter wavelengths (Mo, Ag) compress peaks to lower 2θ angles.
        """),
    )


@app.cell
def _(mo, pmv, quartz):
    """Visualize quartz structure."""
    return mo.vstack([
        mo.md("### Quartz Structure"),
        pmv.StructureWidget(structure=quartz, style="height: 250px;"),
    ])


@app.cell
def _(Lattice, Structure, ferrox, mo, time, xrd):
    """Batch XRD calculation for multiple structures."""

    _variants = []
    _base_a = 4.0
    for _idx in range(20):
        _a = _base_a + _idx * 0.02
        _struct = Structure(
            Lattice.cubic(_a),
            ["Cu", "Cu", "Cu", "Cu"],
            [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
        )
        _variants.append(_struct)

    _start = time.perf_counter()
    _batch_results = []
    for _struct in _variants:
        _struct_dict = ferrox.io.from_pymatgen_structure(_struct)
        _result = xrd.compute_xrd(
            _struct_dict, two_theta_range=(30.0, 90.0), wavelength=1.5406
        )
        _hkls = _result["hkls"]
        _two_theta = _result["two_theta"]
        _found_111 = None
        for _peak_idx, _hkl_list in enumerate(_hkls):
            if _hkl_list[0] == [1, 1, 1]:
                _found_111 = _two_theta[_peak_idx]
                break
        _batch_results.append(_found_111)
    _batch_time = time.perf_counter() - _start

    _valid_results = [peak for peak in _batch_results if peak is not None]
    _peak_range = (
        f"{_valid_results[0]:.2f}° → {_valid_results[-1]:.2f}°"
        if _valid_results
        else "N/A (no (111) peaks found)"
    )

    return mo.md(f"""
## Batch XRD Processing

Calculated XRD for {len(_variants)} FCC Cu variants (a = {_base_a}–{_base_a + 19 * 0.02:.2f} Å):

- **Total time**: {_batch_time:.4f}s ({_batch_time / len(_variants) * 1000:.2f} ms/structure)
- **(111) peak range**: {_peak_range}

Lattice expansion shifts peaks to lower 2θ angles.
    """)


@app.cell
def _(Lattice, Structure, ferrox, mo, np, xrd):
    """Edge case: Heavy elements."""

    pbo2 = Structure(
        Lattice.tetragonal(4.95, 3.38),
        ["Pb", "Pb", "O", "O", "O", "O"],
        [
            [0, 0, 0],
            [0.5, 0.5, 0.5],
            [0.307, 0.307, 0],
            [0.693, 0.693, 0],
            [0.807, 0.193, 0.5],
            [0.193, 0.807, 0.5],
        ],
    )

    _pbo2_dict = ferrox.io.from_pymatgen_structure(pbo2)
    _pbo2_xrd = xrd.compute_xrd(
        _pbo2_dict, two_theta_range=(10.0, 80.0), wavelength=1.5406
    )

    _two_theta = _pbo2_xrd["two_theta"]
    _intensities = _pbo2_xrd["intensities"]
    _hkls = _pbo2_xrd["hkls"]
    _sorted_idx = np.argsort(_intensities)[::-1]

    _pbo2_table = "\n".join(
        f"| ({_hkls[idx][0][0]}{_hkls[idx][0][1]}{_hkls[idx][0][2]}) | {_two_theta[idx]:.2f}° | {_intensities[idx]:.1f} |"
        for idx in _sorted_idx[:6]
    )

    return mo.md(f"""
## Edge Case: Heavy Elements (PbO₂)

| hkl | 2θ (°) | Intensity |
|-----|--------|-----------|
{_pbo2_table}

Heavy elements like Pb have large scattering factors, producing strong peaks.
    """)


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return mo.md("""
## Summary

Ferrox provides XRD pattern calculation with the same physics as pymatgen:

1. **Full pattern calculation**: Positions, intensities, Miller indices
2. **Flexible wavelengths**: Cu Kα, Co Kα, Mo Kα, custom
3. **Batch processing**: Efficient multi-structure analysis
4. **Scattering parameters**: Access to atomic form factors

### Key Functions

```python
from ferrox import xrd

result = xrd.compute_xrd(
    struct, two_theta_range=(10.0, 90.0), wavelength=1.5406,
)

# Access peaks via parallel arrays
for two_theta, intensity, hkl in zip(
    result["two_theta"], result["intensities"], result["hkls"],
):
    h, k, l = hkl[0]
```
    """)


if __name__ == "__main__":
    app.run()
