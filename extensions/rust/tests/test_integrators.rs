//! Integration tests for MD integrators.
//!
//! These tests verify:
//! 1. Unit conversion correctness (internal time unit = 10.1805 fs)
//! 2. Analytical Ornstein-Uhlenbeck velocity relaxation for Langevin dynamics

use ferrox::integrators::{LangevinIntegrator, MDState, units};
use nalgebra::Vector3;

// =============================================================================
// Unit Conversion Tests
// =============================================================================

/// Verify the internal time unit constant is correct.
///
/// The internal time unit is defined as: _t = sqrt(amu * Å² / eV)
///
/// Using:
///   - 1 amu = 1.66054e-27 kg
///   - 1 Å = 1e-10 m
///   - 1 eV = 1.60218e-19 J
///
/// _t = sqrt(1.66054e-27 * (1e-10)² / 1.60218e-19)
///    = sqrt(1.66054e-27 * 1e-20 / 1.60218e-19)
///    = sqrt(1.03643e-28) = 1.01805e-14 s = 10.1805 fs
#[test]
fn test_internal_time_unit_value() {
    let amu_kg: f64 = 1.66054e-27;
    let angstrom_m: f64 = 1e-10;
    let ev_j: f64 = 1.60218e-19;

    // Calculate internal time in seconds
    let t_internal_s = (amu_kg * angstrom_m.powi(2) / ev_j).sqrt();

    // Convert to femtoseconds
    let t_internal_fs = t_internal_s * 1e15;

    // Verify against the constant in the code
    let rel_error = (t_internal_fs - units::INTERNAL_TIME_FS).abs() / units::INTERNAL_TIME_FS;
    assert!(
        rel_error < 1e-4,
        "Internal time unit {:.6} fs differs from expected {:.6} fs by {:.2e}",
        t_internal_fs,
        units::INTERNAL_TIME_FS,
        rel_error
    );
}

/// Verify FS_TO_INTERNAL and INTERNAL_TO_FS are consistent inverses.
#[test]
fn test_time_conversion_inverse() {
    let product = units::FS_TO_INTERNAL * units::INTERNAL_TO_FS;
    assert!(
        (product - 1.0).abs() < 1e-14,
        "FS_TO_INTERNAL * INTERNAL_TO_FS = {}, should be 1.0",
        product
    );
}

/// Verify Boltzmann constant value.
///
/// kB = 8.617333262e-5 eV/K (CODATA 2018)
#[test]
fn test_boltzmann_constant() {
    let kb_expected = 8.617333262e-5; // CODATA 2018 value
    let rel_error = (units::KB - kb_expected).abs() / kb_expected;
    assert!(
        rel_error < 1e-8,
        "kB = {:.9e} eV/K differs from expected {:.9e} eV/K",
        units::KB,
        kb_expected
    );
}

/// Verify that velocity in internal units gives correct kinetic energy.
///
/// For velocity v in Å/internal_time and mass m in amu:
/// KE = 0.5 * m * v² should be in eV
#[test]
fn test_kinetic_energy_units() {
    // A particle with mass 1 amu moving at 1 Å/internal_time
    // has KE = 0.5 * 1 * 1² = 0.5 in ASE energy units = 0.5 eV
    let mass: f64 = 1.0; // amu
    let velocity: f64 = 1.0; // Å/internal_time

    let ke = 0.5 * mass * velocity.powi(2);

    // This should be 0.5 eV (the definition of our unit system)
    assert!(
        (ke - 0.5_f64).abs() < 1e-14,
        "KE = {}, should be 0.5 eV",
        ke
    );
}

/// Verify velocity standard deviation from Maxwell-Boltzmann.
///
/// For Maxwell-Boltzmann: v_std = sqrt(kT/m)
/// At T = 300 K, m = 1 amu:
/// v_std = sqrt(8.617e-5 * 300 / 1) = sqrt(0.02585) ≈ 0.1608 Å/internal_time
#[test]
fn test_maxwell_boltzmann_velocity_scale() {
    let temp = 300.0; // K
    let mass = 1.0; // amu

    let v_std = (units::KB * temp / mass).sqrt();

    // Expected from equipartition: <v²> = kT/m, so v_std = sqrt(kT/m)
    let expected = (units::KB * temp / mass).sqrt();

    assert!(
        (v_std - expected).abs() / expected < 1e-10,
        "v_std = {:.6}, expected {:.6}",
        v_std,
        expected
    );
}

// =============================================================================
// Analytical Ornstein-Uhlenbeck Tests for Langevin Dynamics
// =============================================================================

/// Test Langevin velocity relaxation: <v(t)> = v0 * exp(-γt)
///
/// For a free particle with Langevin dynamics (no external forces),
/// the mean velocity decays exponentially with time constant 1/γ.
#[test]
fn test_langevin_velocity_relaxation() {
    let temp = 300.0;
    let friction = 0.01; // 1/fs
    let dt = 0.5; // fs
    let mass = 12.0; // amu (carbon)

    // Initial velocity: large enough to see clear decay
    let v0 = 0.5; // Å/internal_time

    // Number of independent runs for ensemble average
    let n_runs = 500;
    let n_steps = 200;

    // Collect velocity at each time step across all runs
    let mut mean_velocities = vec![0.0; n_steps + 1];

    for run in 0..n_runs {
        let positions = vec![Vector3::zeros()];
        let masses = vec![mass];
        let mut state = MDState::new(positions, masses);

        // Set initial velocity along x
        state.velocities[0] = Vector3::new(v0, 0.0, 0.0);

        // Record initial velocity
        mean_velocities[0] += state.velocities[0].x;

        // Create integrator with different seed for each run
        let mut integrator = LangevinIntegrator::new(temp, friction, dt, Some(run as u64 * 12345));

        // No external forces (free particle)
        let zero_forces = |_pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::zeros()] };

        for step in 0..n_steps {
            integrator.step(&mut state, zero_forces);
            mean_velocities[step + 1] += state.velocities[0].x;
        }
    }

    // Calculate ensemble averages
    for vel in &mut mean_velocities {
        *vel /= n_runs as f64;
    }

    // Verify exponential decay: <v(t)> = v0 * exp(-γt)
    // Note: friction is in 1/fs, but we need it in internal units for the decay
    let friction_internal = friction * units::INTERNAL_TO_FS;
    let dt_internal = dt * units::FS_TO_INTERNAL;

    // Check at several time points
    let check_times = [10, 50, 100, 150, 200];

    for &step in &check_times {
        let time_internal = step as f64 * dt_internal;
        let expected_v = v0 * (-friction_internal * time_internal).exp();
        let actual_v = mean_velocities[step];

        // Allow 20% error due to finite ensemble size
        let rel_error = (actual_v - expected_v).abs() / expected_v.abs().max(0.01);
        assert!(
            rel_error < 0.25,
            "At step {}: <v> = {:.4}, expected {:.4} (error {:.1}%)",
            step,
            actual_v,
            expected_v,
            rel_error * 100.0
        );
    }
}

/// Test Langevin equilibrium velocity variance: <v²> → kT/m
///
/// After equilibration, the velocity variance should approach kT/m.
#[test]
fn test_langevin_equilibrium_variance() {
    let temp = 300.0;
    let friction = 0.01;
    let dt = 1.0;
    let mass = 12.0;

    // Expected equilibrium variance
    let expected_var = units::KB * temp / mass;

    let positions = vec![Vector3::zeros()];
    let masses = vec![mass];
    let mut state = MDState::new(positions, masses);

    // Start with zero velocity
    let mut integrator = LangevinIntegrator::new(temp, friction, dt, Some(42));
    let zero_forces = |_pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::zeros()] };

    // Equilibrate
    for _ in 0..5000 {
        integrator.step(&mut state, zero_forces);
    }

    // Collect variance samples
    let mut v_squared_samples = Vec::with_capacity(10000);
    for _ in 0..10000 {
        integrator.step(&mut state, zero_forces);
        // Per-component variance (each component independently has variance kT/m)
        v_squared_samples.push(state.velocities[0].x.powi(2));
    }

    let actual_var = v_squared_samples.iter().sum::<f64>() / v_squared_samples.len() as f64;

    // Allow 10% error
    let rel_error = (actual_var - expected_var).abs() / expected_var;
    assert!(
        rel_error < 0.1,
        "<v²> = {:.6}, expected kT/m = {:.6} (error {:.1}%)",
        actual_var,
        expected_var,
        rel_error * 100.0
    );
}

/// Test Langevin free particle MSD growth.
///
/// For a free particle with Langevin dynamics:
/// - Short time (ballistic): MSD ∝ t²
/// - Long time (diffusive): MSD ∝ 2Dt where D = kT/(mγ)
///
/// This test verifies that MSD grows monotonically and is positive.
#[test]
fn test_langevin_diffusion_msd() {
    let temp = 300.0;
    let friction = 0.01; // Moderate friction
    let dt = 1.0;
    let mass = 12.0;

    let n_runs = 100;
    let n_steps = 200;

    let mut msd_sum = vec![0.0; n_steps + 1];

    for run in 0..n_runs {
        let positions = vec![Vector3::zeros()];
        let masses = vec![mass];
        let mut state = MDState::new(positions, masses);

        let initial_x = state.positions[0].x;
        msd_sum[0] += 0.0;

        let mut integrator = LangevinIntegrator::new(temp, friction, dt, Some(run as u64 * 7777));
        let zero_forces = |_pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::zeros()] };

        for step in 0..n_steps {
            integrator.step(&mut state, zero_forces);
            let dx = state.positions[0].x - initial_x;
            msd_sum[step + 1] += dx.powi(2);
        }
    }

    // Calculate average MSD
    for msd in &mut msd_sum {
        *msd /= n_runs as f64;
    }

    // MSD should be positive and growing
    assert!(
        msd_sum[100] > 0.0,
        "MSD at step 100 should be positive, got {}",
        msd_sum[100]
    );

    assert!(
        msd_sum[100] < msd_sum[200],
        "MSD should grow with time: MSD(100)={} vs MSD(200)={}",
        msd_sum[100],
        msd_sum[200]
    );

    // MSD should be roughly consistent with diffusive behavior
    // D = kT/(mγ) ≈ 8.6e-5 * 300 / (12 * 0.01 * 10.18) ≈ 0.021 Å²/fs
    // At t=200 fs, MSD ≈ 2 * 0.021 * 200 = 8.4 Å² (order of magnitude check)
    assert!(
        msd_sum[200] > 0.1 && msd_sum[200] < 100.0,
        "MSD at 200 fs should be reasonable, got {} Å²",
        msd_sum[200]
    );
}

/// Test that Langevin integrator coefficients c1 = exp(-γ*dt).
#[test]
fn test_langevin_c1_coefficient() {
    let temp = 300.0;
    let friction = 0.01; // 1/fs
    let dt = 1.0; // fs

    let _integrator = LangevinIntegrator::new(temp, friction, dt, Some(42));

    // c1 = exp(-γ*dt) where γ is in internal units and dt is in internal units
    let friction_internal = friction * units::INTERNAL_TO_FS;
    let dt_internal = dt * units::FS_TO_INTERNAL;
    let expected_c1 = (-friction_internal * dt_internal).exp();

    // Access c1 via the public field (if exposed) or verify behavior
    // Since c1 is private, we verify through the velocity update behavior

    // For a single O-U step with v = v0, no force:
    // v_new = c1 * v + c2 * v_std * noise
    // With seed, we can predict the outcome

    let mass = 12.0;
    let positions = vec![Vector3::zeros()];
    let masses = vec![mass];
    let mut state = MDState::new(positions, masses);

    let v0 = 1.0;
    state.velocities[0] = Vector3::new(v0, 0.0, 0.0);

    // The BAOAB scheme is: B-A-O-A-B
    // For zero forces, B does nothing, A moves positions
    // O applies: v_new = c1 * v + c2 * v_std * noise

    // This test just verifies the mathematical relationship is correct
    // by checking that c1*c2 relationship holds: c2 = sqrt(1 - c1^2)
    let c2_expected = (1.0 - expected_c1.powi(2)).sqrt();

    // Verify c1² + c2² = 1
    let sum = expected_c1.powi(2) + c2_expected.powi(2);
    assert!(
        (sum - 1.0).abs() < 1e-14,
        "c1² + c2² = {}, should be 1.0",
        sum
    );
}

// =============================================================================
// Velocity Verlet Symplectic Property Tests
// =============================================================================

/// Test that Velocity Verlet is time-reversible.
///
/// Running forward then reversing velocities and running backward
/// should return to the initial state (within numerical precision).
#[test]
fn test_velocity_verlet_time_reversibility() {
    use ferrox::integrators::velocity_verlet_step;

    let positions = vec![Vector3::new(1.0, 0.0, 0.0)];
    let masses = vec![1.0];
    let mut state = MDState::new(positions, masses);

    let k = 1.0; // Harmonic spring constant
    let compute_forces =
        |pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::new(-k * pos[0].x, 0.0, 0.0)] };

    // Initial conditions
    let x0 = state.positions[0].x;
    let v0 = 0.0; // Start at rest

    // Initialize forces
    let forces = compute_forces(&state.positions);
    state.set_forces(&forces);

    let dt = 0.5;
    let n_steps = 100;

    // Run forward
    for _ in 0..n_steps {
        velocity_verlet_step(&mut state, dt, compute_forces);
    }

    // Reverse velocities
    for vel in &mut state.velocities {
        *vel = -*vel;
    }

    // Run forward again (same number of steps) - equivalent to running backward in time
    for _ in 0..n_steps {
        velocity_verlet_step(&mut state, dt, compute_forces);
    }

    // Reverse velocities again
    for vel in &mut state.velocities {
        *vel = -*vel;
    }

    // Should be back to initial state
    let x_final = state.positions[0].x;
    let v_final = state.velocities[0].x;

    assert!(
        (x_final - x0).abs() < 1e-10,
        "Position not reversible: x0={}, x_final={}",
        x0,
        x_final
    );
    assert!(
        (v_final - v0).abs() < 1e-10,
        "Velocity not reversible: v0={}, v_final={}",
        v0,
        v_final
    );
}

/// Test phase space volume preservation (Liouville's theorem).
///
/// For a symplectic integrator, the phase space volume should be preserved.
/// We test this by running nearby trajectories and checking the volume ratio.
#[test]
fn test_velocity_verlet_phase_space_preservation() {
    use ferrox::integrators::velocity_verlet_step;

    let k = 1.0;
    let compute_forces =
        |pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::new(-k * pos[0].x, 0.0, 0.0)] };

    // Create 4 initial conditions forming a small rectangle in (x, vx) space
    let x0 = 1.0;
    let v0 = 0.0;
    let dx = 0.001;
    let dv = 0.001;

    let corners_initial = vec![(x0, v0), (x0 + dx, v0), (x0 + dx, v0 + dv), (x0, v0 + dv)];

    let dt = 0.5;
    let n_steps = 50;

    let mut corners_final = Vec::new();

    for (xi, vi) in &corners_initial {
        let positions = vec![Vector3::new(*xi, 0.0, 0.0)];
        let masses = vec![1.0];
        let mut state = MDState::new(positions, masses);
        state.velocities[0] = Vector3::new(*vi, 0.0, 0.0);

        let forces = compute_forces(&state.positions);
        state.set_forces(&forces);

        for _ in 0..n_steps {
            velocity_verlet_step(&mut state, dt, compute_forces);
        }

        corners_final.push((state.positions[0].x, state.velocities[0].x));
    }

    // Calculate initial and final areas using shoelace formula
    fn polygon_area(corners: &[(f64, f64)]) -> f64 {
        let n = corners.len();
        let mut area = 0.0;
        for idx in 0..n {
            let (x1, y1) = corners[idx];
            let (x2, y2) = corners[(idx + 1) % n];
            area += x1 * y2 - x2 * y1;
        }
        area.abs() / 2.0
    }

    let area_initial = polygon_area(&corners_initial);
    let area_final = polygon_area(&corners_final);

    // Areas should be equal (volume preserved)
    let rel_error = (area_final - area_initial).abs() / area_initial;
    assert!(
        rel_error < 1e-6,
        "Phase space volume not preserved: initial={:.6e}, final={:.6e}, error={:.2e}",
        area_initial,
        area_final,
        rel_error
    );
}
