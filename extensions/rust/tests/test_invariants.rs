//! Conservation law and physics invariant tests.
//!
//! Covers potentials.rs and md/ with tests for energy conservation,
//! Newton's third law, stress tensor symmetry, permutation invariance,
//! and time-reversibility.

mod common;

use common::{make_fcc, make_fcc_supercell, make_nacl};
use ferrox::element::Element;
use ferrox::md::state::MDState;
use ferrox::md::verlet::{velocity_verlet_finalize, velocity_verlet_init};
use ferrox::potentials::{
    LennardJonesParams, PotentialResult, compute_lj_full, compute_morse_simple,
    compute_soft_sphere_simple,
};
use nalgebra::{Matrix3, Vector3};

// === Helpers ===

// Extract Cartesian positions from a Structure for use with potentials.
fn structure_positions(structure: &ferrox::structure::Structure) -> Vec<Vector3<f64>> {
    structure.cart_coords()
}

// Compute LJ energy and forces for a set of positions with given cell.
fn lj_energy_forces(
    positions: &[Vector3<f64>],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    params: &LennardJonesParams,
) -> (f64, Vec<Vector3<f64>>) {
    let result = compute_lj_full(positions, cell, pbc, params, false).unwrap();
    (result.energy, result.forces)
}

// Assert sum of forces is zero (Newton's 3rd law).
fn assert_force_sum_zero(label: &str, result: &PotentialResult) {
    let total_force: Vector3<f64> = result.forces.iter().sum();
    let force_mag = total_force.norm();
    assert!(
        force_mag < 1e-10,
        "[BUG] {label} Newton's 3rd: total force mag={force_mag:.2e}"
    );
}

// Assert stress tensor is symmetric.
fn assert_stress_symmetric(label: &str, stress: &Matrix3<f64>) {
    for row in 0..3 {
        for col in (row + 1)..3 {
            let diff = (stress[(row, col)] - stress[(col, row)]).abs();
            assert!(
                diff < 1e-12,
                "[BUG] {label} stress asymmetry: ({row},{col}) diff={diff:.2e}"
            );
        }
    }
}

// === NVE Energy Conservation ===

#[test]
fn nve_energy_conservation_lj() {
    // Run 1000 Velocity Verlet steps with LJ, check total energy drift < 1e-6 per step
    // Use 3x3x3 supercell so cutoff (5.0) < L/2 (5.1) to avoid discontinuities
    let structure = make_fcc_supercell(3.4, Element::Ar, 3, 3, 3);
    let positions = structure_positions(&structure);
    let cell = *structure.lattice.matrix();
    let pbc = [true, true, true];
    let params = LennardJonesParams::new(3.4, 0.0103, Some(5.0));
    let n_atoms = positions.len();

    let masses = vec![39.948; n_atoms]; // Argon mass in amu
    let mut state = MDState::with_cell(positions, masses, cell, pbc);
    state.init_velocities(30.0, Some(42)); // Low temperature for stability

    let (initial_energy, initial_forces) =
        lj_energy_forces(&state.positions, Some(&cell), pbc, &params);
    state.set_forces(&initial_forces);

    let initial_total = initial_energy + state.kinetic_energy();

    let dt_fs = 0.5;
    let n_steps = 1000;

    for _step in 0..n_steps {
        state = velocity_verlet_init(state, dt_fs);
        let (_, new_forces) = lj_energy_forces(&state.positions, Some(&cell), pbc, &params);
        state = velocity_verlet_finalize(state, dt_fs, &new_forces);
    }

    let (final_pe, _) = lj_energy_forces(&state.positions, Some(&cell), pbc, &params);
    let final_total = final_pe + state.kinetic_energy();

    let drift_per_step = (final_total - initial_total).abs() / n_steps as f64;
    assert!(
        drift_per_step < 1e-6,
        "[BUG] NVE drift={drift_per_step:.2e} eV/step (initial={initial_total:.6}, final={final_total:.6})"
    );
}

// === Force Symmetry (Newton's Third Law) ===

#[test]
fn force_symmetry_all_potentials() {
    let fcc_cu = make_fcc(3.6, Element::Cu);
    let pos_cu = structure_positions(&fcc_cu);
    let cell_cu = *fcc_cu.lattice.matrix();

    let fcc_ar = make_fcc(3.5, Element::Ar);
    let pos_ar = structure_positions(&fcc_ar);
    let cell_ar = *fcc_ar.lattice.matrix();

    let fcc_cu2 = make_fcc(3.0, Element::Cu);
    let pos_cu2 = structure_positions(&fcc_cu2);
    let cell_cu2 = *fcc_cu2.lattice.matrix();

    let nacl = make_nacl(5.64);
    let pos_nacl = structure_positions(&nacl);
    let cell_nacl = *nacl.lattice.matrix();

    // LJ on FCC Cu
    let lj_params = LennardJonesParams::new(2.5, 0.01, Some(6.0));
    let lj_result = compute_lj_full(&pos_cu, Some(&cell_cu), [true; 3], &lj_params, false).unwrap();
    assert_force_sum_zero("LJ", &lj_result);

    // Morse on FCC Cu
    let morse_result = compute_morse_simple(
        &pos_cu2,
        Some(&cell_cu2),
        [true; 3],
        0.5,
        1.5,
        2.1,
        5.0,
        false,
    )
    .unwrap();
    assert_force_sum_zero("Morse", &morse_result);

    // Soft Sphere on FCC Ar
    let ss_result = compute_soft_sphere_simple(
        &pos_ar,
        Some(&cell_ar),
        [true; 3],
        1.5,
        0.5,
        12.0,
        5.0,
        false,
    )
    .unwrap();
    assert_force_sum_zero("SoftSphere", &ss_result);

    // LJ on NaCl (multi-species)
    let nacl_params = LennardJonesParams::new(3.0, 0.01, Some(8.0));
    let nacl_result =
        compute_lj_full(&pos_nacl, Some(&cell_nacl), [true; 3], &nacl_params, false).unwrap();
    assert_force_sum_zero("NaCl LJ", &nacl_result);
}

// === Stress Tensor Symmetry ===

#[test]
fn stress_tensor_symmetry_all_potentials() {
    let fcc_cu = make_fcc(3.6, Element::Cu);
    let pos_cu = structure_positions(&fcc_cu);
    let cell_cu = *fcc_cu.lattice.matrix();

    let fcc_cu2 = make_fcc(3.0, Element::Cu);
    let pos_cu2 = structure_positions(&fcc_cu2);
    let cell_cu2 = *fcc_cu2.lattice.matrix();

    // LJ stress
    let lj_params = LennardJonesParams::new(2.5, 0.01, Some(6.0));
    let lj_stress = compute_lj_full(&pos_cu, Some(&cell_cu), [true; 3], &lj_params, true)
        .unwrap()
        .stress
        .expect("stress should be computed");
    assert_stress_symmetric("LJ", &lj_stress);

    // Morse stress
    let morse_stress = compute_morse_simple(
        &pos_cu2,
        Some(&cell_cu2),
        [true; 3],
        0.5,
        1.5,
        2.1,
        5.0,
        true,
    )
    .unwrap()
    .stress
    .expect("stress should be computed");
    assert_stress_symmetric("Morse", &morse_stress);
}

// === Permutation Invariance ===

#[test]
fn permutation_invariance_lj() {
    // Shuffling atom order gives same total energy
    let structure = make_fcc(3.6, Element::Cu);
    let positions = structure_positions(&structure);
    let cell = *structure.lattice.matrix();
    let params = LennardJonesParams::new(2.5, 0.01, Some(6.0));

    let energy_original = compute_lj_full(&positions, Some(&cell), [true; 3], &params, false)
        .unwrap()
        .energy;

    // Reverse atom order
    let mut pos_reversed = positions.clone();
    pos_reversed.reverse();
    let energy_reversed = compute_lj_full(&pos_reversed, Some(&cell), [true; 3], &params, false)
        .unwrap()
        .energy;
    assert!(
        (energy_original - energy_reversed).abs() < 1e-10,
        "[BUG] LJ permutation: original={energy_original:.8e}, reversed={energy_reversed:.8e}"
    );

    // Swap first two atoms
    let mut pos_swapped = positions.clone();
    pos_swapped.swap(0, 1);
    let energy_swapped = compute_lj_full(&pos_swapped, Some(&cell), [true; 3], &params, false)
        .unwrap()
        .energy;
    assert!(
        (energy_original - energy_swapped).abs() < 1e-10,
        "[BUG] LJ swap: original={energy_original:.8e}, swapped={energy_swapped:.8e}"
    );
}

// === Time-Reversibility of Verlet ===

#[test]
fn verlet_time_reversibility() {
    // Run N steps forward, negate velocities, run N steps back, check positions match.
    // Use non-PBC to avoid cutoff-induced discontinuities.
    let positions = vec![
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(4.0, 0.0, 0.0),
        Vector3::new(0.0, 4.0, 0.0),
        Vector3::new(0.0, 0.0, 4.0),
    ];
    let params = LennardJonesParams::new(3.4, 0.0103, None); // No cutoff = no discontinuity
    let n_atoms = positions.len();

    let mut state = MDState::new(positions.clone(), vec![39.948; n_atoms]);
    state.pbc = [false, false, false];
    state.init_velocities(20.0, Some(123));

    let initial_positions = state.positions.clone();
    let initial_velocities = state.velocities.clone();

    let (_, initial_forces) = lj_energy_forces(&state.positions, None, [false; 3], &params);
    state.set_forces(&initial_forces);

    let dt_fs = 0.5;
    let n_steps = 20;

    // Run forward
    for _step in 0..n_steps {
        state = velocity_verlet_init(state, dt_fs);
        let (_, new_forces) = lj_energy_forces(&state.positions, None, [false; 3], &params);
        state = velocity_verlet_finalize(state, dt_fs, &new_forces);
    }

    // Negate velocities and run backward
    for vel in &mut state.velocities {
        *vel = -*vel;
    }
    for _step in 0..n_steps {
        state = velocity_verlet_init(state, dt_fs);
        let (_, new_forces) = lj_energy_forces(&state.positions, None, [false; 3], &params);
        state = velocity_verlet_finalize(state, dt_fs, &new_forces);
    }

    // Check positions match initial
    let max_pos_diff = state
        .positions
        .iter()
        .zip(&initial_positions)
        .map(|(pos, init)| (pos - init).norm())
        .fold(0.0f64, f64::max);
    assert!(
        max_pos_diff < 1e-6,
        "[BUG] Verlet reversibility: max position diff={max_pos_diff:.2e}"
    );

    // Check velocities are negated from initial
    for vel in &mut state.velocities {
        *vel = -*vel;
    }
    let max_vel_diff = state
        .velocities
        .iter()
        .zip(&initial_velocities)
        .map(|(vel, init)| (vel - init).norm())
        .fold(0.0f64, f64::max);
    assert!(
        max_vel_diff < 1e-6,
        "[BUG] Verlet velocity reversibility: max diff={max_vel_diff:.2e}"
    );
}
