//! Langevin integrator (NVT ensemble) - BAOAB scheme.

use std::fmt;

use nalgebra::Vector3;
use rand::prelude::*;

use super::state::MDState;
use super::thermostats::ForcesLengthError;
use super::units;

// === Error types ===

/// Error type for Langevin step failures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LangevinStepError<E> {
    /// Force computation callback returned an error
    Callback(E),
    /// Forces vector has wrong length
    ForcesLength(ForcesLengthError),
}

impl<E: fmt::Display> fmt::Display for LangevinStepError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Callback(err) => write!(f, "Force computation failed: {err}"),
            Self::ForcesLength(err) => err.fmt(f),
        }
    }
}

impl<E: fmt::Debug + fmt::Display> std::error::Error for LangevinStepError<E> {}

impl<E> From<ForcesLengthError> for LangevinStepError<E> {
    fn from(err: ForcesLengthError) -> Self {
        Self::ForcesLength(err)
    }
}

// === Validation helpers ===

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

/// Configuration for Langevin thermostat.
#[derive(Debug, Clone, Default)]
pub struct LangevinConfig {
    /// Target temperature in Kelvin.
    pub temperature_k: f64,
    /// Time step in fs.
    pub dt_fs: f64,
    /// Pre-computed: dt in internal units.
    pub(crate) dt_int: f64,
    /// Friction coefficient in internal units (stored to avoid ln recovery).
    pub(crate) friction_int: f64,
    /// Pre-computed: c1 = exp(-friction * dt).
    pub(crate) c1: f64,
    /// Pre-computed: c2 = sqrt(1 - c1²).
    pub(crate) c2: f64,
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
        let (c1, c2) = compute_c1_c2(friction_int, dt_int);
        Self {
            temperature_k,
            dt_fs,
            dt_int,
            friction_int,
            c1,
            c2,
        }
    }

    /// Recompute c1/c2 after changing friction or dt.
    fn recompute_coefficients(&mut self) {
        (self.c1, self.c2) = compute_c1_c2(self.friction_int, self.dt_int);
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
        self.recompute_coefficients();
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
        self.recompute_coefficients();
        self
    }
}

/// Compute c1 = exp(-friction * dt), c2 = sqrt(1 - c1²).
#[inline]
fn compute_c1_c2(friction_int: f64, dt_int: f64) -> (f64, f64) {
    let c1 = (-friction_int * dt_int).exp();
    // Clamp to avoid NaN from tiny negative rounding when c1 ≈ 1
    let c2 = (1.0 - c1 * c1).max(0.0).sqrt();
    (c1, c2)
}

/// Perform one Langevin dynamics step (BAOAB scheme).
pub fn langevin_step<R, F>(
    state: MDState,
    config: &LangevinConfig,
    rng: &mut R,
    mut compute_forces: F,
) -> MDState
where
    R: Rng + Clone,
    F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
{
    // Wrap infallible closure and unwrap result
    // With infallible closure, callback errors are impossible, but forces length
    // mismatch can still occur - panic in that case as caller violated contract
    try_langevin_step(state, config, rng, |pos| {
        Ok::<_, std::convert::Infallible>(compute_forces(pos))
    })
    .unwrap_or_else(|(_state, err)| match err {
        LangevinStepError::Callback(infallible) => match infallible {},
        LangevinStepError::ForcesLength(err) => {
            panic!("langevin_step: {err}")
        }
    })
}

/// Perform one Langevin dynamics step with fallible force computation.
///
/// If the force computation fails or returns wrong-length forces, both the
/// original state and the RNG are restored, allowing the caller to retry
/// deterministically.
///
/// # Errors
/// Returns `(original_state, error)` if compute_forces fails or returns
/// forces with length != state.num_atoms().
#[allow(clippy::result_large_err)]
pub fn try_langevin_step<R, F, E>(
    state: MDState,
    config: &LangevinConfig,
    rng: &mut R,
    mut compute_forces: F,
) -> Result<MDState, (MDState, LangevinStepError<E>)>
where
    R: Rng + Clone,
    F: FnMut(&[Vector3<f64>]) -> Result<Vec<Vector3<f64>>, E>,
{
    // Clone state and RNG upfront so we can restore on error
    let original_state = state.clone();
    let original_rng = rng.clone();
    let expected_len = state.num_atoms();

    // Perform the BAOAB integration (modifies rng)
    let mut state = langevin_baoab_core(state, config, rng);

    // Compute new forces - if this fails, restore original state and RNG
    match compute_forces(&state.positions) {
        Ok(new_forces) => {
            // Validate forces length before assignment to prevent panic
            if new_forces.len() != expected_len {
                *rng = original_rng;
                return Err((
                    original_state,
                    ForcesLengthError {
                        expected: expected_len,
                        got: new_forces.len(),
                    }
                    .into(),
                ));
            }
            state.forces = new_forces;
            // B: Half-step velocity from new forces
            let half_dt = 0.5 * config.dt_int;
            for idx in 0..state.num_atoms() {
                let accel = state.forces[idx] / state.masses[idx];
                state.velocities[idx] += half_dt * accel;
            }
            Ok(state)
        }
        Err(err) => {
            *rng = original_rng;
            Err((original_state, LangevinStepError::Callback(err)))
        }
    }
}

/// Core BAOAB integration steps (B-A-O-A, without final B that requires new forces).
/// Made pub(crate) for split step API in WASM bindings.
pub(crate) fn langevin_baoab_core<R: Rng>(
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
        Self {
            config: LangevinConfig::new(temperature_k, friction, dt_fs),
            rng: super::units::make_rng(seed),
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
    /// If the force computation fails or returns wrong-length forces, the state
    /// and internal RNG are restored to their original values before the step
    /// and the error is returned. This ensures deterministic behavior on retry.
    ///
    /// # Errors
    /// Returns `LangevinStepError::Callback` if compute_forces fails, or
    /// `LangevinStepError::ForcesLength` if forces have wrong length.
    pub fn try_step<F, E>(
        &mut self,
        state: &mut MDState,
        compute_forces: F,
    ) -> Result<(), LangevinStepError<E>>
    where
        F: FnMut(&[Vector3<f64>]) -> Result<Vec<Vector3<f64>>, E>,
    {
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
                Err(err)
            }
        }
    }

    /// Set target temperature.
    pub fn set_temperature(&mut self, temperature_k: f64) {
        validate_temperature(temperature_k);
        self.config.temperature_k = temperature_k;
    }

    /// Set friction coefficient (1/fs).
    pub fn set_friction(&mut self, friction: f64) {
        validate_friction(friction);
        self.config.friction_int = friction * units::INTERNAL_TO_FS;
        self.config.recompute_coefficients();
    }

    /// Set time step (fs).
    pub fn set_dt(&mut self, dt_fs: f64) {
        validate_dt(dt_fs);
        self.config.dt_fs = dt_fs;
        self.config.dt_int = dt_fs * units::FS_TO_INTERNAL;
        self.config.recompute_coefficients();
    }

    /// Perform the first part of a Langevin step (B-A-O-A: velocity half-step, position
    /// update, thermostat).
    ///
    /// This is the split API for WASM where force computation cannot use closures.
    /// After calling this, compute forces at the new positions, then call `step_finalize`.
    ///
    /// Uses `state.forces` for the initial velocity half-step.
    pub fn step_init(&mut self, state: &mut MDState) {
        *state = langevin_baoab_core(std::mem::take(state), &self.config, &mut self.rng);
    }

    /// Complete a Langevin step after `step_init` (final B: velocity half-step with new forces).
    ///
    /// Must be called after `step_init` with forces computed at the updated positions.
    ///
    /// # Errors
    /// Returns `ForcesLengthError` if `new_forces.len() != state.positions.len()`.
    pub fn step_finalize(
        &self,
        state: &mut MDState,
        new_forces: &[Vector3<f64>],
    ) -> Result<(), super::thermostats::ForcesLengthError> {
        super::thermostats::validate_forces_len(new_forces, state.positions.len())?;
        state.forces = new_forces.to_vec();
        let half_dt = 0.5 * self.config.dt_int;
        for idx in 0..state.num_atoms() {
            let accel = state.forces[idx] / state.masses[idx];
            state.velocities[idx] += half_dt * accel;
        }
        Ok(())
    }
}

/// Box-Muller transform for standard normal random number.
pub fn box_muller_normal<R: Rng>(rng: &mut R) -> f64 {
    let u1: f64 = rng.gen_range(0.0001..1.0);
    let u2: f64 = rng.gen_range(0.0..std::f64::consts::TAU);
    (-2.0 * u1.ln()).sqrt() * u2.cos()
}
