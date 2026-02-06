"""MD Simulation Playground with Ferrox.

Demonstrates classical molecular dynamics with various integrators,
thermostats, and interatomic potentials.

**Who is this for?** Computational scientists learning MD fundamentals
and researchers prototyping simulation workflows. This is a pedagogical
notebook — for production MD on large systems, use dedicated codes
like LAMMPS or ASE.

Run with: marimo edit 05_md_simulation.py --no-sandbox
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
    from ferrox import md, potentials
    from pymatgen.core import Lattice, Structure

    return (
        Lattice,
        Structure,
        ferrox,
        md,
        mo,
        np,
        pmv,
        potentials,
        time,
        mo.md("""
        # MD Simulation Playground

        This notebook demonstrates ferrox's molecular dynamics capabilities:

        - **Integrators**: Velocity Verlet (NVE), Langevin, Nosé-Hoover, Velocity Rescale
        - **Potentials**: Lennard-Jones, Morse, Soft Sphere, Harmonic Bonds
        - **Optimizers**: FIRE, CellFIRE for geometry optimization
        - **Analysis**: Temperature, kinetic energy, diffusion

        **Key ferrox functions:**
        - `md.MDState` - Molecular dynamics state (positions, velocities, forces)
        - `md.LangevinIntegrator` - Langevin dynamics (NVT with friction)
        - `md.NoseHooverChain` - Nosé-Hoover thermostat (NVT)
        - `potentials.compute_lennard_jones()` - LJ potential
        """),
    )


@app.cell
def _(Lattice, Structure, mo, np):
    """Create initial configuration: Argon FCC crystal."""

    # FCC Argon (approximating noble gas)
    a_ar = 5.26  # Lattice parameter for Ar at low T
    ar_fcc = Structure(
        Lattice.cubic(a_ar),
        ["Ar", "Ar", "Ar", "Ar"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )

    # Create 2x2x2 supercell for MD
    ar_fcc.make_supercell([2, 2, 2])

    # Get positions and cell
    positions = [list(site.coords) for site in ar_fcc]
    cell = ar_fcc.lattice.matrix.tolist()

    # Argon mass in amu
    ar_mass = 39.948
    masses = [ar_mass] * len(positions)

    return (
        a_ar,
        ar_fcc,
        ar_mass,
        cell,
        masses,
        positions,
        mo.md(f"""
        ## Initial Configuration: FCC Argon

        Created 2×2×2 supercell of FCC Ar:
        - **Number of atoms**: {len(positions)}
        - **Lattice parameter**: {a_ar} Å
        - **Box size**: {a_ar * 2} × {a_ar * 2} × {a_ar * 2} Å³

        This is a classic test system for MD simulations.
        """),
    )


@app.cell
def _(ar_fcc, mo, pmv):
    """Visualize initial structure."""
    return mo.vstack(
        [
            mo.md("### Initial Argon FCC Structure"),
            pmv.StructureWidget(structure=ar_fcc, style="height: 250px;"),
        ]
    )


@app.cell
def _(mo):
    """Interactive MD parameter controls."""
    temp_slider = mo.ui.slider(10.0, 200.0, value=50.0, step=10.0, label="Temperature (K)")
    sigma_slider = mo.ui.slider(2.5, 4.5, value=3.4, step=0.1, label="σ (Å)")
    epsilon_slider = mo.ui.slider(0.005, 0.02, value=0.0103, step=0.001, label="ε (eV)")

    return epsilon_slider, sigma_slider, temp_slider


@app.cell
def _(epsilon_slider, md, mo, positions, sigma_slider, temp_slider):
    """Create MD state with interactive temperature control."""

    # LJ parameters from sliders
    sigma_ar = sigma_slider.value
    epsilon_ar = epsilon_slider.value

    # Create MD state
    md_state = md.MDState(
        positions=positions,
        masses=[39.948] * len(positions),
        velocities=None,  # Will initialize with Maxwell-Boltzmann
    )

    # Initialize velocities at target temperature
    target_temp = temp_slider.value
    md_state.init_velocities(temperature_k=target_temp, seed=42)

    initial_temp = md_state.temperature()
    initial_ke = md_state.kinetic_energy()

    controls = mo.hstack([temp_slider, sigma_slider, epsilon_slider], gap=2)

    return (
        epsilon_ar,
        initial_ke,
        initial_temp,
        md_state,
        sigma_ar,
        target_temp,
        mo.vstack([
            mo.md("## MD State Initialization"),
            controls,
            mo.md(f"""
Created MD state with Maxwell-Boltzmann velocity distribution:

- **Target temperature**: {target_temp:.1f} K
- **Initial temperature**: {initial_temp:.2f} K
- **Initial kinetic energy**: {initial_ke:.6f} eV
- **LJ parameters**: σ = {sigma_ar:.2f} Å, ε = {epsilon_ar:.4f} eV

Adjust temperature to see different kinetic energy distributions. The LJ
parameters control the potential energy surface.
            """),
        ]),
    )


@app.cell
def _(cell, epsilon_ar, mo, potentials, positions, sigma_ar):
    """Compute initial LJ energy and forces."""

    cutoff = 2.5 * sigma_ar  # Standard LJ cutoff

    energy, forces = potentials.compute_lennard_jones(
        positions=positions,
        cell=cell,
        pbc=[True, True, True],
        sigma=sigma_ar,
        epsilon=epsilon_ar,
        cutoff=cutoff,
    )

    max_force = max(max(abs(comp) for comp in force_vec) for force_vec in forces)

    return (
        cutoff,
        energy,
        forces,
        max_force,
        mo.md(f"""
        ## Lennard-Jones Potential

        LJ parameters for Argon:
        - **σ (sigma)**: {sigma_ar} Å
        - **ε (epsilon)**: {epsilon_ar} eV ≈ 120 K
        - **Cutoff**: {cutoff:.1f} Å

        **Initial energy**: {energy:.6f} eV
        **Maximum force component**: {max_force:.6f} eV/Å
        """),
    )


@app.cell
def _(cell, cutoff, epsilon_ar, md, md_state, mo, potentials, sigma_ar, time):
    """Run NVE MD (velocity Verlet)."""

    def compute_lj_forces(pos):
        """Force callback for LJ potential."""
        _, forces = potentials.compute_lennard_jones(
            positions=pos,
            cell=cell,
            pbc=[True, True, True],
            sigma=sigma_ar,
            epsilon=epsilon_ar,
            cutoff=cutoff,
        )
        return forces

    # Run short NVE trajectory
    dt = 1.0  # fs (using natural units, roughly)
    n_steps_nve = 100

    nve_temps = []
    nve_energies = []

    _start = time.perf_counter()
    for _step_idx in range(n_steps_nve):
        md.velocity_verlet_step(md_state, dt=dt, compute_forces=compute_lj_forces)
        nve_temps.append(md_state.temperature())
        nve_energies.append(md_state.kinetic_energy())
    nve_time = time.perf_counter() - _start

    return (
        compute_lj_forces,
        dt,
        n_steps_nve,
        nve_energies,
        nve_temps,
        nve_time,
        mo.md(f"""
        ## NVE Molecular Dynamics (Velocity Verlet)

        Microcanonical ensemble (constant E, V, N). {n_steps_nve} steps in {nve_time:.3f}s
        ({n_steps_nve / nve_time:.0f} steps/s). Temperature should fluctuate around
        initial value without drift.
        """),
)


@app.cell
def _(
    Lattice,
    Structure,
    ar_mass,
    cell,
    cutoff,
    epsilon_ar,
    md,
    mo,
    potentials,
    sigma_ar,
    time,
):
    """Run NVT MD with Langevin thermostat."""

    # Create fresh state for Langevin
    a_ar_langevin = 5.26
    ar_langevin = Structure(
        Lattice.cubic(a_ar_langevin),
        ["Ar", "Ar", "Ar", "Ar"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )
    ar_langevin.make_supercell([2, 2, 2])
    langevin_positions = [list(site.coords) for site in ar_langevin]
    langevin_cell = ar_langevin.lattice.matrix.tolist()

    langevin_state = md.MDState(
        positions=langevin_positions,
        masses=[ar_mass] * len(langevin_positions),
    )
    langevin_state.init_velocities(temperature_k=100.0, seed=123)

    def compute_lj_forces_langevin(pos):
        """Force callback for LJ potential (Langevin thermostat)."""
        _, forces = potentials.compute_lennard_jones(
            positions=pos,
            cell=langevin_cell,
            pbc=[True, True, True],
            sigma=sigma_ar,
            epsilon=epsilon_ar,
            cutoff=cutoff,
        )
        return forces

    # Create Langevin integrator
    langevin = md.LangevinIntegrator(
        temperature_k=50.0,  # Target temperature
        friction=0.01,  # Friction coefficient
        dt=1.0,
        seed=456,
    )

    # Run trajectory
    n_steps_langevin = 100
    langevin_temps = []

    _start = time.perf_counter()
    for _ in range(n_steps_langevin):
        langevin.step(langevin_state, compute_lj_forces_langevin)
        langevin_temps.append(langevin_state.temperature())
    langevin_time = time.perf_counter() - _start

    return (
        a_ar_langevin,
        ar_langevin,
        compute_lj_forces_langevin,
        langevin,
        langevin_cell,
        langevin_positions,
        langevin_state,
        langevin_temps,
        langevin_time,
        n_steps_langevin,
        mo.md(f"""
        ## NVT: Langevin Thermostat

        Stochastic thermostat (target 50 K, friction 0.01).
        {n_steps_langevin} steps in {langevin_time:.3f}s.
        Couples the system to a heat bath via random forces.
        """),
)


@app.cell
def _(
    Lattice, Structure, ar_mass, cutoff, epsilon_ar, md, mo, potentials, sigma_ar, time
):
    """Run NVT MD with Nosé-Hoover thermostat."""

    # Create fresh state for Nosé-Hoover
    ar_nh = Structure(
        Lattice.cubic(5.26),
        ["Ar", "Ar", "Ar", "Ar"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )
    ar_nh.make_supercell([2, 2, 2])
    nh_positions = [list(site.coords) for site in ar_nh]
    nh_cell = ar_nh.lattice.matrix.tolist()

    nh_state = md.MDState(
        positions=nh_positions,
        masses=[ar_mass] * len(nh_positions),
    )
    nh_state.init_velocities(temperature_k=100.0, seed=789)

    def compute_lj_forces_nh(pos):
        """Force callback for LJ potential (Nosé-Hoover thermostat)."""
        _, forces = potentials.compute_lennard_jones(
            positions=pos,
            cell=nh_cell,
            pbc=[True, True, True],
            sigma=sigma_ar,
            epsilon=epsilon_ar,
            cutoff=cutoff,
        )
        return forces

    # Create Nosé-Hoover integrator
    # n_dof = 3 * N_atoms - 3 (subtract center of mass)
    n_dof = 3 * len(nh_positions) - 3
    nose_hoover = md.NoseHooverChain(
        target_temp=50.0,
        tau=100.0,  # Thermostat coupling time
        dt=1.0,
        n_dof=n_dof,
    )

    # Run trajectory
    n_steps_nh = 100
    nh_temps = []

    _start = time.perf_counter()
    for _ in range(n_steps_nh):
        nose_hoover.step(nh_state, compute_lj_forces_nh)
        nh_temps.append(nh_state.temperature())
    nh_time = time.perf_counter() - _start

    return (
        ar_nh,
        compute_lj_forces_nh,
        n_dof,
        n_steps_nh,
        nh_cell,
        nh_positions,
        nh_state,
        nh_temps,
        nh_time,
        nose_hoover,
        mo.md(f"""
        ## NVT: Nosé-Hoover Chain

        Deterministic thermostat (target 50 K, τ=100, {n_dof} DOF).
        {n_steps_nh} steps in {nh_time:.3f}s.
        Produces correct canonical distribution via extended system dynamics.
        """),
)


@app.cell
def _(
    Lattice, Structure, ar_mass, cutoff, epsilon_ar, md, mo, potentials, sigma_ar, time
):
    """Run NVT MD with Velocity Rescaling (Bussi thermostat)."""

    # Create fresh state
    ar_vr = Structure(
        Lattice.cubic(5.26),
        ["Ar", "Ar", "Ar", "Ar"],
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )
    ar_vr.make_supercell([2, 2, 2])
    vr_positions = [list(site.coords) for site in ar_vr]
    vr_cell = ar_vr.lattice.matrix.tolist()

    vr_state = md.MDState(
        positions=vr_positions,
        masses=[ar_mass] * len(vr_positions),
    )
    vr_state.init_velocities(temperature_k=100.0, seed=111)

    def compute_lj_forces_vr(pos):
        """Force callback for LJ potential (velocity rescale thermostat)."""
        _, forces = potentials.compute_lennard_jones(
            positions=pos,
            cell=vr_cell,
            pbc=[True, True, True],
            sigma=sigma_ar,
            epsilon=epsilon_ar,
            cutoff=cutoff,
        )
        return forces

    n_dof_vr = 3 * len(vr_positions) - 3
    velocity_rescale = md.VelocityRescale(
        target_temp=50.0,
        tau=100.0,
        dt=1.0,
        n_dof=n_dof_vr,
        seed=222,
    )

    n_steps_vr = 100
    vr_temps = []

    _start = time.perf_counter()
    for _ in range(n_steps_vr):
        velocity_rescale.step(vr_state, compute_lj_forces_vr)
        vr_temps.append(vr_state.temperature())
    vr_time = time.perf_counter() - _start

    return (
        ar_vr,
        compute_lj_forces_vr,
        n_dof_vr,
        n_steps_vr,
        velocity_rescale,
        vr_cell,
        vr_positions,
        vr_state,
        vr_temps,
        vr_time,
        mo.md(f"""
        ## NVT: Velocity Rescaling (Bussi)

        Stochastic rescaling thermostat (target 50 K, τ=100).
        {n_steps_vr} steps in {vr_time:.3f}s.
        Correct canonical distribution, more robust than Nosé-Hoover.
        """),
)


@app.cell
def _(langevin_temps, mo, nh_temps, np, nve_temps, vr_temps):
    """Compare thermostat performance."""

    def temp_stats(temps, name):
        """Calculate temperature statistics for a thermostat trajectory."""
        temps_arr = np.array(temps)
        return {
            "name": name,
            "mean": np.mean(temps_arr),
            "std": np.std(temps_arr),
            "min": np.min(temps_arr),
            "max": np.max(temps_arr),
        }

    stats = [
        temp_stats(nve_temps, "NVE (Verlet)"),
        temp_stats(langevin_temps, "Langevin"),
        temp_stats(nh_temps, "Nosé-Hoover"),
        temp_stats(vr_temps, "Velocity Rescale"),
    ]

    stats_table = "\n".join(
        f"| {stat['name']} | {stat['mean']:.1f} | {stat['std']:.1f} | {stat['min']:.1f} | {stat['max']:.1f} |"
        for stat in stats
    )

    return (
        stats,
        stats_table,
        temp_stats,
        mo.md(f"""
        ## Thermostat Comparison

        Temperature statistics across 100 steps (target: 50 K):

        | Method | Mean (K) | Std (K) | Min (K) | Max (K) |
        |--------|----------|---------|---------|---------|
        {stats_table}

        **Observations**:
        - NVE: No thermostat, temperature drifts
        - Langevin: Stochastic coupling to heat bath
        - Nosé-Hoover: Deterministic extended system
        - Velocity Rescale: Robust stochastic rescaling
        """),
    )


@app.cell
def _(cell, mo, potentials):
    """Demonstrate other potentials: Morse."""

    # Create simple diatomic positions
    dimer_positions = [[0.0, 0.0, 0.0], [2.5, 0.0, 0.0]]

    # Morse potential parameters
    d_morse = 1.0  # Well depth (eV)
    alpha_morse = 1.5  # Width parameter
    r0_morse = 2.0  # Equilibrium distance

    # Scan potential energy curve
    distances = [1.5 + 0.1 * step for step in range(30)]
    morse_energies = []

    for dist in distances:
        pos = [[0.0, 0.0, 0.0], [dist, 0.0, 0.0]]
        energy, _, _ = potentials.compute_morse(
            positions=pos,
            cell=None,
            pbc=None,
            d=d_morse,
            alpha=alpha_morse,
            r0=r0_morse,
            cutoff=10.0,
        )
        morse_energies.append(energy)

    min_energy = min(morse_energies)
    min_idx = morse_energies.index(min_energy)
    min_r = distances[min_idx]

    return (
        alpha_morse,
        d_morse,
        dimer_positions,
        distances,
        min_energy,
        min_idx,
        min_r,
        morse_energies,
        r0_morse,
        mo.md(f"""
        ## Morse Potential

        Parameters for diatomic interaction:
        - **D (well depth)**: {d_morse} eV
        - **α (width)**: {alpha_morse} Å⁻¹
        - **r₀ (equilibrium)**: {r0_morse} Å

        **Energy scan**:
        - Minimum energy: {min_energy:.4f} eV at r = {min_r:.1f} Å

        The Morse potential is more realistic than LJ for bonded atoms.
        """),
)


@app.cell
def _(Lattice, Structure, cutoff, epsilon_ar, md, mo, potentials, sigma_ar, time):
    """Geometry optimization with FIRE."""

    # Create slightly distorted structure
    ar_fire = Structure(
        Lattice.cubic(5.0),  # Slightly compressed
        ["Ar", "Ar", "Ar", "Ar"],
        [
            [0.02, 0.01, 0.0],  # Slightly displaced
            [0.52, 0.48, 0.0],
            [0.48, 0.0, 0.52],
            [0.0, 0.52, 0.48],
        ],
    )
    fire_positions = [list(site.coords) for site in ar_fire]
    fire_cell = ar_fire.lattice.matrix.tolist()

    def compute_forces_fire(pos):
        """Force callback for LJ potential (FIRE optimizer)."""
        _, forces = potentials.compute_lennard_jones(
            positions=pos,
            cell=fire_cell,
            pbc=[True, True, True],
            sigma=sigma_ar,
            epsilon=epsilon_ar,
            cutoff=cutoff,
        )
        return forces

    # Create FIRE optimizer
    fire_config = md.FireConfig(
        dt_start=0.1,
        dt_max=1.0,
        max_step=0.2,
    )
    fire_state = md.FireState(positions=fire_positions, config=fire_config)

    # Run optimization
    max_steps = 100
    fmax_target = 0.01
    fire_forces = []
    _step_idx = 0

    _start = time.perf_counter()
    for _step_idx in range(max_steps):
        fire_state.step(compute_forces_fire)
        fmax = fire_state.max_force()
        fire_forces.append(fmax)
        if fire_state.is_converged(fmax_target):
            break
    fire_time = time.perf_counter() - _start

    converged = fire_forces[-1] < fmax_target
    convergence_status = "✅ Converged" if converged else f"❌ Not converged (stopped at {max_steps} steps)"

    return (
        ar_fire,
        compute_forces_fire,
        fire_cell,
        fire_config,
        fire_forces,
        fire_positions,
        fire_state,
        fire_time,
        fmax,
        fmax_target,
        max_steps,
        mo.md(f"""
        ## Geometry Optimization (FIRE)

        Fast Inertial Relaxation Engine for minimization:

        - **Convergence criterion**: f_max < {fmax_target} eV/Å
        - **Status**: {convergence_status}
        - **Steps**: {_step_idx + 1}
        - **Wall time**: {fire_time:.3f}s

        **Force evolution**:
        - Initial max force: {fire_forces[0]:.4f} eV/Å
        - Final max force: {fire_forces[-1]:.6f} eV/Å

        FIRE is efficient for local minimization.
        """),
)


@app.cell
def _(Lattice, Structure, mo, np, pmv):
    """Create trajectory for visualization."""

    # Generate a short trajectory of expanding lattice
    trajectory_frames = []
    for idx in range(10):
        scale = 5.0 + idx * 0.2
        frame = Structure(
            Lattice.cubic(scale),
            ["Ar", "Ar", "Ar", "Ar"],
            [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
        )
        # Add some properties for trajectory widget
        trajectory_frames.append(
            {
                "structure": frame,
                "energy": -0.1 * (1 - ((scale - 5.5) / 2) ** 2),
                "temperature": 50 + 5 * np.sin(idx * 0.5),
                "step": idx,
            }
        )

    return (trajectory_frames,
        mo.md("## Trajectory Visualization"),
)


@app.cell
def _(mo, pmv, trajectory_frames):
    """Display trajectory widget."""
    traj_widget = pmv.TrajectoryWidget(
        trajectory=trajectory_frames,
        display_mode="structure+scatter",
        show_controls=True,
        style="height: 500px;",
    )

    return (
        traj_widget,
        mo.vstack(
            [
                mo.md("### MD Trajectory with Energy/Temperature Plots"),
                traj_widget,
            ]
        ),
    )


@app.cell
def _(mo):
    """Summary and key takeaways."""
    return mo.md("""
    ## Summary

    Ferrox provides comprehensive MD simulation capabilities:

    1. **Multiple integrators**: NVE (Verlet), Langevin, Nosé-Hoover, Velocity Rescale
    2. **Classical potentials**: Lennard-Jones, Morse, Soft Sphere, Harmonic Bonds
    3. **Optimizers**: FIRE for geometry optimization
    4. **State management**: Easy access to positions, velocities, forces

    ### Key Functions

    ```python
    from ferrox import md, potentials

    # Create MD state
    state = md.MDState(positions, masses)
    state.init_velocities(temperature_k=300, seed=42)

    # Force calculation
    def compute_forces(pos):
        _, forces = potentials.compute_lennard_jones(
            positions=pos, cell=cell, pbc=[True, True, True],
            sigma=3.4, epsilon=0.01, cutoff=10.0
        )
        return forces

    # NVE dynamics
    md.velocity_verlet_step(state, dt=1.0, compute_forces=compute_forces)

    # NVT with Langevin
    langevin = md.LangevinIntegrator(temperature_k=300, friction=0.01, dt=1.0)
    langevin.step(state, compute_forces)

    # Geometry optimization with FIRE
    fire = md.FireState(positions, config=md.FireConfig())
    fire.step(compute_forces)
    ```

    ### Use Cases

    - **Prototyping**: Test simulation workflows before scaling to production MD codes
    - **Education**: Learn MD fundamentals with interactive controls
    - **Quick checks**: Verify potentials and thermostats on small systems
    - **Optimization**: Find local energy minima with FIRE
    """)


if __name__ == "__main__":
    app.run()
