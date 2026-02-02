//! NPT ensemble (isothermal-isobaric) integrator.

use nalgebra::{Matrix3, Vector3};

use super::thermostats::kinetic_energy_2x;
use super::units;

/// Error type for NPT step operations.
#[derive(Debug, Clone)]
pub enum NptStepError<E> {
    /// The force/stress callback returned an error.
    Callback(E),
    /// The forces vector has an incorrect length.
    ForcesLengthMismatch {
        /// Expected number of forces (equal to number of atoms).
        expected: usize,
        /// Actual number of forces returned by callback.
        got: usize,
    },
}

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
    ///
    /// # Panics
    /// Panics if `positions.len() != masses.len()` or if any mass is non-positive or non-finite.
    pub fn new(
        positions: Vec<Vector3<f64>>,
        masses: Vec<f64>,
        cell: Matrix3<f64>,
        pbc: [bool; 3],
    ) -> Self {
        let n_atoms = positions.len();
        assert_eq!(
            masses.len(),
            n_atoms,
            "NPTState::new requires positions.len() == masses.len() (got {} vs {})",
            n_atoms,
            masses.len()
        );
        for (idx, &mass) in masses.iter().enumerate() {
            assert!(
                mass > 0.0 && mass.is_finite(),
                "NPTState::new: mass at index {idx} must be positive and finite, got {mass}"
            );
        }
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
            .map(|(vel, mass)| mass * vel.norm_squared())
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
    /// - `config.cell_mass_factor <= 0` or non-finite (would cause NaN/negative w_cell)
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
        assert!(
            config.cell_mass_factor.is_finite() && config.cell_mass_factor > 0.0,
            "NPTIntegrator requires cell_mass_factor > 0 and finite (got {}). \
             Invalid cell_mass_factor would produce NaN/negative barostat mass w_cell.",
            config.cell_mass_factor
        );

        let kt = units::KB * config.temperature_k;
        let n_dof = 3 * n_atoms - 3;

        // Thermostat mass: Q = n_dof * kT * tau_t^2
        let tau_t_int = config.tau_t * units::FS_TO_INTERNAL;
        let q_atoms = n_dof as f64 * kt * tau_t_int * tau_t_int;

        // Barostat mass: W = (n_dof + 1) * kT * tau_p^2 * cell_mass_factor
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
    /// # Arguments
    /// * `state` - NPT state
    /// * `compute_forces_and_stress` - Function that returns (forces, stress_tensor)
    ///   where stress is in eV/Å³
    ///
    /// # Panics
    /// Panics if the callback returns a forces vector with incorrect length.
    pub fn step<F>(&mut self, state: &mut NPTState, mut compute_forces_and_stress: F)
    where
        F: FnMut(&[Vector3<f64>], &Matrix3<f64>) -> (Vec<Vector3<f64>>, Matrix3<f64>),
    {
        let result: Result<(), NptStepError<std::convert::Infallible>> = self
            .try_step(state, |positions, cell| {
                Ok(compute_forces_and_stress(positions, cell))
            });
        if let Err(NptStepError::ForcesLengthMismatch { expected, got }) = result {
            panic!("compute_forces_and_stress returned {got} forces but expected {expected}");
        }
    }

    /// Perform one NPT step with fallible force/stress computation.
    ///
    /// If the force computation fails, the state is restored to its original
    /// value before the step and the error is returned.
    ///
    /// # Errors
    /// Returns an error if:
    /// - `compute_forces_and_stress` returns an error (`NptStepError::Callback`)
    /// - The returned forces vector has a different length than `state.positions`
    ///   (`NptStepError::ForcesLengthMismatch`)
    pub fn try_step<F, E>(
        &mut self,
        state: &mut NPTState,
        mut compute_forces_and_stress: F,
    ) -> Result<(), NptStepError<E>>
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

        // Target pressure in eV/Å³
        let p_ext = self.config.pressure_gpa * units::GPA_TO_EV_PER_ANG3;

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
        let (initial_forces, initial_stress) =
            match compute_forces_and_stress(&state.positions, &state.cell) {
                Ok((forces, stress)) => {
                    let expected = state.positions.len();
                    if forces.len() != expected {
                        *state = original_state;
                        self.v_xi_atoms = original_v_xi_atoms;
                        return Err(NptStepError::ForcesLengthMismatch {
                            expected,
                            got: forces.len(),
                        });
                    }
                    (forces, stress)
                }
                Err(err) => {
                    *state = original_state;
                    self.v_xi_atoms = original_v_xi_atoms;
                    return Err(NptStepError::Callback(err));
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
        let cell_scale = 1.0 + state.cell_velocity[(0, 0)] * dt;
        state.cell *= cell_scale;

        for pos in &mut state.positions {
            *pos *= cell_scale;
        }
        for (idx, pos) in state.positions.iter_mut().enumerate() {
            *pos += dt * state.velocities[idx];
        }

        // === Compute new forces ===
        let (new_forces, new_stress) =
            match compute_forces_and_stress(&state.positions, &state.cell) {
                Ok((forces, stress)) => {
                    let expected = state.positions.len();
                    if forces.len() != expected {
                        *state = original_state;
                        self.v_xi_atoms = original_v_xi_atoms;
                        return Err(NptStepError::ForcesLengthMismatch {
                            expected,
                            got: forces.len(),
                        });
                    }
                    (forces, stress)
                }
                Err(err) => {
                    *state = original_state;
                    self.v_xi_atoms = original_v_xi_atoms;
                    return Err(NptStepError::Callback(err));
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
        p_int / units::GPA_TO_EV_PER_ANG3
    }

    /// Perform the first part of an NPT step (thermostat half-step + cell half-step +
    /// velocity half-step + position/cell update).
    ///
    /// This is the split API for WASM where force computation cannot use closures.
    /// After calling this, compute forces and stress at the new positions/cell,
    /// then call `step_finalize`.
    ///
    /// Expects `state.forces` to contain the initial forces before calling.
    /// Uses `initial_stress` for the cell dynamics.
    pub fn step_init(&mut self, state: &mut NPTState, initial_stress: &Matrix3<f64>) {
        let dt = self.config.dt_fs * units::FS_TO_INTERNAL;
        let dt2 = dt / 2.0;
        let kt = units::KB * self.config.temperature_k;
        let n_dof = self.n_dof as f64;

        // Target pressure in eV/Å³
        let p_ext = self.config.pressure_gpa * units::GPA_TO_EV_PER_ANG3;

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
        let cell_scale = 1.0 + state.cell_velocity[(0, 0)] * dt;
        state.cell *= cell_scale;

        for pos in &mut state.positions {
            *pos *= cell_scale;
        }
        for (idx, pos) in state.positions.iter_mut().enumerate() {
            *pos += dt * state.velocities[idx];
        }
    }

    /// Complete an NPT step after `step_init` (velocity second half + cell second half +
    /// thermostat second half).
    ///
    /// Must be called after `step_init` with forces and stress computed at the updated
    /// positions/cell.
    pub fn step_finalize(
        &mut self,
        state: &mut NPTState,
        new_forces: &[Vector3<f64>],
        new_stress: &Matrix3<f64>,
    ) {
        let dt = self.config.dt_fs * units::FS_TO_INTERNAL;
        let dt2 = dt / 2.0;
        let kt = units::KB * self.config.temperature_k;
        let n_dof = self.n_dof as f64;

        // Target pressure in eV/Å³
        let p_ext = self.config.pressure_gpa * units::GPA_TO_EV_PER_ANG3;

        // Store new forces
        state.forces = new_forces.to_vec();

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
        let scale = (-self.v_xi_atoms * dt2).exp();
        for vel in &mut state.velocities {
            *vel *= scale;
        }

        let ke2 = kinetic_energy_2x(&state.velocities, &state.masses);
        let g_xi = (ke2 - n_dof * kt) / self.q_atoms;
        self.v_xi_atoms += g_xi * dt2;
    }
}
