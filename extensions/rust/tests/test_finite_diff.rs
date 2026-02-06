//! Finite-difference force and stress validation for potentials.
//!
//! Verifies analytic forces and stresses against numerical derivatives
//! for all potentials in potentials.rs.

mod common;

use ferrox::potentials::{
    HarmonicBond, LennardJonesParams, compute_harmonic_bonds, compute_lj_full,
    compute_morse_simple, compute_soft_sphere_simple,
};
use nalgebra::{Matrix3, Vector3};

// === Helpers ===

// Compute numerical force on atom `atom_idx` in direction `dim` using central differences.
fn numerical_force<F>(
    positions: &[Vector3<f64>],
    atom_idx: usize,
    dim: usize,
    delta: f64,
    energy_fn: F,
) -> f64
where
    F: Fn(&[Vector3<f64>]) -> f64,
{
    let mut pos_plus = positions.to_vec();
    let mut pos_minus = positions.to_vec();
    pos_plus[atom_idx][dim] += delta;
    pos_minus[atom_idx][dim] -= delta;
    let e_plus = energy_fn(&pos_plus);
    let e_minus = energy_fn(&pos_minus);
    -(e_plus - e_minus) / (2.0 * delta)
}

// Compute numerical stress component using central strain differences.
// Stress convention: sigma_ab = (1/V) dE/d_eps_ab
fn numerical_stress_component<F>(
    positions: &[Vector3<f64>],
    cell: &Matrix3<f64>,
    voigt_idx: usize,
    delta: f64,
    energy_fn: F,
) -> f64
where
    F: Fn(&[Vector3<f64>], &Matrix3<f64>) -> f64,
{
    let volume = cell.determinant().abs();

    // Build strain tensor from Voigt index
    let (row, col) = match voigt_idx {
        0 => (0, 0),
        1 => (1, 1),
        2 => (2, 2),
        3 => (1, 2),
        4 => (0, 2),
        5 => (0, 1),
        _ => unreachable!(),
    };

    let mut strain_plus = Matrix3::identity();
    let mut strain_minus = Matrix3::identity();
    strain_plus[(row, col)] += delta;
    strain_minus[(row, col)] -= delta;
    if row != col {
        strain_plus[(col, row)] += delta;
        strain_minus[(col, row)] -= delta;
    }

    // Apply strain to cell and positions (affine transformation)
    let cell_plus = strain_plus * cell;
    let cell_minus = strain_minus * cell;

    let pos_plus: Vec<Vector3<f64>> = positions.iter().map(|p| strain_plus * p).collect();
    let pos_minus: Vec<Vector3<f64>> = positions.iter().map(|p| strain_minus * p).collect();

    let e_plus = energy_fn(&pos_plus, &cell_plus);
    let e_minus = energy_fn(&pos_minus, &cell_minus);

    let raw = (e_plus - e_minus) / (2.0 * delta * volume);
    // For off-diagonal components, the symmetric strain doubles the effect
    if row != col { raw / 2.0 } else { raw }
}

// Make a 2-atom dimer at given separation.
fn make_dimer(separation: f64) -> Vec<Vector3<f64>> {
    vec![
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(separation, 0.0, 0.0),
    ]
}

// Make displaced positions in a large enough cell for PBC tests.
// Uses a 2x2x2 FCC supercell with small random displacements so forces are nonzero.
// Returns (positions, cell) where cutoff < L/2 is satisfied.
fn make_displaced_fcc(a: f64) -> (Vec<Vector3<f64>>, Matrix3<f64>) {
    let big_a = 2.0 * a; // 2x2x2 supercell dimension
    let cell = Matrix3::new(big_a, 0.0, 0.0, 0.0, big_a, 0.0, 0.0, 0.0, big_a);

    // FCC basis
    let basis = [
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(0.5 * a, 0.5 * a, 0.0),
        Vector3::new(0.5 * a, 0.0, 0.5 * a),
        Vector3::new(0.0, 0.5 * a, 0.5 * a),
    ];

    let mut positions = Vec::new();
    // Create 2x2x2 supercell with small displacements
    for ix in 0..2 {
        for iy in 0..2 {
            for iz in 0..2 {
                let offset = Vector3::new(ix as f64 * a, iy as f64 * a, iz as f64 * a);
                for base in basis.iter() {
                    // Small deterministic displacement to break symmetry
                    let atom_idx = positions.len();
                    let dx = 0.02 * ((atom_idx * 7 + 3) % 11) as f64 / 10.0 - 0.01;
                    let dy = 0.02 * ((atom_idx * 13 + 5) % 11) as f64 / 10.0 - 0.01;
                    let dz = 0.02 * ((atom_idx * 17 + 7) % 11) as f64 / 10.0 - 0.01;
                    positions.push(offset + base + Vector3::new(dx, dy, dz));
                }
            }
        }
    }

    (positions, cell)
}

// Assert forces match within tolerance.
fn assert_forces_match(
    label: &str,
    positions: &[Vector3<f64>],
    analytic_forces: &[Vector3<f64>],
    delta: f64,
    force_tol: f64,
    energy_fn: impl Fn(&[Vector3<f64>]) -> f64,
) {
    for (atom_idx, analytic_force) in analytic_forces.iter().enumerate() {
        for dim in 0..3 {
            let num_force = numerical_force(positions, atom_idx, dim, delta, &energy_fn);
            let analytic = analytic_force[dim];
            let abs_diff = (analytic - num_force).abs();
            let rel_diff = if analytic.abs() > 1e-10 {
                abs_diff / analytic.abs()
            } else {
                abs_diff
            };
            assert!(
                rel_diff < force_tol || abs_diff < 1e-8,
                "[BUG] {label} force: atom={atom_idx}, dim={dim}, analytic={analytic:.6e}, numerical={num_force:.6e}, rel_diff={rel_diff:.2e}"
            );
        }
    }
}

// Assert stress matches within tolerance.
fn assert_stress_matches(
    label: &str,
    positions: &[Vector3<f64>],
    cell: &Matrix3<f64>,
    analytic_stress: &Matrix3<f64>,
    delta: f64,
    stress_tol: f64,
    energy_fn: impl Fn(&[Vector3<f64>], &Matrix3<f64>) -> f64,
) {
    for voigt_idx in 0..6 {
        let (row, col) = match voigt_idx {
            0 => (0, 0),
            1 => (1, 1),
            2 => (2, 2),
            3 => (1, 2),
            4 => (0, 2),
            5 => (0, 1),
            _ => unreachable!(),
        };
        let num_stress = numerical_stress_component(positions, cell, voigt_idx, delta, &energy_fn);
        let analytic = analytic_stress[(row, col)];
        let abs_diff = (analytic - num_stress).abs();
        let rel_diff = if analytic.abs() > 1e-10 {
            abs_diff / analytic.abs()
        } else {
            abs_diff
        };
        assert!(
            rel_diff < stress_tol || abs_diff < 1e-8,
            "[BUG] {label} stress: voigt={voigt_idx}, analytic={analytic:.6e}, numerical={num_stress:.6e}, rel_diff={rel_diff:.2e}"
        );
    }
}

const DELTA: f64 = 1e-5;
const FORCE_TOL: f64 = 1e-4;
const STRESS_TOL: f64 = 1e-3;

// === Lennard-Jones Force Tests ===

#[test]
fn lj_dimer_forces() {
    let params = LennardJonesParams::new(3.4, 0.0103, None);
    let positions = make_dimer(3.8);
    let result = compute_lj_full(&positions, None, [false; 3], &params, false).unwrap();

    assert_forces_match(
        "LJ dimer",
        &positions,
        &result.forces,
        DELTA,
        FORCE_TOL,
        |pos| {
            compute_lj_full(pos, None, [false; 3], &params, false)
                .unwrap()
                .energy
        },
    );
}

#[test]
fn lj_fcc_forces_with_pbc() {
    let (positions, cell) = make_displaced_fcc(3.6);
    let pbc = [true, true, true];
    // cell is 7.2 A, cutoff must be < L/2 = 3.6
    let params = LennardJonesParams::new(2.5, 0.01, Some(3.5));

    let result = compute_lj_full(&positions, Some(&cell), pbc, &params, false).unwrap();

    assert_forces_match(
        "LJ FCC PBC",
        &positions,
        &result.forces,
        DELTA,
        FORCE_TOL,
        |pos| {
            compute_lj_full(pos, Some(&cell), pbc, &params, false)
                .unwrap()
                .energy
        },
    );
}

#[test]
fn lj_fcc_stress() {
    let params = LennardJonesParams::new(2.5, 0.01, Some(3.5));
    let (positions, cell) = make_displaced_fcc(3.6);
    let pbc = [true, true, true];

    let result = compute_lj_full(&positions, Some(&cell), pbc, &params, true).unwrap();
    let stress = result.stress.expect("stress should be computed");

    assert_stress_matches(
        "LJ FCC",
        &positions,
        &cell,
        &stress,
        DELTA,
        STRESS_TOL,
        |pos, c| {
            compute_lj_full(pos, Some(c), pbc, &params, false)
                .unwrap()
                .energy
        },
    );
}

// === Morse Potential Tests ===

#[test]
fn morse_dimer_forces() {
    let positions = make_dimer(1.5);
    let d_param = 1.0;
    let alpha = 2.0;
    let r0 = 1.2;
    let cutoff = 10.0;

    let result = compute_morse_simple(
        &positions, None, [false; 3], d_param, alpha, r0, cutoff, false,
    )
    .unwrap();

    assert_forces_match(
        "Morse dimer",
        &positions,
        &result.forces,
        DELTA,
        FORCE_TOL,
        |pos| {
            compute_morse_simple(pos, None, [false; 3], d_param, alpha, r0, cutoff, false)
                .unwrap()
                .energy
        },
    );
}

#[test]
fn morse_fcc_forces_with_pbc() {
    let (positions, cell) = make_displaced_fcc(3.0);
    let pbc = [true, true, true];
    let d_param = 0.5;
    let alpha = 1.5;
    let r0 = 2.1;
    let cutoff = 2.9; // Must be < L/2 = 3.0

    let result = compute_morse_simple(
        &positions,
        Some(&cell),
        pbc,
        d_param,
        alpha,
        r0,
        cutoff,
        false,
    )
    .unwrap();

    assert_forces_match(
        "Morse FCC PBC",
        &positions,
        &result.forces,
        DELTA,
        FORCE_TOL,
        |pos| {
            compute_morse_simple(pos, Some(&cell), pbc, d_param, alpha, r0, cutoff, false)
                .unwrap()
                .energy
        },
    );
}

#[test]
fn morse_fcc_stress() {
    let (positions, cell) = make_displaced_fcc(3.0);
    let pbc = [true, true, true];
    let d_param = 0.5;
    let alpha = 1.5;
    let r0 = 2.1;
    let cutoff = 2.9;

    let result = compute_morse_simple(
        &positions,
        Some(&cell),
        pbc,
        d_param,
        alpha,
        r0,
        cutoff,
        true,
    )
    .unwrap();
    let stress = result.stress.expect("stress should be computed");

    assert_stress_matches(
        "Morse FCC",
        &positions,
        &cell,
        &stress,
        DELTA,
        STRESS_TOL,
        |pos, c| {
            compute_morse_simple(pos, Some(c), pbc, d_param, alpha, r0, cutoff, false)
                .unwrap()
                .energy
        },
    );
}

// === Soft Sphere Potential Tests ===

#[test]
fn soft_sphere_dimer_forces() {
    let positions = make_dimer(2.0);
    let sigma = 1.5;
    let epsilon = 0.5;
    let alpha = 12.0;
    let cutoff = 10.0;

    let result = compute_soft_sphere_simple(
        &positions, None, [false; 3], sigma, epsilon, alpha, cutoff, false,
    )
    .unwrap();

    assert_forces_match(
        "SoftSphere dimer",
        &positions,
        &result.forces,
        DELTA,
        FORCE_TOL,
        |pos| {
            compute_soft_sphere_simple(pos, None, [false; 3], sigma, epsilon, alpha, cutoff, false)
                .unwrap()
                .energy
        },
    );
}

#[test]
fn soft_sphere_fcc_stress() {
    let (positions, cell) = make_displaced_fcc(3.5);
    let pbc = [true, true, true];
    let sigma = 1.5;
    let epsilon = 0.5;
    let alpha = 12.0;
    let cutoff = 3.4; // < L/2 = 3.5

    let result = compute_soft_sphere_simple(
        &positions,
        Some(&cell),
        pbc,
        sigma,
        epsilon,
        alpha,
        cutoff,
        true,
    )
    .unwrap();
    let stress = result.stress.expect("stress should be computed");

    assert_stress_matches(
        "SoftSphere FCC",
        &positions,
        &cell,
        &stress,
        DELTA,
        STRESS_TOL,
        |pos, c| {
            compute_soft_sphere_simple(pos, Some(c), pbc, sigma, epsilon, alpha, cutoff, false)
                .unwrap()
                .energy
        },
    );
}

// === Harmonic Bond Tests ===

#[test]
fn harmonic_bond_forces() {
    let positions = make_dimer(1.5);
    let bonds = vec![HarmonicBond::new(0, 1, 10.0, 1.2)];

    let result = compute_harmonic_bonds(&positions, &bonds, None, [false; 3], false).unwrap();

    assert_forces_match(
        "Harmonic dimer",
        &positions,
        &result.forces,
        DELTA,
        FORCE_TOL,
        |pos| {
            compute_harmonic_bonds(pos, &bonds, None, [false; 3], false)
                .unwrap()
                .energy
        },
    );
}

#[test]
fn harmonic_bond_multi_atom_forces() {
    // 3-atom chain with 2 bonds
    let positions = vec![
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(1.3, 0.2, 0.0),
        Vector3::new(2.5, 0.1, 0.3),
    ];
    let bonds = vec![
        HarmonicBond::new(0, 1, 8.0, 1.2),
        HarmonicBond::new(1, 2, 8.0, 1.2),
    ];

    let result = compute_harmonic_bonds(&positions, &bonds, None, [false; 3], false).unwrap();

    assert_forces_match(
        "Harmonic chain",
        &positions,
        &result.forces,
        DELTA,
        FORCE_TOL,
        |pos| {
            compute_harmonic_bonds(pos, &bonds, None, [false; 3], false)
                .unwrap()
                .energy
        },
    );
}

#[test]
fn harmonic_bond_stress_with_pbc() {
    let cell = Matrix3::new(10.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 10.0);
    let positions = vec![Vector3::new(0.5, 0.5, 0.5), Vector3::new(2.0, 0.8, 0.3)];
    let bonds = vec![HarmonicBond::new(0, 1, 10.0, 1.2)];
    let pbc = [true, true, true];

    let result = compute_harmonic_bonds(&positions, &bonds, Some(&cell), pbc, true).unwrap();
    let stress = result.stress.expect("stress should be computed");

    assert_stress_matches(
        "Harmonic PBC",
        &positions,
        &cell,
        &stress,
        DELTA,
        STRESS_TOL,
        |pos, c| {
            compute_harmonic_bonds(pos, &bonds, Some(c), pbc, false)
                .unwrap()
                .energy
        },
    );
}
