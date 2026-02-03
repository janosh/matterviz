//! Integration tests for MD integrators.
//!
//! These tests verify:
//! 1. Unit conversion correctness (internal time unit = 10.1805 fs)
//! 2. Analytical Ornstein-Uhlenbeck velocity relaxation for Langevin dynamics

use ferrox::md::{LangevinConfig, MDState, langevin_step, units, velocity_verlet_step};
use nalgebra::Vector3;
use rand::SeedableRng;
use rand::rngs::StdRng;

// === Unit Conversion Tests ===

/// Verify the internal time unit constant is correct.
#[test]
fn test_internal_time_unit_value() {
    let amu_kg: f64 = 1.66054e-27;
    let angstrom_m: f64 = 1e-10;
    let ev_j: f64 = 1.60218e-19;

    let t_internal_s = (amu_kg * angstrom_m.powi(2) / ev_j).sqrt();
    let t_internal_fs = t_internal_s * 1e15;

    let rel_error = (t_internal_fs - units::INTERNAL_TIME_FS).abs() / units::INTERNAL_TIME_FS;
    assert!(
        rel_error < 1e-4,
        "Internal time unit {:.6} fs differs from expected {:.6} fs by {:.2e}",
        t_internal_fs,
        units::INTERNAL_TIME_FS,
        rel_error
    );
}

/// Consolidated test for unit system consistency.
/// Verifies that time conversion constants and physical constants are correct.
#[test]
fn test_unit_system_consistency() {
    // Time conversion constants are inverses
    let product = units::FS_TO_INTERNAL * units::INTERNAL_TO_FS;
    assert!(
        (product - 1.0).abs() < 1e-14,
        "FS_TO_INTERNAL * INTERNAL_TO_FS should be 1.0"
    );

    // Boltzmann constant is correct (CODATA 2018 value)
    let kb_expected = 8.617333262e-5;
    let rel_error = (units::KB - kb_expected).abs() / kb_expected;
    assert!(rel_error < 1e-8, "kB should match CODATA value");

    // Maxwell-Boltzmann velocity scale: v_std = sqrt(kT/m)
    // At 300K with m=1 amu: v_std ≈ 0.1608 Å/internal_time
    let v_std = (units::KB * 300.0 / 1.0).sqrt();
    assert!((v_std - 0.1608).abs() < 0.001, "v_std should be ~0.1608");
}

// === Analytical Ornstein-Uhlenbeck Tests for Langevin Dynamics ===

/// Test Langevin velocity relaxation: <v(t)> = v0 * exp(-γt)
#[test]
fn test_langevin_velocity_relaxation() {
    let temp = 300.0;
    let friction = 0.01;
    let dt = 0.5;
    let mass = 12.0;
    let v0 = 0.5;
    let n_runs = 500;
    let n_steps = 200;

    let mut mean_velocities = vec![0.0; n_steps + 1];

    for run in 0..n_runs {
        let positions = vec![Vector3::zeros()];
        let masses = vec![mass];
        let mut state = MDState::new(positions, masses);
        state.velocities[0] = Vector3::new(v0, 0.0, 0.0);
        mean_velocities[0] += state.velocities[0].x;

        let config = LangevinConfig::new(temp, friction, dt);
        let mut rng = StdRng::seed_from_u64(run as u64 * 12345);

        let zero_forces = |_pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::zeros()] };

        for step in 0..n_steps {
            state = langevin_step(state, &config, &mut rng, zero_forces);
            mean_velocities[step + 1] += state.velocities[0].x;
        }
    }

    for vel in &mut mean_velocities {
        *vel /= n_runs as f64;
    }

    let friction_internal = friction * units::INTERNAL_TO_FS;
    let dt_internal = dt * units::FS_TO_INTERNAL;

    let check_times = [10, 50, 100, 150, 200];
    for &step in &check_times {
        let time_internal = step as f64 * dt_internal;
        let expected_v = v0 * (-friction_internal * time_internal).exp();
        let actual_v = mean_velocities[step];
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
#[test]
fn test_langevin_equilibrium_variance() {
    let temp = 300.0;
    let friction = 0.01;
    let dt = 1.0;
    let mass = 12.0;

    let expected_var = units::KB * temp / mass;

    let positions = vec![Vector3::zeros()];
    let masses = vec![mass];
    let mut state = MDState::new(positions, masses);

    let config = LangevinConfig::new(temp, friction, dt);
    let mut rng = StdRng::seed_from_u64(42);
    let zero_forces = |_pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::zeros()] };

    // Equilibrate
    for _ in 0..5000 {
        state = langevin_step(state, &config, &mut rng, zero_forces);
    }

    // Collect samples
    let mut v_squared_samples = Vec::with_capacity(10000);
    for _ in 0..10000 {
        state = langevin_step(state, &config, &mut rng, zero_forces);
        v_squared_samples.push(state.velocities[0].x.powi(2));
    }

    let actual_var = v_squared_samples.iter().sum::<f64>() / v_squared_samples.len() as f64;
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
#[test]
fn test_langevin_diffusion_msd() {
    let temp = 300.0;
    let friction = 0.01;
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

        let config = LangevinConfig::new(temp, friction, dt);
        let mut rng = StdRng::seed_from_u64(run as u64 * 7777);
        let zero_forces = |_pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::zeros()] };

        for step in 0..n_steps {
            state = langevin_step(state, &config, &mut rng, zero_forces);
            let dx = state.positions[0].x - initial_x;
            msd_sum[step + 1] += dx.powi(2);
        }
    }

    for msd in &mut msd_sum {
        *msd /= n_runs as f64;
    }

    assert!(
        msd_sum[100] > 0.0,
        "MSD at step 100 should be positive, got {}",
        msd_sum[100]
    );
    assert!(
        msd_sum[100] < msd_sum[200],
        "MSD should grow: MSD(100)={} vs MSD(200)={}",
        msd_sum[100],
        msd_sum[200]
    );
    assert!(
        msd_sum[200] > 0.1 && msd_sum[200] < 100.0,
        "MSD at 200 fs should be reasonable, got {} Å²",
        msd_sum[200]
    );
}

// === Velocity Verlet Symplectic Property Tests ===

/// Test that Velocity Verlet is time-reversible.
#[test]
fn test_velocity_verlet_time_reversibility() {
    let positions = vec![Vector3::new(1.0, 0.0, 0.0)];
    let masses = vec![1.0];
    let mut state = MDState::new(positions, masses);

    let k = 1.0;
    let compute_forces =
        |pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::new(-k * pos[0].x, 0.0, 0.0)] };

    let x0 = state.positions[0].x;
    let v0 = 0.0;

    let forces = compute_forces(&state.positions);
    state.set_forces(&forces);

    let dt = 0.5;
    let n_steps = 100;

    // Run forward
    for _ in 0..n_steps {
        state = velocity_verlet_step(state, dt, compute_forces);
    }

    // Reverse velocities
    for vel in &mut state.velocities {
        *vel = -*vel;
    }

    // Run forward again (equivalent to backward in time)
    for _ in 0..n_steps {
        state = velocity_verlet_step(state, dt, compute_forces);
    }

    // Reverse velocities again
    for vel in &mut state.velocities {
        *vel = -*vel;
    }

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

/// Test phase space volume preservation.
#[test]
fn test_velocity_verlet_phase_space_preservation() {
    let k = 1.0;
    let compute_forces =
        |pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> { vec![Vector3::new(-k * pos[0].x, 0.0, 0.0)] };

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
            state = velocity_verlet_step(state, dt, compute_forces);
        }

        corners_final.push((state.positions[0].x, state.velocities[0].x));
    }

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

    let rel_error = (area_final - area_initial).abs() / area_initial;
    assert!(
        rel_error < 1e-6,
        "Phase space volume not preserved: initial={:.6e}, final={:.6e}, error={:.2e}",
        area_initial,
        area_final,
        rel_error
    );
}
