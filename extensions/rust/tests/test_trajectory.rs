//! Integration tests for trajectory analysis module.
//!
//! Tests large-scale behavior, statistical properties, and consistency
//! between different methods of computing diffusion coefficients.

#![allow(clippy::needless_range_loop)]

use ferrox::trajectory::{
    MsdCalculator, VacfCalculator, diffusion_coefficient_from_msd, diffusion_coefficient_from_vacf,
};
use nalgebra::Vector3;

/// Test that multiple time origins improve statistics (reduce variance).
///
/// Test MSD with linear motion where the answer is analytically known.
/// For constant velocity v, MSD(t) = v² * t² = 3 * (v_x² + v_y² + v_z²) * t²
#[test]
fn test_msd_linear_motion_analytical() {
    let n_atoms = 5;
    let n_frames = 100;
    let max_lag = 20;
    let origin_interval = 1; // Use all origins for best statistics

    let velocity = Vector3::new(0.1, 0.2, 0.3);
    let v_squared = velocity.norm_squared();

    let mut calc = MsdCalculator::new(n_atoms, max_lag, origin_interval);

    for frame in 0..n_frames {
        let t = frame as f64;
        let positions: Vec<Vector3<f64>> = (0..n_atoms).map(|_| velocity * t).collect();
        calc.add_frame(&positions);
    }

    let msd = calc.compute_msd();

    // Verify MSD matches analytical result: MSD(lag) = v² * lag²
    for lag in 1..=max_lag {
        let expected = v_squared * (lag as f64).powi(2);
        let rel_err = (msd[lag] - expected).abs() / expected;
        assert!(
            rel_err < 1e-10,
            "MSD[{}] = {}, expected {} (error {:.2e})",
            lag,
            msd[lag],
            expected,
            rel_err
        );
    }
}

/// Test handling of large trajectories (10000+ frames).
///
/// Ensures no memory issues, overflow, or performance degradation.
#[test]
fn test_large_trajectory_handling() {
    let n_atoms = 50;
    let n_frames = 10_000;
    let max_lag = 200;
    let origin_interval = 50;

    let mut msd_calc = MsdCalculator::new(n_atoms, max_lag, origin_interval);
    let mut vacf_calc = VacfCalculator::new(n_atoms, max_lag, origin_interval);

    // Linear motion for predictable MSD
    let velocity = 0.1; // small velocity to avoid large numbers

    for frame in 0..n_frames {
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|atom| {
                let offset = atom as f64 * 0.01; // small offset per atom
                Vector3::new(velocity * frame as f64 + offset, offset * 2.0, offset * 3.0)
            })
            .collect();

        let velocities: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|_| Vector3::new(velocity, 0.0, 0.0))
            .collect();

        msd_calc.add_frame(&positions);
        vacf_calc.add_frame(&velocities);
    }

    let msd = msd_calc.compute_msd();
    let vacf = vacf_calc.compute_vacf();

    // Verify MSD is computed correctly
    assert_eq!(msd.len(), max_lag + 1);
    assert!(msd[0].abs() < 1e-10, "MSD(0) should be 0");

    // For linear motion in x: MSD(t) ≈ v^2 * t^2 averaged over atoms
    // Each atom has same velocity, so MSD(t) = v^2 * t^2
    for lag in [50, 100, 150, 200] {
        let expected = velocity * velocity * (lag as f64).powi(2);
        let rel_err = (msd[lag] - expected).abs() / expected;
        assert!(
            rel_err < 0.1,
            "MSD[{}] = {}, expected {}, rel_err = {:.1}%",
            lag,
            msd[lag],
            expected,
            rel_err * 100.0
        );
    }

    // Verify VACF is computed correctly
    assert_eq!(vacf.len(), max_lag + 1);
    let expected_vacf = velocity * velocity; // v · v = v^2 (only x component)
    for lag in 0..=max_lag {
        let rel_err = (vacf[lag] - expected_vacf).abs() / expected_vacf;
        assert!(
            rel_err < 1e-10,
            "VACF[{}] = {}, expected {}",
            lag,
            vacf[lag],
            expected_vacf
        );
    }

    // Verify no NaN or Inf values
    for (idx, &val) in msd.iter().enumerate() {
        assert!(val.is_finite(), "MSD[{}] is not finite: {}", idx, val);
    }
    for (idx, &val) in vacf.iter().enumerate() {
        assert!(val.is_finite(), "VACF[{}] is not finite: {}", idx, val);
    }
}

/// Test consistency between Einstein and Green-Kubo methods.
///
/// Both methods should give the same diffusion coefficient within 10%
/// for a properly diffusive system.
#[test]
fn test_einstein_green_kubo_consistency() {
    // Use analytically constructed MSD data directly (not from trajectory)
    // to test that both methods give consistent D
    let d_true = 0.3;
    let dt = 0.1;
    let dim = 3;
    let max_lag = 100;

    // MSD(t) = 6Dt for 3D diffusion
    let msd: Vec<f64> = (0..=max_lag)
        .map(|t| 6.0 * d_true * t as f64 * dt)
        .collect();
    let times: Vec<f64> = (0..=max_lag).map(|t| t as f64 * dt).collect();

    // Einstein relation: fit MSD vs t
    let (d_einstein, r2) = diffusion_coefficient_from_msd(&msd, &times, dim, 0.1, 0.9);

    // For Green-Kubo, construct VACF that integrates to dim * D
    // For constant VACF = c over time T (with trapezoidal rule):
    // integral ≈ c * T, so D = c * T / dim
    // We want D = d_true, so c = dim * d_true / T
    let t_max = max_lag as f64 * dt;
    let vacf_const = dim as f64 * d_true / t_max;
    let vacf: Vec<f64> = vec![vacf_const; max_lag + 1];

    let d_green_kubo = diffusion_coefficient_from_vacf(&vacf, dt, dim);

    // Both methods should recover d_true
    let einstein_err = (d_einstein - d_true).abs() / d_true;
    let green_kubo_err = (d_green_kubo - d_true).abs() / d_true;

    assert!(
        einstein_err < 0.01,
        "Einstein D = {}, expected {}, error = {:.1}%",
        d_einstein,
        d_true,
        einstein_err * 100.0
    );

    assert!(
        green_kubo_err < 0.05,
        "Green-Kubo D = {}, expected {}, error = {:.1}%",
        d_green_kubo,
        d_true,
        green_kubo_err * 100.0
    );

    // Methods should agree within 10%
    let method_diff = (d_einstein - d_green_kubo).abs() / d_true;
    assert!(
        method_diff < 0.1,
        "Einstein ({}) and Green-Kubo ({}) differ by {:.1}%",
        d_einstein,
        d_green_kubo,
        method_diff * 100.0
    );

    // R^2 should be 1.0 for perfect linear MSD
    assert!(
        r2 > 0.9999,
        "R^2 = {} should be ~1.0 for perfect linear MSD",
        r2
    );
}

/// Test that MSD grows linearly for diffusive motion.
///
/// The hallmark of diffusion is linear MSD growth: MSD(t) = 6Dt.
#[test]
fn test_msd_linear_growth_diffusive() {
    let d_true = 0.2;
    let dt = 1.0;
    let n_atoms = 1;
    let max_lag = 80;

    let mut calc = MsdCalculator::new(n_atoms, max_lag, 100);

    // Generate trajectory with MSD = 6Dt
    for t in 0..=max_lag {
        let r = (2.0 * d_true * t as f64 * dt).sqrt();
        calc.add_frame(&[Vector3::new(r, r, r)]);
    }

    let msd = calc.compute_msd();
    let times: Vec<f64> = (0..=max_lag).map(|t| t as f64 * dt).collect();

    // Compute R^2 for linear fit
    let (d_fit, r2) = diffusion_coefficient_from_msd(&msd, &times, 3, 0.1, 0.9);

    assert!(
        r2 > 0.999,
        "Linear fit R^2 = {} should be > 0.999 for diffusive MSD",
        r2
    );
    assert!(
        (d_fit - d_true).abs() / d_true < 0.01,
        "Fitted D = {}, expected {}",
        d_fit,
        d_true
    );
}

/// Test that MSD grows quadratically for ballistic motion.
///
/// For constant velocity motion: MSD(t) = v² * t².
#[test]
fn test_msd_quadratic_growth_ballistic() {
    let v = 0.5;
    let v_sq = v * v;
    let n_atoms = 1;
    let max_lag = 50;

    let mut calc = MsdCalculator::new(n_atoms, max_lag, 100);

    // Ballistic motion: r(t) = v * t
    for t in 0..=max_lag {
        calc.add_frame(&[Vector3::new(v * t as f64, 0.0, 0.0)]);
    }

    let msd = calc.compute_msd();

    // MSD(t) should equal v^2 * t^2
    for t in 1..=max_lag {
        let expected = v_sq * (t as f64).powi(2);
        let rel_err = (msd[t] - expected).abs() / expected;
        assert!(
            rel_err < 1e-10,
            "Ballistic MSD[{}] = {}, expected {}",
            t,
            msd[t],
            expected
        );
    }
}

/// Test VACF integration gives correct diffusion via Green-Kubo.
///
/// For exponentially decaying VACF: D = VACF(0) / (gamma * dim)
#[test]
fn test_green_kubo_exponential_vacf() {
    let gamma = 0.3;
    let vacf0 = 2.0; // VACF(0) = <v^2>
    let dt = 0.05;
    let dim = 3;
    let max_lag = 200;

    // Exponential decay: VACF(t) = vacf0 * exp(-gamma * t)
    let vacf: Vec<f64> = (0..=max_lag)
        .map(|t| vacf0 * (-gamma * t as f64 * dt).exp())
        .collect();

    let d_computed = diffusion_coefficient_from_vacf(&vacf, dt, dim);

    // Analytical: D = vacf0 / (gamma * dim) for infinite integral
    // For finite integral up to t_max: D = vacf0 * (1 - exp(-gamma*t_max)) / (gamma * dim)
    let t_max = max_lag as f64 * dt;
    let integral = vacf0 * (1.0 - (-gamma * t_max).exp()) / gamma;
    let d_analytical = integral / dim as f64;

    let rel_err = (d_computed - d_analytical).abs() / d_analytical;
    assert!(
        rel_err < 0.02,
        "Green-Kubo D = {}, analytical D = {}, rel_err = {:.2}%",
        d_computed,
        d_analytical,
        rel_err * 100.0
    );
}

/// Test per-atom MSD correctly identifies mobile vs immobile atoms.
#[test]
fn test_per_atom_msd_mobility() {
    let n_atoms = 5;
    let max_lag = 20;

    // Atoms with different mobilities
    let v_values = [0.0, 0.1, 0.5, 1.0, 2.0]; // velocities

    let mut calc = MsdCalculator::new(n_atoms, max_lag, 100);

    for t in 0..=max_lag {
        let positions: Vec<Vector3<f64>> = v_values
            .iter()
            .map(|&v| Vector3::new(v * t as f64, 0.0, 0.0))
            .collect();
        calc.add_frame(&positions);
    }

    let msd_per_atom = calc.compute_msd_per_atom();

    // At lag = max_lag, MSD should be v^2 * max_lag^2 for each atom
    let lag = max_lag;
    for (atom_idx, &v) in v_values.iter().enumerate() {
        let expected = v * v * (lag as f64).powi(2);
        let got = msd_per_atom[lag][atom_idx];
        let rel_err = if expected > 1e-10 {
            (got - expected).abs() / expected
        } else {
            got.abs()
        };
        assert!(
            rel_err < 1e-10,
            "Atom {} (v={}): MSD = {}, expected {}",
            atom_idx,
            v,
            got,
            expected
        );
    }

    // Verify ordering: faster atoms have higher MSD
    for atom_idx in 0..n_atoms - 1 {
        assert!(
            msd_per_atom[lag][atom_idx] <= msd_per_atom[lag][atom_idx + 1],
            "MSD ordering violated: atom {} ({}) > atom {} ({})",
            atom_idx,
            msd_per_atom[lag][atom_idx],
            atom_idx + 1,
            msd_per_atom[lag][atom_idx + 1]
        );
    }
}

/// Test normalized VACF correctly handles decay to zero.
#[test]
fn test_normalized_vacf_decay() {
    let n_atoms = 1;
    let max_lag = 30;
    let gamma = 0.15;
    let v0 = 3.0;

    let mut calc = VacfCalculator::new(n_atoms, max_lag, 100);

    // Generate velocities with exponential decay
    for t in 0..=max_lag {
        let v_mag = v0 * (-gamma * t as f64).exp();
        calc.add_frame(&[Vector3::new(v_mag, 0.0, 0.0)]);
    }

    let norm_vacf = calc.compute_normalized_vacf();

    // Normalized VACF(0) should be 1
    assert!(
        (norm_vacf[0] - 1.0).abs() < 1e-10,
        "Normalized VACF(0) = {}, expected 1.0",
        norm_vacf[0]
    );

    // Should decay towards 0
    assert!(
        norm_vacf[max_lag] < norm_vacf[0],
        "VACF should decay: VACF(0)={} > VACF({})={}",
        norm_vacf[0],
        max_lag,
        norm_vacf[max_lag]
    );

    // Check monotonic decay
    for t in 1..max_lag {
        assert!(
            norm_vacf[t] <= norm_vacf[t - 1] + 1e-10, // small tolerance for numerical
            "VACF should decay monotonically: t={}: {} > t={}: {}",
            t - 1,
            norm_vacf[t - 1],
            t,
            norm_vacf[t]
        );
    }
}

/// Test handling of empty or minimal input.
#[test]
fn test_edge_cases() {
    // Empty MSD/times
    let (d, r2) = diffusion_coefficient_from_msd(&[], &[], 3, 0.1, 0.9);
    assert_eq!(d, 0.0);
    assert_eq!(r2, 0.0);

    // Single point
    let (d, _r2) = diffusion_coefficient_from_msd(&[1.0], &[0.0], 3, 0.1, 0.9);
    assert_eq!(d, 0.0);

    // Two points minimum
    let msd = vec![0.0, 6.0];
    let times = vec![0.0, 1.0];
    let (d, _) = diffusion_coefficient_from_msd(&msd, &times, 3, 0.0, 1.0);
    assert!((d - 1.0).abs() < 0.1, "Two-point D = {}, expected ~1.0", d);

    // VACF with single point
    let d = diffusion_coefficient_from_vacf(&[1.0], 0.1, 3);
    assert_eq!(d, 0.0, "Single-point VACF should give D=0");

    // VACF with two points
    let vacf = vec![1.0, 1.0];
    let d = diffusion_coefficient_from_vacf(&vacf, 0.1, 3);
    assert!(d > 0.0, "Two-point VACF should give D>0");
}

/// Test consistency across many particles.
#[test]
fn test_many_particles() {
    let n_atoms = 1000;
    let max_lag = 30;
    let n_frames = 50;

    let mut calc = MsdCalculator::new(n_atoms, max_lag, 10);

    // All atoms move with same velocity
    let v = 0.3;
    for t in 0..n_frames {
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|_| Vector3::new(v * t as f64, 0.0, 0.0))
            .collect();
        calc.add_frame(&positions);
    }

    let msd = calc.compute_msd();

    // MSD should be v^2 * t^2 averaged over all atoms (all same)
    for lag in 1..=max_lag {
        let expected = v * v * (lag as f64).powi(2);
        let rel_err = (msd[lag] - expected).abs() / expected;
        assert!(
            rel_err < 1e-8,
            "1000 atoms MSD[{}] = {}, expected {}",
            lag,
            msd[lag],
            expected
        );
    }
}
