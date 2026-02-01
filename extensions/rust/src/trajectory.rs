//! Trajectory analysis for molecular dynamics simulations.
//!
//! This module provides streaming algorithms for analyzing MD trajectories,
//! designed to handle large trajectories without loading everything into memory.
//!
//! # Features
//!
//! - Mean Squared Displacement (MSD)
//! - Velocity Autocorrelation Function (VACF)
//! - Diffusion coefficient calculation
//!
//! # Example
//!
//! ```rust,ignore
//! use ferrox::trajectory::{MsdCalculator, diffusion_coefficient_from_msd};
//!
//! let mut msd_calc = MsdCalculator::new(n_atoms, 100, 10);
//!
//! for frame in trajectory {
//!     msd_calc.add_frame(&frame.positions);
//! }
//!
//! let msd = msd_calc.compute_msd();
//! let (d, r2) = diffusion_coefficient_from_msd(&msd, &times, 3);
//! ```

use nalgebra::Vector3;

/// Streaming Mean Squared Displacement calculator.
///
/// Uses a "multiple time origins" approach for better statistics:
/// - Stores reference positions at regular intervals
/// - Computes MSD at various lag times from each origin
#[derive(Debug, Clone)]
pub struct MsdCalculator {
    /// Number of atoms.
    n_atoms: usize,
    /// Maximum lag time in frames.
    max_lag: usize,
    /// Interval between time origins (in frames).
    origin_interval: usize,
    /// Stored reference positions at each time origin.
    /// Shape: [n_origins][n_atoms]
    reference_positions: Vec<Vec<Vector3<f64>>>,
    /// Frame indices for each time origin.
    origin_frames: Vec<usize>,
    /// Running sum of squared displacements for each lag.
    /// Shape: [max_lag + 1][n_atoms]
    msd_sums: Vec<Vec<f64>>,
    /// Count of samples for each lag.
    msd_counts: Vec<usize>,
    /// Current frame index.
    current_frame: usize,
}

impl MsdCalculator {
    /// Create a new MSD calculator.
    ///
    /// # Arguments
    ///
    /// * `n_atoms` - Number of atoms
    /// * `max_lag` - Maximum lag time in frames
    /// * `origin_interval` - Frames between time origins (smaller = more samples)
    pub fn new(n_atoms: usize, max_lag: usize, origin_interval: usize) -> Self {
        let msd_sums = vec![vec![0.0; n_atoms]; max_lag + 1];
        let msd_counts = vec![0; max_lag + 1];

        Self {
            n_atoms,
            max_lag,
            origin_interval,
            reference_positions: Vec::new(),
            origin_frames: Vec::new(),
            msd_sums,
            msd_counts,
            current_frame: 0,
        }
    }

    /// Add a frame to the MSD calculation.
    ///
    /// # Arguments
    ///
    /// * `positions` - Atomic positions for this frame
    pub fn add_frame(&mut self, positions: &[Vector3<f64>]) {
        assert_eq!(
            positions.len(),
            self.n_atoms,
            "Position count must match n_atoms"
        );

        // Store as time origin if at interval
        if self.current_frame.is_multiple_of(self.origin_interval) {
            self.reference_positions.push(positions.to_vec());
            self.origin_frames.push(self.current_frame);
        }

        // Update MSD for all time origins
        for (origin_idx, &origin_frame) in self.origin_frames.iter().enumerate() {
            let lag = self.current_frame - origin_frame;
            if lag > self.max_lag {
                continue;
            }

            let ref_pos = &self.reference_positions[origin_idx];

            // Compute squared displacement for each atom
            for (atom_idx, (pos, ref_p)) in positions.iter().zip(ref_pos).enumerate() {
                let dr = pos - ref_p;
                self.msd_sums[lag][atom_idx] += dr.norm_squared();
            }
            self.msd_counts[lag] += 1;
        }

        self.current_frame += 1;
    }

    /// Compute final MSD values.
    ///
    /// Returns MSD averaged over all atoms and time origins for each lag time.
    ///
    /// # Returns
    ///
    /// Vector of length (max_lag + 1) with MSD values
    pub fn compute_msd(&self) -> Vec<f64> {
        self.msd_counts
            .iter()
            .zip(&self.msd_sums)
            .map(|(&count, sums)| {
                if count > 0 {
                    // Average over atoms and origins
                    let total: f64 = sums.iter().sum();
                    total / (count as f64 * self.n_atoms as f64)
                } else {
                    0.0
                }
            })
            .collect()
    }

    /// Get MSD for each atom separately (useful for identifying mobile atoms).
    ///
    /// # Returns
    ///
    /// 2D vector: [max_lag + 1][n_atoms]
    pub fn compute_msd_per_atom(&self) -> Vec<Vec<f64>> {
        self.msd_counts
            .iter()
            .zip(&self.msd_sums)
            .map(|(&count, sums)| {
                if count > 0 {
                    sums.iter().map(|&s| s / count as f64).collect()
                } else {
                    vec![0.0; self.n_atoms]
                }
            })
            .collect()
    }
}

/// Streaming Velocity Autocorrelation Function calculator.
///
/// Uses the same "multiple time origins" approach as MSD.
#[derive(Debug, Clone)]
pub struct VacfCalculator {
    /// Number of atoms.
    n_atoms: usize,
    /// Maximum lag time in frames.
    max_lag: usize,
    /// Interval between time origins (in frames).
    origin_interval: usize,
    /// Stored reference velocities at each time origin.
    reference_velocities: Vec<Vec<Vector3<f64>>>,
    /// Frame indices for each time origin.
    origin_frames: Vec<usize>,
    /// Running sum of velocity dot products for each lag.
    vacf_sums: Vec<f64>,
    /// Count of samples for each lag.
    vacf_counts: Vec<usize>,
    /// Current frame index.
    current_frame: usize,
}

impl VacfCalculator {
    /// Create a new VACF calculator.
    ///
    /// # Arguments
    ///
    /// * `n_atoms` - Number of atoms
    /// * `max_lag` - Maximum lag time in frames
    /// * `origin_interval` - Frames between time origins
    pub fn new(n_atoms: usize, max_lag: usize, origin_interval: usize) -> Self {
        Self {
            n_atoms,
            max_lag,
            origin_interval,
            reference_velocities: Vec::new(),
            origin_frames: Vec::new(),
            vacf_sums: vec![0.0; max_lag + 1],
            vacf_counts: vec![0; max_lag + 1],
            current_frame: 0,
        }
    }

    /// Add a frame to the VACF calculation.
    ///
    /// # Arguments
    ///
    /// * `velocities` - Atomic velocities for this frame
    pub fn add_frame(&mut self, velocities: &[Vector3<f64>]) {
        assert_eq!(
            velocities.len(),
            self.n_atoms,
            "Velocity count must match n_atoms"
        );

        // Store as time origin if at interval
        if self.current_frame.is_multiple_of(self.origin_interval) {
            self.reference_velocities.push(velocities.to_vec());
            self.origin_frames.push(self.current_frame);
        }

        // Update VACF for all time origins
        for (origin_idx, &origin_frame) in self.origin_frames.iter().enumerate() {
            let lag = self.current_frame - origin_frame;
            if lag > self.max_lag {
                continue;
            }

            let ref_vel = &self.reference_velocities[origin_idx];

            // Compute v(0) · v(t) for each atom
            let dot_sum: f64 = velocities
                .iter()
                .zip(ref_vel)
                .map(|(v, v0)| v.dot(v0))
                .sum();

            self.vacf_sums[lag] += dot_sum;
            self.vacf_counts[lag] += 1;
        }

        self.current_frame += 1;
    }

    /// Compute final VACF values.
    ///
    /// Returns VACF averaged over all atoms and time origins for each lag time.
    ///
    /// # Returns
    ///
    /// Vector of length (max_lag + 1) with VACF values
    pub fn compute_vacf(&self) -> Vec<f64> {
        self.vacf_counts
            .iter()
            .zip(&self.vacf_sums)
            .map(|(&count, &sum)| {
                if count > 0 {
                    sum / (count as f64 * self.n_atoms as f64)
                } else {
                    0.0
                }
            })
            .collect()
    }

    /// Compute normalized VACF (VACF(t) / VACF(0)).
    pub fn compute_normalized_vacf(&self) -> Vec<f64> {
        let vacf = self.compute_vacf();
        let vacf0 = vacf[0];

        if vacf0.abs() < 1e-10 {
            return vec![0.0; vacf.len()];
        }

        vacf.iter().map(|v| v / vacf0).collect()
    }
}

/// Compute diffusion coefficient from MSD using Einstein relation.
///
/// D = MSD(t) / (2 * d * t)
///
/// where d is the dimensionality (typically 3).
///
/// Uses linear regression on MSD vs time in the specified range.
///
/// # Arguments
///
/// * `msd` - MSD values for each lag time
/// * `times` - Time values corresponding to each lag
/// * `dim` - Dimensionality (default: 3)
/// * `start_fraction` - Start of fitting region as fraction of data (default: 0.1)
/// * `end_fraction` - End of fitting region as fraction of data (default: 0.9)
///
/// # Returns
///
/// (diffusion_coefficient, r_squared)
pub fn diffusion_coefficient_from_msd(
    msd: &[f64],
    times: &[f64],
    dim: usize,
    start_fraction: f64,
    end_fraction: f64,
) -> (f64, f64) {
    assert_eq!(
        msd.len(),
        times.len(),
        "MSD and times must have same length"
    );

    let n_points = msd.len();
    if n_points < 2 {
        return (0.0, 0.0);
    }

    // Determine fitting range
    let start_idx = (n_points as f64 * start_fraction) as usize;
    let end_idx = ((n_points as f64 * end_fraction) as usize).min(n_points - 1);

    if start_idx >= end_idx {
        return (0.0, 0.0);
    }

    // Linear regression: MSD = slope * t + intercept
    // slope = 2 * d * D
    let n_fit = (end_idx - start_idx + 1) as f64;
    let t_sum: f64 = times[start_idx..=end_idx].iter().sum();
    let msd_sum: f64 = msd[start_idx..=end_idx].iter().sum();
    let t_mean = t_sum / n_fit;
    let msd_mean = msd_sum / n_fit;

    let mut numerator = 0.0;
    let mut denominator = 0.0;
    let mut ss_tot = 0.0;

    for idx in start_idx..=end_idx {
        let t_dev = times[idx] - t_mean;
        let msd_dev = msd[idx] - msd_mean;
        numerator += t_dev * msd_dev;
        denominator += t_dev * t_dev;
        ss_tot += msd_dev * msd_dev;
    }

    if denominator.abs() < 1e-10 {
        return (0.0, 0.0);
    }

    let slope = numerator / denominator;
    let intercept = msd_mean - slope * t_mean;

    // D = slope / (2 * d)
    let diff_coeff = slope / (2.0 * dim as f64);

    // Compute R^2
    let mut ss_res = 0.0;
    for idx in start_idx..=end_idx {
        let predicted = slope * times[idx] + intercept;
        ss_res += (msd[idx] - predicted).powi(2);
    }

    let r_squared = if ss_tot > 1e-10 {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };

    (diff_coeff, r_squared)
}

/// Compute diffusion coefficient from VACF using Green-Kubo relation.
///
/// D = (1/d) * integral_0^inf VACF(t) dt
///
/// Uses trapezoidal integration.
///
/// # Arguments
///
/// * `vacf` - VACF values for each lag time
/// * `dt` - Time step between frames
/// * `dim` - Dimensionality (default: 3)
///
/// # Returns
///
/// Diffusion coefficient
pub fn diffusion_coefficient_from_vacf(vacf: &[f64], dt: f64, dim: usize) -> f64 {
    if vacf.len() < 2 {
        return 0.0;
    }

    // Trapezoidal integration
    let mut integral = 0.0;
    for idx in 0..vacf.len() - 1 {
        integral += 0.5 * (vacf[idx] + vacf[idx + 1]) * dt;
    }

    integral / dim as f64
}

#[cfg(test)]
#[allow(clippy::needless_range_loop)]
mod tests {
    use super::*;

    #[test]
    fn test_msd_calculator_creation() {
        let calc = MsdCalculator::new(10, 100, 5);
        assert_eq!(calc.n_atoms, 10);
        assert_eq!(calc.max_lag, 100);
    }

    #[test]
    fn test_msd_stationary() {
        // Stationary particles should have MSD = 0
        let mut calc = MsdCalculator::new(2, 10, 2);

        let pos = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)];

        for _ in 0..20 {
            calc.add_frame(&pos);
        }

        let msd = calc.compute_msd();

        // All MSD values should be zero for stationary particles
        for &val in &msd[1..] {
            assert!(
                val.abs() < 1e-10,
                "MSD should be 0 for stationary particles"
            );
        }
    }

    #[test]
    fn test_msd_linear_motion() {
        // Particle moving linearly: r(t) = v*t => MSD(tau) = v^2 * tau^2 (single time origin)
        let mut calc = MsdCalculator::new(1, 10, 100);

        let velocity = 1.0;
        for frame in 0..11 {
            let pos = vec![Vector3::new(velocity * frame as f64, 0.0, 0.0)];
            calc.add_frame(&pos);
        }

        let msd = calc.compute_msd();
        for lag in 1..=10 {
            let expected = (lag as f64).powi(2);
            assert!(
                (msd[lag] - expected).abs() < 0.1,
                "MSD at lag {lag}: got {}, expected {expected}",
                msd[lag]
            );
        }
    }

    #[test]
    fn test_vacf_calculator_creation() {
        let calc = VacfCalculator::new(10, 100, 5);
        assert_eq!(calc.n_atoms, 10);
        assert_eq!(calc.max_lag, 100);
    }

    #[test]
    fn test_vacf_constant_velocity() {
        // Constant velocity should have constant VACF
        let mut calc = VacfCalculator::new(1, 10, 100); // Large interval = single origin

        let vel = vec![Vector3::new(1.0, 2.0, 3.0)];
        let v_dot_v = 1.0 + 4.0 + 9.0; // 14.0

        for _ in 0..11 {
            calc.add_frame(&vel);
        }

        let vacf = calc.compute_vacf();

        // VACF should be constant (v · v = 14)
        for &val in &vacf {
            assert!(
                (val - v_dot_v).abs() < 1e-10,
                "VACF should be {v_dot_v}, got {val}"
            );
        }
    }

    #[test]
    fn test_diffusion_coefficient_linear() {
        // MSD = 6Dt for 3D diffusion
        // If MSD = t, then D = 1/6
        let msd: Vec<f64> = (0..100).map(|t| t as f64).collect();
        let times: Vec<f64> = (0..100).map(|t| t as f64).collect();

        let (d, r2) = diffusion_coefficient_from_msd(&msd, &times, 3, 0.1, 0.9);

        assert!((d - 1.0 / 6.0).abs() < 0.01, "D should be ~0.167, got {d}");
        assert!(
            r2 > 0.99,
            "R^2 should be ~1 for perfect linear data, got {r2}"
        );
    }

    #[test]
    fn test_diffusion_from_vacf() {
        // For constant VACF = v², D = v² * t_max / dim
        let vel_squared = 1.0;
        let vacf = vec![vel_squared; 10];
        let dt = 0.1;

        let diffusion = diffusion_coefficient_from_vacf(&vacf, dt, 3);

        // integral of constant = v² * (n-1) * dt = 1.0 * 9 * 0.1 = 0.9, D = 0.9 / 3 = 0.3
        assert!(
            (diffusion - 0.3).abs() < 0.01,
            "D should be ~0.3, got {diffusion}"
        );
    }

    #[test]
    fn test_msd_stationary_exact_zero() {
        // Stationary particles should have MSD = 0 exactly (within floating point)
        let n_atoms = 10;
        let mut calc = MsdCalculator::new(n_atoms, 50, 5);

        // Random but fixed positions
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * 0.5, (idx as f64).sin(), (idx as f64).cos()))
            .collect();

        // Add 100 frames - particles don't move
        for _ in 0..100 {
            calc.add_frame(&positions);
        }

        let msd = calc.compute_msd();

        // All MSD values must be exactly 0
        for (lag, &val) in msd.iter().enumerate() {
            assert!(
                val.abs() < 1e-14,
                "MSD at lag {lag} should be exactly 0, got {val}"
            );
        }
    }

    #[test]
    fn test_msd_ballistic_motion_3d() {
        // Ballistic motion: r(t) = r(0) + v*t
        // MSD(tau) = |v|^2 * tau^2
        let n_atoms = 5;
        let mut calc = MsdCalculator::new(n_atoms, 20, 100); // single origin

        // Different constant velocities for each atom
        let velocities: Vec<Vector3<f64>> = vec![
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
            Vector3::new(1.0, 1.0, 0.0),
            Vector3::new(1.0, 1.0, 1.0),
        ];

        // Expected |v|^2 for each atom: 1, 1, 1, 2, 3
        let v_sq_values: Vec<f64> = velocities.iter().map(|v| v.norm_squared()).collect();
        let mean_v_sq: f64 = v_sq_values.iter().sum::<f64>() / n_atoms as f64;

        for frame in 0..21 {
            let positions: Vec<Vector3<f64>> =
                velocities.iter().map(|v| v * frame as f64).collect();
            calc.add_frame(&positions);
        }

        let msd = calc.compute_msd();

        // MSD(t) = <|v|^2> * t^2
        for lag in 1..=20 {
            let expected = mean_v_sq * (lag as f64).powi(2);
            let relative_error = (msd[lag] - expected).abs() / expected.max(1e-10);
            assert!(
                relative_error < 1e-10,
                "MSD at lag {lag}: got {}, expected {expected}, rel_err={relative_error}",
                msd[lag]
            );
        }
    }

    #[test]
    fn test_msd_known_diffusion_analytical() {
        // Test MSD computation with analytically constructed diffusive trajectory
        // Instead of pseudo-random noise (which doesn't diffuse properly),
        // we construct a trajectory where MSD = 6Dt exactly.

        let n_atoms = 10;
        let max_lag = 50;
        let d_input: f64 = 0.1; // Known diffusion coefficient
        let dt: f64 = 1.0; // time step

        let mut calc = MsdCalculator::new(n_atoms, max_lag, 100); // single origin

        // Construct trajectory: MSD(t) = 6*D*t with position at time t: (sqrt(2Dt), sqrt(2Dt), sqrt(2Dt))
        for frame in 0..=max_lag {
            let displacement = (2.0 * d_input * frame as f64 * dt).sqrt();
            let positions: Vec<Vector3<f64>> = (0..n_atoms)
                .map(|atom_idx| {
                    let offset = atom_idx as f64 * 0.001; // Small per-atom offset for distinct positions
                    Vector3::new(
                        displacement + offset,
                        displacement + offset,
                        displacement + offset,
                    )
                })
                .collect();
            calc.add_frame(&positions);
        }

        let msd = calc.compute_msd();

        // For this construction: MSD(t) = 6Dt (with tiny error from atom offsets)
        let times: Vec<f64> = (0..=max_lag).map(|t| t as f64 * dt).collect();
        let (d_recovered, r2) = diffusion_coefficient_from_msd(&msd, &times, 3, 0.2, 0.8);

        assert!(
            r2 > 0.99,
            "MSD should show perfect linear growth for this construction, R^2={r2}"
        );
        // Should recover input D within 5%
        let rel_err = (d_recovered - d_input).abs() / d_input;
        assert!(
            rel_err < 0.05,
            "Recovered D={d_recovered} should match input D={d_input}, rel_err={rel_err}"
        );
    }

    #[test]
    fn test_vacf_constant_velocity_exact() {
        // Multiple atoms with different constant velocities
        let n_atoms = 4;
        let mut calc = VacfCalculator::new(n_atoms, 30, 100); // single origin

        let velocities = vec![
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 2.0, 0.0),
            Vector3::new(0.0, 0.0, 3.0),
            Vector3::new(1.0, 1.0, 1.0),
        ];

        // Expected: <v·v> = (1 + 4 + 9 + 3) / 4 = 4.25
        let expected_vacf: f64 =
            velocities.iter().map(|v| v.norm_squared()).sum::<f64>() / n_atoms as f64;

        for _ in 0..31 {
            calc.add_frame(&velocities);
        }

        let vacf = calc.compute_vacf();

        // VACF should be constant for all lag times
        for (lag, &val) in vacf.iter().enumerate() {
            assert!(
                (val - expected_vacf).abs() < 1e-10,
                "VACF at lag {lag}: got {val}, expected {expected_vacf}"
            );
        }
    }

    #[test]
    fn test_vacf_exponential_decay_langevin() {
        // Langevin dynamics: VACF(t) = VACF(0) * exp(-gamma * t)
        // Use SINGLE time origin to test exact exponential decay
        let n_atoms = 1;
        let max_lag = 50;
        let gamma = 0.1; // friction coefficient
        let v0 = 2.0; // initial velocity magnitude

        // Use large origin_interval for single origin
        let mut calc = VacfCalculator::new(n_atoms, max_lag, 100);

        // Generate velocity trajectory following exponential decay
        // v(t) = v0 * exp(-gamma * t / 2) in same direction
        // Then VACF(t) = v(0)·v(t) = v0^2 * exp(-gamma * t / 2)
        for frame in 0..=max_lag {
            let decay = (-gamma * frame as f64 / 2.0).exp();
            let vel = vec![Vector3::new(v0 * decay, 0.0, 0.0)];
            calc.add_frame(&vel);
        }

        let vacf = calc.compute_vacf();
        let vacf_normalized = calc.compute_normalized_vacf();

        // VACF(0) should be v0^2
        let expected_vacf0 = v0 * v0;
        assert!(
            (vacf[0] - expected_vacf0).abs() < 1e-10,
            "VACF(0) should be {expected_vacf0}, got {}",
            vacf[0]
        );

        // Check exponential decay shape: VACF(t) = v0^2 * exp(-gamma * t / 2)
        for lag in 1..=max_lag {
            let expected = expected_vacf0 * (-gamma * lag as f64 / 2.0).exp();
            let rel_err = if expected > 1e-10 {
                (vacf[lag] - expected).abs() / expected
            } else {
                vacf[lag].abs()
            };
            assert!(
                rel_err < 1e-10,
                "VACF at lag {lag}: got {}, expected {expected}",
                vacf[lag]
            );
        }

        // Normalized VACF should start at 1 and decay
        assert!(
            (vacf_normalized[0] - 1.0).abs() < 1e-10,
            "Normalized VACF(0) should be 1"
        );
        assert!(
            vacf_normalized[max_lag] < 0.5,
            "Normalized VACF should decay significantly"
        );
    }

    #[test]
    fn test_msd_per_atom_identifies_mobile() {
        // Test per-atom MSD to identify mobile vs immobile atoms
        let n_atoms = 3;
        let mut calc = MsdCalculator::new(n_atoms, 10, 100); // single origin

        // Atom 0: stationary
        // Atom 1: slow diffusion (v=0.5)
        // Atom 2: fast diffusion (v=2.0)
        let v_slow = 0.5;
        let v_fast = 2.0;

        for frame in 0..11 {
            let positions = vec![
                Vector3::new(1.0, 1.0, 1.0),                   // stationary
                Vector3::new(v_slow * frame as f64, 0.0, 0.0), // slow
                Vector3::new(v_fast * frame as f64, 0.0, 0.0), // fast
            ];
            calc.add_frame(&positions);
        }

        let msd_per_atom = calc.compute_msd_per_atom();

        // At lag=10: stationary=0, slow=25, fast=400
        let lag = 10;
        assert!(
            msd_per_atom[lag][0].abs() < 1e-10,
            "Stationary atom MSD should be 0"
        );
        assert!(
            (msd_per_atom[lag][1] - 25.0).abs() < 1e-10,
            "Slow atom MSD should be 25"
        );
        assert!(
            (msd_per_atom[lag][2] - 400.0).abs() < 1e-10,
            "Fast atom MSD should be 400"
        );

        // Verify ordering: fast > slow > stationary
        assert!(msd_per_atom[lag][2] > msd_per_atom[lag][1]);
        assert!(msd_per_atom[lag][1] > msd_per_atom[lag][0]);
    }

    #[test]
    fn test_diffusion_coefficient_edge_cases() {
        // Empty / very short data
        let (d, r2) = diffusion_coefficient_from_msd(&[], &[], 3, 0.1, 0.9);
        assert_eq!(d, 0.0);
        assert_eq!(r2, 0.0);

        let (d, _r2) = diffusion_coefficient_from_msd(&[1.0], &[0.0], 3, 0.1, 0.9);
        assert_eq!(d, 0.0);

        // Two points - minimum for regression
        let msd = vec![0.0, 6.0];
        let times = vec![0.0, 1.0];
        let (d, _r2) = diffusion_coefficient_from_msd(&msd, &times, 3, 0.0, 1.0);
        // MSD = 6t, so D = 6 / (2*3) = 1.0
        assert!((d - 1.0).abs() < 0.1, "D should be ~1.0, got {d}");
    }

    #[test]
    fn test_vacf_edge_cases() {
        // Zero velocities
        let mut calc = VacfCalculator::new(2, 5, 1);
        let zeros = vec![Vector3::zeros(), Vector3::zeros()];
        for _ in 0..6 {
            calc.add_frame(&zeros);
        }
        let vacf = calc.compute_vacf();
        for &val in &vacf {
            assert!(val.abs() < 1e-14, "VACF should be 0 for zero velocities");
        }

        // Normalized VACF with zero initial should return zeros
        let norm_vacf = calc.compute_normalized_vacf();
        for &val in &norm_vacf {
            assert!(val.abs() < 1e-10, "Normalized VACF should be 0");
        }
    }

    #[test]
    fn test_multiple_time_origins_improves_statistics() {
        // Compare single origin vs multiple origins
        // Multiple origins should give smoother results

        // With large origin interval (single origin)
        let mut calc_single = MsdCalculator::new(1, 10, 100);
        // With small origin interval (multiple origins)
        let mut calc_multi = MsdCalculator::new(1, 10, 2);

        // Linear motion
        for frame in 0..30 {
            let pos = vec![Vector3::new(frame as f64, 0.0, 0.0)];
            calc_single.add_frame(&pos);
            calc_multi.add_frame(&pos);
        }

        let msd_single = calc_single.compute_msd();
        let msd_multi = calc_multi.compute_msd();

        // Both should give correct MSD for ballistic motion
        // The multi-origin version averages over more samples
        for lag in 1..=10 {
            let expected = (lag as f64).powi(2);
            // Single origin should match exactly (only one sample)
            assert!(
                (msd_single[lag] - expected).abs() < 1e-10,
                "Single origin MSD at lag {lag}"
            );
            // Multi origin should also match (averaged over multiple samples of same trajectory)
            assert!(
                (msd_multi[lag] - expected).abs() < 1e-10,
                "Multi origin MSD at lag {lag}"
            );
        }
    }

    #[test]
    fn test_ballistic_msd_v_squared_t_squared() {
        // For ballistic motion r(t) = v*t, MSD(tau) = |v|^2 * tau^2
        // Test with various velocities in 3D
        let velocities = [
            (1.0, 0.0, 0.0, 1.0), // |v|^2 = 1
            (1.0, 1.0, 0.0, 2.0), // |v|^2 = 2
            (1.0, 1.0, 1.0, 3.0), // |v|^2 = 3
            (2.0, 0.0, 0.0, 4.0), // |v|^2 = 4
            (1.0, 2.0, 2.0, 9.0), // |v|^2 = 9
        ];

        for (vx, vy, vz, v_sq) in velocities {
            let mut calc = MsdCalculator::new(1, 20, 100); // single origin

            for t in 0..21 {
                let pos = vec![Vector3::new(vx * t as f64, vy * t as f64, vz * t as f64)];
                calc.add_frame(&pos);
            }

            let msd = calc.compute_msd();

            // Verify MSD(t) = |v|^2 * t^2
            for tau in 1..=20 {
                let expected = v_sq * (tau as f64).powi(2);
                let rel_err = (msd[tau] - expected).abs() / expected;
                assert!(
                    rel_err < 1e-12,
                    "v=({vx},{vy},{vz}), tau={tau}: MSD={}, expected={expected}",
                    msd[tau]
                );
            }
        }
    }

    #[test]
    fn test_analytical_diffusion_msd_6dt() {
        // For true 3D diffusion, MSD(t) = 6Dt
        // We construct a trajectory where displacements are exactly sqrt(2D*dt) per component
        let d_true = 0.5; // True diffusion coefficient
        let dt = 1.0;
        let n_atoms = 1;
        let max_lag = 30;

        let mut calc = MsdCalculator::new(n_atoms, max_lag, 100); // single origin for exact test

        // For ideal diffusion: <x(t)^2> = 2Dt per dimension
        // If we move sqrt(2D*dt) in each dimension each step, cumulative displacement after n steps
        // has variance = n * 2D*dt in each dimension, so MSD = 3 * n * 2D*dt = 6Dn*dt
        // But for exact test, we use deterministic increments whose squared sum matches expected MSD

        // Generate positions such that MSD exactly equals 6Dt
        // At time t, position = (sqrt(2Dt), sqrt(2Dt), sqrt(2Dt))
        // Then MSD(t) = 3 * 2Dt = 6Dt
        for t in 0..=max_lag {
            let x = (2.0 * d_true * t as f64 * dt).sqrt();
            let pos = vec![Vector3::new(x, x, x)];
            calc.add_frame(&pos);
        }

        let msd = calc.compute_msd();
        let times: Vec<f64> = (0..=max_lag).map(|t| t as f64 * dt).collect();

        // Verify MSD(t) = 6Dt
        for t in 1..=max_lag {
            let expected = 6.0 * d_true * t as f64 * dt;
            let rel_err = (msd[t] - expected).abs() / expected;
            assert!(
                rel_err < 1e-10,
                "t={t}: MSD={}, expected={expected}",
                msd[t]
            );
        }

        // Recover D from linear fit
        let (d_recovered, r2) = diffusion_coefficient_from_msd(&msd, &times, 3, 0.1, 0.9);
        assert!(
            (d_recovered - d_true).abs() / d_true < 0.01,
            "Recovered D={d_recovered}, expected {d_true}"
        );
        assert!(r2 > 0.9999, "R^2 should be ~1, got {r2}");
    }

    #[test]
    fn test_vacf_exponential_decay_analytical() {
        // For Langevin dynamics: VACF(t) = VACF(0) * exp(-gamma*t)
        // We construct velocities that exactly follow this decay
        let gamma = 0.2;
        let v0_sq: f64 = 4.0; // <v(0)^2> = kT/m in equilibrium
        let n_atoms = 1;
        let max_lag = 40;

        // Use single time origin for exact analytical comparison
        let mut calc = VacfCalculator::new(n_atoms, max_lag, 100);

        // v(t) in same direction, magnitude = v0 * exp(-gamma*t/2)
        // Then v(0)·v(t) = v0^2 * exp(-gamma*t/2)
        let v0 = v0_sq.sqrt();

        for t in 0..=max_lag {
            let v_mag = v0 * (-gamma * t as f64 / 2.0).exp();
            let vel = vec![Vector3::new(v_mag, 0.0, 0.0)];
            calc.add_frame(&vel);
        }

        let vacf = calc.compute_vacf();

        // Verify VACF(t) = v0^2 * exp(-gamma*t/2)
        for t in 0..=max_lag {
            let expected = v0_sq * (-gamma * t as f64 / 2.0).exp();
            let rel_err = if expected > 1e-10 {
                (vacf[t] - expected).abs() / expected
            } else {
                vacf[t].abs()
            };
            assert!(
                rel_err < 1e-10,
                "t={t}: VACF={}, expected={expected}",
                vacf[t]
            );
        }
    }

    #[test]
    fn test_diffusion_from_vacf_green_kubo() {
        // Green-Kubo: D = (1/d) * integral_0^inf VACF(t) dt
        // For exponential decay VACF(t) = v0^2 * exp(-gamma*t):
        // D = v0^2 / (d * gamma)
        let gamma = 0.5;
        let v0_sq = 3.0;
        let dt = 0.1;
        let dim = 3;

        // Generate VACF with exponential decay
        let max_lag = 100;
        let vacf: Vec<f64> = (0..=max_lag)
            .map(|t| v0_sq * (-gamma * t as f64 * dt).exp())
            .collect();

        let d_computed = diffusion_coefficient_from_vacf(&vacf, dt, dim);

        // Analytical: integral of v0^2 * exp(-gamma*t) from 0 to T = v0^2 * (1 - exp(-gamma*T)) / gamma
        // As T -> inf, integral = v0^2 / gamma
        // D = v0^2 / (gamma * dim)
        let t_max = max_lag as f64 * dt;
        let integral_analytical = v0_sq * (1.0 - (-gamma * t_max).exp()) / gamma;
        let d_analytical = integral_analytical / dim as f64;

        let rel_err = (d_computed - d_analytical).abs() / d_analytical;
        assert!(
            rel_err < 0.01,
            "Green-Kubo D={d_computed}, analytical={d_analytical}"
        );
    }

    #[test]
    fn test_einstein_green_kubo_consistency() {
        // Einstein and Green-Kubo should give same D for proper diffusive system
        // Use analytical construction where both relations hold

        let d_true = 0.25;
        let dt = 0.1;
        let dim = 3;
        let max_lag = 50;

        // For Einstein: MSD(t) = 6Dt in 3D
        // For Green-Kubo with constant VACF = v^2: D = v^2 * t_max / dim
        // We need VACF that integrates to dim * D over our time range

        // Construct MSD directly: MSD(t) = 6Dt
        let msd: Vec<f64> = (0..=max_lag)
            .map(|t| 6.0 * d_true * t as f64 * dt)
            .collect();
        let times: Vec<f64> = (0..=max_lag).map(|t| t as f64 * dt).collect();

        let (d_einstein, _r2) = diffusion_coefficient_from_msd(&msd, &times, dim, 0.1, 0.9);

        // For matching Green-Kubo: VACF must integrate to dim * D
        // With constant VACF = c over time T: integral = c * T
        // D_gk = c * T / dim, so c = dim * D / T
        let t_max = max_lag as f64 * dt;
        let vacf_const = dim as f64 * d_true / t_max;
        let vacf: Vec<f64> = vec![vacf_const; max_lag + 1];

        let d_green_kubo = diffusion_coefficient_from_vacf(&vacf, dt, dim);

        // Both should recover d_true
        assert!(
            (d_einstein - d_true).abs() / d_true < 0.01,
            "Einstein D={d_einstein}, expected {d_true}"
        );
        // Green-Kubo has some discretization error, allow 5%
        assert!(
            (d_green_kubo - d_true).abs() / d_true < 0.05,
            "Green-Kubo D={d_green_kubo}, expected {d_true}"
        );

        // Check consistency between methods
        let rel_diff = (d_einstein - d_green_kubo).abs() / d_true;
        assert!(
            rel_diff < 0.1,
            "Einstein ({d_einstein}) and Green-Kubo ({d_green_kubo}) differ by {:.1}%",
            rel_diff * 100.0
        );
    }
}
