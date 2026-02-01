//! Molecular dynamics integrators for atomistic simulations.
//!
//! Functional API: pure functions that take state and return new state.
//!
//! # Units (ASE-compatible)
//! - Energy: eV
//! - Length: Angstrom
//! - Mass: amu (atomic mass units)
//! - Time: fs (femtoseconds)
//!
//! # Example
//!
//! ```rust,ignore
//! use ferrox::integrators::{MDState, LangevinConfig, init_velocities, langevin_step};
//!
//! let state = MDState::new(positions, masses);
//! let state = init_velocities(state, 300.0, &mut rng);
//!
//! let config = LangevinConfig::new(300.0, 0.01, 1.0);
//! for _ in 0..1000 {
//!     let forces = compute_forces(&state.positions);
//!     state = langevin_step(state, &forces, &config, &mut rng);
//! }
//! ```

use nalgebra::{Matrix3, Vector3};
use rand::prelude::*;

// === Unit conversion constants ===

/// ASE unit conversion constants.
pub mod units {
    /// Boltzmann constant in eV/K.
    pub const KB: f64 = 8.617333262e-5;

    /// Internal time unit in femtoseconds: sqrt(amu * Å² / eV) ≈ 10.18 fs
    pub const INTERNAL_TIME_FS: f64 = 10.1805055073576;

    /// Conversion: fs to internal time units.
    pub const FS_TO_INTERNAL: f64 = 1.0 / INTERNAL_TIME_FS;

    /// Conversion: internal time to fs.
    pub const INTERNAL_TO_FS: f64 = INTERNAL_TIME_FS;
}

// === MD State ===

/// State of a molecular dynamics simulation.
///
/// Plain data container - all operations are standalone functions.
#[derive(Debug, Clone, Default)]
pub struct MDState {
    /// Atomic positions in Angstrom.
    pub positions: Vec<Vector3<f64>>,
    /// Atomic velocities in Angstrom/internal_time_unit.
    pub velocities: Vec<Vector3<f64>>,
    /// Forces on atoms in eV/Angstrom.
    pub forces: Vec<Vector3<f64>>,
    /// Atomic masses in amu.
    pub masses: Vec<f64>,
    /// Optional unit cell (3x3 matrix, rows are lattice vectors).
    pub cell: Option<Matrix3<f64>>,
    /// Periodic boundary conditions along each axis.
    pub pbc: [bool; 3],
}

impl MDState {
    /// Create a new MD state with zero velocities and forces.
    pub fn new(positions: Vec<Vector3<f64>>, masses: Vec<f64>) -> Self {
        let n_atoms = positions.len();
        assert_eq!(
            masses.len(),
            n_atoms,
            "masses.len() must match positions.len()"
        );
        Self {
            positions,
            velocities: vec![Vector3::zeros(); n_atoms],
            forces: vec![Vector3::zeros(); n_atoms],
            masses,
            cell: None,
            pbc: [true, true, true],
        }
    }

    /// Create state with cell and PBC.
    pub fn with_cell(
        positions: Vec<Vector3<f64>>,
        masses: Vec<f64>,
        cell: Matrix3<f64>,
        pbc: [bool; 3],
    ) -> Self {
        let mut state = Self::new(positions, masses);
        state.cell = Some(cell);
        state.pbc = pbc;
        state
    }

    /// Number of atoms.
    #[inline]
    pub fn num_atoms(&self) -> usize {
        self.positions.len()
    }

    /// Initialize velocities from Maxwell-Boltzmann distribution (method wrapper).
    pub fn init_velocities(&mut self, temperature_k: f64, seed: Option<u64>) {
        use rand::SeedableRng;
        let mut rng = match seed {
            Some(s) => rand::rngs::StdRng::seed_from_u64(s),
            None => rand::rngs::StdRng::from_entropy(),
        };
        let new_state = init_velocities(std::mem::take(self), temperature_k, &mut rng);
        *self = new_state;
    }

    /// Compute kinetic energy in eV (method wrapper).
    pub fn kinetic_energy(&self) -> f64 {
        kinetic_energy(self)
    }

    /// Compute temperature in Kelvin (method wrapper).
    pub fn temperature(&self) -> f64 {
        temperature(self)
    }

    /// Set forces directly.
    pub fn set_forces(&mut self, forces: &[Vector3<f64>]) {
        assert_eq!(forces.len(), self.num_atoms());
        self.forces = forces.to_vec();
    }
}

// === Pure functions operating on MDState ===

/// Compute kinetic energy in eV.
pub fn kinetic_energy(state: &MDState) -> f64 {
    state
        .velocities
        .iter()
        .zip(&state.masses)
        .map(|(vel, &mass)| 0.5 * mass * vel.norm_squared())
        .sum()
}

/// Compute temperature in Kelvin from kinetic energy.
pub fn temperature(state: &MDState) -> f64 {
    let dof = degrees_of_freedom(state);
    if dof == 0 {
        return 0.0;
    }
    let ke = kinetic_energy(state);
    2.0 * ke / (dof as f64 * units::KB)
}

/// Get degrees of freedom: 3N - 3 for N > 1 (COM removed), 3N otherwise.
pub fn degrees_of_freedom(state: &MDState) -> usize {
    let n = state.num_atoms();
    if n <= 1 { 3 * n } else { 3 * n - 3 }
}

/// Remove center-of-mass momentum, returning new state.
pub fn zero_com_momentum(mut state: MDState) -> MDState {
    if state.num_atoms() == 0 {
        return state;
    }

    let (total_momentum, total_mass) = state
        .velocities
        .iter()
        .zip(&state.masses)
        .fold((Vector3::zeros(), 0.0), |(mom, mass), (vel, &m)| {
            (mom + m * vel, mass + m)
        });

    if total_mass > 0.0 {
        let com_vel = total_momentum / total_mass;
        for vel in &mut state.velocities {
            *vel -= com_vel;
        }
    }
    state
}

/// Initialize velocities from Maxwell-Boltzmann distribution.
pub fn init_velocities<R: Rng>(mut state: MDState, temperature_k: f64, rng: &mut R) -> MDState {
    if temperature_k <= 0.0 || state.num_atoms() == 0 {
        return state;
    }

    // Sample from Maxwell-Boltzmann
    for (vel, &mass) in state.velocities.iter_mut().zip(&state.masses) {
        let v_std = (units::KB * temperature_k / mass).sqrt();
        *vel = Vector3::new(
            box_muller_normal(rng) * v_std,
            box_muller_normal(rng) * v_std,
            box_muller_normal(rng) * v_std,
        );
    }

    // Remove COM motion
    state = zero_com_momentum(state);

    // Scale to exact temperature
    let current_temp = temperature(&state);
    if current_temp > 0.0 {
        let scale = (temperature_k / current_temp).sqrt();
        for vel in &mut state.velocities {
            *vel *= scale;
        }
    }
    state
}

/// Set forces on state.
pub fn set_forces(mut state: MDState, forces: &[Vector3<f64>]) -> MDState {
    assert_eq!(forces.len(), state.num_atoms());
    state.forces = forces.to_vec();
    state
}

// === Velocity Verlet integrator (NVE) ===

/// First half of velocity Verlet: update velocities and positions.
/// After this, compute new forces and call `velocity_verlet_finalize`.
pub fn velocity_verlet_init(mut state: MDState, dt_fs: f64) -> MDState {
    let dt = dt_fs * units::FS_TO_INTERNAL;
    for idx in 0..state.num_atoms() {
        let accel = state.forces[idx] / state.masses[idx];
        state.velocities[idx] += 0.5 * dt * accel;
        state.positions[idx] += dt * state.velocities[idx];
    }
    state
}

/// Complete velocity Verlet with new forces.
pub fn velocity_verlet_finalize(
    mut state: MDState,
    dt_fs: f64,
    new_forces: &[Vector3<f64>],
) -> MDState {
    let dt = dt_fs * units::FS_TO_INTERNAL;
    state.forces = new_forces.to_vec();
    for idx in 0..state.num_atoms() {
        let accel = state.forces[idx] / state.masses[idx];
        state.velocities[idx] += 0.5 * dt * accel;
    }
    state
}

/// Complete velocity Verlet step with force function.
pub fn velocity_verlet_step<F>(state: MDState, dt_fs: f64, mut compute_forces: F) -> MDState
where
    F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
{
    let state = velocity_verlet_init(state, dt_fs);
    let new_forces = compute_forces(&state.positions);
    velocity_verlet_finalize(state, dt_fs, &new_forces)
}

// === Langevin integrator (NVT) - BAOAB scheme ===

/// Configuration for Langevin thermostat.
#[derive(Debug, Clone, Default)]
pub struct LangevinConfig {
    /// Target temperature in Kelvin.
    pub temperature_k: f64,
    /// Time step in fs.
    pub dt_fs: f64,
    /// Pre-computed: dt in internal units.
    dt_int: f64,
    /// Friction coefficient in internal units (stored to avoid ln recovery).
    friction_int: f64,
    /// Pre-computed: c1 = exp(-friction * dt).
    c1: f64,
    /// Pre-computed: c2 = sqrt(1 - c1²).
    c2: f64,
}

impl LangevinConfig {
    /// Create Langevin configuration.
    ///
    /// # Arguments
    /// * `temperature_k` - Target temperature in Kelvin
    /// * `friction` - Friction coefficient in 1/fs (typical: 0.001 to 0.01)
    /// * `dt_fs` - Time step in fs
    pub fn new(temperature_k: f64, friction: f64, dt_fs: f64) -> Self {
        let dt_int = dt_fs * units::FS_TO_INTERNAL;
        let friction_int = friction * units::INTERNAL_TO_FS;
        let c1 = (-friction_int * dt_int).exp();
        let c2 = (1.0 - c1 * c1).sqrt();
        Self {
            temperature_k,
            dt_fs,
            dt_int,
            friction_int,
            c1,
            c2,
        }
    }

    /// Update temperature.
    pub fn with_temperature(mut self, temperature_k: f64) -> Self {
        self.temperature_k = temperature_k;
        self
    }

    /// Update friction coefficient (1/fs).
    pub fn with_friction(mut self, friction: f64) -> Self {
        self.friction_int = friction * units::INTERNAL_TO_FS;
        self.c1 = (-self.friction_int * self.dt_int).exp();
        self.c2 = (1.0 - self.c1 * self.c1).sqrt();
        self
    }

    /// Update time step (fs).
    pub fn with_dt(mut self, dt_fs: f64) -> Self {
        self.dt_fs = dt_fs;
        self.dt_int = dt_fs * units::FS_TO_INTERNAL;
        // Recompute c1, c2 using stored friction_int (avoids numerically unstable ln)
        self.c1 = (-self.friction_int * self.dt_int).exp();
        self.c2 = (1.0 - self.c1 * self.c1).sqrt();
        self
    }
}

/// Perform one Langevin dynamics step (BAOAB scheme).
pub fn langevin_step<R, F>(
    mut state: MDState,
    config: &LangevinConfig,
    rng: &mut R,
    mut compute_forces: F,
) -> MDState
where
    R: Rng,
    F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
{
    let n_atoms = state.num_atoms();
    let half_dt = 0.5 * config.dt_int;

    // B: Half-step velocity from current forces
    for idx in 0..n_atoms {
        let accel = state.forces[idx] / state.masses[idx];
        state.velocities[idx] += half_dt * accel;
    }

    // A: Half-step position
    for idx in 0..n_atoms {
        state.positions[idx] += half_dt * state.velocities[idx];
    }

    // O: Ornstein-Uhlenbeck (friction + random kicks)
    for idx in 0..n_atoms {
        let mass = state.masses[idx];
        let v_std = (units::KB * config.temperature_k / mass).sqrt();
        let vel = &mut state.velocities[idx];
        for axis in 0..3 {
            let noise = box_muller_normal(rng);
            vel[axis] = config.c1 * vel[axis] + config.c2 * v_std * noise;
        }
    }

    // A: Half-step position
    for idx in 0..n_atoms {
        state.positions[idx] += half_dt * state.velocities[idx];
    }

    // Compute new forces
    let new_forces = compute_forces(&state.positions);
    state.forces = new_forces;

    // B: Half-step velocity from new forces
    for idx in 0..n_atoms {
        let accel = state.forces[idx] / state.masses[idx];
        state.velocities[idx] += half_dt * accel;
    }

    state
}

// === Stateful Langevin integrator (for Python bindings) ===

/// Stateful Langevin integrator with internal RNG.
///
/// This wrapper is for use with Python bindings where we need mutable state.
/// For pure Rust code, prefer the functional `langevin_step` API.
pub struct LangevinIntegrator {
    config: LangevinConfig,
    rng: rand::rngs::StdRng,
}

impl LangevinIntegrator {
    /// Create a new Langevin integrator.
    pub fn new(temperature_k: f64, friction: f64, dt_fs: f64, seed: Option<u64>) -> Self {
        use rand::SeedableRng;
        let rng = match seed {
            Some(s) => rand::rngs::StdRng::seed_from_u64(s),
            None => rand::rngs::StdRng::from_entropy(),
        };
        Self {
            config: LangevinConfig::new(temperature_k, friction, dt_fs),
            rng,
        }
    }

    /// Perform one Langevin dynamics step, mutating the state in place.
    pub fn step<F>(&mut self, state: &mut MDState, mut compute_forces: F)
    where
        F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
    {
        let new_state = langevin_step(
            std::mem::take(state),
            &self.config,
            &mut self.rng,
            &mut compute_forces,
        );
        *state = new_state;
    }

    /// Set target temperature.
    pub fn set_temperature(&mut self, temperature_k: f64) {
        self.config = std::mem::take(&mut self.config).with_temperature(temperature_k);
    }

    /// Set friction coefficient (1/fs).
    pub fn set_friction(&mut self, friction: f64) {
        self.config = std::mem::take(&mut self.config).with_friction(friction);
    }

    /// Set time step (fs).
    pub fn set_dt(&mut self, dt_fs: f64) {
        self.config = std::mem::take(&mut self.config).with_dt(dt_fs);
    }
}

// === Utilities ===

/// Box-Muller transform for standard normal random number.
fn box_muller_normal<R: Rng>(rng: &mut R) -> f64 {
    let u1: f64 = rng.gen_range(0.0001..1.0);
    let u2: f64 = rng.gen_range(0.0..std::f64::consts::TAU);
    (-2.0 * u1.ln()).sqrt() * u2.cos()
}

// === Tests ===

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn make_diatomic() -> MDState {
        let positions = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)];
        let masses = vec![12.0, 12.0];
        MDState::new(positions, masses)
    }

    fn harmonic_forces(positions: &[Vector3<f64>], k: f64, r0: f64) -> Vec<Vector3<f64>> {
        assert_eq!(positions.len(), 2);
        let diff = positions[1] - positions[0];
        let dist = diff.norm();
        let unit = if dist > 1e-10 { diff / dist } else { diff };
        let force_mag = -k * (dist - r0);
        vec![-force_mag * unit, force_mag * unit]
    }

    #[test]
    fn test_mdstate_creation() {
        let state = make_diatomic();
        assert_eq!(state.num_atoms(), 2);
        assert_eq!(state.velocities.len(), 2);
        assert_eq!(state.forces.len(), 2);
    }

    #[test]
    fn test_init_velocities() {
        let state = make_diatomic();
        let mut rng = StdRng::seed_from_u64(42);
        let state = init_velocities(state, 300.0, &mut rng);

        assert!(state.velocities.iter().any(|v| v.norm() > 1e-10));
        let temp = temperature(&state);
        assert!(
            (temp - 300.0).abs() < 50.0,
            "Temperature {temp} should be ~300 K"
        );
    }

    #[test]
    fn test_zero_com_momentum() {
        let mut state = make_diatomic();
        state.velocities[0] = Vector3::new(1.0, 2.0, 3.0);
        state.velocities[1] = Vector3::new(4.0, 5.0, 6.0);

        let state = zero_com_momentum(state);

        let total_mom: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(v, m)| *m * v)
            .sum();
        assert!(total_mom.norm() < 1e-10, "COM momentum should be zero");
    }

    #[test]
    fn test_kinetic_energy() {
        let mut state = make_diatomic();
        state.velocities[0] = Vector3::new(0.1, 0.0, 0.0);
        state.velocities[1] = Vector3::new(0.0, 0.0, 0.0);

        let ke = kinetic_energy(&state);
        let expected = 0.5 * 12.0 * 0.01;
        assert!(
            (ke - expected).abs() < 1e-10,
            "KE {ke} should be {expected}"
        );
    }

    #[test]
    fn test_velocity_verlet_energy_conservation() {
        let mut state = make_diatomic();
        let k = 1.0;
        let r0 = 1.2;

        state.positions[1] = Vector3::new(1.4, 0.0, 0.0);
        let forces = harmonic_forces(&state.positions, k, r0);
        state = set_forces(state, &forces);

        let dt = 1.0;
        let mut energies = Vec::new();

        for _ in 0..500 {
            state = velocity_verlet_step(state, dt, |pos| harmonic_forces(pos, k, r0));
            let ke = kinetic_energy(&state);
            let dist = (state.positions[1] - state.positions[0]).norm();
            let pe = 0.5 * k * (dist - r0).powi(2);
            energies.push(ke + pe);
        }

        let e_init = energies[0];
        let e_final = *energies.last().unwrap();
        let e_drift = (e_final - e_init).abs() / e_init.max(1e-10);
        assert!(
            e_drift < 0.01,
            "Energy drift {:.2}% too large",
            e_drift * 100.0
        );
    }

    #[test]
    fn test_langevin_temperature() {
        let mut state = make_diatomic();
        let target_temp = 300.0;
        let k = 1.0;
        let r0 = 1.2;

        state.positions[1] = Vector3::new(r0, 0.0, 0.0);
        let forces = harmonic_forces(&state.positions, k, r0);
        state = set_forces(state, &forces);

        let config = LangevinConfig::new(target_temp, 0.01, 1.0);
        let mut rng = StdRng::seed_from_u64(42);

        let mut temps = Vec::new();
        for _ in 0..2000 {
            state = langevin_step(state, &config, &mut rng, |pos| harmonic_forces(pos, k, r0));
            temps.push(temperature(&state));
        }

        let avg_temp: f64 = temps[1000..].iter().sum::<f64>() / 1000.0;
        assert!(
            avg_temp > target_temp * 0.1 && avg_temp < target_temp * 10.0,
            "Avg temp {avg_temp} K should be near {target_temp} K"
        );
    }

    #[test]
    fn test_degrees_of_freedom() {
        let single = MDState::new(vec![Vector3::zeros()], vec![1.0]);
        assert_eq!(degrees_of_freedom(&single), 3);

        let diatomic = make_diatomic();
        assert_eq!(degrees_of_freedom(&diatomic), 3);

        let many = MDState::new(vec![Vector3::zeros(); 10], vec![1.0; 10]);
        assert_eq!(degrees_of_freedom(&many), 27);
    }

    #[test]
    fn test_harmonic_oscillator_analytical() {
        let mass: f64 = 1.0;
        let k: f64 = 1.0;
        let omega = (k / mass).sqrt();
        let amplitude = 0.5;

        let positions = vec![Vector3::new(amplitude, 0.0, 0.0)];
        let masses = vec![mass];
        let mut state = MDState::new(positions, masses);

        let compute_forces = |pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            vec![Vector3::new(-k * pos[0].x, 0.0, 0.0)]
        };

        let forces = compute_forces(&state.positions);
        state = set_forces(state, &forces);

        let period_internal = 2.0 * std::f64::consts::PI / omega;
        let period_fs = period_internal * units::INTERNAL_TO_FS;
        let dt_fs = period_fs / 200.0;
        let n_periods = 100;
        let n_steps = (n_periods as f64 * 200.0) as usize;

        let mut max_position_error: f64 = 0.0;

        for step in 0..n_steps {
            let time_fs = step as f64 * dt_fs;
            let time_internal = time_fs * units::FS_TO_INTERNAL;
            let x_analytical = amplitude * (omega * time_internal).cos();
            let x_error = (state.positions[0].x - x_analytical).abs();
            max_position_error = max_position_error.max(x_error);

            state = velocity_verlet_step(state, dt_fs, compute_forces);
        }

        assert!(
            max_position_error < 0.05 * amplitude,
            "Max position error {:.2e} Å exceeds 5%",
            max_position_error
        );
    }

    #[test]
    fn test_energy_conservation_long_run() {
        let mut state = make_diatomic();
        let k = 2.0;
        let r0 = 1.0;

        state.positions[1] = Vector3::new(1.3, 0.0, 0.0);
        state.velocities[0] = Vector3::new(0.0, 0.01, 0.0);
        state.velocities[1] = Vector3::new(0.0, -0.01, 0.0);

        let forces = harmonic_forces(&state.positions, k, r0);
        state = set_forces(state, &forces);

        let calc_pe = |positions: &[Vector3<f64>]| -> f64 {
            let dist = (positions[1] - positions[0]).norm();
            0.5 * k * (dist - r0).powi(2)
        };

        let e_initial = kinetic_energy(&state) + calc_pe(&state.positions);

        let dt = 0.1;
        for _ in 0..12000 {
            state = velocity_verlet_step(state, dt, |pos| harmonic_forces(pos, k, r0));
        }

        let e_final = kinetic_energy(&state) + calc_pe(&state.positions);
        let drift = (e_final - e_initial).abs() / e_initial;
        assert!(drift < 1e-5, "Energy drift {:.2e} exceeds 1e-5", drift);
    }

    #[test]
    fn test_com_momentum_removal_exact() {
        let positions = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.5, 0.866, 0.0),
            Vector3::new(0.5, 0.289, 0.816),
        ];
        let masses = vec![12.0, 16.0, 14.0, 32.0];
        let mut state = MDState::new(positions, masses);

        state.velocities[0] = Vector3::new(1.234, -0.567, 2.891);
        state.velocities[1] = Vector3::new(-2.345, 1.678, -0.912);
        state.velocities[2] = Vector3::new(0.456, -3.789, 1.234);
        state.velocities[3] = Vector3::new(-1.567, 2.345, -0.678);

        let state = zero_com_momentum(state);

        let final_momentum: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(v, m)| *m * v)
            .sum();
        assert!(
            final_momentum.norm() < 1e-13,
            "Final momentum should be zero"
        );
    }

    #[test]
    fn test_equipartition_theorem() {
        let n_atoms = 50;
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * 2.0, 0.0, 0.0))
            .collect();
        let masses = vec![12.0; n_atoms];
        let state = MDState::new(positions, masses);
        let target_temp = 300.0;

        let mut rng = StdRng::seed_from_u64(12345);
        let state = init_velocities(state, target_temp, &mut rng);

        let temp_after_init = temperature(&state);
        assert!(
            (temp_after_init - target_temp).abs() < 1.0,
            "Temperature after init {:.1} K should be {target_temp} K",
            temp_after_init
        );

        let ke = kinetic_energy(&state);
        let dof = degrees_of_freedom(&state);
        let expected_ke = 0.5 * dof as f64 * units::KB * target_temp;
        let ke_error = (ke - expected_ke).abs() / expected_ke;
        assert!(
            ke_error < 0.01,
            "KE differs from expected by {:.1}%",
            ke_error * 100.0
        );
    }

    #[test]
    fn test_langevin_equipartition_long_run() {
        let n_atoms = 20;
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * 3.0, 0.0, 0.0))
            .collect();
        let masses = vec![12.0; n_atoms];
        let mut state = MDState::new(positions, masses);
        let target_temp = 300.0;
        let k = 0.5;
        let r0 = 3.0;

        let compute_forces = |positions: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            let n = positions.len();
            let mut forces = vec![Vector3::zeros(); n];
            for idx in 0..n - 1 {
                let diff = positions[idx + 1] - positions[idx];
                let dist = diff.norm();
                let unit = if dist > 1e-10 { diff / dist } else { diff };
                let f_mag = -k * (dist - r0);
                forces[idx] -= f_mag * unit;
                forces[idx + 1] += f_mag * unit;
            }
            forces
        };

        let forces = compute_forces(&state.positions);
        state = set_forces(state, &forces);

        let config = LangevinConfig::new(target_temp, 0.005, 1.0);
        let mut rng = StdRng::seed_from_u64(42);

        // Equilibrate
        for _ in 0..10000 {
            state = langevin_step(state, &config, &mut rng, compute_forces);
        }

        // Sample
        let mut temp_samples = Vec::with_capacity(20000);
        for _ in 0..20000 {
            state = langevin_step(state, &config, &mut rng, compute_forces);
            temp_samples.push(temperature(&state));
        }

        let avg_temp: f64 = temp_samples.iter().sum::<f64>() / temp_samples.len() as f64;
        let temp_error = (avg_temp - target_temp).abs() / target_temp;
        assert!(
            temp_error < 0.15,
            "Avg temp {:.1} K differs from {target_temp} K by {:.1}%",
            avg_temp,
            temp_error * 100.0
        );
    }

    #[test]
    fn test_langevin_config_update() {
        // Test that with_* builder methods work correctly
        let config = LangevinConfig::new(300.0, 0.01, 1.0);

        let config_new_temp = config.clone().with_temperature(600.0);
        assert_eq!(config_new_temp.temperature_k, 600.0);

        let config_new_friction = config.clone().with_friction(0.05);
        // Higher friction leads to faster velocity relaxation
        // Test by running one step and checking velocity is more damped
        let mut state1 = MDState::new(vec![Vector3::zeros()], vec![12.0]);
        let mut state2 = MDState::new(vec![Vector3::zeros()], vec![12.0]);
        state1.velocities[0] = Vector3::new(1.0, 0.0, 0.0);
        state2.velocities[0] = Vector3::new(1.0, 0.0, 0.0);

        let mut rng1 = StdRng::seed_from_u64(42);
        let mut rng2 = StdRng::seed_from_u64(42);
        let zero_forces = |_: &[Vector3<f64>]| vec![Vector3::zeros()];

        state1 = langevin_step(state1, &config, &mut rng1, zero_forces);
        state2 = langevin_step(state2, &config_new_friction, &mut rng2, zero_forces);

        // With same seed, higher friction should give larger velocity change
        let change1 = (state1.velocities[0].x - 1.0).abs();
        let change2 = (state2.velocities[0].x - 1.0).abs();
        assert!(
            change2 > change1,
            "Higher friction should cause larger velocity change: low={change1}, high={change2}"
        );
    }

    #[test]
    fn test_langevin_config_with_dt_preserves_friction() {
        // Test that with_dt correctly preserves the friction coefficient
        let friction = 0.02;
        let dt1 = 1.0;
        let dt2 = 2.0;

        // Create config with known friction and dt
        let config1 = LangevinConfig::new(300.0, friction, dt1);

        // Update dt - friction should be preserved
        let config2 = config1.clone().with_dt(dt2);

        // Create a fresh config with same friction but new dt for comparison
        let config_fresh = LangevinConfig::new(300.0, friction, dt2);

        // c1 and c2 should match the fresh config (same friction, same dt)
        assert!(
            (config2.c1 - config_fresh.c1).abs() < 1e-14,
            "c1 mismatch after with_dt: {} vs {} (fresh)",
            config2.c1,
            config_fresh.c1
        );
        assert!(
            (config2.c2 - config_fresh.c2).abs() < 1e-14,
            "c2 mismatch after with_dt: {} vs {} (fresh)",
            config2.c2,
            config_fresh.c2
        );

        // Also verify dt was updated
        assert_eq!(config2.dt_fs, dt2);
    }

    // === torch-sim Compatible Tests ===

    #[test]
    fn test_calculate_momenta_zero_com_torch_sim_style() {
        // Matches torch-sim test_calculate_momenta_basic:
        // After velocity initialization, each system should have zero COM momentum

        let n_atoms = 8;
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64, 0.0, 0.0))
            .collect();
        let masses = (0..n_atoms)
            .map(|_| 12.0 + rand::random::<f64>() * 10.0)
            .collect();
        let mut state = MDState::new(positions, masses);

        // Initialize velocities
        let mut rng = StdRng::seed_from_u64(42);
        state = init_velocities(state, 300.0, &mut rng);

        // Zero COM momentum
        state = zero_com_momentum(state);

        // Check COM momentum is zero
        let total_momentum: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(vel, mass)| *mass * vel)
            .sum();

        assert!(
            total_momentum.norm() < 1e-10,
            "COM momentum should be zero, got {:?}",
            total_momentum
        );
    }

    #[test]
    fn test_nvt_langevin_temperature_torch_sim_style() {
        // NVT Langevin should maintain temperature near target (torch-sim style)
        let mut state = make_diatomic();
        let target_temp = 300.0;
        let k = 1.0;
        let r0 = 1.2;

        state.positions[1] = Vector3::new(r0, 0.0, 0.0);
        let forces = harmonic_forces(&state.positions, k, r0);
        state = set_forces(state, &forces);

        let config = LangevinConfig::new(target_temp, 0.01, 1.0);
        let mut rng = StdRng::seed_from_u64(42);

        let mut temps = Vec::new();
        for _ in 0..2000 {
            state = langevin_step(state, &config, &mut rng, |pos| harmonic_forces(pos, k, r0));
            temps.push(temperature(&state));
        }

        let avg_temp: f64 = temps[1000..].iter().sum::<f64>() / 1000.0;

        // For small systems, temperature fluctuations are large
        // Check that we're in a reasonable range (similar to existing test)
        assert!(
            avg_temp > target_temp * 0.1 && avg_temp < target_temp * 10.0,
            "Avg temp {avg_temp} K should be in reasonable range of {target_temp} K"
        );
    }

    #[test]
    fn test_nve_energy_conservation_torch_sim_style() {
        // NVE (velocity Verlet) should conserve energy (torch-sim style)
        let mut state = make_diatomic();
        let k = 1.0;
        let r0 = 1.2;

        state.positions[1] = Vector3::new(1.4, 0.0, 0.0);
        let forces = harmonic_forces(&state.positions, k, r0);
        state = set_forces(state, &forces);

        let dt = 1.0;
        let mut energies = Vec::new();

        for _ in 0..500 {
            state = velocity_verlet_step(state, dt, |pos| harmonic_forces(pos, k, r0));
            let ke = kinetic_energy(&state);
            let dist = (state.positions[1] - state.positions[0]).norm();
            let pe = 0.5 * k * (dist - r0).powi(2);
            energies.push(ke + pe);
        }

        // For harmonic oscillator, energy should be very well conserved
        let n = energies.len() as f64;
        let mean_energy = energies.iter().sum::<f64>() / n;
        let std_energy = (energies
            .iter()
            .map(|e| (e - mean_energy).powi(2))
            .sum::<f64>()
            / n)
            .sqrt();
        let e_drift = std_energy / mean_energy.max(1e-10);
        assert!(
            e_drift < 0.01,
            "Energy drift {:.2}% should be < 1% (NVE conservation)",
            e_drift * 100.0
        );
    }
}
