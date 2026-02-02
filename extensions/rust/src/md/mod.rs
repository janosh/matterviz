//! Molecular dynamics integrators for atomistic simulations.
//!
//! This module provides MD integrators organized by ensemble:
//!
//! - **NVE (microcanonical)**: [`verlet`] - Velocity Verlet integrator
//! - **NVT (canonical)**: [`langevin`], [`thermostats`] - Langevin dynamics,
//!   Nosé-Hoover chain, velocity rescaling
//! - **NPT (isothermal-isobaric)**: [`npt`] - Nosé-Hoover + Parrinello-Rahman
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
//! use ferrox::md::{MDState, LangevinConfig, init_velocities, langevin_step};
//!
//! let state = MDState::new(positions, masses);
//! let state = init_velocities(state, 300.0, &mut rng);
//!
//! let config = LangevinConfig::new(300.0, 0.01, 1.0);
//! for _ in 0..1000 {
//!     let forces = compute_forces(&state.positions);
//!     state = langevin_step(state, &config, &mut rng, |_| forces.clone());
//! }
//! ```

// Submodules
pub mod langevin;
pub mod npt;
pub mod state;
pub mod thermostats;
pub mod units;
pub mod verlet;

// Re-export commonly used types and functions
pub use langevin::{
    LangevinConfig, LangevinIntegrator, box_muller_normal, langevin_step, try_langevin_step,
};
pub use npt::{NPTConfig, NPTIntegrator, NPTState, NptStepError};
pub use state::{MDState, init_velocities, kinetic_energy, remove_com_velocity, temperature};
pub use thermostats::{
    ForcesLengthError, NoseHooverChain, ThermostatStepError, VelocityRescale, kinetic_energy_2x,
};
pub use units::{FS_TO_INTERNAL, INTERNAL_TIME_FS, INTERNAL_TO_FS, KB};
pub use verlet::{
    try_velocity_verlet_step, velocity_verlet_finalize, velocity_verlet_init, velocity_verlet_step,
};
