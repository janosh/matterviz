//! Integration tests for FIRE optimizer.

use ferrox::optimizers::{CellFireState, FireConfig, FireState};
use nalgebra::{Matrix3, Vector3};

// Morse potential for diatomic molecule
// V(r) = D * (1 - exp(-a*(r - r_eq)))^2
// F(r) = 2 * D * a * (1 - exp(-a*(r - r_eq))) * exp(-a*(r - r_eq)) * r_hat
fn morse_potential(r: f64, d: f64, a: f64, r_eq: f64) -> f64 {
    let x = 1.0 - (-a * (r - r_eq)).exp();
    d * x * x
}

fn morse_force_magnitude(r: f64, d: f64, a: f64, r_eq: f64) -> f64 {
    let exp_term = (-a * (r - r_eq)).exp();
    2.0 * d * a * (1.0 - exp_term) * exp_term
}

/// Compute forces for a Morse dimer (two atoms).
fn morse_dimer_forces(positions: &[Vector3<f64>], d: f64, a: f64, r_eq: f64) -> Vec<Vector3<f64>> {
    let r_vec = positions[1] - positions[0];
    let r = r_vec.norm();

    if r < 1e-10 {
        return vec![Vector3::zeros(), Vector3::zeros()];
    }

    let r_hat = r_vec / r;
    let f_mag = morse_force_magnitude(r, d, a, r_eq);

    // Force on atom 0 points toward atom 1 if r > r_eq
    let f0 = f_mag * r_hat;
    let f1 = -f_mag * r_hat;

    vec![f0, f1]
}

#[test]
fn test_morse_dimer_equilibrium() {
    // Morse potential parameters (typical for diatomic like H2)
    let d = 4.5; // Well depth in eV
    let a = 1.9; // Width parameter in 1/Angstrom
    let r_eq = 0.74; // Equilibrium distance in Angstrom

    // Start with stretched bond
    let initial = vec![
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(1.2, 0.0, 0.0), // Stretched from r_eq = 0.74
    ];

    let config = FireConfig::default();
    let mut state = FireState::new(initial, &config);

    // Run FIRE optimization
    let fmax = 0.001;
    let max_steps = 500;
    let mut converged = false;

    for _ in 0..max_steps {
        state.step(|pos| morse_dimer_forces(pos, d, a, r_eq), &config);
        if state.is_converged(fmax) {
            converged = true;
            break;
        }
    }

    assert!(
        converged,
        "Morse dimer should converge, max_force={}",
        state.max_force()
    );

    // Check bond length is at equilibrium
    let bond_vec = state.positions[1] - state.positions[0];
    let bond_length = bond_vec.norm();
    assert!(
        (bond_length - r_eq).abs() < 0.01,
        "Bond length should be ~{r_eq}, got {bond_length}"
    );

    // Check energy is at minimum (V = 0 at r_eq)
    let energy = morse_potential(bond_length, d, a, r_eq);
    assert!(
        energy < 0.001,
        "Energy should be near zero at equilibrium, got {energy}"
    );
}

#[test]
fn test_morse_dimer_compressed() {
    // Test starting from compressed bond
    let d = 4.5;
    let a = 1.9;
    let r_eq = 0.74;

    let initial = vec![
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(0.5, 0.0, 0.0), // Compressed
    ];

    let config = FireConfig::default();
    let mut state = FireState::new(initial, &config);

    for _ in 0..500 {
        state.step(|pos| morse_dimer_forces(pos, d, a, r_eq), &config);
        if state.is_converged(0.001) {
            break;
        }
    }

    let bond_length = (state.positions[1] - state.positions[0]).norm();
    assert!(
        (bond_length - r_eq).abs() < 0.02,
        "Bond length should approach equilibrium from compressed state"
    );
}

// Spring network forces: F_i = -k * sum_j(r_ij - r_eq) * r_hat_ij
fn spring_network_forces(
    positions: &[Vector3<f64>],
    neighbors: &[(usize, usize)],
    k: f64,
    r_eq: f64,
) -> Vec<Vector3<f64>> {
    let n_atoms = positions.len();
    let mut forces = vec![Vector3::zeros(); n_atoms];

    for &(idx_i, idx_j) in neighbors {
        let r_vec = positions[idx_j] - positions[idx_i];
        let r = r_vec.norm();
        if r < 1e-10 {
            continue;
        }

        let r_hat = r_vec / r;
        let f_mag = k * (r - r_eq);

        forces[idx_i] += f_mag * r_hat;
        forces[idx_j] -= f_mag * r_hat;
    }

    forces
}

fn spring_network_energy(
    positions: &[Vector3<f64>],
    neighbors: &[(usize, usize)],
    k: f64,
    r_eq: f64,
) -> f64 {
    let mut energy = 0.0;
    for &(idx_i, idx_j) in neighbors {
        let r = (positions[idx_j] - positions[idx_i]).norm();
        energy += 0.5 * k * (r - r_eq).powi(2);
    }
    energy
}

#[test]
fn test_spring_network_10_atoms() {
    // Create a chain of 10 atoms connected by springs
    let n_atoms = 10;
    let k = 1.0;
    let r_eq = 1.0;

    // Linear chain neighbors
    let neighbors: Vec<(usize, usize)> = (0..n_atoms - 1).map(|idx| (idx, idx + 1)).collect();

    // Initial positions: perturbed from equilibrium linear chain
    let mut initial = Vec::with_capacity(n_atoms);
    for idx in 0..n_atoms {
        initial.push(Vector3::new(
            idx as f64 * 0.9 + 0.1 * (idx as f64).sin(), // Compressed and wavy
            0.2 * (idx as f64 * 0.5).cos(),
            0.1 * (idx as f64 * 0.7).sin(),
        ));
    }

    let config = FireConfig::default();
    let mut state = FireState::new(initial, &config);

    let initial_energy = spring_network_energy(&state.positions, &neighbors, k, r_eq);

    // Run optimization
    let max_steps = 1000;
    let fmax = 0.001;

    for _ in 0..max_steps {
        state.step(
            |pos| spring_network_forces(pos, &neighbors, k, r_eq),
            &config,
        );
        if state.is_converged(fmax) {
            break;
        }
    }

    assert!(
        state.is_converged(fmax),
        "Spring network should converge, max_force={}",
        state.max_force()
    );

    let final_energy = spring_network_energy(&state.positions, &neighbors, k, r_eq);
    assert!(
        final_energy < initial_energy * 0.01,
        "Energy should decrease significantly: {initial_energy} -> {final_energy}"
    );

    // Check all bond lengths are approximately r_eq
    for &(idx_i, idx_j) in &neighbors {
        let bond_len = (state.positions[idx_j] - state.positions[idx_i]).norm();
        assert!(
            (bond_len - r_eq).abs() < 0.05,
            "Bond {idx_i}-{idx_j} length should be ~{r_eq}, got {bond_len}"
        );
    }
}

#[test]
fn test_spring_network_2d_grid() {
    // 3x3 grid of atoms connected by springs
    let n_side = 3;
    let k = 1.0;
    let r_eq = 1.0;

    // Create grid positions (perturbed)
    let mut initial = Vec::new();
    for row in 0..n_side {
        for col in 0..n_side {
            initial.push(Vector3::new(
                col as f64 * 0.8 + 0.1,  // Compressed
                row as f64 * 1.1 - 0.05, // Stretched
                0.05 * ((row + col) as f64).sin(),
            ));
        }
    }

    // Connect neighbors (horizontal and vertical)
    let mut neighbors = Vec::new();
    for row in 0..n_side {
        for col in 0..n_side {
            let idx = row * n_side + col;
            // Right neighbor
            if col < n_side - 1 {
                neighbors.push((idx, idx + 1));
            }
            // Down neighbor
            if row < n_side - 1 {
                neighbors.push((idx, idx + n_side));
            }
        }
    }

    let config = FireConfig::default();
    let mut state = FireState::new(initial, &config);

    for _ in 0..1000 {
        state.step(
            |pos| spring_network_forces(pos, &neighbors, k, r_eq),
            &config,
        );
        if state.is_converged(0.001) {
            break;
        }
    }

    assert!(state.is_converged(0.001), "2D spring grid should converge");

    // All bonds should be at equilibrium length
    for &(idx_i, idx_j) in &neighbors {
        let bond_len = (state.positions[idx_j] - state.positions[idx_i]).norm();
        assert!(
            (bond_len - r_eq).abs() < 0.05,
            "Grid bond length should be ~{r_eq}, got {bond_len}"
        );
    }
}

#[test]
fn test_cell_fire_hydrostatic_stress() {
    // Test cell optimization with hydrostatic stress (uniform pressure)
    let positions = vec![
        Vector3::new(0.25, 0.25, 0.25),
        Vector3::new(0.75, 0.75, 0.75),
    ];

    // Start with non-cubic cell
    let initial_cell = Matrix3::new(4.0, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 6.0);

    let config = FireConfig::default();
    // Use small cell_factor to avoid instability (volume ~120 Å³ amplifies forces)
    let mut state = CellFireState::new(positions, initial_cell, &config, 0.01);

    // Target cell: 5x5x5 cubic
    let target_len = 5.0;

    let compute = |_pos: &[Vector3<f64>], cell: &Matrix3<f64>| {
        let forces = vec![Vector3::zeros(), Vector3::zeros()];

        // Stress proportional to deviation from cubic
        // Positive stress when cell is too large (tensile = contract)
        // Negative stress when cell is too small (compressive = expand)
        let a_len = cell.row(0).norm();
        let b_len = cell.row(1).norm();
        let c_len = cell.row(2).norm();

        let stress = Matrix3::new(
            (a_len - target_len) * 0.1,
            0.0,
            0.0,
            0.0,
            (b_len - target_len) * 0.1,
            0.0,
            0.0,
            0.0,
            (c_len - target_len) * 0.1,
        );

        (forces, stress)
    };

    for _ in 0..500 {
        state.step(compute, &config);
    }

    // Check cell approached cubic
    let a_len = state.cell.row(0).norm();
    let b_len = state.cell.row(1).norm();
    let c_len = state.cell.row(2).norm();

    assert!(
        (a_len - target_len).abs() < 0.3,
        "Cell a should approach {target_len}, got {a_len}"
    );
    assert!(
        (b_len - target_len).abs() < 0.3,
        "Cell b should approach {target_len}, got {b_len}"
    );
    assert!(
        (c_len - target_len).abs() < 0.3,
        "Cell c should approach {target_len}, got {c_len}"
    );
}

#[test]
fn test_cell_fire_shear_stress() {
    // Test cell optimization with shear stress
    let positions = vec![Vector3::new(0.5, 0.5, 0.5)];

    // Start with sheared cell
    let initial_cell = Matrix3::new(
        5.0, 1.0, 0.0, // Sheared
        0.0, 5.0, 0.0, 0.0, 0.0, 5.0,
    );

    let config = FireConfig::default();
    // Use small cell_factor to avoid instability
    let mut state = CellFireState::new(positions, initial_cell, &config, 0.01);

    // Stress that tries to remove shear
    // Positive shear stress when shear > 0 (want to reduce it)
    let compute = |_pos: &[Vector3<f64>], cell: &Matrix3<f64>| {
        let forces = vec![Vector3::zeros()];

        // Off-diagonal stress to remove shear
        let shear_xy = cell[(0, 1)];
        let stress = Matrix3::new(
            0.0,
            shear_xy * 0.1,
            0.0,
            shear_xy * 0.1,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
        );

        (forces, stress)
    };

    for _ in 0..300 {
        state.step(compute, &config);
    }

    // Shear should be reduced
    let shear = state.cell[(0, 1)].abs();
    assert!(shear < 0.3, "Shear should be reduced, got {shear}");
}

#[test]
fn test_fire_convergence_tolerance() {
    // Test that different fmax values work correctly
    let minimum = vec![Vector3::new(0.0, 0.0, 0.0)];
    let initial = vec![Vector3::new(0.5, 0.3, 0.2)];

    let config = FireConfig::default();
    let k = 1.0;

    // Test loose tolerance
    let mut state1 = FireState::new(initial.clone(), &config);
    let mut steps_loose = 0;
    for _ in 0..500 {
        state1.step(
            |pos| {
                pos.iter()
                    .zip(&minimum)
                    .map(|(r, r_min)| -k * (r - r_min))
                    .collect()
            },
            &config,
        );
        steps_loose += 1;
        if state1.is_converged(0.1) {
            break;
        }
    }

    // Test tight tolerance
    let mut state2 = FireState::new(initial, &config);
    let mut steps_tight = 0;
    for _ in 0..500 {
        state2.step(
            |pos| {
                pos.iter()
                    .zip(&minimum)
                    .map(|(r, r_min)| -k * (r - r_min))
                    .collect()
            },
            &config,
        );
        steps_tight += 1;
        if state2.is_converged(0.001) {
            break;
        }
    }

    assert!(
        steps_tight > steps_loose,
        "Tighter tolerance should require more steps: {steps_loose} vs {steps_tight}"
    );
}
