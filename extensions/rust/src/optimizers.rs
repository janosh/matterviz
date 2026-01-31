//! Geometry optimization algorithms for atomistic simulations.
//!
//! This module provides the FIRE (Fast Inertial Relaxation Engine) algorithm
//! for optimizing atomic positions and optionally unit cell parameters.
//!
//! # Example
//!
//! ```rust,ignore
//! use ferrox::optimizers::{FireState, FireConfig};
//!
//! let mut state = FireState::new(positions);
//! let config = FireConfig::default();
//!
//! while !state.is_converged(&forces, 0.01) {
//!     state.step(|pos| compute_forces(pos), &config);
//! }
//! ```

use nalgebra::{Matrix3, Vector3};

/// FIRE optimizer configuration parameters.
///
/// Default values from Bitzek et al., PRL 97, 170201 (2006).
#[derive(Debug, Clone)]
pub struct FireConfig {
    /// Initial timestep in internal units (default: 0.1).
    pub dt_start: f64,
    /// Maximum timestep (default: 1.0).
    pub dt_max: f64,
    /// Minimum steps before dt increase (default: 5).
    pub n_min: usize,
    /// Factor to increase dt (default: 1.1).
    pub f_inc: f64,
    /// Factor to decrease dt (default: 0.5).
    pub f_dec: f64,
    /// Initial mixing parameter (default: 0.1).
    pub alpha_start: f64,
    /// Factor to decrease alpha (default: 0.99).
    pub f_alpha: f64,
    /// Maximum step size in Angstrom (default: 0.2).
    pub max_step: f64,
}

impl Default for FireConfig {
    fn default() -> Self {
        Self {
            dt_start: 0.1,
            dt_max: 1.0,
            n_min: 5,
            f_inc: 1.1,
            f_dec: 0.5,
            alpha_start: 0.1,
            f_alpha: 0.99,
            max_step: 0.2,
        }
    }
}

/// FIRE optimizer state for atomic position optimization.
#[derive(Debug, Clone)]
pub struct FireState {
    /// Atomic positions in Angstrom.
    pub positions: Vec<Vector3<f64>>,
    /// Velocities (in FIRE algorithm units).
    velocities: Vec<Vector3<f64>>,
    /// Current timestep.
    dt: f64,
    /// Current mixing parameter.
    alpha: f64,
    /// Steps since last velocity reset.
    n_pos: usize,
    /// Last computed forces (for convergence check).
    last_forces: Vec<Vector3<f64>>,
}

impl FireState {
    /// Create a new FIRE optimizer state.
    pub fn new(positions: Vec<Vector3<f64>>, config: &FireConfig) -> Self {
        let n_atoms = positions.len();
        Self {
            positions,
            velocities: vec![Vector3::zeros(); n_atoms],
            dt: config.dt_start,
            alpha: config.alpha_start,
            n_pos: 0,
            last_forces: vec![Vector3::zeros(); n_atoms],
        }
    }

    /// Number of atoms.
    pub fn num_atoms(&self) -> usize {
        self.positions.len()
    }

    /// Perform one FIRE optimization step.
    ///
    /// # Arguments
    ///
    /// * `compute_forces` - Function that computes forces given positions
    /// * `config` - FIRE configuration parameters
    pub fn step<F>(&mut self, mut compute_forces: F, config: &FireConfig)
    where
        F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
    {
        let n_atoms = self.num_atoms();
        if n_atoms == 0 {
            return;
        }

        // Compute forces
        let forces = compute_forces(&self.positions);
        self.last_forces = forces.clone();

        // Compute power: P = F · v
        let power: f64 = self
            .velocities
            .iter()
            .zip(&forces)
            .map(|(v, f)| v.dot(f))
            .sum();

        // FIRE algorithm
        if power > 0.0 {
            // Uphill: mix velocity with force direction
            self.n_pos += 1;

            if self.n_pos > config.n_min {
                // Increase timestep
                self.dt = (self.dt * config.f_inc).min(config.dt_max);
                // Decrease alpha
                self.alpha *= config.f_alpha;
            }

            // Mix velocity with normalized force direction
            // v = (1 - alpha) * v + alpha * |v| * F_hat
            let v_norm: f64 = self
                .velocities
                .iter()
                .map(|v| v.norm_squared())
                .sum::<f64>()
                .sqrt();
            let f_norm: f64 = forces.iter().map(|f| f.norm_squared()).sum::<f64>().sqrt();

            if f_norm > 1e-10 {
                for (velocity, force) in self.velocities.iter_mut().zip(&forces) {
                    let f_hat = force / f_norm;
                    *velocity = (1.0 - self.alpha) * (*velocity) + self.alpha * v_norm * f_hat;
                }
            }
        } else {
            // Downhill or zero power: reset
            self.n_pos = 0;
            self.dt *= config.f_dec;
            self.alpha = config.alpha_start;

            // Reset velocities to zero
            for velocity in &mut self.velocities {
                *velocity = Vector3::zeros();
            }
        }

        // Velocity update: v += dt * F (using unit mass for FIRE)
        for (velocity, force) in self.velocities.iter_mut().zip(&forces) {
            *velocity += self.dt * force;
        }

        // Position update with step limiting
        // dr = dt * v, but limit |dr| to max_step per atom
        for (position, velocity) in self.positions.iter_mut().zip(&self.velocities) {
            let dr = self.dt * velocity;
            let dr_norm = dr.norm();
            let dr_limited = if dr_norm > config.max_step {
                dr * (config.max_step / dr_norm)
            } else {
                dr
            };
            *position += dr_limited;
        }
    }

    /// Check if optimization has converged.
    ///
    /// # Arguments
    ///
    /// * `fmax` - Maximum force component threshold in eV/Angstrom
    pub fn is_converged(&self, fmax: f64) -> bool {
        self.max_force() < fmax
    }

    /// Get maximum force component magnitude.
    pub fn max_force(&self) -> f64 {
        self.last_forces
            .iter()
            .flat_map(|f| [f.x.abs(), f.y.abs(), f.z.abs()])
            .fold(0.0, f64::max)
    }
}

/// FIRE optimizer state with cell optimization.
///
/// Optimizes both atomic positions and unit cell parameters simultaneously,
/// similar to torch-sim's CellFireState.
#[derive(Debug, Clone)]
pub struct CellFireState {
    /// Atomic positions in Angstrom.
    pub positions: Vec<Vector3<f64>>,
    /// Position velocities.
    velocities: Vec<Vector3<f64>>,
    /// Unit cell matrix (rows are lattice vectors).
    pub cell: Matrix3<f64>,
    /// Cell velocities (as deformation rate).
    cell_velocities: Matrix3<f64>,
    /// Scaling factor for cell degrees of freedom.
    pub cell_factor: f64,
    /// Current timestep.
    dt: f64,
    /// Current mixing parameter.
    alpha: f64,
    /// Steps since last velocity reset.
    n_pos: usize,
    /// Last computed forces.
    last_forces: Vec<Vector3<f64>>,
    /// Last computed stress tensor.
    last_stress: Matrix3<f64>,
}

impl CellFireState {
    /// Create a new FIRE optimizer state with cell optimization.
    ///
    /// # Arguments
    ///
    /// * `positions` - Initial atomic positions
    /// * `cell` - Initial unit cell matrix (rows are lattice vectors)
    /// * `config` - FIRE configuration
    /// * `cell_factor` - Scaling factor for cell DOF relative to atomic DOF
    pub fn new(
        positions: Vec<Vector3<f64>>,
        cell: Matrix3<f64>,
        config: &FireConfig,
        cell_factor: f64,
    ) -> Self {
        let n_atoms = positions.len();
        Self {
            positions,
            velocities: vec![Vector3::zeros(); n_atoms],
            cell,
            cell_velocities: Matrix3::zeros(),
            cell_factor,
            dt: config.dt_start,
            alpha: config.alpha_start,
            n_pos: 0,
            last_forces: vec![Vector3::zeros(); n_atoms],
            last_stress: Matrix3::zeros(),
        }
    }

    /// Number of atoms.
    pub fn num_atoms(&self) -> usize {
        self.positions.len()
    }

    /// Perform one FIRE optimization step with cell optimization.
    ///
    /// # Arguments
    ///
    /// * `compute_forces_and_stress` - Function that computes forces and stress
    ///   given positions and cell. Stress should be in eV/Angstrom^3.
    /// * `config` - FIRE configuration parameters
    pub fn step<F>(&mut self, mut compute_forces_and_stress: F, config: &FireConfig)
    where
        F: FnMut(&[Vector3<f64>], &Matrix3<f64>) -> (Vec<Vector3<f64>>, Matrix3<f64>),
    {
        let n_atoms = self.num_atoms();
        if n_atoms == 0 {
            return;
        }

        // Compute forces and stress
        let (forces, stress) = compute_forces_and_stress(&self.positions, &self.cell);
        self.last_forces = forces.clone();
        self.last_stress = stress;

        // Convert stress to cell force
        // Cell force = -volume * stress (using Virial definition)
        let volume = self.cell.determinant().abs();
        let cell_force = -volume * stress * self.cell_factor;

        // Compute power: P = F · v + F_cell : v_cell
        let atom_power: f64 = self
            .velocities
            .iter()
            .zip(&forces)
            .map(|(v, f)| v.dot(f))
            .sum();

        let cell_power: f64 = (0..3)
            .flat_map(|row| (0..3).map(move |col| (row, col)))
            .map(|(row, col)| self.cell_velocities[(row, col)] * cell_force[(row, col)])
            .sum();

        let power = atom_power + cell_power;

        // FIRE algorithm (same as position-only, but with combined DOF)
        if power > 0.0 {
            self.n_pos += 1;

            if self.n_pos > config.n_min {
                self.dt = (self.dt * config.f_inc).min(config.dt_max);
                self.alpha *= config.f_alpha;
            }

            // Compute norms for mixing
            let v_norm_sq: f64 = self
                .velocities
                .iter()
                .map(|v| v.norm_squared())
                .sum::<f64>()
                + self.cell_velocities.norm_squared();
            let f_norm_sq: f64 =
                forces.iter().map(|f| f.norm_squared()).sum::<f64>() + cell_force.norm_squared();

            let v_norm = v_norm_sq.sqrt();
            let f_norm = f_norm_sq.sqrt();

            if f_norm > 1e-10 {
                // Mix atomic velocities
                for (velocity, force) in self.velocities.iter_mut().zip(&forces) {
                    let f_hat = force / f_norm;
                    *velocity = (1.0 - self.alpha) * (*velocity) + self.alpha * v_norm * f_hat;
                }

                // Mix cell velocities
                let cell_f_hat = cell_force / f_norm;
                self.cell_velocities =
                    (1.0 - self.alpha) * self.cell_velocities + self.alpha * v_norm * cell_f_hat;
            }
        } else {
            self.n_pos = 0;
            self.dt *= config.f_dec;
            self.alpha = config.alpha_start;

            for velocity in &mut self.velocities {
                *velocity = Vector3::zeros();
            }
            self.cell_velocities = Matrix3::zeros();
        }

        // Velocity update
        for (velocity, force) in self.velocities.iter_mut().zip(&forces) {
            *velocity += self.dt * force;
        }
        self.cell_velocities += self.dt * cell_force;

        // Position update with step limiting
        for (position, velocity) in self.positions.iter_mut().zip(&self.velocities) {
            let dr = self.dt * velocity;
            let dr_norm = dr.norm();
            let dr_limited = if dr_norm > config.max_step {
                dr * (config.max_step / dr_norm)
            } else {
                dr
            };
            *position += dr_limited;
        }

        // Cell update (with similar limiting)
        let cell_dr = self.dt * self.cell_velocities;
        let cell_dr_norm = cell_dr.norm();
        let cell_dr_limited = if cell_dr_norm > config.max_step {
            cell_dr * (config.max_step / cell_dr_norm)
        } else {
            cell_dr
        };
        self.cell += cell_dr_limited;
    }

    /// Check if optimization has converged.
    ///
    /// # Arguments
    ///
    /// * `fmax` - Maximum force component threshold in eV/Angstrom
    /// * `smax` - Maximum stress component threshold in eV/Angstrom^3
    pub fn is_converged(&self, fmax: f64, smax: f64) -> bool {
        self.max_force() < fmax && self.max_stress() < smax
    }

    /// Get maximum force component magnitude.
    pub fn max_force(&self) -> f64 {
        self.last_forces
            .iter()
            .flat_map(|f| [f.x.abs(), f.y.abs(), f.z.abs()])
            .fold(0.0, f64::max)
    }

    /// Get maximum stress component magnitude.
    pub fn max_stress(&self) -> f64 {
        (0..3)
            .flat_map(|row| (0..3).map(move |col| self.last_stress[(row, col)].abs()))
            .fold(0.0, f64::max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quadratic_forces(
        positions: &[Vector3<f64>],
        minimum: &[Vector3<f64>],
        k: f64,
    ) -> Vec<Vector3<f64>> {
        // F = -k * (r - r_min)
        positions
            .iter()
            .zip(minimum)
            .map(|(r, r_min)| -k * (r - r_min))
            .collect()
    }

    fn quadratic_energy(positions: &[Vector3<f64>], minimum: &[Vector3<f64>], k: f64) -> f64 {
        // E = 0.5 * k * sum(|r - r_min|^2)
        positions
            .iter()
            .zip(minimum)
            .map(|(r, r_min)| 0.5 * k * (r - r_min).norm_squared())
            .sum()
    }

    #[test]
    fn test_fire_converges_to_minimum() {
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)];

        // Start displaced from minimum
        let initial = vec![Vector3::new(0.5, 0.3, 0.0), Vector3::new(0.8, -0.2, 0.1)];

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 1.0;

        // Run FIRE optimization
        for _ in 0..500 {
            state.step(|pos| quadratic_forces(pos, &minimum, k), &config);
            if state.is_converged(0.001) {
                break;
            }
        }

        // Check convergence
        assert!(
            state.is_converged(0.001),
            "FIRE should converge, max_force={}",
            state.max_force()
        );

        // Check positions are close to minimum
        for (pos, min) in state.positions.iter().zip(&minimum) {
            assert!(
                (pos - min).norm() < 0.1,
                "Position {pos:?} should be close to {min:?}"
            );
        }
    }

    #[test]
    fn test_fire_config_default() {
        let config = FireConfig::default();
        assert!((config.dt_start - 0.1).abs() < 1e-10);
        assert!((config.dt_max - 1.0).abs() < 1e-10);
        assert_eq!(config.n_min, 5);
    }

    #[test]
    fn test_fire_max_force() {
        let positions = vec![Vector3::new(0.0, 0.0, 0.0)];
        let config = FireConfig::default();
        let mut state = FireState::new(positions, &config);

        // Set known forces
        state.last_forces = vec![Vector3::new(0.1, -0.3, 0.2)];

        assert!((state.max_force() - 0.3).abs() < 1e-10);
    }

    #[test]
    fn test_cell_fire_state_creation() {
        let positions = vec![Vector3::zeros()];
        let cell = Matrix3::identity() * 5.0;
        let config = FireConfig::default();
        let state = CellFireState::new(positions, cell, &config, 1.0);

        assert_eq!(state.num_atoms(), 1);
        assert!((state.cell.determinant() - 125.0).abs() < 1e-10);
    }

    #[test]
    fn test_fire_power_boundary_zero() {
        // Test case where P = F · v = 0 exactly (perpendicular force and velocity)
        // This should trigger the downhill branch (power <= 0)
        let positions = vec![Vector3::new(1.0, 0.0, 0.0)];
        let config = FireConfig::default();
        let mut state = FireState::new(positions, &config);

        // Manually set velocity perpendicular to force direction
        state.velocities = vec![Vector3::new(0.0, 1.0, 0.0)];
        state.dt = 0.5; // Non-default dt to check reset
        state.alpha = 0.05; // Non-default alpha
        state.n_pos = 10; // Steps since last reset

        // Force in x direction, velocity in y direction => P = 0
        let force_fn = |_: &[Vector3<f64>]| vec![Vector3::new(-1.0, 0.0, 0.0)];

        state.step(force_fn, &config);

        // P = 0 should trigger reset behavior
        assert_eq!(state.n_pos, 0, "n_pos should reset to 0 when P <= 0");
        assert!(
            (state.alpha - config.alpha_start).abs() < 1e-10,
            "alpha should reset"
        );
        assert!(
            (state.dt - 0.5 * config.f_dec).abs() < 1e-10,
            "dt should decrease by f_dec"
        );
    }

    #[test]
    fn test_fire_parameter_adaptation() {
        // Track dt and alpha evolution during optimization
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0)];
        let initial = vec![Vector3::new(0.1, 0.0, 0.0)];

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 1.0;

        let mut dt_history = vec![state.dt];
        let mut alpha_history = vec![state.alpha];
        let mut n_pos_history = vec![state.n_pos];

        // Run several steps and track parameter evolution
        for _ in 0..50 {
            state.step(|pos| quadratic_forces(pos, &minimum, k), &config);
            dt_history.push(state.dt);
            alpha_history.push(state.alpha);
            n_pos_history.push(state.n_pos);
        }

        // After n_min successful steps, dt should increase
        // Find first point where n_pos > n_min
        let dt_increased = dt_history.windows(2).any(|w| w[1] > w[0]);
        assert!(
            dt_increased,
            "dt should increase after n_min positive power steps"
        );

        // Alpha should decrease when optimization is going well
        let alpha_decreased = alpha_history.windows(2).any(|w| w[1] < w[0]);
        assert!(
            alpha_decreased,
            "alpha should decrease after n_min positive power steps"
        );

        // Verify dt doesn't exceed dt_max
        for dt in &dt_history {
            assert!(*dt <= config.dt_max, "dt should never exceed dt_max");
        }
    }

    #[test]
    fn test_fire_rapid_convergence_near_minimum() {
        // Start very close to minimum - should converge in few steps
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(2.0, 0.0, 0.0)];

        // Initial positions only 0.001 away from minimum
        let initial = vec![Vector3::new(0.001, 0.0, 0.0), Vector3::new(2.001, 0.0, 0.0)];

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 1.0;
        let fmax = 0.001;

        let mut steps = 0;
        for _ in 0..100 {
            state.step(|pos| quadratic_forces(pos, &minimum, k), &config);
            steps += 1;
            if state.is_converged(fmax) {
                break;
            }
        }

        assert!(
            state.is_converged(fmax),
            "Should converge when starting near minimum"
        );
        assert!(
            steps < 20,
            "Should converge in fewer than 20 steps when near minimum, took {steps}"
        );

        // Verify positions are very close to minimum
        for (pos, min) in state.positions.iter().zip(&minimum) {
            assert!(
                (pos - min).norm() < 0.01,
                "Position should be very close to minimum"
            );
        }
    }

    #[test]
    fn test_fire_empty_system() {
        // Edge case: empty system should not panic
        let positions: Vec<Vector3<f64>> = vec![];
        let config = FireConfig::default();
        let mut state = FireState::new(positions, &config);

        state.step(|_| vec![], &config);
        assert_eq!(state.num_atoms(), 0);
    }

    #[test]
    fn test_fire_single_atom_oscillation() {
        // Single atom in harmonic well - check damping of oscillations
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0)];
        let initial = vec![Vector3::new(1.0, 0.0, 0.0)];

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 2.0;

        // Run many steps
        let mut energies = Vec::new();
        for _ in 0..200 {
            state.step(|pos| quadratic_forces(pos, &minimum, k), &config);
            let energy = quadratic_energy(&state.positions, &minimum, k);
            energies.push(energy);
        }

        // Energy should generally decrease (FIRE is damped)
        let early_avg: f64 = energies[0..10].iter().sum::<f64>() / 10.0;
        let late_avg: f64 = energies[190..200].iter().sum::<f64>() / 10.0;
        assert!(
            late_avg < early_avg * 0.1,
            "Energy should decrease significantly"
        );
    }

    #[test]
    fn test_cell_fire_stress_minimization() {
        // Simple test: stressed cell should relax
        let positions = vec![Vector3::new(0.25, 0.25, 0.25)];
        // Strained cell (compressed in x)
        let cell = Matrix3::new(4.5, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0);
        let config = FireConfig::default();
        let mut state = CellFireState::new(positions, cell, &config, 0.01);

        // Target is cubic 5x5x5 cell
        let _target_vol = 125.0;

        // Mock stress function: tries to make cell cubic
        let compute = |_pos: &[Vector3<f64>], cell: &Matrix3<f64>| {
            // No atomic forces
            let forces = vec![Vector3::zeros()];

            // Stress tries to restore cubic shape
            // Positive stress when cell is too large (tensile = contract)
            // Negative stress when cell is too small (compressive = expand)
            let a_len = cell.row(0).norm();
            let b_len = cell.row(1).norm();
            let c_len = cell.row(2).norm();

            let target_len = 5.0;
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

        // Run optimization
        for _ in 0..200 {
            state.step(compute, &config);
        }

        // Cell should have relaxed towards cubic
        let a_len = state.cell.row(0).norm();
        assert!(
            (a_len - 5.0).abs() < 0.5,
            "Cell a-axis should approach 5.0, got {a_len}"
        );
    }

    #[test]
    fn test_fire_already_converged() {
        // Test case: start with forces already below threshold
        // Optimization should complete immediately (in 0 steps)
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(2.0, 0.0, 0.0)];

        // Start exactly at minimum
        let initial = minimum.clone();

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 1.0;
        let fmax = 0.001;

        // Compute initial forces (should be zero)
        let forces = quadratic_forces(&state.positions, &minimum, k);
        state.last_forces = forces;

        // Should already be converged before any step
        assert!(
            state.is_converged(fmax),
            "Should be converged at minimum, max_force={}",
            state.max_force()
        );

        // Max force should be effectively zero
        assert!(
            state.max_force() < 1e-10,
            "Max force should be ~0 at minimum, got {}",
            state.max_force()
        );

        // Taking a step should not change anything significantly
        let initial_positions = state.positions.clone();
        state.step(|pos| quadratic_forces(pos, &minimum, k), &config);

        for (pos, init) in state.positions.iter().zip(&initial_positions) {
            assert!(
                (pos - init).norm() < 1e-8,
                "Position should not change when at minimum"
            );
        }

        // Should still be converged
        assert!(state.is_converged(fmax));
    }

    #[test]
    fn test_fire_max_step_limiting() {
        // Test that max_step limiting works correctly
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0)];
        // Start very far from minimum
        let initial = vec![Vector3::new(10.0, 0.0, 0.0)];

        let config = FireConfig {
            max_step: 0.1, // Very small max step
            ..Default::default()
        };

        let mut state = FireState::new(initial, &config);
        let k = 10.0; // Strong spring = large forces

        let initial_pos = state.positions[0];
        state.step(|pos| quadratic_forces(pos, &minimum, k), &config);

        // Displacement should be limited by max_step
        let displacement = (state.positions[0] - initial_pos).norm();
        assert!(
            displacement <= config.max_step + 1e-10,
            "Displacement {} should be <= max_step {}",
            displacement,
            config.max_step
        );
    }

    #[test]
    fn test_cell_fire_already_converged() {
        // Test CellFireState with zero forces and stress
        let positions = vec![Vector3::new(0.5, 0.5, 0.5)];
        let cell = Matrix3::identity() * 5.0;
        let config = FireConfig::default();
        let mut state = CellFireState::new(positions, cell, &config, 1.0);

        // Zero forces and stress
        let compute = |_pos: &[Vector3<f64>], _cell: &Matrix3<f64>| {
            (vec![Vector3::zeros()], Matrix3::zeros())
        };

        // Take one step to set last_forces and last_stress
        state.step(compute, &config);

        // Should be converged with any reasonable threshold
        assert!(
            state.is_converged(0.001, 0.001),
            "Should be converged with zero forces/stress"
        );
        assert!(state.max_force() < 1e-10);
        assert!(state.max_stress() < 1e-10);
    }
}
