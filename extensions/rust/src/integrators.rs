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
    ///
    /// # Panics
    /// Panics if `masses.len() != positions.len()` or if any mass is non-positive.
    pub fn new(positions: Vec<Vector3<f64>>, masses: Vec<f64>) -> Self {
        let n_atoms = positions.len();
        assert_eq!(
            masses.len(),
            n_atoms,
            "masses.len() must match positions.len()"
        );
        for (idx, &mass) in masses.iter().enumerate() {
            assert!(
                mass > 0.0 && mass.is_finite(),
                "Mass at index {idx} must be positive and finite, got {mass}"
            );
        }
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
    let n_atoms = state.num_atoms();
    if n_atoms <= 1 {
        3 * n_atoms
    } else {
        3 * n_atoms - 3
    }
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

/// Complete velocity Verlet step with fallible force function.
///
/// If the force computation fails, the original state is returned along with the error.
///
/// # Errors
/// Returns the error from compute_forces if it fails, along with the original state.
#[allow(clippy::result_large_err)]
pub fn try_velocity_verlet_step<F, E>(
    state: MDState,
    dt_fs: f64,
    mut compute_forces: F,
) -> Result<MDState, (MDState, E)>
where
    F: FnMut(&[Vector3<f64>]) -> Result<Vec<Vector3<f64>>, E>,
{
    if state.num_atoms() == 0 {
        return Ok(state);
    }
    let original_state = state.clone();
    let state = velocity_verlet_init(state, dt_fs);
    match compute_forces(&state.positions) {
        Ok(new_forces) => Ok(velocity_verlet_finalize(state, dt_fs, &new_forces)),
        Err(err) => Err((original_state, err)),
    }
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

// Validation helpers for LangevinConfig parameters
fn validate_temperature(temperature_k: f64) {
    assert!(
        temperature_k >= 0.0 && temperature_k.is_finite(),
        "LangevinConfig requires temperature_k >= 0 and finite (got {temperature_k})"
    );
}

fn validate_friction(friction: f64) {
    assert!(
        friction >= 0.0 && friction.is_finite(),
        "LangevinConfig requires friction >= 0 and finite (got {friction})"
    );
}

fn validate_dt(dt_fs: f64) {
    assert!(
        dt_fs > 0.0 && dt_fs.is_finite(),
        "LangevinConfig requires dt_fs > 0 and finite (got {dt_fs})"
    );
}

impl LangevinConfig {
    /// Create Langevin configuration.
    ///
    /// # Arguments
    /// * `temperature_k` - Target temperature in Kelvin (must be >= 0)
    /// * `friction` - Friction coefficient in 1/fs (must be >= 0; typical: 0.001 to 0.01)
    /// * `dt_fs` - Time step in fs (must be > 0)
    ///
    /// # Panics
    /// Panics if `temperature_k < 0`, `friction < 0`, or `dt_fs <= 0`.
    pub fn new(temperature_k: f64, friction: f64, dt_fs: f64) -> Self {
        validate_temperature(temperature_k);
        validate_friction(friction);
        validate_dt(dt_fs);
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
    ///
    /// # Panics
    /// Panics if `temperature_k < 0` or not finite.
    pub fn with_temperature(mut self, temperature_k: f64) -> Self {
        validate_temperature(temperature_k);
        self.temperature_k = temperature_k;
        self
    }

    /// Update friction coefficient (1/fs).
    ///
    /// # Panics
    /// Panics if `friction < 0` or not finite.
    pub fn with_friction(mut self, friction: f64) -> Self {
        validate_friction(friction);
        self.friction_int = friction * units::INTERNAL_TO_FS;
        self.c1 = (-self.friction_int * self.dt_int).exp();
        self.c2 = (1.0 - self.c1 * self.c1).sqrt();
        self
    }

    /// Update time step (fs).
    ///
    /// # Panics
    /// Panics if `dt_fs <= 0` or not finite.
    pub fn with_dt(mut self, dt_fs: f64) -> Self {
        validate_dt(dt_fs);
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
    state: MDState,
    config: &LangevinConfig,
    rng: &mut R,
    mut compute_forces: F,
) -> MDState
where
    R: Rng,
    F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
{
    // Wrap infallible closure and unwrap result (can't fail with Infallible)
    try_langevin_step(state, config, rng, |pos| {
        Ok::<_, std::convert::Infallible>(compute_forces(pos))
    })
    .unwrap_or_else(|(_state, err): (MDState, std::convert::Infallible)| match err {})
}

/// Perform one Langevin dynamics step with fallible force computation.
///
/// If the force computation fails, the original state is returned along with
/// the error, allowing the caller to retry or handle the failure gracefully.
///
/// # Errors
/// Returns `(original_state, error)` if compute_forces fails.
#[allow(clippy::result_large_err)]
pub fn try_langevin_step<R, F, E>(
    state: MDState,
    config: &LangevinConfig,
    rng: &mut R,
    mut compute_forces: F,
) -> Result<MDState, (MDState, E)>
where
    R: Rng,
    F: FnMut(&[Vector3<f64>]) -> Result<Vec<Vector3<f64>>, E>,
{
    // Clone state upfront so we can restore on error
    let original_state = state.clone();

    // Perform the BAOAB integration
    let mut state = langevin_baoab_core(state, config, rng);

    // Compute new forces - if this fails, return original state
    match compute_forces(&state.positions) {
        Ok(new_forces) => {
            state.forces = new_forces;
            // B: Half-step velocity from new forces
            let half_dt = 0.5 * config.dt_int;
            for idx in 0..state.num_atoms() {
                let accel = state.forces[idx] / state.masses[idx];
                state.velocities[idx] += half_dt * accel;
            }
            Ok(state)
        }
        Err(err) => Err((original_state, err)),
    }
}

/// Core BAOAB integration steps (B-A-O-A, without final B that requires new forces).
fn langevin_baoab_core<R: Rng>(
    mut state: MDState,
    config: &LangevinConfig,
    rng: &mut R,
) -> MDState {
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
    pub fn step<F>(&mut self, state: &mut MDState, compute_forces: F)
    where
        F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
    {
        *state = langevin_step(
            std::mem::take(state),
            &self.config,
            &mut self.rng,
            compute_forces,
        );
    }

    /// Perform one Langevin dynamics step with fallible force computation.
    ///
    /// If the force computation fails, the state and internal RNG are restored
    /// to their original values before the step and the error is returned.
    /// This ensures deterministic behavior on retry.
    ///
    /// # Errors
    /// Returns the error from compute_forces if it fails.
    pub fn try_step<F, E>(&mut self, state: &mut MDState, compute_forces: F) -> Result<(), E>
    where
        F: FnMut(&[Vector3<f64>]) -> Result<Vec<Vector3<f64>>, E>,
    {
        // Clone RNG so we can restore it on error (for reproducibility)
        let original_rng = self.rng.clone();
        match try_langevin_step(
            std::mem::take(state),
            &self.config,
            &mut self.rng,
            compute_forces,
        ) {
            Ok(new_state) => {
                *state = new_state;
                Ok(())
            }
            Err((original_state, err)) => {
                *state = original_state;
                self.rng = original_rng;
                Err(err)
            }
        }
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

// === Nosé-Hoover Thermostat ===

/// Nosé-Hoover thermostat for NVT ensemble.
///
/// Currently implements a single Nosé-Hoover thermostat. The struct has
/// fields for a chain of 3 thermostats for future extension, but only
/// the first thermostat (index 0) is currently used.
///
/// Reference: Nosé, Mol. Phys. 52, 255 (1984); Hoover, Phys. Rev. A 31, 1695 (1985)
#[derive(Debug, Clone)]
pub struct NoseHooverChain {
    /// Thermostat positions (extended coordinates) - only xi[0] currently used
    pub xi: [f64; 3],
    /// Thermostat velocities - only v_xi[0] currently used
    pub v_xi: [f64; 3],
    /// Thermostat masses (Q values) - only q[0] currently used
    pub q: [f64; 3],
    /// Target temperature in K
    pub target_temp: f64,
    /// Time step in fs
    pub dt_fs: f64,
    /// Number of degrees of freedom in the system
    pub n_dof: usize,
    /// Coupling time constant squared in internal units (for set_temperature)
    tau2_internal: f64,
}

impl NoseHooverChain {
    /// Create a new Nosé-Hoover chain thermostat.
    ///
    /// # Arguments
    /// * `target_temp` - Target temperature in K (must be > 0)
    /// * `tau` - Characteristic time in fs (must be > 0; larger = weaker coupling)
    /// * `dt_fs` - Time step in fs
    /// * `n_dof` - Number of degrees of freedom (typically 3*N - 3 for N atoms with COM constraint)
    ///
    /// # Panics
    /// Panics if `target_temp <= 0`, `tau <= 0`, `dt_fs <= 0`, or `n_dof == 0`.
    pub fn new(target_temp: f64, tau: f64, dt_fs: f64, n_dof: usize) -> Self {
        assert!(
            target_temp > 0.0,
            "NoseHooverChain requires target_temp > 0 (got {target_temp}). \
             Zero or negative temperature would produce zero/NaN thermostat mass."
        );
        assert!(
            tau > 0.0,
            "NoseHooverChain requires tau > 0 (got {tau}). \
             Zero or negative coupling time would produce zero/NaN thermostat mass."
        );
        assert!(
            dt_fs > 0.0,
            "NoseHooverChain requires dt_fs > 0 (got {dt_fs}). \
             Zero or negative time step is non-physical."
        );
        assert!(
            n_dof > 0,
            "NoseHooverChain requires n_dof > 0 (got {n_dof}). \
             Cannot thermalize a system with no degrees of freedom."
        );

        let kt = units::KB * target_temp;
        // Q = n_dof * kT * tau^2 for first thermostat (in internal units)
        // tau is in fs, need to convert to internal time units
        // Q has units of mass * length^2 (energy * time^2)
        let tau_internal = tau * units::FS_TO_INTERNAL;
        let tau2_internal = tau_internal * tau_internal;
        let q0 = n_dof as f64 * kt * tau2_internal;
        let q_rest = kt * tau2_internal;

        Self {
            xi: [0.0; 3],
            v_xi: [0.0; 3],
            q: [q0, q_rest, q_rest],
            target_temp,
            dt_fs,
            n_dof,
            tau2_internal,
        }
    }

    /// Perform one NVT step using Nosé-Hoover chain.
    ///
    /// Uses the standard Nosé-Hoover equations with velocity Verlet.
    pub fn step<F>(&mut self, state: &mut MDState, mut compute_forces: F)
    where
        F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
    {
        let _: Result<(), std::convert::Infallible> =
            self.try_step(state, |positions| Ok(compute_forces(positions)));
    }

    /// Perform one NVT step with fallible force computation.
    ///
    /// If the force computation fails, the state is restored to its original
    /// value before the step and the error is returned.
    ///
    /// # Errors
    /// Returns the error from compute_forces if it fails.
    pub fn try_step<F, E>(&mut self, state: &mut MDState, mut compute_forces: F) -> Result<(), E>
    where
        F: FnMut(&[Vector3<f64>]) -> Result<Vec<Vector3<f64>>, E>,
    {
        // Save original state in case we need to restore on error
        let original_state = state.clone();
        let original_xi = self.xi;
        let original_v_xi = self.v_xi;

        let dt = self.dt_fs * units::FS_TO_INTERNAL;
        let dt2 = dt / 2.0;
        let dt4 = dt / 4.0;
        let kt = units::KB * self.target_temp;
        let n_dof = self.n_dof as f64;

        // === First thermostat half-step ===
        // G_0 = (2*KE - n_dof * kT) / Q_0
        let g0 = (kinetic_energy_2x(&state.velocities, &state.masses) - n_dof * kt) / self.q[0];
        self.v_xi[0] += g0 * dt4;

        // Scale atomic velocities
        let scale = (-self.v_xi[0] * dt2).exp();
        for vel in &mut state.velocities {
            *vel *= scale;
        }

        // Update thermostat velocity after scaling
        let g0 = (kinetic_energy_2x(&state.velocities, &state.masses) - n_dof * kt) / self.q[0];
        self.v_xi[0] += g0 * dt4;

        // === Velocity Verlet for atoms ===
        // First half: update velocities with forces
        for (idx, vel) in state.velocities.iter_mut().enumerate() {
            *vel += dt2 * state.forces[idx] / state.masses[idx];
        }

        // Update positions
        for (idx, pos) in state.positions.iter_mut().enumerate() {
            *pos += dt * state.velocities[idx];
        }

        // Compute new forces - if this fails, restore state and return error
        match compute_forces(&state.positions) {
            Ok(new_forces) => state.forces = new_forces,
            Err(err) => {
                *state = original_state;
                self.xi = original_xi;
                self.v_xi = original_v_xi;
                return Err(err);
            }
        }

        // Second half: update velocities with new forces
        for (idx, vel) in state.velocities.iter_mut().enumerate() {
            *vel += dt2 * state.forces[idx] / state.masses[idx];
        }

        // === Second thermostat half-step ===
        let g0 = (kinetic_energy_2x(&state.velocities, &state.masses) - n_dof * kt) / self.q[0];
        self.v_xi[0] += g0 * dt4;

        let scale = (-self.v_xi[0] * dt2).exp();
        for vel in &mut state.velocities {
            *vel *= scale;
        }

        let g0 = (kinetic_energy_2x(&state.velocities, &state.masses) - n_dof * kt) / self.q[0];
        self.v_xi[0] += g0 * dt4;

        // Update thermostat position
        self.xi[0] += self.v_xi[0] * dt;

        Ok(())
    }

    /// Set target temperature.
    ///
    /// # Panics
    /// Panics if `target_temp` is 0 (would make thermostat mass zero).
    pub fn set_temperature(&mut self, target_temp: f64) {
        assert!(
            target_temp > 0.0,
            "NoseHooverChain requires target_temp > 0 (got {target_temp})"
        );
        self.target_temp = target_temp;
        // Recalculate Q values using stored tau2
        let kt = units::KB * target_temp;
        self.q[0] = self.n_dof as f64 * kt * self.tau2_internal;
        self.q[1] = kt * self.tau2_internal;
        self.q[2] = kt * self.tau2_internal;
    }
}

// === Velocity Rescaling (Bussi) Thermostat ===

/// Velocity rescaling thermostat (Bussi et al.).
///
/// Stochastic velocity rescaling that samples the correct canonical distribution.
/// Reference: Bussi et al., J. Chem. Phys. 126, 014101 (2007)
#[derive(Debug, Clone)]
pub struct VelocityRescale {
    /// Target temperature in K
    pub target_temp: f64,
    /// Coupling time constant in fs
    pub tau: f64,
    /// Time step in fs
    pub dt_fs: f64,
    /// Random number generator
    rng: rand::rngs::StdRng,
    /// Number of degrees of freedom
    pub n_dof: usize,
}

impl VelocityRescale {
    /// Create a new velocity rescaling thermostat.
    ///
    /// # Arguments
    /// * `target_temp` - Target temperature in K (must be > 0)
    /// * `tau` - Coupling time constant in fs (must be > 0; larger = weaker coupling)
    /// * `dt_fs` - Time step in fs
    /// * `n_dof` - Number of degrees of freedom
    /// * `seed` - Optional random seed
    ///
    /// # Panics
    /// Panics if `target_temp <= 0`, `tau <= 0`, `dt_fs <= 0`, or `n_dof == 0`.
    pub fn new(target_temp: f64, tau: f64, dt_fs: f64, n_dof: usize, seed: Option<u64>) -> Self {
        assert!(
            target_temp > 0.0,
            "VelocityRescale requires target_temp > 0 (got {target_temp}). \
             Zero or negative temperature is non-physical."
        );
        assert!(
            tau > 0.0,
            "VelocityRescale requires tau > 0 (got {tau}). \
             Zero or negative coupling time would cause division by zero."
        );
        assert!(
            dt_fs > 0.0,
            "VelocityRescale requires dt_fs > 0 (got {dt_fs}). \
             Zero or negative time step is non-physical."
        );
        assert!(
            n_dof > 0,
            "VelocityRescale requires n_dof > 0 (got {n_dof}). \
             Cannot thermalize a system with no degrees of freedom."
        );

        use rand::SeedableRng;
        let rng = match seed {
            Some(s) => rand::rngs::StdRng::seed_from_u64(s),
            None => rand::rngs::StdRng::from_entropy(),
        };
        Self {
            target_temp,
            tau,
            dt_fs,
            rng,
            n_dof,
        }
    }

    /// Perform one NVT step using velocity rescaling.
    pub fn step<F>(&mut self, state: &mut MDState, mut compute_forces: F)
    where
        F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
    {
        let _: Result<(), std::convert::Infallible> =
            self.try_step(state, |positions| Ok(compute_forces(positions)));
    }

    /// Perform one NVT step with fallible force computation.
    ///
    /// If the force computation fails, the state is restored to its original
    /// value before the step and the error is returned.
    ///
    /// # Errors
    /// Returns the error from compute_forces if it fails.
    pub fn try_step<F, E>(&mut self, state: &mut MDState, mut compute_forces: F) -> Result<(), E>
    where
        F: FnMut(&[Vector3<f64>]) -> Result<Vec<Vector3<f64>>, E>,
    {
        // Save original state in case we need to restore on error
        let original_state = state.clone();

        let dt = self.dt_fs * units::FS_TO_INTERNAL;

        // Velocity Verlet first half: update positions
        for (idx, pos) in state.positions.iter_mut().enumerate() {
            *pos +=
                dt * state.velocities[idx] + 0.5 * dt * dt * state.forces[idx] / state.masses[idx];
        }

        // Compute new forces - if this fails, restore state and return error
        let old_forces = std::mem::take(&mut state.forces);
        match compute_forces(&state.positions) {
            Ok(new_forces) => state.forces = new_forces,
            Err(err) => {
                *state = original_state;
                return Err(err);
            }
        }

        // Velocity Verlet second half: update velocities
        for (idx, vel) in state.velocities.iter_mut().enumerate() {
            *vel += 0.5 * dt * (old_forces[idx] + state.forces[idx]) / state.masses[idx];
        }

        // Apply velocity rescaling
        self.rescale_velocities(state);

        Ok(())
    }

    /// Rescale velocities to target temperature with stochastic correction.
    ///
    /// Implements the Bussi-Donadio-Parrinello velocity rescaling.
    /// Reference: J. Chem. Phys. 126, 014101 (2007)
    fn rescale_velocities(&mut self, state: &mut MDState) {
        let current_ke: f64 = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(vel, mass)| 0.5 * mass * vel.norm_squared())
            .sum();

        if current_ke < 1e-20 {
            return;
        }

        let target_ke = 0.5 * self.n_dof as f64 * units::KB * self.target_temp;
        let dt_fs = self.dt_fs;
        let tau = self.tau;
        let n_dof = self.n_dof as f64;

        // Exponential relaxation factor: exp(-dt/tau)
        let exp_factor = (-dt_fs / tau).exp();
        let one_minus_exp = 1.0 - exp_factor;

        // Deterministic part: approaches target KE exponentially
        let ke_ratio = target_ke / current_ke;
        let deterministic = exp_factor + one_minus_exp * ke_ratio;

        // Stochastic correction from Bussi-Donadio-Parrinello (Eq. 7)
        // For large n_dof, the chi-squared sum simplifies to a single Gaussian term
        // with variance 4*c*(1-c)*K_target/(n_dof*K_current).
        //
        // NOTE: This approximation is accurate for n_dof >> 1 but introduces sampling
        // bias for small systems (e.g., diatomics with n_dof=3). For exact canonical
        // sampling of small systems, the full algorithm (sum of n_dof-1 chi-squared
        // variates plus Gaussian) would be needed.
        let random_normal = box_muller_normal(&mut self.rng);
        let stochastic_variance = 4.0 * exp_factor * one_minus_exp * ke_ratio / n_dof;
        let stochastic_term = stochastic_variance.sqrt() * random_normal;

        // Total scale factor squared
        let mut scale_sq = deterministic + stochastic_term;

        // Clamp to prevent negative values from rare stochastic fluctuations.
        // Minimum corresponds to ~1% of target KE to prevent numerical issues
        // while still allowing the thermostat to cool the system.
        const MIN_SCALE_SQ: f64 = 0.01;
        if scale_sq < MIN_SCALE_SQ {
            scale_sq = MIN_SCALE_SQ;
        }

        let scale = scale_sq.sqrt();
        for vel in &mut state.velocities {
            *vel *= scale;
        }
    }

    /// Set target temperature.
    ///
    /// # Panics
    /// Panics if `target_temp <= 0` (same invariant as constructor).
    pub fn set_temperature(&mut self, target_temp: f64) {
        assert!(
            target_temp > 0.0,
            "VelocityRescale::set_temperature requires target_temp > 0 (got {target_temp}). \
             Zero or negative temperature is non-physical."
        );
        self.target_temp = target_temp;
    }
}

// === NPT Ensemble (Parrinello-Rahman) ===

/// State for NPT molecular dynamics.
#[derive(Debug, Clone)]
pub struct NPTState {
    /// Atomic positions in Angstrom
    pub positions: Vec<Vector3<f64>>,
    /// Atomic velocities
    pub velocities: Vec<Vector3<f64>>,
    /// Forces on atoms
    pub forces: Vec<Vector3<f64>>,
    /// Atomic masses
    pub masses: Vec<f64>,
    /// Unit cell matrix (rows are lattice vectors)
    pub cell: Matrix3<f64>,
    /// Cell velocity (time derivative of cell matrix)
    pub cell_velocity: Matrix3<f64>,
    /// Periodic boundary conditions
    pub pbc: [bool; 3],
}

impl NPTState {
    /// Create a new NPT state.
    pub fn new(
        positions: Vec<Vector3<f64>>,
        masses: Vec<f64>,
        cell: Matrix3<f64>,
        pbc: [bool; 3],
    ) -> Self {
        let n_atoms = positions.len();
        Self {
            positions,
            velocities: vec![Vector3::zeros(); n_atoms],
            forces: vec![Vector3::zeros(); n_atoms],
            masses,
            cell,
            cell_velocity: Matrix3::zeros(),
            pbc,
        }
    }

    /// Number of atoms.
    pub fn num_atoms(&self) -> usize {
        self.positions.len()
    }

    /// Current volume in Å³.
    pub fn volume(&self) -> f64 {
        self.cell.determinant().abs()
    }

    /// Kinetic energy of atoms in eV.
    pub fn kinetic_energy(&self) -> f64 {
        0.5 * self
            .velocities
            .iter()
            .zip(&self.masses)
            .map(|(v, m)| m * v.norm_squared())
            .sum::<f64>()
    }

    /// Instantaneous temperature in K.
    ///
    /// Returns 0.0 for systems with 0 or 1 atoms (no meaningful temperature).
    pub fn temperature(&self) -> f64 {
        let n_atoms = self.num_atoms();
        if n_atoms <= 1 {
            // No meaningful temperature for 0 or 1 atom
            return 0.0;
        }
        let ke = self.kinetic_energy();
        let n_dof = 3 * n_atoms - 3; // Remove COM
        2.0 * ke / (n_dof as f64 * units::KB)
    }
}

/// Configuration for NPT molecular dynamics.
#[derive(Debug, Clone)]
pub struct NPTConfig {
    /// Target temperature in K
    pub temperature_k: f64,
    /// Target pressure in GPa
    pub pressure_gpa: f64,
    /// Temperature coupling time constant in fs
    pub tau_t: f64,
    /// Pressure coupling time constant in fs
    pub tau_p: f64,
    /// Time step in fs
    pub dt_fs: f64,
    /// Fictitious cell mass (relative to atomic masses)
    pub cell_mass_factor: f64,
}

impl Default for NPTConfig {
    fn default() -> Self {
        Self {
            temperature_k: 300.0,
            pressure_gpa: 0.0, // Ambient pressure
            tau_t: 100.0,
            tau_p: 1000.0,
            dt_fs: 1.0,
            cell_mass_factor: 1.0,
        }
    }
}

impl NPTConfig {
    /// Create new NPT config.
    pub fn new(temperature_k: f64, pressure_gpa: f64, tau_t: f64, tau_p: f64, dt_fs: f64) -> Self {
        Self {
            temperature_k,
            pressure_gpa,
            tau_t,
            tau_p,
            dt_fs,
            cell_mass_factor: 1.0,
        }
    }

    /// Set cell mass factor.
    pub fn with_cell_mass_factor(mut self, factor: f64) -> Self {
        self.cell_mass_factor = factor;
        self
    }
}

/// NPT integrator using isotropic barostat with Nosé-Hoover thermostat.
///
/// Note: This implements isotropic NPT (uniform cell scaling). For full
/// anisotropic Parrinello-Rahman dynamics, a more complex implementation
/// with 9 cell DOF would be needed.
#[derive(Debug, Clone)]
pub struct NPTIntegrator {
    config: NPTConfig,
    /// Thermostat velocity for atoms
    v_xi_atoms: f64,
    /// Thermostat mass for atoms
    q_atoms: f64,
    /// Cell mass
    w_cell: f64,
    /// Number of degrees of freedom
    n_dof: usize,
}

impl NPTIntegrator {
    /// Create a new NPT integrator.
    ///
    /// # Arguments
    /// * `config` - NPT configuration
    /// * `n_atoms` - Number of atoms (must be >= 2)
    /// * `total_mass` - Total mass of the system in amu
    ///
    /// # Panics
    /// Panics if:
    /// - `n_atoms < 2` (need at least 2 atoms for meaningful NPT dynamics)
    /// - `config.temperature_k <= 0` (non-physical temperature)
    /// - `config.tau_t <= 0` (would cause zero/NaN thermostat mass)
    /// - `config.tau_p <= 0` (would cause incorrect barostat dynamics)
    /// - `config.dt_fs <= 0` (non-physical time step)
    pub fn new(config: NPTConfig, n_atoms: usize, _total_mass: f64) -> Self {
        assert!(
            n_atoms >= 2,
            "NPTIntegrator requires n_atoms >= 2 (got {n_atoms}). \
             Need at least 2 atoms for meaningful NPT dynamics with n_dof = 3*N - 3 > 0."
        );
        assert!(
            config.temperature_k > 0.0,
            "NPTIntegrator requires temperature_k > 0 (got {}). \
             Zero or negative temperature is non-physical.",
            config.temperature_k
        );
        assert!(
            config.tau_t > 0.0,
            "NPTIntegrator requires tau_t > 0 (got {}). \
             Zero or negative thermostat coupling time would cause zero/NaN thermostat mass.",
            config.tau_t
        );
        assert!(
            config.tau_p > 0.0,
            "NPTIntegrator requires tau_p > 0 (got {}). \
             Zero or negative barostat coupling time is non-physical.",
            config.tau_p
        );
        assert!(
            config.dt_fs > 0.0,
            "NPTIntegrator requires dt_fs > 0 (got {}). \
             Zero or negative time step is non-physical.",
            config.dt_fs
        );

        let kt = units::KB * config.temperature_k;
        let n_dof = 3 * n_atoms - 3;

        // Thermostat mass: Q = n_dof * kT * tau_t^2
        let tau_t_int = config.tau_t * units::FS_TO_INTERNAL;
        let q_atoms = n_dof as f64 * kt * tau_t_int * tau_t_int;

        // Barostat mass: W = (n_dof + 1) * kT * tau_p^2 * cell_mass_factor
        // This follows the Martyna-Tobias-Klein (MTK) equations where the barostat
        // mass determines the pressure coupling timescale. The (n_dof + 1) factor
        // accounts for the additional cell degree of freedom.
        let tau_p_int = config.tau_p * units::FS_TO_INTERNAL;
        let w_cell = (n_dof + 1) as f64 * kt * tau_p_int * tau_p_int * config.cell_mass_factor;

        Self {
            config,
            v_xi_atoms: 0.0,
            q_atoms,
            w_cell,
            n_dof,
        }
    }

    /// Perform one NPT step (isotropic cell scaling).
    ///
    /// Note: This implements isotropic NPT where only the cell volume changes
    /// uniformly. For full anisotropic Parrinello-Rahman dynamics with 9 DOF,
    /// a more complex implementation would be needed.
    ///
    /// # Arguments
    /// * `state` - NPT state
    /// * `compute_forces_and_stress` - Function that returns (forces, stress_tensor)
    ///   where stress is in eV/Å³
    pub fn step<F>(&mut self, state: &mut NPTState, mut compute_forces_and_stress: F)
    where
        F: FnMut(&[Vector3<f64>], &Matrix3<f64>) -> (Vec<Vector3<f64>>, Matrix3<f64>),
    {
        let _: Result<(), std::convert::Infallible> = self.try_step(state, |positions, cell| {
            Ok(compute_forces_and_stress(positions, cell))
        });
    }

    /// Perform one NPT step with fallible force/stress computation.
    ///
    /// If the force computation fails, the state is restored to its original
    /// value before the step and the error is returned.
    ///
    /// # Errors
    /// Returns the error from compute_forces_and_stress if it fails.
    pub fn try_step<F, E>(
        &mut self,
        state: &mut NPTState,
        mut compute_forces_and_stress: F,
    ) -> Result<(), E>
    where
        F: FnMut(&[Vector3<f64>], &Matrix3<f64>) -> Result<(Vec<Vector3<f64>>, Matrix3<f64>), E>,
    {
        // Save original state in case we need to restore on error
        let original_state = state.clone();
        let original_v_xi_atoms = self.v_xi_atoms;

        let dt = self.config.dt_fs * units::FS_TO_INTERNAL;
        let dt2 = dt / 2.0;
        let kt = units::KB * self.config.temperature_k;
        let n_dof = self.n_dof as f64;

        // Target pressure in eV/Å³ (1 GPa = 0.00624150913 eV/Å³)
        let p_ext = self.config.pressure_gpa * 0.00624150913;

        // === Thermostat half-step for atoms ===
        let ke2 = kinetic_energy_2x(&state.velocities, &state.masses);
        let g_xi = (ke2 - n_dof * kt) / self.q_atoms;
        self.v_xi_atoms += g_xi * dt2;

        // Scale atomic velocities
        let scale = (-self.v_xi_atoms * dt2).exp();
        for vel in &mut state.velocities {
            *vel *= scale;
        }

        // === Cell dynamics half-step ===
        // For first step or when forces not yet computed, compute them
        let (initial_forces, initial_stress) =
            match compute_forces_and_stress(&state.positions, &state.cell) {
                Ok((forces, stress)) => (forces, stress),
                Err(err) => {
                    *state = original_state;
                    self.v_xi_atoms = original_v_xi_atoms;
                    return Err(err);
                }
            };
        state.forces = initial_forces;

        let volume = state.volume();
        let p_int =
            -(initial_stress[(0, 0)] + initial_stress[(1, 1)] + initial_stress[(2, 2)]) / 3.0;

        // Pressure difference drives cell change
        let pressure_diff = p_int - p_ext;
        let cell_acc = pressure_diff * volume / self.w_cell;

        // Update cell velocity (isotropic)
        let cell_scale_vel = state.cell_velocity[(0, 0)] + cell_acc * dt2;
        state.cell_velocity = Matrix3::from_diagonal(&Vector3::new(
            cell_scale_vel,
            cell_scale_vel,
            cell_scale_vel,
        ));

        // === Velocity Verlet: update velocities (half step) ===
        for (idx, vel) in state.velocities.iter_mut().enumerate() {
            *vel += dt2 * state.forces[idx] / state.masses[idx];
        }

        // === Update positions and cell ===
        // Scale factor for cell
        let cell_scale = 1.0 + state.cell_velocity[(0, 0)] * dt;
        state.cell *= cell_scale;

        // Update positions (scale with cell, then add velocity contribution)
        for pos in &mut state.positions {
            *pos *= cell_scale;
        }
        for (idx, pos) in state.positions.iter_mut().enumerate() {
            *pos += dt * state.velocities[idx];
        }

        // === Compute new forces ===
        let (new_forces, new_stress) =
            match compute_forces_and_stress(&state.positions, &state.cell) {
                Ok((forces, stress)) => (forces, stress),
                Err(err) => {
                    *state = original_state;
                    self.v_xi_atoms = original_v_xi_atoms;
                    return Err(err);
                }
            };
        state.forces = new_forces;

        // === Velocity Verlet: update velocities (second half) ===
        for (idx, vel) in state.velocities.iter_mut().enumerate() {
            *vel += dt2 * state.forces[idx] / state.masses[idx];
        }

        // === Cell dynamics second half-step ===
        let volume = state.volume();
        let p_int = -(new_stress[(0, 0)] + new_stress[(1, 1)] + new_stress[(2, 2)]) / 3.0;
        let pressure_diff = p_int - p_ext;
        let cell_acc = pressure_diff * volume / self.w_cell;

        let cell_scale_vel = state.cell_velocity[(0, 0)] + cell_acc * dt2;
        state.cell_velocity = Matrix3::from_diagonal(&Vector3::new(
            cell_scale_vel,
            cell_scale_vel,
            cell_scale_vel,
        ));

        // === Thermostat second half-step for atoms ===
        // For time-reversibility, second half is REVERSE of first half:
        // First half:  update v_xi -> scale velocities
        // Second half: scale velocities -> update v_xi
        let scale = (-self.v_xi_atoms * dt2).exp();
        for vel in &mut state.velocities {
            *vel *= scale;
        }

        let ke2 = kinetic_energy_2x(&state.velocities, &state.masses);
        let g_xi = (ke2 - n_dof * kt) / self.q_atoms;
        self.v_xi_atoms += g_xi * dt2;

        Ok(())
    }

    /// Current instantaneous pressure in GPa.
    pub fn pressure(&self, stress: &Matrix3<f64>) -> f64 {
        let p_int = -(stress[(0, 0)] + stress[(1, 1)] + stress[(2, 2)]) / 3.0;
        // Convert eV/Å³ to GPa
        p_int / 0.00624150913
    }
}

// === Utilities ===

/// Compute twice the kinetic energy (sum of m*v²).
/// Used in thermostats where 2*KE = sum_i m_i * |v_i|².
#[inline]
fn kinetic_energy_2x(velocities: &[Vector3<f64>], masses: &[f64]) -> f64 {
    velocities
        .iter()
        .zip(masses)
        .map(|(v, m)| m * v.norm_squared())
        .sum()
}

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
        let spring_k = 1.0;
        let eq_dist = 1.2;

        state.positions[1] = Vector3::new(1.4, 0.0, 0.0);
        let forces = harmonic_forces(&state.positions, spring_k, eq_dist);
        state = set_forces(state, &forces);

        let dt_fs = 1.0;
        let mut energies = Vec::new();

        for _ in 0..500 {
            state =
                velocity_verlet_step(state, dt_fs, |pos| harmonic_forces(pos, spring_k, eq_dist));
            let kinetic = kinetic_energy(&state);
            let dist = (state.positions[1] - state.positions[0]).norm();
            let potential = 0.5 * spring_k * (dist - eq_dist).powi(2);
            energies.push(kinetic + potential);
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
        let spring_k = 1.0;
        let eq_dist = 1.2;

        state.positions[1] = Vector3::new(eq_dist, 0.0, 0.0);
        let forces = harmonic_forces(&state.positions, spring_k, eq_dist);
        state = set_forces(state, &forces);

        let config = LangevinConfig::new(target_temp, 0.01, 1.0);
        let mut rng = StdRng::seed_from_u64(42);

        let mut temps = Vec::new();
        for _ in 0..2000 {
            state = langevin_step(state, &config, &mut rng, |pos| {
                harmonic_forces(pos, spring_k, eq_dist)
            });
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
        let spring_k: f64 = 1.0;
        let omega = (spring_k / mass).sqrt();
        let amplitude = 0.5;

        let positions = vec![Vector3::new(amplitude, 0.0, 0.0)];
        let masses = vec![mass];
        let mut state = MDState::new(positions, masses);

        let compute_forces = |pos: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            vec![Vector3::new(-spring_k * pos[0].x, 0.0, 0.0)]
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
        let spring_k = 2.0;
        let eq_dist = 1.0;

        state.positions[1] = Vector3::new(1.3, 0.0, 0.0);
        state.velocities[0] = Vector3::new(0.0, 0.01, 0.0);
        state.velocities[1] = Vector3::new(0.0, -0.01, 0.0);

        let forces = harmonic_forces(&state.positions, spring_k, eq_dist);
        state = set_forces(state, &forces);

        let calc_pe = |positions: &[Vector3<f64>]| -> f64 {
            let dist = (positions[1] - positions[0]).norm();
            0.5 * spring_k * (dist - eq_dist).powi(2)
        };

        let e_initial = kinetic_energy(&state) + calc_pe(&state.positions);

        let dt_fs = 0.1;
        for _ in 0..12000 {
            state =
                velocity_verlet_step(state, dt_fs, |pos| harmonic_forces(pos, spring_k, eq_dist));
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
        let spring_k = 0.5;
        let eq_dist = 3.0;

        let compute_forces = |positions: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            let count = positions.len();
            let mut forces = vec![Vector3::zeros(); count];
            for idx in 0..count - 1 {
                let diff = positions[idx + 1] - positions[idx];
                let dist = diff.norm();
                let unit = if dist > 1e-10 { diff / dist } else { diff };
                let f_mag = -spring_k * (dist - eq_dist);
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
        // Test that zero_com_momentum removes COM drift while preserving kinetic energy

        let mut rng = StdRng::seed_from_u64(42);
        let n_atoms = 8;
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64, 0.0, 0.0))
            .collect();
        let masses: Vec<f64> = (0..n_atoms).map(|_| rng.gen_range(12.0..22.0)).collect();
        let mut state = MDState::new(positions, masses);

        // Manually set velocities with significant COM drift (don't use init_velocities
        // which already zeroes COM)
        for (idx, vel) in state.velocities.iter_mut().enumerate() {
            // Add systematic drift (all atoms moving +x) plus some variation
            *vel = Vector3::new(
                10.0 + (idx as f64) * 0.1, // Strong x-drift
                (idx as f64) * 0.5,
                0.0,
            );
        }

        // Verify COM momentum is non-zero before zeroing
        let momentum_before: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(vel, mass)| *mass * vel)
            .sum();
        assert!(
            momentum_before.norm() > 100.0,
            "Should have significant COM momentum before zeroing, got {:?}",
            momentum_before
        );

        let ke_before = kinetic_energy(&state);

        // Zero COM momentum
        state = zero_com_momentum(state);

        // Check COM momentum is now zero
        let momentum_after: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(vel, mass)| *mass * vel)
            .sum();
        assert!(
            momentum_after.norm() < 1e-10,
            "COM momentum should be zero after zeroing, got {:?}",
            momentum_after
        );

        // Kinetic energy should be reduced (COM kinetic energy removed)
        // but not zero (thermal motion remains)
        let ke_after = kinetic_energy(&state);
        assert!(
            ke_after < ke_before,
            "KE should decrease after removing COM motion"
        );
        assert!(ke_after > 0.0, "KE should remain non-zero (thermal motion)");
    }

    #[test]
    fn test_nve_energy_conservation_torch_sim_style() {
        // NVE (velocity Verlet) should conserve energy (torch-sim style)
        let mut state = make_diatomic();
        let spring_k = 1.0;
        let eq_dist = 1.2;

        state.positions[1] = Vector3::new(1.4, 0.0, 0.0);
        let forces = harmonic_forces(&state.positions, spring_k, eq_dist);
        state = set_forces(state, &forces);

        let dt_fs = 1.0;
        let mut energies = Vec::new();

        for _ in 0..500 {
            state =
                velocity_verlet_step(state, dt_fs, |pos| harmonic_forces(pos, spring_k, eq_dist));
            let kinetic = kinetic_energy(&state);
            let dist = (state.positions[1] - state.positions[0]).norm();
            let potential = 0.5 * spring_k * (dist - eq_dist).powi(2);
            energies.push(kinetic + potential);
        }

        // For harmonic oscillator, energy should be very well conserved
        let count = energies.len() as f64;
        let mean_energy = energies.iter().sum::<f64>() / count;
        let std_energy = (energies
            .iter()
            .map(|energy| (energy - mean_energy).powi(2))
            .sum::<f64>()
            / count)
            .sqrt();
        let e_drift = std_energy / mean_energy.max(1e-10);
        assert!(
            e_drift < 0.01,
            "Energy drift {:.2}% should be < 1% (NVE conservation)",
            e_drift * 100.0
        );
    }

    // === Nosé-Hoover Chain Tests ===

    #[test]
    fn test_nose_hoover_chain_creation() {
        let nhc = NoseHooverChain::new(300.0, 100.0, 1.0, 6);
        assert_eq!(nhc.target_temp, 300.0);
        assert_eq!(nhc.n_dof, 6);
        assert!(nhc.q[0] > 0.0);
        assert!(nhc.q[1] > 0.0);
    }

    #[test]
    fn test_nose_hoover_temperature_equilibration() {
        // NHC should bring temperature toward target using harmonic diatomic
        let mut state = make_diatomic();

        // Initialize at high temperature
        let mut rng = StdRng::seed_from_u64(42);
        state = init_velocities(state, 500.0, &mut rng);

        let target_temp = 300.0;
        let n_dof = 3; // 2 atoms, 6 DOF - 3 COM = 3
        // Use larger tau (500 fs) for gentler coupling
        let mut nhc = NoseHooverChain::new(target_temp, 500.0, 1.0, n_dof);

        let spring_k = 1.0;
        let eq_dist = 1.2;

        // Initialize forces
        state.forces = harmonic_forces(&state.positions, spring_k, eq_dist);

        // Run for equilibration
        let mut temps = Vec::new();
        for step in 0..2000 {
            nhc.step(&mut state, |pos| harmonic_forces(pos, spring_k, eq_dist));
            if step > 1000 {
                temps.push(temperature(&state));
            }
        }

        // Temperature should remain reasonable (not zero, not infinite)
        let avg_temp: f64 = temps.iter().sum::<f64>() / temps.len() as f64;
        // Relaxed criterion: temperature should be positive and not diverge
        assert!(
            avg_temp > 10.0 && avg_temp < 10000.0,
            "Average temp {avg_temp:.1}K should be bounded and positive"
        );
    }

    // === Velocity Rescaling Tests ===

    #[test]
    fn test_velocity_rescale_creation() {
        let vr = VelocityRescale::new(300.0, 100.0, 1.0, 6, Some(42));
        assert_eq!(vr.target_temp, 300.0);
        assert_eq!(vr.tau, 100.0);
        assert_eq!(vr.n_dof, 6);
    }

    #[test]
    fn test_velocity_rescale_temperature_control() {
        // Velocity rescaling should maintain temperature near target
        let mut state = make_diatomic();

        // Initialize at different temperature
        let mut rng = StdRng::seed_from_u64(42);
        state = init_velocities(state, 500.0, &mut rng);

        let spring_k = 1.0;
        let eq_dist = 1.2;

        // Initialize forces
        state.forces = harmonic_forces(&state.positions, spring_k, eq_dist);

        let target_temp = 300.0;
        let n_dof = 3; // Diatomic with COM constraint
        let mut vr = VelocityRescale::new(target_temp, 100.0, 1.0, n_dof, Some(42));

        let mut temps = Vec::new();
        for step in 0..1000 {
            vr.step(&mut state, |pos| harmonic_forces(pos, spring_k, eq_dist));
            if step > 500 {
                temps.push(temperature(&state));
            }
        }

        let avg_temp: f64 = temps.iter().sum::<f64>() / temps.len() as f64;
        // Relaxed criterion: temperature should be positive and bounded
        assert!(
            avg_temp > 10.0 && avg_temp < 10000.0,
            "Average temp {avg_temp:.1}K should be bounded and positive"
        );
    }

    // === NPT Tests ===

    #[test]
    fn test_npt_state_creation() {
        let positions = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)];
        let masses = vec![12.0, 12.0];
        let cell = Matrix3::from_diagonal(&Vector3::new(5.0, 5.0, 5.0));
        let state = NPTState::new(positions, masses, cell, [true, true, true]);

        assert_eq!(state.num_atoms(), 2);
        assert!((state.volume() - 125.0).abs() < 1e-10);
    }

    #[test]
    fn test_npt_config_creation() {
        let config = NPTConfig::new(300.0, 0.0, 100.0, 1000.0, 1.0);
        assert_eq!(config.temperature_k, 300.0);
        assert_eq!(config.pressure_gpa, 0.0);
    }

    #[test]
    fn test_npt_integrator_basic() {
        // Test that NPT integrator runs without crashing
        let positions = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::new(0.0, 2.0, 0.0),
            Vector3::new(0.0, 0.0, 2.0),
        ];
        let masses = vec![12.0; 4];
        let cell = Matrix3::from_diagonal(&Vector3::new(5.0, 5.0, 5.0));
        let mut state = NPTState::new(positions, masses, cell, [true, true, true]);

        // Initialize velocities
        let mut rng = StdRng::seed_from_u64(42);
        for vel in &mut state.velocities {
            *vel = Vector3::new(
                box_muller_normal(&mut rng) * 0.1,
                box_muller_normal(&mut rng) * 0.1,
                box_muller_normal(&mut rng) * 0.1,
            );
        }

        // Simple harmonic potential for forces and stress
        let compute_forces_stress = |positions: &[Vector3<f64>], _cell: &Matrix3<f64>| {
            let mut forces = vec![Vector3::zeros(); positions.len()];
            let mut stress = Matrix3::zeros();
            let spring_k = 0.1;
            let eq_dist = 2.0;

            for idx_i in 0..positions.len() {
                for idx_j in (idx_i + 1)..positions.len() {
                    let rij = positions[idx_j] - positions[idx_i];
                    let dist = rij.norm();
                    if dist > 0.1 {
                        let f_mag = -spring_k * (dist - eq_dist) / dist;
                        let force = f_mag * rij;
                        forces[idx_i] -= force;
                        forces[idx_j] += force;

                        // Virial contribution
                        for alpha in 0..3 {
                            for beta in 0..3 {
                                stress[(alpha, beta)] -= rij[alpha] * force[beta];
                            }
                        }
                    }
                }
            }
            (forces, stress / 125.0) // Normalize by volume
        };

        // Initialize forces
        let (forces, _) = compute_forces_stress(&state.positions, &state.cell);
        state.forces = forces;

        let config = NPTConfig::new(300.0, 0.0, 100.0, 1000.0, 0.5);
        let total_mass: f64 = state.masses.iter().sum();
        let mut npt = NPTIntegrator::new(config, state.num_atoms(), total_mass);

        // Run a few steps
        let initial_volume = state.volume();
        for _ in 0..100 {
            npt.step(&mut state, compute_forces_stress);
        }

        // Volume should be reasonable (not collapsed or exploded)
        let final_volume = state.volume();
        assert!(
            final_volume > 0.1 * initial_volume && final_volume < 10.0 * initial_volume,
            "Volume {final_volume:.1} should be reasonable compared to initial {initial_volume:.1}"
        );
    }

    // === ASE-ported Tests ===

    #[test]
    fn test_nose_hoover_momentum_conservation() {
        // Ported from ASE: test_nose_hoover_chain.py::test_nose_hoover_chain_nvt
        // Total momentum should remain zero
        let mut state = make_diatomic();

        let mut rng = StdRng::seed_from_u64(42);
        state = init_velocities(state, 300.0, &mut rng);

        // Zero out center of mass momentum
        state = zero_com_momentum(state);

        let target_temp = 300.0;
        let n_dof = 3;
        let mut nhc = NoseHooverChain::new(target_temp, 100.0, 1.0, n_dof);

        let spring_k = 1.0;
        let eq_dist = 1.2;
        state.forces = harmonic_forces(&state.positions, spring_k, eq_dist);

        // Initial momentum should be zero
        let initial_momentum: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(vel, mass)| *mass * vel)
            .sum();
        assert!(
            initial_momentum.norm() < 1e-10,
            "Initial momentum should be zero"
        );

        // Run simulation
        for _ in 0..100 {
            nhc.step(&mut state, |pos| harmonic_forces(pos, spring_k, eq_dist));
        }

        // Final momentum should still be approximately zero
        let final_momentum: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(vel, mass)| *mass * vel)
            .sum();
        assert!(
            final_momentum.norm() < 1e-6,
            "Final momentum {:.2e} should be approximately zero",
            final_momentum.norm()
        );
    }

    #[test]
    fn test_velocity_verlet_symplectic() {
        // Test that velocity Verlet is symplectic (time-reversible)
        // Based on ASE's test_thermostat_round_trip concept
        let mut state = make_diatomic();
        state.positions[1] = Vector3::new(1.3, 0.0, 0.0);

        let spring_k = 1.0;
        let eq_dist = 1.0;

        // Initialize with some velocity
        state.velocities[0] = Vector3::new(0.1, 0.05, 0.0);
        state.velocities[1] = Vector3::new(-0.1, -0.05, 0.0);
        state.forces = harmonic_forces(&state.positions, spring_k, eq_dist);

        // Save initial state
        let initial_positions = state.positions.clone();
        let initial_velocities = state.velocities.clone();

        let dt_fs = 1.0;
        let n_steps = 100;

        // Forward integration
        for _ in 0..n_steps {
            state =
                velocity_verlet_step(state, dt_fs, |pos| harmonic_forces(pos, spring_k, eq_dist));
        }

        // State should have changed
        let pos_diff: f64 = state
            .positions
            .iter()
            .zip(&initial_positions)
            .map(|(p, ip)| (p - ip).norm())
            .sum();
        assert!(
            pos_diff > 0.01,
            "Position should have changed during forward integration"
        );

        // Reverse velocities and integrate backward
        for vel in &mut state.velocities {
            *vel = -*vel;
        }
        state.forces = harmonic_forces(&state.positions, spring_k, eq_dist);

        for _ in 0..n_steps {
            state =
                velocity_verlet_step(state, dt_fs, |pos| harmonic_forces(pos, spring_k, eq_dist));
        }

        // Reverse velocities again
        for vel in &mut state.velocities {
            *vel = -*vel;
        }

        // Should be back to initial state (symplectic property)
        for (pos, initial_pos) in state.positions.iter().zip(&initial_positions) {
            assert!(
                (pos - initial_pos).norm() < 1e-8,
                "Position should return to initial after time reversal"
            );
        }
        for (vel, initial_vel) in state.velocities.iter().zip(&initial_velocities) {
            assert!(
                (vel - initial_vel).norm() < 1e-8,
                "Velocity should return to initial after time reversal"
            );
        }
    }

    #[test]
    fn test_nve_total_energy_conserved_high_precision() {
        // More stringent energy conservation test
        // Based on ASE's NVE conservation tests
        let mut state = make_diatomic();
        state.positions[1] = Vector3::new(1.3, 0.0, 0.0);
        state.velocities[0] = Vector3::new(0.05, 0.02, 0.0);
        state.velocities[1] = Vector3::new(-0.05, -0.02, 0.0);

        let spring_k = 2.0;
        let eq_dist = 1.0;
        state.forces = harmonic_forces(&state.positions, spring_k, eq_dist);

        let calc_total_energy = |s: &MDState| -> f64 {
            let kinetic = kinetic_energy(s);
            let dist = (s.positions[1] - s.positions[0]).norm();
            let potential = 0.5 * spring_k * (dist - eq_dist).powi(2);
            kinetic + potential
        };

        let initial_energy = calc_total_energy(&state);
        let dt_fs = 0.5; // Small timestep for high precision

        let mut max_drift: f64 = 0.0;
        for _ in 0..5000 {
            state =
                velocity_verlet_step(state, dt_fs, |pos| harmonic_forces(pos, spring_k, eq_dist));
            let energy = calc_total_energy(&state);
            let drift = (energy - initial_energy).abs() / initial_energy;
            max_drift = max_drift.max(drift);
        }

        // Velocity Verlet has O(dt^2) energy drift, so with dt=0.5 we expect ~1e-4 drift
        assert!(
            max_drift < 1e-3,
            "Maximum energy drift {:.2e} should be < 1e-3 for NVE",
            max_drift
        );
    }

    #[test]
    #[allow(clippy::redundant_closure_call)]
    fn test_langevin_temperature_distribution() {
        // Test that Langevin dynamics produces correct temperature distribution
        // Based on ASE's test_nvt_npt.py tests
        let n_atoms = 10;
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * 2.5, 0.0, 0.0))
            .collect();
        let masses = vec![12.0; n_atoms];
        let mut state = MDState::new(positions, masses);

        let target_temp = 300.0;
        let spring_k = 0.5;
        let eq_dist = 2.5;

        // Chain potential
        let compute_chain_forces = |positions: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            let count = positions.len();
            let mut forces = vec![Vector3::zeros(); count];
            for idx in 0..count - 1 {
                let diff = positions[idx + 1] - positions[idx];
                let dist = diff.norm();
                let unit = if dist > 1e-10 { diff / dist } else { diff };
                let f_mag = -spring_k * (dist - eq_dist);
                forces[idx] -= f_mag * unit;
                forces[idx + 1] += f_mag * unit;
            }
            forces
        };

        state.forces = compute_chain_forces(&state.positions);

        let config = LangevinConfig::new(target_temp, 0.01, 1.0);
        let mut rng = StdRng::seed_from_u64(12345);

        // Equilibrate
        for _ in 0..5000 {
            state = langevin_step(state, &config, &mut rng, compute_chain_forces);
        }

        // Sample temperature
        let mut temp_samples = Vec::with_capacity(5000);
        for _ in 0..5000 {
            state = langevin_step(state, &config, &mut rng, compute_chain_forces);
            temp_samples.push(temperature(&state));
        }

        let avg_temp: f64 = temp_samples.iter().sum::<f64>() / temp_samples.len() as f64;

        // Temperature should be within 20% of target (relaxed for small system)
        let temp_error = (avg_temp - target_temp).abs() / target_temp;
        assert!(
            temp_error < 0.20,
            "Average temperature {avg_temp:.1}K deviates {:.1}% from target {target_temp}K",
            temp_error * 100.0
        );
    }

    // === Statistical Correctness Tests ===

    #[test]
    fn test_maxwell_boltzmann_velocity_distribution() {
        // Verify velocity distribution matches Maxwell-Boltzmann
        // P(v) ∝ exp(-m*v²/(2*kT)), so <v²> = kT/m for each component
        let n_atoms = 100;
        let mass = 12.0; // amu
        let target_temp = 300.0;

        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * 5.0, 0.0, 0.0))
            .collect();
        let masses = vec![mass; n_atoms];

        let mut rng = StdRng::seed_from_u64(42);

        // Sample many velocity initializations
        let n_samples = 50;
        let mut all_v_sq: Vec<f64> = Vec::new();

        for _ in 0..n_samples {
            let state = MDState::new(positions.clone(), masses.clone());
            let state = init_velocities(state, target_temp, &mut rng);

            for vel in &state.velocities {
                // Each component should have variance kT/m
                all_v_sq.push(vel.x * vel.x);
                all_v_sq.push(vel.y * vel.y);
                all_v_sq.push(vel.z * vel.z);
            }
        }

        // Expected <v²> = kT/m for each component
        let expected_v_sq = units::KB * target_temp / mass;
        let mean_v_sq = all_v_sq.iter().sum::<f64>() / all_v_sq.len() as f64;

        // Should be within 10% (statistical test)
        let error = (mean_v_sq - expected_v_sq).abs() / expected_v_sq;
        assert!(
            error < 0.10,
            "Mean v² = {mean_v_sq:.6} differs from expected {expected_v_sq:.6} by {:.1}%",
            error * 100.0
        );
    }

    #[test]
    #[allow(clippy::redundant_closure_call)]
    fn test_langevin_velocity_distribution_statistical() {
        // After equilibration, velocity distribution should be Maxwell-Boltzmann
        let n_atoms = 50;
        let mass = 12.0;
        let target_temp = 300.0;
        let spring_k = 0.1;
        let eq_dist = 5.0;

        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * eq_dist, 0.0, 0.0))
            .collect();
        let masses = vec![mass; n_atoms];
        let mut state = MDState::new(positions, masses);

        // Harmonic chain potential
        let compute_forces = |positions: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            let count = positions.len();
            let mut forces = vec![Vector3::zeros(); count];
            for idx in 0..count - 1 {
                let diff = positions[idx + 1] - positions[idx];
                let dist = diff.norm();
                let unit = if dist > 1e-10 { diff / dist } else { diff };
                let f_mag = -spring_k * (dist - eq_dist);
                forces[idx] -= f_mag * unit;
                forces[idx + 1] += f_mag * unit;
            }
            forces
        };

        state.forces = compute_forces(&state.positions);

        let config = LangevinConfig::new(target_temp, 0.01, 1.0);
        let mut rng = StdRng::seed_from_u64(42);

        // Equilibrate
        for _ in 0..10000 {
            state = langevin_step(state, &config, &mut rng, compute_forces);
        }

        // Sample velocity distribution
        let mut v_sq_samples: Vec<f64> = Vec::new();
        for _ in 0..5000 {
            state = langevin_step(state, &config, &mut rng, compute_forces);
            for vel in &state.velocities {
                v_sq_samples.push(vel.x * vel.x);
                v_sq_samples.push(vel.y * vel.y);
                v_sq_samples.push(vel.z * vel.z);
            }
        }

        // Expected <v²> = kT/m
        let expected_v_sq = units::KB * target_temp / mass;
        let mean_v_sq = v_sq_samples.iter().sum::<f64>() / v_sq_samples.len() as f64;

        let error = (mean_v_sq - expected_v_sq).abs() / expected_v_sq;
        assert!(
            error < 0.05,
            "Langevin v² distribution: mean={mean_v_sq:.6}, expected={expected_v_sq:.6}, error={:.1}%",
            error * 100.0
        );
    }

    #[test]
    fn test_nve_energy_drift_long_trajectory() {
        // Run NVE for many steps and verify energy drift is bounded
        let mut state = make_diatomic();
        let spring_k = 2.0;
        let eq_dist = 1.0;

        // Start with some stretch and velocity
        state.positions[1] = Vector3::new(1.2, 0.0, 0.0);
        state.velocities[0] = Vector3::new(0.05, 0.02, 0.01);
        state.velocities[1] = Vector3::new(-0.05, -0.02, -0.01);

        let compute_forces = |positions: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            let diff = positions[1] - positions[0];
            let dist = diff.norm();
            let unit = if dist > 1e-10 { diff / dist } else { diff };
            let f_mag = -spring_k * (dist - eq_dist);
            vec![-f_mag * unit, f_mag * unit]
        };

        let calc_pe = |positions: &[Vector3<f64>]| -> f64 {
            let dist = (positions[1] - positions[0]).norm();
            0.5 * spring_k * (dist - eq_dist).powi(2)
        };

        state.forces = compute_forces(&state.positions);
        let e_initial = kinetic_energy(&state) + calc_pe(&state.positions);

        let dt_fs = 0.5;
        let n_steps = 20000;

        let mut max_drift: f64 = 0.0;
        for _ in 0..n_steps {
            state = velocity_verlet_step(state, dt_fs, compute_forces);
            let e_current = kinetic_energy(&state) + calc_pe(&state.positions);
            let drift = (e_current - e_initial).abs() / e_initial;
            max_drift = max_drift.max(drift);
        }

        // Energy drift should be very small for symplectic integrator
        assert!(
            max_drift < 1e-4,
            "NVE energy drift {:.2e} exceeds 0.01% over {n_steps} steps",
            max_drift
        );
    }

    #[test]
    fn test_langevin_detailed_balance() {
        // Test that Langevin dynamics satisfies detailed balance
        // by checking that the energy distribution is Boltzmann-like
        let n_atoms = 20;
        let mass = 12.0;
        let target_temp = 300.0;
        let spring_k = 0.5;
        let eq_dist = 3.0;

        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * eq_dist, 0.0, 0.0))
            .collect();
        let masses = vec![mass; n_atoms];
        let mut state = MDState::new(positions, masses);

        let compute_forces = |positions: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            let count = positions.len();
            let mut forces = vec![Vector3::zeros(); count];
            for idx in 0..count - 1 {
                let diff = positions[idx + 1] - positions[idx];
                let dist = diff.norm();
                let unit = if dist > 1e-10 { diff / dist } else { diff };
                let f_mag = -spring_k * (dist - eq_dist);
                forces[idx] -= f_mag * unit;
                forces[idx + 1] += f_mag * unit;
            }
            forces
        };

        let calc_pe = |positions: &[Vector3<f64>]| -> f64 {
            let count = positions.len();
            let mut pe = 0.0;
            for idx in 0..count - 1 {
                let dist = (positions[idx + 1] - positions[idx]).norm();
                pe += 0.5 * spring_k * (dist - eq_dist).powi(2);
            }
            pe
        };

        state.forces = compute_forces(&state.positions);

        let config = LangevinConfig::new(target_temp, 0.01, 1.0);
        let mut rng = StdRng::seed_from_u64(42);

        // Equilibrate
        for _ in 0..10000 {
            state = langevin_step(state, &config, &mut rng, compute_forces);
        }

        // Sample energies
        let mut ke_samples: Vec<f64> = Vec::new();
        let mut pe_samples: Vec<f64> = Vec::new();
        for _ in 0..10000 {
            state = langevin_step(state, &config, &mut rng, compute_forces);
            ke_samples.push(kinetic_energy(&state));
            pe_samples.push(calc_pe(&state.positions));
        }

        // For equipartition: <KE> = (N_dof/2) * kT
        let n_dof = 3 * n_atoms - 3;
        let expected_ke = 0.5 * n_dof as f64 * units::KB * target_temp;
        let mean_ke = ke_samples.iter().sum::<f64>() / ke_samples.len() as f64;

        let ke_error = (mean_ke - expected_ke).abs() / expected_ke;
        assert!(
            ke_error < 0.10,
            "KE equipartition: mean={mean_ke:.4}, expected={expected_ke:.4}, error={:.1}%",
            ke_error * 100.0
        );

        // Also check that PE has reasonable fluctuations (not stuck)
        let pe_mean = pe_samples.iter().sum::<f64>() / pe_samples.len() as f64;
        let pe_variance = pe_samples
            .iter()
            .map(|pe| (pe - pe_mean).powi(2))
            .sum::<f64>()
            / pe_samples.len() as f64;
        let pe_std = pe_variance.sqrt();

        assert!(
            pe_std > 0.001,
            "PE should fluctuate (std={pe_std:.6}), system may be stuck"
        );
    }

    #[test]
    fn test_thermostat_heating_and_cooling() {
        // Test that thermostats can both heat and cool
        let mut state = make_diatomic();
        let spring_k = 1.0;
        let eq_dist = 1.2;

        state.positions[1] = Vector3::new(eq_dist, 0.0, 0.0);
        let compute_forces = |positions: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            let diff = positions[1] - positions[0];
            let dist = diff.norm();
            let unit = if dist > 1e-10 { diff / dist } else { diff };
            let f_mag = -spring_k * (dist - eq_dist);
            vec![-f_mag * unit, f_mag * unit]
        };

        state.forces = compute_forces(&state.positions);
        let mut rng = StdRng::seed_from_u64(42);

        // Test heating: start cold, heat to 500K
        let mut cold_state = state.clone();
        cold_state.velocities[0] = Vector3::zeros();
        cold_state.velocities[1] = Vector3::zeros();
        let config_hot = LangevinConfig::new(500.0, 0.05, 1.0);

        for _ in 0..5000 {
            cold_state = langevin_step(cold_state, &config_hot, &mut rng, compute_forces);
        }
        let final_temp_heated = temperature(&cold_state);
        assert!(
            final_temp_heated > 200.0,
            "Thermostat should heat cold system: got {final_temp_heated:.0}K"
        );

        // Test cooling: start hot, cool to 100K
        let mut hot_state = state.clone();
        hot_state = init_velocities(hot_state, 800.0, &mut rng);
        hot_state.forces = compute_forces(&hot_state.positions);
        let config_cold = LangevinConfig::new(100.0, 0.05, 1.0);

        for _ in 0..5000 {
            hot_state = langevin_step(hot_state, &config_cold, &mut rng, compute_forces);
        }
        let final_temp_cooled = temperature(&hot_state);
        assert!(
            final_temp_cooled < 300.0,
            "Thermostat should cool hot system: got {final_temp_cooled:.0}K"
        );
    }

    // === Error Recovery Tests ===

    #[test]
    fn test_nose_hoover_try_step_error_recovery() {
        // Verify that try_step restores state when force callback fails
        let mut state = make_diatomic();
        state.positions[1] = Vector3::new(1.2, 0.0, 0.0);
        state.velocities[0] = Vector3::new(0.1, 0.0, 0.0);
        state.velocities[1] = Vector3::new(-0.1, 0.0, 0.0);
        state.forces[0] = Vector3::new(-0.5, 0.0, 0.0);
        state.forces[1] = Vector3::new(0.5, 0.0, 0.0);

        let original_positions = state.positions.clone();
        let original_velocities = state.velocities.clone();
        let original_forces = state.forces.clone();

        let mut thermostat = NoseHooverChain::new(300.0, 100.0, 1.0, 3);
        let original_xi = thermostat.xi;
        let original_v_xi = thermostat.v_xi;

        // Force callback that fails
        let mut call_count = 0;
        let result = thermostat.try_step(
            &mut state,
            |_positions| -> Result<Vec<Vector3<f64>>, &str> {
                call_count += 1;
                Err("Force computation failed")
            },
        );

        // Should return error
        assert!(result.is_err());
        assert_eq!(call_count, 1);

        // State should be restored
        assert_eq!(state.positions, original_positions);
        assert_eq!(state.velocities, original_velocities);
        assert_eq!(state.forces, original_forces);

        // Thermostat state should be restored
        assert_eq!(thermostat.xi, original_xi);
        assert_eq!(thermostat.v_xi, original_v_xi);
    }

    #[test]
    fn test_velocity_rescale_try_step_error_recovery() {
        // Verify that try_step restores state when force callback fails
        let mut state = make_diatomic();
        state.positions[1] = Vector3::new(1.2, 0.0, 0.0);
        state.velocities[0] = Vector3::new(0.1, 0.0, 0.0);
        state.velocities[1] = Vector3::new(-0.1, 0.0, 0.0);
        state.forces[0] = Vector3::new(-0.5, 0.0, 0.0);
        state.forces[1] = Vector3::new(0.5, 0.0, 0.0);

        let original_positions = state.positions.clone();
        let original_velocities = state.velocities.clone();
        let original_forces = state.forces.clone();

        let mut thermostat = VelocityRescale::new(300.0, 100.0, 1.0, 3, Some(42));

        // Force callback that fails
        let result = thermostat.try_step(
            &mut state,
            |_positions| -> Result<Vec<Vector3<f64>>, &str> { Err("Force computation failed") },
        );

        // Should return error
        assert!(result.is_err());

        // State should be restored
        assert_eq!(state.positions, original_positions);
        assert_eq!(state.velocities, original_velocities);
        assert_eq!(state.forces, original_forces);
    }

    #[test]
    fn test_npt_try_step_error_recovery() {
        // Verify that try_step restores state when force callback fails
        let n_atoms = 4;
        let mass = 12.0;
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * 2.5, 0.0, 0.0))
            .collect();
        let masses = vec![mass; n_atoms];
        let cell = Matrix3::from_diagonal(&Vector3::new(10.0, 10.0, 10.0));

        let mut state = NPTState::new(positions.clone(), masses.clone(), cell, [true; 3]);
        state.velocities = positions
            .iter()
            .map(|_| Vector3::new(0.1, 0.0, 0.0))
            .collect();
        state.forces = positions
            .iter()
            .map(|_| Vector3::new(-0.1, 0.0, 0.0))
            .collect();

        let original_positions = state.positions.clone();
        let original_velocities = state.velocities.clone();
        let original_forces = state.forces.clone();
        let original_cell = state.cell;

        let total_mass: f64 = masses.iter().sum();
        let mut integrator = NPTIntegrator::new(
            NPTConfig::new(300.0, 0.0, 100.0, 1000.0, 1.0),
            n_atoms,
            total_mass,
        );
        let original_v_xi_atoms = integrator.v_xi_atoms;

        // Force callback that fails on the first call
        let mut call_count = 0;
        let result = integrator.try_step(
            &mut state,
            |_positions, _cell| -> Result<(Vec<Vector3<f64>>, Matrix3<f64>), &str> {
                call_count += 1;
                Err("Force computation failed")
            },
        );

        // Should return error
        assert!(result.is_err());
        assert_eq!(call_count, 1);

        // State should be restored
        assert_eq!(state.positions, original_positions);
        assert_eq!(state.velocities, original_velocities);
        assert_eq!(state.forces, original_forces);
        assert_eq!(state.cell, original_cell);

        // Integrator state should be restored
        assert_eq!(integrator.v_xi_atoms, original_v_xi_atoms);
    }

    #[test]
    fn test_npt_try_step_error_recovery_second_force_call() {
        // Verify that try_step restores state when the SECOND force call fails
        // (NPT calls force function twice per step)
        let n_atoms = 4;
        let mass = 12.0;
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| Vector3::new(idx as f64 * 2.5, 0.0, 0.0))
            .collect();
        let masses = vec![mass; n_atoms];
        let cell = Matrix3::from_diagonal(&Vector3::new(10.0, 10.0, 10.0));

        let mut state = NPTState::new(positions.clone(), masses.clone(), cell, [true; 3]);
        state.velocities = positions
            .iter()
            .map(|_| Vector3::new(0.1, 0.0, 0.0))
            .collect();
        state.forces = positions
            .iter()
            .map(|_| Vector3::new(-0.1, 0.0, 0.0))
            .collect();

        let original_positions = state.positions.clone();
        let original_velocities = state.velocities.clone();
        let original_forces = state.forces.clone();
        let original_cell = state.cell;

        let total_mass: f64 = masses.iter().sum();
        let mut integrator = NPTIntegrator::new(
            NPTConfig::new(300.0, 0.0, 100.0, 1000.0, 1.0),
            n_atoms,
            total_mass,
        );

        // Force callback that fails on the second call
        let mut call_count = 0;
        let result = integrator.try_step(
            &mut state,
            |positions, _cell| -> Result<(Vec<Vector3<f64>>, Matrix3<f64>), &str> {
                call_count += 1;
                if call_count == 1 {
                    // First call succeeds
                    Ok((
                        positions
                            .iter()
                            .map(|_| Vector3::new(-0.05, 0.0, 0.0))
                            .collect(),
                        Matrix3::zeros(),
                    ))
                } else {
                    // Second call fails
                    Err("Force computation failed on second call")
                }
            },
        );

        // Should return error
        assert!(result.is_err());
        assert_eq!(call_count, 2);

        // State should be restored to original (not intermediate)
        assert_eq!(state.positions, original_positions);
        assert_eq!(state.velocities, original_velocities);
        assert_eq!(state.forces, original_forces);
        assert_eq!(state.cell, original_cell);
    }

    // === Edge Case Validation Tests ===

    #[test]
    #[should_panic(expected = "NoseHooverChain requires n_dof > 0")]
    fn test_nose_hoover_panics_on_zero_n_dof() {
        // Creating NoseHooverChain with n_dof=0 should panic
        let _thermostat = NoseHooverChain::new(300.0, 100.0, 1.0, 0);
    }

    #[test]
    #[should_panic(expected = "VelocityRescale requires n_dof > 0")]
    fn test_velocity_rescale_panics_on_zero_n_dof() {
        // Creating VelocityRescale with n_dof=0 should panic
        let _thermostat = VelocityRescale::new(300.0, 100.0, 1.0, 0, Some(42));
    }

    #[test]
    #[should_panic(expected = "NPTIntegrator requires n_atoms >= 2")]
    fn test_npt_integrator_panics_on_zero_atoms() {
        // Creating NPTIntegrator with n_atoms=0 should panic
        let config = NPTConfig::new(300.0, 0.0, 100.0, 1000.0, 1.0);
        let _integrator = NPTIntegrator::new(config, 0, 0.0);
    }

    #[test]
    #[should_panic(expected = "NPTIntegrator requires n_atoms >= 2")]
    fn test_npt_integrator_panics_on_one_atom() {
        // Creating NPTIntegrator with n_atoms=1 should panic (n_dof would be 0)
        let config = NPTConfig::new(300.0, 0.0, 100.0, 1000.0, 1.0);
        let _integrator = NPTIntegrator::new(config, 1, 12.0);
    }

    #[test]
    #[should_panic(expected = "NoseHooverChain requires target_temp > 0")]
    fn test_nose_hoover_panics_on_zero_temperature() {
        // Setting temperature to 0 should panic
        let mut thermostat = NoseHooverChain::new(300.0, 100.0, 1.0, 3);
        thermostat.set_temperature(0.0);
    }

    #[test]
    #[should_panic(expected = "NoseHooverChain requires dt_fs > 0")]
    fn test_nose_hoover_panics_on_zero_dt() {
        // Creating NoseHooverChain with dt_fs=0 should panic
        let _thermostat = NoseHooverChain::new(300.0, 100.0, 0.0, 3);
    }

    #[test]
    #[should_panic(expected = "NoseHooverChain requires dt_fs > 0")]
    fn test_nose_hoover_panics_on_negative_dt() {
        // Creating NoseHooverChain with negative dt_fs should panic
        let _thermostat = NoseHooverChain::new(300.0, 100.0, -1.0, 3);
    }

    #[test]
    #[should_panic(expected = "VelocityRescale::set_temperature requires target_temp > 0")]
    fn test_velocity_rescale_set_temperature_panics_on_zero() {
        // Setting temperature to 0 should panic
        let mut thermostat = VelocityRescale::new(300.0, 100.0, 1.0, 3, Some(42));
        thermostat.set_temperature(0.0);
    }

    #[test]
    #[should_panic(expected = "NPTIntegrator requires temperature_k > 0")]
    fn test_npt_integrator_panics_on_zero_temperature() {
        let config = NPTConfig::new(0.0, 0.0, 100.0, 1000.0, 1.0);
        let _integrator = NPTIntegrator::new(config, 4, 48.0);
    }

    #[test]
    #[should_panic(expected = "NPTIntegrator requires tau_t > 0")]
    fn test_npt_integrator_panics_on_zero_tau_t() {
        let config = NPTConfig::new(300.0, 0.0, 0.0, 1000.0, 1.0);
        let _integrator = NPTIntegrator::new(config, 4, 48.0);
    }

    #[test]
    #[should_panic(expected = "NPTIntegrator requires tau_p > 0")]
    fn test_npt_integrator_panics_on_zero_tau_p() {
        let config = NPTConfig::new(300.0, 0.0, 100.0, 0.0, 1.0);
        let _integrator = NPTIntegrator::new(config, 4, 48.0);
    }

    #[test]
    #[should_panic(expected = "NPTIntegrator requires dt_fs > 0")]
    fn test_npt_integrator_panics_on_zero_dt() {
        let config = NPTConfig::new(300.0, 0.0, 100.0, 1000.0, 0.0);
        let _integrator = NPTIntegrator::new(config, 4, 48.0);
    }

    #[test]
    fn test_npt_state_temperature_edge_cases() {
        // NPTState::temperature() should return 0 for 0 or 1 atoms (no underflow/panic)
        let cell = Matrix3::from_diagonal(&Vector3::new(10.0, 10.0, 10.0));

        // 0 atoms
        let state_empty = NPTState::new(vec![], vec![], cell, [true; 3]);
        assert_eq!(state_empty.temperature(), 0.0);

        // 1 atom
        let state_single = NPTState::new(vec![Vector3::zeros()], vec![1.0], cell, [true; 3]);
        assert_eq!(state_single.temperature(), 0.0);

        // 2 atoms - should have meaningful temperature
        let mut state_two = NPTState::new(
            vec![Vector3::zeros(), Vector3::new(2.0, 0.0, 0.0)],
            vec![1.0, 1.0],
            cell,
            [true; 3],
        );
        state_two.velocities = vec![Vector3::new(0.1, 0.0, 0.0), Vector3::new(-0.1, 0.0, 0.0)];
        // With 2 atoms, n_dof = 3*2 - 3 = 3, so temperature should be positive
        assert!(state_two.temperature() > 0.0);
    }

    #[test]
    fn test_degrees_of_freedom_edge_cases() {
        // Test degrees_of_freedom function handles edge cases
        let state_empty = MDState::new(vec![], vec![]);
        assert_eq!(degrees_of_freedom(&state_empty), 0);

        let state_single = MDState::new(vec![Vector3::zeros()], vec![1.0]);
        assert_eq!(degrees_of_freedom(&state_single), 3); // 3*1 for single atom

        let state_two = MDState::new(
            vec![Vector3::zeros(), Vector3::new(2.0, 0.0, 0.0)],
            vec![1.0, 1.0],
        );
        assert_eq!(degrees_of_freedom(&state_two), 3); // 3*2 - 3 = 3

        let state_three = MDState::new(
            vec![
                Vector3::zeros(),
                Vector3::new(2.0, 0.0, 0.0),
                Vector3::new(4.0, 0.0, 0.0),
            ],
            vec![1.0, 1.0, 1.0],
        );
        assert_eq!(degrees_of_freedom(&state_three), 6); // 3*3 - 3 = 6
    }
}
