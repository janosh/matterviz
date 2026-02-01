//! Trajectory analysis for molecular dynamics simulations.
//!
//! Provides both batch functions for full trajectories and streaming
//! calculators for memory-efficient processing of large trajectories.
//!
//! # Batch API (recommended for small trajectories)
//!
//! ```rust,ignore
//! use ferrox::trajectory::{compute_msd_batch, diffusion_coefficient_from_msd};
//!
//! let msd = compute_msd_batch(&trajectory, max_lag, origin_interval);
//! let (diff, r2) = diffusion_coefficient_from_msd(&msd, &times, 3, 0.1, 0.9);
//! ```
//!
//! # Streaming API (for large trajectories)
//!
//! ```rust,ignore
//! use ferrox::trajectory::{MsdState, msd_new, msd_add_frame, msd_compute};
//!
//! let mut state = msd_new(n_atoms, max_lag, origin_interval);
//! for frame in trajectory {
//!     state = msd_add_frame(state, &frame.positions);
//! }
//! let msd = msd_compute(&state);
//! ```

use nalgebra::Vector3;

// === Batch functions for full trajectories ===

/// Compute MSD from a complete trajectory (batch mode).
///
/// # Arguments
/// * `trajectory` - Sequence of position frames, each frame is [n_atoms] positions
/// * `max_lag` - Maximum lag time in frames
/// * `origin_interval` - Frames between time origins (smaller = more samples)
///
/// # Returns
/// MSD values for each lag time (length = max_lag + 1)
pub fn compute_msd_batch(
    trajectory: &[Vec<Vector3<f64>>],
    max_lag: usize,
    origin_interval: usize,
) -> Vec<f64> {
    if trajectory.is_empty() {
        return vec![0.0; max_lag + 1];
    }

    let n_atoms = trajectory[0].len();

    // Validate: all frames must have the same non-zero atom count
    if n_atoms == 0 || trajectory.iter().any(|frame| frame.len() != n_atoms) {
        return vec![0.0; max_lag + 1];
    }

    let n_frames = trajectory.len();
    let max_lag = max_lag.min(n_frames - 1);

    let mut msd = vec![0.0; max_lag + 1];
    let mut counts = vec![0usize; max_lag + 1];

    // Use multiple time origins
    for origin in (0..n_frames).step_by(origin_interval.max(1)) {
        for lag in 0..=max_lag {
            let frame = origin + lag;
            if frame >= n_frames {
                break;
            }

            let sum_sq: f64 = trajectory[frame]
                .iter()
                .zip(&trajectory[origin])
                .map(|(pos, ref_pos)| (pos - ref_pos).norm_squared())
                .sum();
            msd[lag] += sum_sq / n_atoms as f64;
            counts[lag] += 1;
        }
    }

    // Normalize by number of origins
    for (val, &count) in msd.iter_mut().zip(&counts) {
        if count > 0 {
            *val /= count as f64;
        }
    }

    msd
}

/// Compute VACF from a complete trajectory (batch mode).
///
/// # Arguments
/// * `trajectory` - Sequence of velocity frames
/// * `max_lag` - Maximum lag time in frames
/// * `origin_interval` - Frames between time origins
///
/// # Returns
/// VACF values for each lag time (length = max_lag + 1)
pub fn compute_vacf_batch(
    trajectory: &[Vec<Vector3<f64>>],
    max_lag: usize,
    origin_interval: usize,
) -> Vec<f64> {
    if trajectory.is_empty() {
        return vec![0.0; max_lag + 1];
    }

    let n_atoms = trajectory[0].len();

    // Validate: all frames must have the same non-zero atom count
    if n_atoms == 0 || trajectory.iter().any(|frame| frame.len() != n_atoms) {
        return vec![0.0; max_lag + 1];
    }

    let n_frames = trajectory.len();
    let max_lag = max_lag.min(n_frames - 1);

    let mut vacf = vec![0.0; max_lag + 1];
    let mut counts = vec![0usize; max_lag + 1];

    for origin in (0..n_frames).step_by(origin_interval.max(1)) {
        for lag in 0..=max_lag {
            let frame = origin + lag;
            if frame >= n_frames {
                break;
            }

            let dot_sum: f64 = trajectory[origin]
                .iter()
                .zip(&trajectory[frame])
                .map(|(v0, v)| v0.dot(v))
                .sum();
            vacf[lag] += dot_sum / n_atoms as f64;
            counts[lag] += 1;
        }
    }

    for (val, &count) in vacf.iter_mut().zip(&counts) {
        if count > 0 {
            *val /= count as f64;
        }
    }

    vacf
}

// === Streaming MSD calculator ===

/// State for streaming MSD calculation.
#[derive(Debug, Clone)]
pub struct MsdState {
    /// Number of atoms.
    pub n_atoms: usize,
    /// Maximum lag time in frames.
    pub max_lag: usize,
    /// Interval between time origins.
    pub origin_interval: usize,
    /// Stored reference positions at each time origin.
    reference_positions: Vec<Vec<Vector3<f64>>>,
    /// Frame indices for each time origin.
    origin_frames: Vec<usize>,
    /// Running sum of squared displacements: [max_lag + 1][n_atoms].
    msd_sums: Vec<Vec<f64>>,
    /// Count of samples for each lag.
    msd_counts: Vec<usize>,
    /// Current frame index.
    current_frame: usize,
}

/// Create new MSD calculator state.
///
/// # Panics
/// Panics if `n_atoms == 0` or `origin_interval == 0`.
pub fn msd_new(n_atoms: usize, max_lag: usize, origin_interval: usize) -> MsdState {
    assert!(n_atoms > 0, "n_atoms must be > 0");
    assert!(origin_interval > 0, "origin_interval must be > 0");

    MsdState {
        n_atoms,
        max_lag,
        origin_interval,
        reference_positions: Vec::new(),
        origin_frames: Vec::new(),
        msd_sums: vec![vec![0.0; n_atoms]; max_lag + 1],
        msd_counts: vec![0; max_lag + 1],
        current_frame: 0,
    }
}

/// Add a frame to MSD calculation, returning updated state.
/// Add a frame to the MSD state (in-place).
pub fn msd_add_frame_inplace(state: &mut MsdState, positions: &[Vector3<f64>]) {
    assert_eq!(
        positions.len(),
        state.n_atoms,
        "Position count must match n_atoms"
    );

    // Store as time origin if at interval
    if state.current_frame.is_multiple_of(state.origin_interval) {
        state.reference_positions.push(positions.to_vec());
        state.origin_frames.push(state.current_frame);
    }

    // Update MSD for all time origins
    for (origin_idx, &origin_frame) in state.origin_frames.iter().enumerate() {
        let lag = state.current_frame - origin_frame;
        if lag > state.max_lag {
            continue;
        }

        let ref_pos = &state.reference_positions[origin_idx];
        for (atom_idx, (pos, ref_p)) in positions.iter().zip(ref_pos).enumerate() {
            let dr = pos - ref_p;
            state.msd_sums[lag][atom_idx] += dr.norm_squared();
        }
        state.msd_counts[lag] += 1;
    }

    state.current_frame += 1;
}

/// Add a frame to the MSD state (ownership version for functional API).
pub fn msd_add_frame(mut state: MsdState, positions: &[Vector3<f64>]) -> MsdState {
    msd_add_frame_inplace(&mut state, positions);
    state
}

/// Compute final MSD values from accumulated state.
pub fn msd_compute(state: &MsdState) -> Vec<f64> {
    state
        .msd_counts
        .iter()
        .zip(&state.msd_sums)
        .map(|(&count, sums)| {
            if count > 0 {
                let total: f64 = sums.iter().sum();
                total / (count as f64 * state.n_atoms as f64)
            } else {
                0.0
            }
        })
        .collect()
}

/// Get MSD for each atom separately.
pub fn msd_compute_per_atom(state: &MsdState) -> Vec<Vec<f64>> {
    state
        .msd_counts
        .iter()
        .zip(&state.msd_sums)
        .map(|(&count, sums)| {
            if count > 0 {
                sums.iter().map(|&s| s / count as f64).collect()
            } else {
                vec![0.0; state.n_atoms]
            }
        })
        .collect()
}

// === Streaming VACF calculator ===

/// State for streaming VACF calculation.
#[derive(Debug, Clone)]
pub struct VacfState {
    /// Number of atoms.
    pub n_atoms: usize,
    /// Maximum lag time in frames.
    pub max_lag: usize,
    /// Interval between time origins.
    pub origin_interval: usize,
    /// Stored reference velocities at each time origin.
    reference_velocities: Vec<Vec<Vector3<f64>>>,
    /// Frame indices for each time origin.
    origin_frames: Vec<usize>,
    /// Running sum of velocity dot products.
    vacf_sums: Vec<f64>,
    /// Count of samples for each lag.
    vacf_counts: Vec<usize>,
    /// Current frame index.
    current_frame: usize,
}

/// Create new VACF calculator state.
///
/// # Panics
/// Panics if `n_atoms == 0` or `origin_interval == 0`.
pub fn vacf_new(n_atoms: usize, max_lag: usize, origin_interval: usize) -> VacfState {
    assert!(n_atoms > 0, "n_atoms must be > 0");
    assert!(origin_interval > 0, "origin_interval must be > 0");

    VacfState {
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

/// Add a frame to VACF calculation, returning updated state.
/// Add a frame to the VACF state (in-place).
pub fn vacf_add_frame_inplace(state: &mut VacfState, velocities: &[Vector3<f64>]) {
    assert_eq!(
        velocities.len(),
        state.n_atoms,
        "Velocity count must match n_atoms"
    );

    // Store as time origin if at interval
    if state.current_frame.is_multiple_of(state.origin_interval) {
        state.reference_velocities.push(velocities.to_vec());
        state.origin_frames.push(state.current_frame);
    }

    // Update VACF for all time origins
    for (origin_idx, &origin_frame) in state.origin_frames.iter().enumerate() {
        let lag = state.current_frame - origin_frame;
        if lag > state.max_lag {
            continue;
        }

        let ref_vel = &state.reference_velocities[origin_idx];
        let dot_sum: f64 = velocities
            .iter()
            .zip(ref_vel)
            .map(|(v, v0)| v.dot(v0))
            .sum();

        state.vacf_sums[lag] += dot_sum;
        state.vacf_counts[lag] += 1;
    }

    state.current_frame += 1;
}

/// Add a frame to the VACF state (ownership version for functional API).
pub fn vacf_add_frame(mut state: VacfState, velocities: &[Vector3<f64>]) -> VacfState {
    vacf_add_frame_inplace(&mut state, velocities);
    state
}

/// Compute final VACF values from accumulated state.
pub fn vacf_compute(state: &VacfState) -> Vec<f64> {
    state
        .vacf_counts
        .iter()
        .zip(&state.vacf_sums)
        .map(|(&count, &sum)| {
            if count > 0 {
                sum / (count as f64 * state.n_atoms as f64)
            } else {
                0.0
            }
        })
        .collect()
}

/// Compute normalized VACF (VACF(t) / VACF(0)).
pub fn vacf_compute_normalized(state: &VacfState) -> Vec<f64> {
    let vacf = vacf_compute(state);
    let vacf0 = vacf[0];
    if vacf0.abs() < 1e-10 {
        return vec![0.0; vacf.len()];
    }
    vacf.iter().map(|v| v / vacf0).collect()
}

// === Analysis functions ===

/// Compute diffusion coefficient from MSD using Einstein relation.
///
/// D = MSD(t) / (2 * d * t)
///
/// Uses linear regression in the specified range.
///
/// # Arguments
/// * `msd` - MSD values for each lag time
/// * `times` - Time values for each lag (must be positive and monotonically increasing)
/// * `dim` - Dimensionality (e.g., 3 for 3D diffusion)
/// * `start_fraction` - Start of fitting region as fraction of data (e.g., 0.1 for 10%)
/// * `end_fraction` - End of fitting region as fraction of data (e.g., 0.9 for 90%)
///
/// # Returns
/// (diffusion_coefficient, r_squared) - Returns (0.0, 0.0) if inputs are invalid
/// (dim == 0, insufficient data, or non-positive times).
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

    // Validate dimension to avoid division by zero
    if dim == 0 {
        return (0.0, 0.0);
    }

    let n_points = msd.len();
    if n_points < 2 {
        return (0.0, 0.0);
    }

    // Validate times are positive (avoid nonsensical results)
    if times.iter().any(|&t| t < 0.0) {
        return (0.0, 0.0);
    }

    // Validate times are strictly increasing (required for regression)
    if times.windows(2).any(|w| w[0] >= w[1]) {
        return (0.0, 0.0);
    }

    let start_idx = (n_points as f64 * start_fraction) as usize;
    let end_idx = ((n_points as f64 * end_fraction) as usize).min(n_points - 1);
    if start_idx >= end_idx {
        return (0.0, 0.0);
    }

    // Linear regression: MSD = slope * t + intercept
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
    let diff_coeff = slope / (2.0 * dim as f64);

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
/// # Arguments
/// * `vacf` - VACF values for each lag time
/// * `dt` - Time step between frames (must be positive)
/// * `dim` - Dimensionality (e.g., 3 for 3D diffusion)
///
/// # Returns
/// Diffusion coefficient, or 0.0 if inputs are invalid (dim == 0 or dt <= 0).
pub fn diffusion_coefficient_from_vacf(vacf: &[f64], dt: f64, dim: usize) -> f64 {
    // Validate inputs to avoid division by zero or nonsensical results
    if vacf.len() < 2 || dim == 0 || dt <= 0.0 {
        return 0.0;
    }

    // Trapezoidal integration
    let mut integral = 0.0;
    for idx in 0..vacf.len() - 1 {
        integral += 0.5 * (vacf[idx] + vacf[idx + 1]) * dt;
    }

    integral / dim as f64
}

// === Legacy API compatibility ===

/// Streaming MSD calculator (legacy wrapper around MsdState).
#[derive(Debug, Clone)]
pub struct MsdCalculator(MsdState);

impl MsdCalculator {
    /// Create new MSD calculator.
    pub fn new(n_atoms: usize, max_lag: usize, origin_interval: usize) -> Self {
        Self(msd_new(n_atoms, max_lag, origin_interval))
    }

    /// Number of atoms expected per frame.
    pub fn n_atoms(&self) -> usize {
        self.0.n_atoms
    }

    /// Maximum lag time in frames.
    pub fn max_lag(&self) -> usize {
        self.0.max_lag
    }

    /// Add a frame.
    pub fn add_frame(&mut self, positions: &[Vector3<f64>]) {
        msd_add_frame_inplace(&mut self.0, positions);
    }

    /// Compute MSD.
    pub fn compute_msd(&self) -> Vec<f64> {
        msd_compute(&self.0)
    }

    /// Compute MSD per atom.
    pub fn compute_msd_per_atom(&self) -> Vec<Vec<f64>> {
        msd_compute_per_atom(&self.0)
    }
}

/// Streaming VACF calculator (legacy wrapper around VacfState).
#[derive(Debug, Clone)]
pub struct VacfCalculator(VacfState);

impl VacfCalculator {
    /// Create new VACF calculator.
    pub fn new(n_atoms: usize, max_lag: usize, origin_interval: usize) -> Self {
        Self(vacf_new(n_atoms, max_lag, origin_interval))
    }

    /// Number of atoms expected per frame.
    pub fn n_atoms(&self) -> usize {
        self.0.n_atoms
    }

    /// Maximum lag time in frames.
    pub fn max_lag(&self) -> usize {
        self.0.max_lag
    }

    /// Add a frame.
    pub fn add_frame(&mut self, velocities: &[Vector3<f64>]) {
        vacf_add_frame_inplace(&mut self.0, velocities);
    }

    /// Compute VACF.
    pub fn compute_vacf(&self) -> Vec<f64> {
        vacf_compute(&self.0)
    }

    /// Compute normalized VACF.
    pub fn compute_normalized_vacf(&self) -> Vec<f64> {
        vacf_compute_normalized(&self.0)
    }
}

// === Tests ===

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_msd_batch_stationary() {
        let pos = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)];
        let trajectory: Vec<Vec<Vector3<f64>>> = (0..20).map(|_| pos.clone()).collect();

        let msd = compute_msd_batch(&trajectory, 10, 2);

        for &val in &msd[1..] {
            assert!(
                val.abs() < 1e-10,
                "MSD should be 0 for stationary particles"
            );
        }
    }

    #[test]
    fn test_msd_batch_linear_motion() {
        let velocity = 1.0;
        let trajectory: Vec<Vec<Vector3<f64>>> = (0..11)
            .map(|t| vec![Vector3::new(velocity * t as f64, 0.0, 0.0)])
            .collect();

        let msd = compute_msd_batch(&trajectory, 10, 100);

        for (lag, &msd_val) in msd.iter().enumerate().skip(1).take(10) {
            let expected = (lag as f64).powi(2);
            assert!(
                (msd_val - expected).abs() < 0.1,
                "MSD at lag {lag}: got {msd_val}, expected {expected}",
            );
        }
    }

    #[test]
    fn test_vacf_batch_constant() {
        let vel = vec![Vector3::new(1.0, 2.0, 3.0)];
        let v_dot_v = 14.0;
        let trajectory: Vec<Vec<Vector3<f64>>> = (0..11).map(|_| vel.clone()).collect();

        let vacf = compute_vacf_batch(&trajectory, 10, 100);

        for &val in &vacf {
            assert!(
                (val - v_dot_v).abs() < 1e-10,
                "VACF should be {v_dot_v}, got {val}"
            );
        }
    }

    #[test]
    fn test_streaming_msd() {
        let mut state = msd_new(2, 10, 2);
        let pos = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)];

        for _ in 0..20 {
            state = msd_add_frame(state, &pos);
        }

        let msd = msd_compute(&state);

        for &val in &msd[1..] {
            assert!(
                val.abs() < 1e-10,
                "MSD should be 0 for stationary particles"
            );
        }
    }

    #[test]
    fn test_streaming_vacf() {
        let mut state = vacf_new(1, 10, 100);
        let vel = vec![Vector3::new(1.0, 2.0, 3.0)];
        let v_dot_v = 14.0;

        for _ in 0..11 {
            state = vacf_add_frame(state, &vel);
        }

        let vacf = vacf_compute(&state);

        for &val in &vacf {
            assert!(
                (val - v_dot_v).abs() < 1e-10,
                "VACF should be {v_dot_v}, got {val}"
            );
        }
    }

    #[test]
    fn test_diffusion_coefficient_linear() {
        let msd: Vec<f64> = (0..100).map(|t| t as f64).collect();
        let times: Vec<f64> = (0..100).map(|t| t as f64).collect();

        let (diff, r2) = diffusion_coefficient_from_msd(&msd, &times, 3, 0.1, 0.9);

        assert!(
            (diff - 1.0 / 6.0).abs() < 0.01,
            "D should be ~0.167, got {diff}"
        );
        assert!(r2 > 0.99, "R^2 should be ~1, got {r2}");
    }

    #[test]
    fn test_diffusion_from_vacf() {
        let vel_squared = 1.0;
        let vacf = vec![vel_squared; 10];
        let dt = 0.1;

        let diff = diffusion_coefficient_from_vacf(&vacf, dt, 3);
        assert!((diff - 0.3).abs() < 0.01, "D should be ~0.3, got {diff}");
    }

    #[test]
    fn test_msd_ballistic_3d() {
        let n_atoms = 5;
        let velocities: Vec<Vector3<f64>> = vec![
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
            Vector3::new(1.0, 1.0, 0.0),
            Vector3::new(1.0, 1.0, 1.0),
        ];
        let v_sq_values: Vec<f64> = velocities.iter().map(|v| v.norm_squared()).collect();
        let mean_v_sq: f64 = v_sq_values.iter().sum::<f64>() / n_atoms as f64;

        let trajectory: Vec<Vec<Vector3<f64>>> = (0..21)
            .map(|t| velocities.iter().map(|v| v * t as f64).collect())
            .collect();

        let msd = compute_msd_batch(&trajectory, 20, 100);

        for (lag, &msd_val) in msd.iter().enumerate().skip(1).take(20) {
            let expected = mean_v_sq * (lag as f64).powi(2);
            let rel_error = (msd_val - expected).abs() / expected.max(1e-10);
            assert!(
                rel_error < 1e-10,
                "MSD at lag {lag}: got {msd_val}, expected {expected}",
            );
        }
    }

    #[test]
    fn test_legacy_api_compatibility() {
        // Test that legacy wrapper API still works
        let mut calc = MsdCalculator::new(2, 10, 2);
        let pos = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)];

        for _ in 0..20 {
            calc.add_frame(&pos);
        }

        let msd = calc.compute_msd();
        for &val in &msd[1..] {
            assert!(val.abs() < 1e-10);
        }
    }

    #[test]
    fn test_vacf_exponential_decay() {
        let gamma = 0.1;
        let v0 = 2.0;
        let max_lag = 50;

        let trajectory: Vec<Vec<Vector3<f64>>> = (0..=max_lag)
            .map(|t| {
                let decay = (-gamma * t as f64 / 2.0).exp();
                vec![Vector3::new(v0 * decay, 0.0, 0.0)]
            })
            .collect();

        let vacf = compute_vacf_batch(&trajectory, max_lag, 100);

        let expected_vacf0 = v0 * v0;
        assert!((vacf[0] - expected_vacf0).abs() < 1e-10);

        for (t, &vacf_val) in vacf.iter().enumerate().skip(1).take(max_lag) {
            let expected = expected_vacf0 * (-gamma * t as f64 / 2.0).exp();
            let rel_err = if expected > 1e-10 {
                (vacf_val - expected).abs() / expected
            } else {
                vacf_val.abs()
            };
            assert!(
                rel_err < 1e-10,
                "VACF at t={t}: got {vacf_val}, expected {expected}",
            );
        }
    }

    #[test]
    fn test_msd_per_atom_identifies_mobile() {
        let trajectory: Vec<Vec<Vector3<f64>>> = (0..11)
            .map(|t| {
                vec![
                    Vector3::new(1.0, 1.0, 1.0),            // stationary
                    Vector3::new(0.5 * t as f64, 0.0, 0.0), // slow
                    Vector3::new(2.0 * t as f64, 0.0, 0.0), // fast
                ]
            })
            .collect();

        let mut state = msd_new(3, 10, 100);
        for frame in &trajectory {
            state = msd_add_frame(state, frame);
        }

        let msd_per_atom = msd_compute_per_atom(&state);

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
    }

    #[test]
    fn test_diffusion_edge_cases() {
        let (d, r2) = diffusion_coefficient_from_msd(&[], &[], 3, 0.1, 0.9);
        assert_eq!(d, 0.0);
        assert_eq!(r2, 0.0);

        let (d, _) = diffusion_coefficient_from_msd(&[1.0], &[0.0], 3, 0.1, 0.9);
        assert_eq!(d, 0.0);
    }

    #[test]
    fn test_analytical_diffusion_msd_6dt() {
        let d_true = 0.5;
        let dt = 1.0;
        let max_lag = 30;

        let trajectory: Vec<Vec<Vector3<f64>>> = (0..=max_lag)
            .map(|t| {
                let x = (2.0 * d_true * t as f64 * dt).sqrt();
                vec![Vector3::new(x, x, x)]
            })
            .collect();

        let msd = compute_msd_batch(&trajectory, max_lag, 100);
        let times: Vec<f64> = (0..=max_lag).map(|t| t as f64 * dt).collect();

        let (d_recovered, r2) = diffusion_coefficient_from_msd(&msd, &times, 3, 0.2, 0.8);

        assert!(r2 > 0.99, "R^2 should be ~1, got {r2}");
        let rel_err = (d_recovered - d_true).abs() / d_true;
        assert!(
            rel_err < 0.05,
            "Recovered D={d_recovered} should match {d_true}"
        );
    }

    #[test]
    fn test_green_kubo_diffusion() {
        let gamma = 0.5;
        let v0_sq = 3.0;
        let dt = 0.1;
        let dim = 3;
        let max_lag = 100;

        let vacf: Vec<f64> = (0..=max_lag)
            .map(|t| v0_sq * (-gamma * t as f64 * dt).exp())
            .collect();

        let d_computed = diffusion_coefficient_from_vacf(&vacf, dt, dim);

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
    fn test_msd_stationary_exact_zero() {
        // Stationary particles should have MSD = 0 exactly (within floating point)
        let n_atoms = 10;
        let mut calc = MsdCalculator::new(n_atoms, 50, 5);

        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * 0.5, (idx as f64).sin(), (idx as f64).cos()))
            .collect();

        for _ in 0..100 {
            calc.add_frame(&positions);
        }

        let msd = calc.compute_msd();

        for (lag, &val) in msd.iter().enumerate() {
            assert!(
                val.abs() < 1e-14,
                "MSD at lag {lag} should be exactly 0, got {val}"
            );
        }
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
        // With large origin interval (single origin)
        let mut calc_single = MsdCalculator::new(1, 10, 100);
        // With small origin interval (multiple origins)
        let mut calc_multi = MsdCalculator::new(1, 10, 2);

        for frame in 0..30 {
            let pos = vec![Vector3::new(frame as f64, 0.0, 0.0)];
            calc_single.add_frame(&pos);
            calc_multi.add_frame(&pos);
        }

        let msd_single = calc_single.compute_msd();
        let msd_multi = calc_multi.compute_msd();

        for lag in 1..=10 {
            let expected = (lag as f64).powi(2);
            assert!(
                (msd_single[lag] - expected).abs() < 1e-10,
                "Single origin MSD at lag {lag}"
            );
            assert!(
                (msd_multi[lag] - expected).abs() < 1e-10,
                "Multi origin MSD at lag {lag}"
            );
        }
    }

    #[test]
    fn test_ballistic_msd_v_squared_t_squared() {
        // For ballistic motion r(t) = v*t, MSD(tau) = |v|^2 * tau^2
        let velocities = [
            (1.0, 0.0, 0.0, 1.0),
            (1.0, 1.0, 0.0, 2.0),
            (1.0, 1.0, 1.0, 3.0),
            (2.0, 0.0, 0.0, 4.0),
            (1.0, 2.0, 2.0, 9.0),
        ];

        for (vx, vy, vz, v_sq) in velocities {
            let mut calc = MsdCalculator::new(1, 20, 100);

            for t in 0..21 {
                let pos = vec![Vector3::new(vx * t as f64, vy * t as f64, vz * t as f64)];
                calc.add_frame(&pos);
            }

            let msd = calc.compute_msd();

            for (tau, &msd_val) in msd.iter().enumerate().skip(1).take(20) {
                let expected = v_sq * (tau as f64).powi(2);
                let rel_err = (msd_val - expected).abs() / expected;
                assert!(
                    rel_err < 1e-12,
                    "v=({vx},{vy},{vz}), tau={tau}: MSD={msd_val}, expected={expected}",
                );
            }
        }
    }

    #[test]
    fn test_vacf_constant_velocity_exact() {
        // Multiple atoms with different constant velocities
        let n_atoms = 4;
        let mut calc = VacfCalculator::new(n_atoms, 30, 100);

        let velocities = vec![
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 2.0, 0.0),
            Vector3::new(0.0, 0.0, 3.0),
            Vector3::new(1.0, 1.0, 1.0),
        ];

        let expected_vacf: f64 =
            velocities.iter().map(|v| v.norm_squared()).sum::<f64>() / n_atoms as f64;

        for _ in 0..31 {
            calc.add_frame(&velocities);
        }

        let vacf = calc.compute_vacf();

        for (lag, &val) in vacf.iter().enumerate() {
            assert!(
                (val - expected_vacf).abs() < 1e-10,
                "VACF at lag {lag}: got {val}, expected {expected_vacf}"
            );
        }
    }

    #[test]
    fn test_vacf_exponential_decay_analytical() {
        // For Langevin dynamics: VACF(t) = VACF(0) * exp(-gamma*t)
        let gamma = 0.2;
        let v0_sq: f64 = 4.0;
        let n_atoms = 1;
        let max_lag = 40;

        let mut calc = VacfCalculator::new(n_atoms, max_lag, 100);

        let v0 = v0_sq.sqrt();

        for t in 0..=max_lag {
            let v_mag = v0 * (-gamma * t as f64 / 2.0).exp();
            let vel = vec![Vector3::new(v_mag, 0.0, 0.0)];
            calc.add_frame(&vel);
        }

        let vacf = calc.compute_vacf();

        for (t, &vacf_val) in vacf.iter().enumerate().take(max_lag + 1) {
            let expected = v0_sq * (-gamma * t as f64 / 2.0).exp();
            let rel_err = if expected > 1e-10 {
                (vacf_val - expected).abs() / expected
            } else {
                vacf_val.abs()
            };
            assert!(
                rel_err < 1e-10,
                "t={t}: VACF={vacf_val}, expected={expected}",
            );
        }
    }

    #[test]
    fn test_einstein_green_kubo_consistency() {
        // Einstein and Green-Kubo should give same D for proper diffusive system
        let d_true = 0.25;
        let dt = 0.1;
        let dim = 3;
        let max_lag = 50;

        // For Einstein: MSD(t) = 6Dt in 3D
        let msd: Vec<f64> = (0..=max_lag)
            .map(|t| 6.0 * d_true * t as f64 * dt)
            .collect();
        let times: Vec<f64> = (0..=max_lag).map(|t| t as f64 * dt).collect();

        let (d_einstein, _r2) = diffusion_coefficient_from_msd(&msd, &times, dim, 0.1, 0.9);

        // For matching Green-Kubo: VACF must integrate to dim * D
        let t_max = max_lag as f64 * dt;
        let vacf_const = dim as f64 * d_true / t_max;
        let vacf: Vec<f64> = vec![vacf_const; max_lag + 1];

        let d_green_kubo = diffusion_coefficient_from_vacf(&vacf, dt, dim);

        assert!(
            (d_einstein - d_true).abs() / d_true < 0.01,
            "Einstein D={d_einstein}, expected {d_true}"
        );
        assert!(
            (d_green_kubo - d_true).abs() / d_true < 0.05,
            "Green-Kubo D={d_green_kubo}, expected {d_true}"
        );
    }
}
