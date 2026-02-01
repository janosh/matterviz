//! Geometry optimization algorithms for atomistic simulations.
//!
//! Functional API: pure functions that take state and return new state.
//!
//! # Example
//!
//! ```rust,ignore
//! use ferrox::optimizers::{FireState, FireConfig, fire_step, is_converged};
//!
//! let config = FireConfig::default();
//! let mut state = FireState::new(positions, &config);
//!
//! // Perform initial step to compute forces (last_forces starts at zero)
//! state = fire_step(state, |pos| compute_forces(pos), &config);
//!
//! while !is_converged(&state, 0.01) {
//!     state = fire_step(state, |pos| compute_forces(pos), &config);
//! }
//! ```

use nalgebra::{Matrix3, Vector3};

// ============================================================================
// Configuration
// ============================================================================

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

// ============================================================================
// FIRE state - plain data struct with optimizer state
// ============================================================================

/// FIRE optimizer state.
#[derive(Debug, Clone, Default)]
pub struct FireState {
    /// Atomic positions in Angstrom.
    pub positions: Vec<Vector3<f64>>,
    /// Velocities (FIRE algorithm units).
    pub velocities: Vec<Vector3<f64>>,
    /// Current timestep.
    pub dt: f64,
    /// Current mixing parameter.
    pub alpha: f64,
    /// Steps since last velocity reset.
    pub n_pos: usize,
    /// Last computed forces.
    pub last_forces: Vec<Vector3<f64>>,
}

impl FireState {
    /// Create new FIRE state.
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
    #[inline]
    pub fn num_atoms(&self) -> usize {
        self.positions.len()
    }

    /// Perform one FIRE step (method wrapper for Python bindings).
    pub fn step<F>(&mut self, compute_forces: F, config: &FireConfig)
    where
        F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
    {
        let new_state = fire_step(std::mem::take(self), compute_forces, config);
        *self = new_state;
    }

    /// Check if optimization has converged (method wrapper).
    pub fn is_converged(&self, fmax: f64) -> bool {
        is_converged(self, fmax)
    }

    /// Get maximum force component (method wrapper).
    pub fn max_force(&self) -> f64 {
        max_force(self)
    }
}

// ============================================================================
// Pure functions for FIRE optimization
// ============================================================================

/// Compute maximum force component magnitude.
pub fn max_force(state: &FireState) -> f64 {
    state
        .last_forces
        .iter()
        .flat_map(|f| [f.x.abs(), f.y.abs(), f.z.abs()])
        .fold(0.0, f64::max)
}

/// Check if optimization has converged.
pub fn is_converged(state: &FireState, fmax: f64) -> bool {
    max_force(state) < fmax
}

/// Perform one FIRE optimization step.
pub fn fire_step<F>(mut state: FireState, mut compute_forces: F, config: &FireConfig) -> FireState
where
    F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
{
    let n_atoms = state.num_atoms();
    if n_atoms == 0 {
        return state;
    }

    // Compute forces (move into state, reference from there)
    state.last_forces = compute_forces(&state.positions);

    // Compute power: P = F · v
    let power: f64 = state
        .velocities
        .iter()
        .zip(&state.last_forces)
        .map(|(v, f)| v.dot(f))
        .sum();

    // FIRE algorithm
    if power > 0.0 {
        state.n_pos += 1;

        if state.n_pos > config.n_min {
            state.dt = (state.dt * config.f_inc).min(config.dt_max);
            state.alpha *= config.f_alpha;
        }

        // Mix velocity with normalized force direction
        let v_norm: f64 = state
            .velocities
            .iter()
            .map(|v| v.norm_squared())
            .sum::<f64>()
            .sqrt();
        let f_norm: f64 = state
            .last_forces
            .iter()
            .map(|f| f.norm_squared())
            .sum::<f64>()
            .sqrt();

        if f_norm > 1e-10 {
            for (vel, force) in state.velocities.iter_mut().zip(&state.last_forces) {
                let f_hat = force / f_norm;
                *vel = (1.0 - state.alpha) * (*vel) + state.alpha * v_norm * f_hat;
            }
        }
    } else {
        // Reset
        state.n_pos = 0;
        state.dt *= config.f_dec;
        state.alpha = config.alpha_start;
        for vel in &mut state.velocities {
            *vel = Vector3::zeros();
        }
    }

    // Velocity update: v += dt * F
    for (vel, force) in state.velocities.iter_mut().zip(&state.last_forces) {
        *vel += state.dt * force;
    }

    // Position update with step limiting
    for (pos, vel) in state.positions.iter_mut().zip(&state.velocities) {
        let dr = state.dt * vel;
        let dr_norm = dr.norm();
        let dr_limited = if dr_norm > config.max_step {
            dr * (config.max_step / dr_norm)
        } else {
            dr
        };
        *pos += dr_limited;
    }

    state
}

// ============================================================================
// Cell FIRE state and functions
// ============================================================================

/// FIRE optimizer state with cell optimization.
#[derive(Debug, Clone, Default)]
pub struct CellFireState {
    /// Atomic positions in Angstrom.
    pub positions: Vec<Vector3<f64>>,
    /// Position velocities.
    pub velocities: Vec<Vector3<f64>>,
    /// Unit cell matrix (rows are lattice vectors).
    pub cell: Matrix3<f64>,
    /// Cell velocities (deformation rate).
    pub cell_velocities: Matrix3<f64>,
    /// Scaling factor for cell DOF.
    pub cell_factor: f64,
    /// Current timestep.
    pub dt: f64,
    /// Current mixing parameter.
    pub alpha: f64,
    /// Steps since last reset.
    pub n_pos: usize,
    /// Last computed forces.
    pub last_forces: Vec<Vector3<f64>>,
    /// Last computed stress tensor.
    pub last_stress: Matrix3<f64>,
}

impl CellFireState {
    /// Create new CellFireState.
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
    #[inline]
    pub fn num_atoms(&self) -> usize {
        self.positions.len()
    }

    /// Perform one cell FIRE step (method wrapper for Python bindings).
    pub fn step<F>(&mut self, compute_forces_and_stress: F, config: &FireConfig)
    where
        F: FnMut(&[Vector3<f64>], &Matrix3<f64>) -> (Vec<Vector3<f64>>, Matrix3<f64>),
    {
        let new_state = cell_fire_step(std::mem::take(self), compute_forces_and_stress, config);
        *self = new_state;
    }

    /// Check if optimization has converged (method wrapper).
    pub fn is_converged(&self, fmax: f64, smax: f64) -> bool {
        cell_is_converged(self, fmax, smax)
    }

    /// Get maximum force component (method wrapper).
    pub fn max_force(&self) -> f64 {
        cell_max_force(self)
    }

    /// Get maximum stress component (method wrapper).
    pub fn max_stress(&self) -> f64 {
        cell_max_stress(self)
    }
}

/// Compute maximum force component for CellFireState.
pub fn cell_max_force(state: &CellFireState) -> f64 {
    state
        .last_forces
        .iter()
        .flat_map(|f| [f.x.abs(), f.y.abs(), f.z.abs()])
        .fold(0.0, f64::max)
}

/// Compute maximum stress component for CellFireState.
pub fn cell_max_stress(state: &CellFireState) -> f64 {
    (0..3)
        .flat_map(|row| (0..3).map(move |col| state.last_stress[(row, col)].abs()))
        .fold(0.0, f64::max)
}

/// Check if cell optimization has converged.
pub fn cell_is_converged(state: &CellFireState, fmax: f64, smax: f64) -> bool {
    cell_max_force(state) < fmax && cell_max_stress(state) < smax
}

/// Perform one FIRE step with cell optimization.
pub fn cell_fire_step<F>(
    mut state: CellFireState,
    mut compute_forces_and_stress: F,
    config: &FireConfig,
) -> CellFireState
where
    F: FnMut(&[Vector3<f64>], &Matrix3<f64>) -> (Vec<Vector3<f64>>, Matrix3<f64>),
{
    let n_atoms = state.num_atoms();
    if n_atoms == 0 {
        return state;
    }

    // Compute forces and stress (move forces into state)
    let (forces, stress) = compute_forces_and_stress(&state.positions, &state.cell);
    state.last_forces = forces;
    state.last_stress = stress;

    // Cell force = -volume * stress
    let volume = state.cell.determinant().abs();
    let cell_force = -volume * stress * state.cell_factor;

    // Compute power
    let atom_power: f64 = state
        .velocities
        .iter()
        .zip(&state.last_forces)
        .map(|(v, f)| v.dot(f))
        .sum();
    let cell_power: f64 = (0..3)
        .flat_map(|row| (0..3).map(move |col| (row, col)))
        .map(|(row, col)| state.cell_velocities[(row, col)] * cell_force[(row, col)])
        .sum();
    let power = atom_power + cell_power;

    // FIRE algorithm
    if power > 0.0 {
        state.n_pos += 1;

        if state.n_pos > config.n_min {
            state.dt = (state.dt * config.f_inc).min(config.dt_max);
            state.alpha *= config.f_alpha;
        }

        let v_norm_sq: f64 = state
            .velocities
            .iter()
            .map(|v| v.norm_squared())
            .sum::<f64>()
            + state.cell_velocities.norm_squared();
        let f_norm_sq: f64 = state
            .last_forces
            .iter()
            .map(|f| f.norm_squared())
            .sum::<f64>()
            + cell_force.norm_squared();
        let v_norm = v_norm_sq.sqrt();
        let f_norm = f_norm_sq.sqrt();

        if f_norm > 1e-10 {
            for (vel, force) in state.velocities.iter_mut().zip(&state.last_forces) {
                let f_hat = force / f_norm;
                *vel = (1.0 - state.alpha) * (*vel) + state.alpha * v_norm * f_hat;
            }
            let cell_f_hat = cell_force / f_norm;
            state.cell_velocities =
                (1.0 - state.alpha) * state.cell_velocities + state.alpha * v_norm * cell_f_hat;
        }
    } else {
        state.n_pos = 0;
        state.dt *= config.f_dec;
        state.alpha = config.alpha_start;
        for vel in &mut state.velocities {
            *vel = Vector3::zeros();
        }
        state.cell_velocities = Matrix3::zeros();
    }

    // Velocity updates
    for (vel, force) in state.velocities.iter_mut().zip(&state.last_forces) {
        *vel += state.dt * force;
    }
    state.cell_velocities += state.dt * cell_force;

    // Position updates with limiting
    for (pos, vel) in state.positions.iter_mut().zip(&state.velocities) {
        let dr = state.dt * vel;
        let dr_norm = dr.norm();
        let dr_limited = if dr_norm > config.max_step {
            dr * (config.max_step / dr_norm)
        } else {
            dr
        };
        *pos += dr_limited;
    }

    let cell_dr = state.dt * state.cell_velocities;
    let cell_dr_norm = cell_dr.norm();
    let cell_dr_limited = if cell_dr_norm > config.max_step {
        cell_dr * (config.max_step / cell_dr_norm)
    } else {
        cell_dr
    };
    state.cell += cell_dr_limited;

    state
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn quadratic_forces(
        positions: &[Vector3<f64>],
        minimum: &[Vector3<f64>],
        k: f64,
    ) -> Vec<Vector3<f64>> {
        positions
            .iter()
            .zip(minimum)
            .map(|(r, r_min)| -k * (r - r_min))
            .collect()
    }

    fn quadratic_energy(positions: &[Vector3<f64>], minimum: &[Vector3<f64>], k: f64) -> f64 {
        positions
            .iter()
            .zip(minimum)
            .map(|(r, r_min)| 0.5 * k * (r - r_min).norm_squared())
            .sum()
    }

    #[test]
    fn test_fire_converges_to_minimum() {
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)];
        let initial = vec![Vector3::new(0.5, 0.3, 0.0), Vector3::new(0.8, -0.2, 0.1)];

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 1.0;

        for _ in 0..500 {
            state = fire_step(state, |pos| quadratic_forces(pos, &minimum, k), &config);
            if is_converged(&state, 0.001) {
                break;
            }
        }

        assert!(
            is_converged(&state, 0.001),
            "FIRE should converge, max_force={}",
            max_force(&state)
        );

        for (pos, min) in state.positions.iter().zip(&minimum) {
            assert!(
                (pos - min).norm() < 0.1,
                "Position {:?} should be close to {:?}",
                pos,
                min
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
        state.last_forces = vec![Vector3::new(0.1, -0.3, 0.2)];
        assert!((max_force(&state) - 0.3).abs() < 1e-10);
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
        let positions = vec![Vector3::new(1.0, 0.0, 0.0)];
        let config = FireConfig::default();
        let mut state = FireState::new(positions, &config);

        state.velocities = vec![Vector3::new(0.0, 1.0, 0.0)];
        state.dt = 0.5;
        state.alpha = 0.05;
        state.n_pos = 10;

        let force_fn = |_: &[Vector3<f64>]| vec![Vector3::new(-1.0, 0.0, 0.0)];
        state = fire_step(state, force_fn, &config);

        assert_eq!(state.n_pos, 0, "n_pos should reset when P <= 0");
        assert!(
            (state.alpha - config.alpha_start).abs() < 1e-10,
            "alpha should reset"
        );
    }

    #[test]
    fn test_fire_parameter_adaptation() {
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0)];
        let initial = vec![Vector3::new(0.1, 0.0, 0.0)];

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 1.0;

        let mut dt_history = vec![state.dt];

        for _ in 0..50 {
            state = fire_step(state, |pos| quadratic_forces(pos, &minimum, k), &config);
            dt_history.push(state.dt);
        }

        let dt_increased = dt_history.windows(2).any(|w| w[1] > w[0]);
        assert!(
            dt_increased,
            "dt should increase after n_min positive power steps"
        );

        for dt in &dt_history {
            assert!(*dt <= config.dt_max, "dt should never exceed dt_max");
        }
    }

    #[test]
    fn test_fire_rapid_convergence_near_minimum() {
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(2.0, 0.0, 0.0)];
        let initial = vec![Vector3::new(0.001, 0.0, 0.0), Vector3::new(2.001, 0.0, 0.0)];

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 1.0;
        let fmax = 0.001;

        let mut steps = 0;
        for _ in 0..100 {
            state = fire_step(state, |pos| quadratic_forces(pos, &minimum, k), &config);
            steps += 1;
            if is_converged(&state, fmax) {
                break;
            }
        }

        assert!(
            is_converged(&state, fmax),
            "Should converge when starting near minimum"
        );
        assert!(
            steps < 20,
            "Should converge in fewer than 20 steps, took {steps}"
        );
    }

    #[test]
    fn test_fire_empty_system() {
        let positions: Vec<Vector3<f64>> = vec![];
        let config = FireConfig::default();
        let state = FireState::new(positions, &config);
        let state = fire_step(state, |_| vec![], &config);
        assert_eq!(state.num_atoms(), 0);
    }

    #[test]
    fn test_fire_single_atom_oscillation() {
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0)];
        let initial = vec![Vector3::new(1.0, 0.0, 0.0)];

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 2.0;

        let mut energies = Vec::new();
        for _ in 0..200 {
            state = fire_step(state, |pos| quadratic_forces(pos, &minimum, k), &config);
            energies.push(quadratic_energy(&state.positions, &minimum, k));
        }

        let early_avg: f64 = energies[0..10].iter().sum::<f64>() / 10.0;
        let late_avg: f64 = energies[190..200].iter().sum::<f64>() / 10.0;
        assert!(
            late_avg < early_avg * 0.1,
            "Energy should decrease significantly"
        );
    }

    #[test]
    fn test_cell_fire_stress_minimization() {
        let positions = vec![Vector3::new(0.25, 0.25, 0.25)];
        let cell = Matrix3::new(4.5, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0);
        let config = FireConfig::default();
        let mut state = CellFireState::new(positions, cell, &config, 0.01);

        let compute = |_pos: &[Vector3<f64>], cell: &Matrix3<f64>| {
            let forces = vec![Vector3::zeros()];
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

        for _ in 0..200 {
            state = cell_fire_step(state, compute, &config);
        }

        let a_len = state.cell.row(0).norm();
        assert!(
            (a_len - 5.0).abs() < 0.5,
            "Cell a-axis should approach 5.0, got {a_len}"
        );
    }

    #[test]
    fn test_fire_already_converged() {
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(2.0, 0.0, 0.0)];
        let initial = minimum.clone();

        let config = FireConfig::default();
        let mut state = FireState::new(initial, &config);
        let k = 1.0;
        let fmax = 0.001;

        let forces = quadratic_forces(&state.positions, &minimum, k);
        state.last_forces = forces;

        assert!(is_converged(&state, fmax), "Should be converged at minimum");
        assert!(max_force(&state) < 1e-10, "Max force should be ~0");

        let initial_positions = state.positions.clone();
        state = fire_step(state, |pos| quadratic_forces(pos, &minimum, k), &config);

        for (pos, init) in state.positions.iter().zip(&initial_positions) {
            assert!(
                (pos - init).norm() < 1e-8,
                "Position should not change at minimum"
            );
        }
    }

    #[test]
    fn test_fire_max_step_limiting() {
        let minimum = vec![Vector3::new(0.0, 0.0, 0.0)];
        let initial = vec![Vector3::new(10.0, 0.0, 0.0)];

        let config = FireConfig {
            max_step: 0.1,
            ..Default::default()
        };
        let mut state = FireState::new(initial, &config);
        let k = 10.0;

        let initial_pos = state.positions[0];
        state = fire_step(state, |pos| quadratic_forces(pos, &minimum, k), &config);

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
        let positions = vec![Vector3::new(0.5, 0.5, 0.5)];
        let cell = Matrix3::identity() * 5.0;
        let config = FireConfig::default();
        let mut state = CellFireState::new(positions, cell, &config, 1.0);

        let compute =
            |_: &[Vector3<f64>], _: &Matrix3<f64>| (vec![Vector3::zeros()], Matrix3::zeros());

        state = cell_fire_step(state, compute, &config);

        assert!(
            cell_is_converged(&state, 0.001, 0.001),
            "Should be converged with zero forces/stress"
        );
        assert!(cell_max_force(&state) < 1e-10);
        assert!(cell_max_stress(&state) < 1e-10);
    }
}
