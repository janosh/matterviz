//! Thermostats for NVT ensemble (Nosé-Hoover and Velocity Rescaling).

use nalgebra::Vector3;

use super::langevin::box_muller_normal;
use super::state::MDState;
use super::units;

// === Utilities ===

/// Compute twice the kinetic energy (sum of m*v²).
/// Used in thermostats where 2*KE = sum_i m_i * |v_i|².
#[inline]
pub fn kinetic_energy_2x(velocities: &[Vector3<f64>], masses: &[f64]) -> f64 {
    velocities
        .iter()
        .zip(masses)
        .map(|(vel, mass)| mass * vel.norm_squared())
        .sum()
}

// === Nosé-Hoover Chain Thermostat ===

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

        Self {
            target_temp,
            tau,
            dt_fs,
            rng: units::make_rng(seed),
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

        // Apply velocity rescaling with stochastic term
        let ke_current = kinetic_energy_2x(&state.velocities, &state.masses);
        if ke_current > 0.0 {
            let c1 = (-self.dt_fs / self.tau).exp();
            let c2 = 1.0 - c1;
            let kt_target = units::KB * self.target_temp * self.n_dof as f64;

            // Stochastic term from sum of n_dof-1 squared normal deviates
            let r_sum: f64 = (0..self.n_dof - 1)
                .map(|_| {
                    let normal = box_muller_normal(&mut self.rng);
                    normal * normal
                })
                .sum();
            let r1: f64 = box_muller_normal(&mut self.rng);

            // Bussi formula for new kinetic energy
            let ke_new = c1 * ke_current
                + c2 * kt_target * (r_sum + r1 * r1) / self.n_dof as f64
                + 2.0 * (c1 * c2 * ke_current * kt_target / self.n_dof as f64).sqrt() * r1;

            if ke_new > 0.0 {
                let scale = (ke_new / ke_current).sqrt();
                for vel in &mut state.velocities {
                    *vel *= scale;
                }
            }
        }

        Ok(())
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
