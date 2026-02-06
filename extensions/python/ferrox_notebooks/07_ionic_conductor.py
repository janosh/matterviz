"""Ionic Conductor Analysis with Ferrox.

Demonstrates AIMD trajectory analysis for diffusion calculations,
radial distribution functions, and mean squared displacement analysis.

**Who is this for?** Battery researchers studying solid electrolytes,
electrochemists measuring ion mobility, and anyone extracting diffusion
coefficients from MD trajectories.

Run with: marimo edit 07_ionic_conductor.py --no-sandbox
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
    from ferrox import rdf, trajectory
    from pymatgen.core import Lattice, Structure

    intro = mo.md("""
        # Ionic Conductor Analysis

        This notebook demonstrates ferrox's trajectory analysis capabilities
        for studying ionic conductors and diffusion:

        - **Radial Distribution Functions (RDF)**: Pair correlation functions
        - **Mean Squared Displacement (MSD)**: Diffusion analysis
        - **Velocity Autocorrelation (VACF)**: Alternative diffusion method
        - **Element-specific analysis**: Separate contributions by element

        **Key ferrox functions:**
        - `rdf.compute_rdf()` - Total radial distribution function
        - `rdf.compute_element_rdf()` - Element-pair specific RDF
        - `trajectory.diffusion_from_msd()` - Diffusion from MSD
        - `trajectory.diffusion_from_vacf()` - Diffusion from VACF
        """)

    return Lattice, Structure, ferrox, mo, np, pmv, rdf, time, trajectory, intro


@app.cell
def _(Lattice, Structure, mo):
    """Create Li3PS4 solid electrolyte structure."""

    # Simplified Li3PS4 structure (argyrodite-type)
    # Real structure is more complex - this is illustrative
    li3ps4 = Structure(
        Lattice.cubic(9.8),  # Approximate lattice parameter
        [
            "Li",
            "Li",
            "Li",
            "Li",
            "Li",
            "Li",
            "P",
            "P",
            "S",
            "S",
            "S",
            "S",
            "S",
            "S",
            "S",
            "S",
        ],
        [
            [0.25, 0.25, 0.25],
            [0.75, 0.75, 0.25],
            [0.75, 0.25, 0.75],
            [0.25, 0.75, 0.75],
            [0.5, 0.5, 0.5],
            [0.0, 0.0, 0.0],
            [0.25, 0.25, 0.75],
            [0.75, 0.75, 0.75],
            [0.1, 0.1, 0.1],
            [0.9, 0.9, 0.1],
            [0.9, 0.1, 0.9],
            [0.1, 0.9, 0.9],
            [0.4, 0.4, 0.4],
            [0.6, 0.6, 0.4],
            [0.6, 0.4, 0.6],
            [0.4, 0.6, 0.6],
        ],
    )

    display = mo.md(f"""
        ## Li₃PS₄ Solid Electrolyte

        Created simplified argyrodite-type structure:
        - **Formula**: Li₃PS₄
        - **Lattice parameter**: 9.8 Å
        - **Total atoms**: {len(li3ps4)}
        - **Li atoms**: 6 (mobile ions)
        - **P atoms**: 2
        - **S atoms**: 8

        Solid electrolytes like Li₃PS₄ are key for all-solid-state batteries.
        """)

    return li3ps4, display


@app.cell
def _(li3ps4, mo, pmv):
    """Visualize structure."""
    return mo.vstack(
        [
            mo.md("### Li₃PS₄ Structure"),
            pmv.StructureWidget(structure=li3ps4, style="height: 250px;"),
        ]
    )


@app.cell
def _(mo):
    """Interactive RDF controls."""
    r_max_slider = mo.ui.slider(5.0, 20.0, value=10.0, step=1.0, label="r_max (Å)")
    n_bins_slider = mo.ui.slider(50, 200, value=100, step=10, label="Number of bins")

    return n_bins_slider, r_max_slider


@app.cell
def _(ferrox, li3ps4, mo, n_bins_slider, r_max_slider, rdf, time):
    """Calculate total RDF with interactive controls."""

    struct_dict = ferrox.io.from_pymatgen_structure(li3ps4)

    # Compute total RDF with user-controlled parameters
    _start = time.perf_counter()
    rdf_result = rdf.compute_rdf(
        struct_dict, r_max=r_max_slider.value, n_bins=n_bins_slider.value
    )
    rdf_time = time.perf_counter() - _start

    controls = mo.hstack([r_max_slider, n_bins_slider], gap=2)
    display = mo.vstack([
        mo.md("## Radial Distribution Function"),
        controls,
        mo.md(f"""
Total g(r) for Li₃PS₄:

- **r_max**: {r_max_slider.value} Å
- **Number of bins**: {n_bins_slider.value}
- **Calculation time**: {rdf_time:.3f}s

Adjust the sliders to see how RDF resolution and range affect the results.
        """),
    ])

    return rdf_result, rdf_time, struct_dict, display


@app.cell
def _(mo, np, rdf_result):
    """Display RDF statistics."""

    # RDF returns dict with keys "r" and "g"
    r_values = rdf_result["r"]
    g_values = rdf_result["g"]

    # Find first peak
    max_idx = np.argmax(g_values)
    first_peak_r = r_values[max_idx]
    first_peak_g = g_values[max_idx]

    # Find first minimum (after first peak)
    min_search_start = max_idx + 5
    min_idx = None
    if min_search_start < len(g_values):
        min_idx = min_search_start + np.argmin(
            g_values[min_search_start : min_search_start + 20]
        )
        first_min_r = r_values[min_idx] if min_idx < len(r_values) else None
    else:
        first_min_r = None

    display = mo.md(f"""
        ### RDF Statistics

        - **First peak position**: {first_peak_r:.2f} Å
        - **First peak height**: {first_peak_g:.2f}
        - **First minimum**: {f"{first_min_r:.2f}" if first_min_r else "N/A"} Å

        The first peak corresponds to nearest-neighbor distances.
        """)

    return first_min_r, first_peak_g, first_peak_r, g_values, max_idx, min_idx, min_search_start, r_values, display


@app.cell
def _(mo):
    """Interactive element pair selection."""
    elem1_select = mo.ui.dropdown(
        options=["Li", "P", "S"], value="Li", label="Element 1"
    )
    elem2_select = mo.ui.dropdown(
        options=["Li", "P", "S"], value="S", label="Element 2"
    )
    return elem1_select, elem2_select


@app.cell
def _(elem1_select, elem2_select, mo, n_bins_slider, np, r_max_slider, rdf, struct_dict, time):
    """Calculate element-specific RDFs with interactive selection."""

    # User-selected element pair RDF
    _start = time.perf_counter()
    selected_rdf = rdf.compute_element_rdf(
        struct_dict,
        elem1_select.value,
        elem2_select.value,
        r_max=r_max_slider.value,
        n_bins=n_bins_slider.value,
    )
    selected_time = time.perf_counter() - _start

    # Also calculate reference pairs for comparison
    li_li_rdf = rdf.compute_element_rdf(struct_dict, "Li", "Li", r_max=10.0, n_bins=100)

    # Li-S RDF (coordination)
    li_s_rdf = rdf.compute_element_rdf(struct_dict, "Li", "S", r_max=10.0, n_bins=100)

    # P-S RDF (PS4 tetrahedra)
    p_s_rdf = rdf.compute_element_rdf(struct_dict, "P", "S", r_max=10.0, n_bins=100)

    # RDFs return dicts with keys "r" and "g"
    li_li_r = li_li_rdf["r"]
    li_li_g = li_li_rdf["g"]
    li_s_r = li_s_rdf["r"]
    li_s_g = li_s_rdf["g"]
    p_s_r = p_s_rdf["r"]
    p_s_g = p_s_rdf["g"]
    selected_r = selected_rdf["r"]
    selected_g = selected_rdf["g"]

    controls = mo.hstack([elem1_select, elem2_select], gap=2)
    display = mo.vstack([
        mo.md("## Element-Specific RDFs"),
        controls,
        mo.md(f"""
**Selected pair: {elem1_select.value}-{elem2_select.value}**
- First peak at {selected_r[np.argmax(selected_g)]:.2f} Å
- Calculation time: {selected_time:.4f}s

**Reference pairs:**
| Pair | First Peak (Å) | Interpretation |
|------|----------------|----------------|
| Li-Li | {li_li_r[np.argmax(li_li_g)]:.2f} | Li-Li distances |
| Li-S | {li_s_r[np.argmax(li_s_g)]:.2f} | Li coordination to S |
| P-S | {p_s_r[np.argmax(p_s_g)]:.2f} | PS₄ tetrahedra |

Select different element pairs to explore coordination environments.
        """),
    ])

    return li_li_rdf, li_s_rdf, p_s_rdf, selected_rdf, display


@app.cell
def _(mo, rdf, struct_dict, time):
    """Compute all element RDFs at once."""

    _start = time.perf_counter()
    all_rdfs = rdf.compute_all_element_rdfs(struct_dict, r_max=10.0, n_bins=100)
    all_time = time.perf_counter() - _start

    display = mo.md(f"""
        ## All Element Pair RDFs

        Using `compute_all_element_rdfs()` for convenience (computes all pairs in one call):

        **Computed pairs**: {list(all_rdfs.keys())}
        **Total time**: {all_time:.3f}s
        """)

    return all_rdfs, all_time, display


@app.cell
def _(Lattice, Structure, mo, np):
    """Generate synthetic trajectory to demonstrate the analysis API."""

    # NOTE: This is a synthetic random-walk trajectory for API demonstration only.
    # The MSD/VACF results below are not physically meaningful. In practice,
    # use frames from AIMD or classical MD simulations.

    _np_rng = np.random.default_rng(seed=42)

    # Base structure
    base = Structure(
        Lattice.cubic(10.0),
        ["Li", "Li", "Li", "Li", "S", "S", "S", "S"],
        [
            [0.1, 0.1, 0.1],
            [0.6, 0.1, 0.1],
            [0.1, 0.6, 0.1],
            [0.1, 0.1, 0.6],
            [0.5, 0.5, 0.5],
            [0.5, 0.5, 0.0],
            [0.5, 0.0, 0.5],
            [0.0, 0.5, 0.5],
        ],
    )

    # Generate trajectory with random walk for Li atoms
    n_frames = 100
    dt = 1.0  # Time step in fs

    trajectory_frames = []
    positions = np.array([site.frac_coords for site in base])

    for _frame_idx in range(n_frames):
        # Random walk for Li atoms (indices 0-3)
        displacement = _np_rng.normal(0, 0.01, size=(4, 3))
        positions[:4] += displacement
        positions[:4] = positions[:4] % 1.0  # Wrap to unit cell

        # Create frame
        frame = Structure(
            base.lattice,
            [site.species_string for site in base],
            positions.copy(),
        )
        trajectory_frames.append(frame)

    times = [idx * dt for idx in range(n_frames)]
    display = mo.md(f"""
        ## Synthetic Trajectory (API Demo)

        ⚠️ **This is a random-walk trajectory for demonstrating the analysis API.**
        The computed MSD and VACF below are not physically meaningful.
        In practice, use frames from AIMD or classical MD.

        - **Frames**: {n_frames}
        - **Time step**: {dt} fs
        - **Mobile species**: Li (random walk), **Immobile**: S (fixed)
        """)

    return dt, n_frames, times, trajectory_frames, display


@app.cell
def _(mo, np, trajectory_frames):
    """Calculate Mean Squared Displacement."""

    # Calculate MSD for Li atoms
    li_positions = []
    for _frame in trajectory_frames:
        _frame_li_pos = []
        for _site in _frame:
            if _site.species_string == "Li":
                _frame_li_pos.append(_site.coords)
        li_positions.append(np.array(_frame_li_pos))

    li_positions = np.array(li_positions)  # shape: (n_frames, n_li, 3)

    # Calculate MSD: average over atoms, as function of time lag
    n_frames_msd = len(li_positions)
    msd_values = []

    # Note: For real MD trajectories, use unwrapped coordinates or apply minimum
    # image convention: disp = disp - np.round(disp / box_length) * box_length
    # The synthetic data here uses small displacements that don't cross boundaries.
    for _lag in range(n_frames_msd):
        if _lag == 0:
            msd_values.append(0.0)
        else:
            displacements_sq = []
            for _start_idx in range(n_frames_msd - _lag):
                disp = li_positions[_start_idx + _lag] - li_positions[_start_idx]
                disp_sq = np.sum(disp**2, axis=1)  # Sum over x,y,z
                displacements_sq.extend(disp_sq)
            msd_values.append(np.mean(displacements_sq))

    mid_idx = len(msd_values) // 2
    display = mo.md(f"""
        ## Mean Squared Displacement (MSD)

        Calculated MSD for Li atoms:

        - **Initial MSD**: {msd_values[0]:.4f} Å²
        - **Final MSD**: {msd_values[-1]:.4f} Å²
        - **MSD at midpoint (t={mid_idx}fs)**: {msd_values[mid_idx]:.4f} Å²

        Linear MSD vs time indicates diffusive behavior (Einstein relation).
        """)

    return msd_values, n_frames_msd, display


@app.cell
def _(mo, msd_values, times, trajectory):
    """Calculate diffusion coefficient from MSD."""

    # Use ferrox diffusion calculation
    diffusion_coeff, r_squared = trajectory.diffusion_from_msd(
        msd=msd_values,
        times=times,
        dim=3,  # 3D diffusion
        start_fraction=0.2,  # Skip initial transient
        end_fraction=0.8,  # Skip noisy end
    )

    # Convert to common units (cm²/s)
    # D in Å²/fs -> D in cm²/s: multiply by 1e-8 (Å->cm)² / 1e-15 (fs->s) = 1e-1
    d_cm2_s = diffusion_coeff * 1e-1
    display = mo.md(f"""
        ## Diffusion Coefficient from MSD

        Using Einstein relation: MSD = 2 * d * D * t

        - **Diffusion coefficient**: {diffusion_coeff:.4e} Å²/fs
        - **D (in cm²/s)**: {d_cm2_s:.4e} cm²/s
        - **Fit quality (R²)**: {r_squared:.4f}

        Typical Li⁺ diffusion in solid electrolytes: 10⁻⁸ to 10⁻⁶ cm²/s
        """)

    return d_cm2_s, diffusion_coeff, r_squared, display


@app.cell
def _(mo, np):
    """Generate synthetic velocity data for VACF analysis."""

    _np_rng2 = np.random.default_rng(seed=123)

    # Synthetic velocity time series (simplified)
    n_steps = 200
    dt_vacf = 1.0  # fs

    # Generate correlated velocities (exponential decay of correlation)
    velocities = []
    v_current = _np_rng2.normal(0, 1, 3)  # Initial velocity

    decay_time = 50.0  # Correlation time in fs
    for _step_idx in range(n_steps):
        # Velocity with exponential autocorrelation
        noise = _np_rng2.normal(0, 0.1, 3)
        v_current = v_current * np.exp(-dt_vacf / decay_time) + noise
        velocities.append(v_current.copy())

    velocities = np.array(velocities)

    # Calculate VACF
    vacf = []
    for _lag in range(n_steps):
        if _lag == 0:
            vacf.append(np.mean(np.sum(velocities * velocities, axis=1)))
        else:
            # <v(0)·v(t)>
            dot_products = []
            for _start_idx in range(n_steps - _lag):
                dot = np.dot(velocities[_start_idx], velocities[_start_idx + _lag])
                dot_products.append(dot)
            vacf.append(np.mean(dot_products))

    # Normalize (with safety check for zero)
    vacf_0 = vacf[0] if vacf[0] > 1e-10 else 1.0
    vacf = [v / vacf_0 for v in vacf]
    display = mo.md(f"""
        ## Velocity Autocorrelation Function (VACF)

        Generated synthetic velocity data with exponential correlation:

        - **Correlation time**: {decay_time} fs
        - **VACF(0)**: 1.0 (normalized)
        - **VACF(50fs)**: {vacf[50]:.4f}
        - **VACF(100fs)**: {vacf[100]:.4f}

        The VACF decays as exp(-t/τ) for simple diffusion.
        """)

    return dt_vacf, vacf, display


@app.cell
def _(dt_vacf, mo, trajectory, vacf):
    """Calculate diffusion from VACF."""

    # Use Green-Kubo relation
    diffusion_vacf = trajectory.diffusion_from_vacf(
        vacf=vacf,
        dt=dt_vacf,
        dim=3,
    )

    display = mo.md(f"""
        ## Diffusion from VACF (Green-Kubo)

        Using Green-Kubo relation: D = (1/d) ∫₀^∞ VACF(t) dt

        - **Diffusion coefficient**: {diffusion_vacf:.4e} (arbitrary units)

        VACF integration provides an independent check on MSD-derived diffusion.
        """)

    return diffusion_vacf, display


@app.cell
def _(mo, trajectory_frames):
    """Visualize trajectory."""

    # Create trajectory data for widget
    traj_data = []
    for _idx, _frame in enumerate(trajectory_frames[:20]):  # First 20 frames
        traj_data.append(
            {
                "structure": _frame,
                "step": _idx,
                "time_fs": _idx * 1.0,
            }
        )

    header = mo.md("## Trajectory Visualization")
    return traj_data, header


@app.cell
def _(mo, pmv, traj_data):
    """Display trajectory widget."""
    traj_widget = pmv.TrajectoryWidget(
        trajectory=traj_data,
        display_mode="structure+scatter",
        show_controls=True,
        style="height: 450px;",
    )

    display = mo.vstack([mo.md("### Li Diffusion Trajectory"), traj_widget])
    return (display,)


@app.cell
def _(Lattice, Structure, ferrox, mo, np, rdf, time):
    """Edge case: Very long trajectory RDF averaging."""

    # Create structure for averaging demonstration
    liq = Structure(
        Lattice.cubic(8.0),
        ["Na"] * 20 + ["Cl"] * 20,
        np.random.default_rng(44).random((40, 3)),
    )

    liq_dict = ferrox.io.from_pymatgen_structure(liq)

    # Benchmark RDF calculation
    _start = time.perf_counter()
    for _ in range(10):  # Simulate averaging over frames
        _ = rdf.compute_rdf(liq_dict, r_max=10.0, n_bins=100)
    avg_time = (time.perf_counter() - _start) / 10

    return mo.md(f"""
    ## RDF Averaging Performance

    For trajectory analysis, RDFs are averaged over many frames:

    - **Structure size**: 40 atoms
    - **Time per RDF**: {avg_time:.4f}s
    - **Frames/second**: {1 / avg_time:.0f}

    For a 1000-frame trajectory: ~{1000 * avg_time:.1f}s total.
    RDF calculation per frame is inherently fast; the bottleneck in practice
    is loading/parsing trajectory files, not the RDF computation itself.
    """)


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return mo.md("""
    ## Summary

    Ferrox provides essential tools for ionic conductor analysis:

    1. **Radial Distribution Functions**: Total and element-specific
    2. **MSD-based diffusion**: Einstein relation method
    3. **VACF-based diffusion**: Green-Kubo method
    4. **Trajectory processing**: Batch RDF averaging over frames

    ### Key Functions

    ```python
    from ferrox import rdf, trajectory

    # Total RDF
    result = rdf.compute_rdf(struct, r_max=10.0, n_bins=100)

    # Element-specific RDF
    li_o_rdf = rdf.compute_element_rdf(struct, "Li", "O", r_max=10.0)

    # All element pairs at once
    all_rdfs = rdf.compute_all_element_rdfs(struct, r_max=10.0)

    # Diffusion from MSD
    D, R2 = trajectory.diffusion_from_msd(msd, times, dim=3)

    # Diffusion from VACF
    D = trajectory.diffusion_from_vacf(vacf, dt, dim=3)
    ```

    ### Analysis Workflow

    1. **Load trajectory** from MD simulation
    2. **Calculate RDFs** averaged over frames
    3. **Track MSD** as function of time lag
    4. **Fit diffusion coefficient** from linear region
    5. **Compare with VACF** for validation

    ### Use Cases

    - **Solid electrolytes**: Li⁺, Na⁺ conductivity
    - **Liquid electrolytes**: Ion mobility
    - **Superionic conductors**: High-T phase transitions
    - **Battery materials**: Diffusion activation energies
    """)


if __name__ == "__main__":
    app.run()
