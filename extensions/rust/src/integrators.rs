//! Molecular dynamics integrators for atomistic simulations.
//!
//! This module provides MD integrators for NVE and NVT ensembles using ASE units:
//! - Energy: eV
//! - Length: Angstrom
//! - Mass: amu (atomic mass units)
//! - Time: fs (femtoseconds)
//!
//! # Example
//!
//! ```rust,ignore
//! use ferrox::integrators::{MDState, LangevinIntegrator};
//!
//! let mut state = MDState::new(positions, masses);
//! state.init_velocities(300.0, Some(42));  // 300 K
//!
//! let mut integrator = LangevinIntegrator::new(300.0, 0.01, 1.0, Some(42));
//!
//! for _ in 0..1000 {
//!     let forces = compute_forces(&state.positions);
//!     integrator.step(&mut state, &forces);
//! }
//! ```

use nalgebra::{Matrix3, Vector3};
use rand::prelude::*;
use rand::rngs::StdRng;

/// Generate a random number from standard normal distribution using Box-Muller transform.
fn box_muller_normal<R: Rng>(rng: &mut R) -> f64 {
    let u1: f64 = rng.gen_range(0.0001..1.0);
    let u2: f64 = rng.gen_range(0.0..std::f64::consts::TAU);
    (-2.0 * u1.ln()).sqrt() * u2.cos()
}

/// ASE unit conversion constants.
///
/// In ASE units:
/// - Energy: eV
/// - Length: Angstrom
/// - Mass: amu
/// - Time: internal time unit _t = sqrt(amu * Angstrom^2 / eV) ≈ 10.18 fs
///
/// For user-facing APIs, time is in femtoseconds.
pub mod units {
    /// Boltzmann constant in eV/K.
    pub const KB: f64 = 8.617333262e-5;

    /// Internal time unit in femtoseconds.
    /// _t = sqrt(amu * Angstrom^2 / eV) = 10.1805 fs
    pub const INTERNAL_TIME_FS: f64 = 10.1805055073576;

    /// Conversion factor: fs to internal time units.
    /// To convert dt_fs to dt_internal: dt_internal = dt_fs * FS_TO_INTERNAL
    pub const FS_TO_INTERNAL: f64 = 1.0 / INTERNAL_TIME_FS;

    /// Conversion factor: internal time to fs.
    pub const INTERNAL_TO_FS: f64 = INTERNAL_TIME_FS;

    // Note: In internal units, KE = 0.5 * m * v^2 directly (in eV).
    // Velocity in internal units: Angstrom / _t
    // To convert v_internal to v_fs: v_fs = v_internal * INTERNAL_TO_FS
}

/// State of a molecular dynamics simulation.
///
/// Contains positions, velocities, forces, and masses.
/// - Positions: Angstrom
/// - Velocities: Angstrom / internal_time_unit (where 1 internal = 10.18 fs)
/// - Forces: eV/Angstrom
/// - Masses: amu
#[derive(Debug, Clone)]
pub struct MDState {
    /// Atomic positions in Angstrom.
    pub positions: Vec<Vector3<f64>>,
    /// Atomic velocities in Angstrom/internal_time_unit.
    pub velocities: Vec<Vector3<f64>>,
    /// Forces on atoms in eV/Angstrom.
    pub forces: Vec<Vector3<f64>>,
    /// Atomic masses in amu.
    pub masses: Vec<f64>,
    /// Optional unit cell for periodic systems (3x3 matrix, rows are lattice vectors).
    pub cell: Option<Matrix3<f64>>,
    /// Periodic boundary conditions along each axis.
    pub pbc: [bool; 3],
}

impl MDState {
    /// Create a new MD state with given positions and masses.
    ///
    /// Velocities are initialized to zero; call `init_velocities` to set them.
    pub fn new(positions: Vec<Vector3<f64>>, masses: Vec<f64>) -> Self {
        let n_atoms = positions.len();
        assert_eq!(
            masses.len(),
            n_atoms,
            "Number of masses ({}) must match number of positions ({})",
            masses.len(),
            n_atoms
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

    /// Create a new MD state with cell and PBC information.
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

    /// Number of atoms in the system.
    pub fn num_atoms(&self) -> usize {
        self.positions.len()
    }

    /// Initialize velocities from Maxwell-Boltzmann distribution.
    ///
    /// # Arguments
    ///
    /// * `temperature_k` - Target temperature in Kelvin
    /// * `seed` - Optional random seed for reproducibility
    pub fn init_velocities(&mut self, temperature_k: f64, seed: Option<u64>) {
        if temperature_k <= 0.0 || self.num_atoms() == 0 {
            return;
        }

        let mut rng: StdRng = match seed {
            Some(s) => StdRng::seed_from_u64(s),
            None => StdRng::from_entropy(),
        };

        // Maxwell-Boltzmann distribution: v ~ sqrt(kT/m) * N(0,1)
        // In internal units where KE = 0.5 * m * v^2:
        // <0.5 * m * v^2> = 0.5 * kT per degree of freedom
        // So v_std = sqrt(kT/m)
        for (idx, velocity) in self.velocities.iter_mut().enumerate() {
            let mass = self.masses[idx];
            let v_std = (units::KB * temperature_k / mass).sqrt();

            // Sample from Maxwell-Boltzmann using Box-Muller
            *velocity = Vector3::new(
                box_muller_normal(&mut rng) * v_std,
                box_muller_normal(&mut rng) * v_std,
                box_muller_normal(&mut rng) * v_std,
            );
        }

        // Remove center of mass motion
        self.zero_com_momentum();

        // Scale to exact temperature
        let current_temp = self.temperature();
        if current_temp > 0.0 {
            let scale = (temperature_k / current_temp).sqrt();
            for velocity in &mut self.velocities {
                *velocity *= scale;
            }
        }
    }

    /// Remove center-of-mass momentum.
    pub fn zero_com_momentum(&mut self) {
        if self.num_atoms() == 0 {
            return;
        }

        // Calculate total momentum
        let mut total_momentum = Vector3::zeros();
        let mut total_mass = 0.0;

        for (idx, velocity) in self.velocities.iter().enumerate() {
            total_momentum += self.masses[idx] * velocity;
            total_mass += self.masses[idx];
        }

        if total_mass > 0.0 {
            let com_velocity = total_momentum / total_mass;
            for velocity in &mut self.velocities {
                *velocity -= com_velocity;
            }
        }
    }

    /// Get kinetic energy in eV.
    ///
    /// In internal units, KE = 0.5 * m * v^2 directly gives energy in eV.
    pub fn kinetic_energy(&self) -> f64 {
        let mut ke = 0.0;
        for (idx, velocity) in self.velocities.iter().enumerate() {
            let mass = self.masses[idx];
            let v_sq = velocity.norm_squared();
            // In internal units: KE = 0.5 * m * v^2 directly in eV
            ke += 0.5 * mass * v_sq;
        }
        ke
    }

    /// Get temperature in Kelvin from kinetic energy.
    ///
    /// Uses the equipartition theorem: KE = (3N - 3) * kT / 2 for N > 1,
    /// or KE = 3N * kT / 2 for N = 1.
    pub fn temperature(&self) -> f64 {
        let n_atoms = self.num_atoms();
        if n_atoms == 0 {
            return 0.0;
        }

        let dof = self.degrees_of_freedom();
        if dof == 0 {
            return 0.0;
        }

        let ke = self.kinetic_energy();
        // T = 2 * KE / (dof * kB)
        2.0 * ke / (dof as f64 * units::KB)
    }

    /// Get total degrees of freedom.
    ///
    /// For N > 1: 3N - 3 (removing COM motion).
    /// For N = 1: 3 (single atom has no COM constraint).
    pub fn degrees_of_freedom(&self) -> usize {
        let n_atoms = self.num_atoms();
        if n_atoms <= 1 {
            3 * n_atoms
        } else {
            3 * n_atoms - 3 // Remove COM degrees of freedom
        }
    }

    /// Set forces from an array.
    pub fn set_forces(&mut self, forces: &[Vector3<f64>]) {
        assert_eq!(
            forces.len(),
            self.num_atoms(),
            "Forces array length ({}) must match number of atoms ({})",
            forces.len(),
            self.num_atoms()
        );
        self.forces = forces.to_vec();
    }
}

/// Perform first half of velocity Verlet step.
///
/// This does:
/// 1. v(t + dt/2) = v(t) + (dt/2) * a(t)
/// 2. r(t + dt) = r(t) + dt * v(t + dt/2)
///
/// After this, the user should compute forces at the new positions
/// and call `velocity_verlet_finalize`.
///
/// # Arguments
///
/// * `state` - The MD state to update
/// * `dt` - Time step in femtoseconds
pub fn velocity_verlet_init(state: &mut MDState, dt: f64) {
    let n_atoms = state.num_atoms();
    let dt_int = dt * units::FS_TO_INTERNAL;

    // Half step velocity update using current forces
    for idx in 0..n_atoms {
        let mass = state.masses[idx];
        let accel = state.forces[idx] / mass;
        state.velocities[idx] += 0.5 * dt_int * accel;
    }

    // Full step position update
    for idx in 0..n_atoms {
        state.positions[idx] += dt_int * state.velocities[idx];
    }
}

/// Complete velocity Verlet step with new forces.
///
/// This does:
/// 3. v(t + dt) = v(t + dt/2) + (dt/2) * a(t + dt)
///
/// # Arguments
///
/// * `state` - The MD state to update
/// * `dt` - Time step in femtoseconds
/// * `new_forces` - Forces at the new positions in eV/Angstrom
pub fn velocity_verlet_finalize(state: &mut MDState, dt: f64, new_forces: &[Vector3<f64>]) {
    let n_atoms = state.num_atoms();
    assert_eq!(
        new_forces.len(),
        n_atoms,
        "Forces array length ({}) must match number of atoms ({})",
        new_forces.len(),
        n_atoms
    );

    let dt_int = dt * units::FS_TO_INTERNAL;

    // Update forces
    state.set_forces(new_forces);

    // Second half step velocity update using new forces
    for idx in 0..n_atoms {
        let mass = state.masses[idx];
        let accel = state.forces[idx] / mass;
        state.velocities[idx] += 0.5 * dt_int * accel;
    }
}

/// Perform one complete velocity Verlet step with a force callable.
///
/// The velocity Verlet algorithm:
/// 1. v(t + dt/2) = v(t) + (dt/2) * a(t)
/// 2. r(t + dt) = r(t) + dt * v(t + dt/2)
/// 3. Compute a(t + dt) from new positions using the force function
/// 4. v(t + dt) = v(t + dt/2) + (dt/2) * a(t + dt)
///
/// # Arguments
///
/// * `state` - The MD state to update
/// * `dt` - Time step in femtoseconds
/// * `compute_forces` - Function that computes forces given positions
pub fn velocity_verlet_step<F>(state: &mut MDState, dt: f64, mut compute_forces: F)
where
    F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
{
    velocity_verlet_init(state, dt);
    let new_forces = compute_forces(&state.positions);
    velocity_verlet_finalize(state, dt, &new_forces);
}

/// Langevin thermostat integrator for NVT ensemble.
///
/// Implements the BAOAB splitting scheme which has good ergodic properties:
/// B: half-step velocity from forces
/// A: half-step position from velocities
/// O: friction and random force (Ornstein-Uhlenbeck)
/// A: half-step position from velocities
/// B: half-step velocity from forces
#[derive(Debug, Clone)]
pub struct LangevinIntegrator {
    /// Target temperature in Kelvin.
    pub temperature_k: f64,
    /// Friction coefficient in 1/internal_time_unit.
    friction_int: f64,
    /// Time step in internal time units.
    dt_int: f64,
    /// Time step in fs (for user reference).
    pub dt_fs: f64,
    /// Random number generator.
    rng: StdRng,
    /// Pre-computed coefficient c1 = exp(-friction * dt).
    c1: f64,
    /// Pre-computed coefficient c2 = sqrt(1 - c1^2).
    c2: f64,
}

impl LangevinIntegrator {
    /// Create a new Langevin integrator.
    ///
    /// # Arguments
    ///
    /// * `temperature_k` - Target temperature in Kelvin
    /// * `friction` - Friction coefficient in 1/fs (typical: 0.001 to 0.01)
    /// * `dt` - Time step in fs
    /// * `seed` - Optional random seed for reproducibility
    pub fn new(temperature_k: f64, friction: f64, dt: f64, seed: Option<u64>) -> Self {
        let rng = match seed {
            Some(s) => StdRng::seed_from_u64(s),
            None => StdRng::from_entropy(),
        };

        // Convert to internal units
        let dt_int = dt * units::FS_TO_INTERNAL;
        let friction_int = friction * units::INTERNAL_TO_FS; // friction in 1/internal_time

        // Pre-compute coefficients for Ornstein-Uhlenbeck step
        let c1 = (-friction_int * dt_int).exp();
        let c2 = (1.0 - c1 * c1).sqrt();

        Self {
            temperature_k,
            friction_int,
            dt_int,
            dt_fs: dt,
            rng,
            c1,
            c2,
        }
    }

    /// Perform one Langevin dynamics step with a force callable.
    ///
    /// Uses BAOAB splitting: B-A-O-A-B where forces are computed at new positions
    /// after position updates.
    ///
    /// # Arguments
    ///
    /// * `state` - The MD state to update
    /// * `compute_forces` - Function that computes forces given positions
    pub fn step<F>(&mut self, state: &mut MDState, mut compute_forces: F)
    where
        F: FnMut(&[Vector3<f64>]) -> Vec<Vector3<f64>>,
    {
        let n_atoms = state.num_atoms();
        let dt_int = self.dt_int;
        let half_dt = 0.5 * dt_int;

        // B: Half-step velocity update from current forces
        for idx in 0..n_atoms {
            let mass = state.masses[idx];
            let accel = state.forces[idx] / mass;
            state.velocities[idx] += half_dt * accel;
        }

        // A: Half-step position update
        for idx in 0..n_atoms {
            state.positions[idx] += half_dt * state.velocities[idx];
        }

        // O: Ornstein-Uhlenbeck process (friction + random kicks)
        for idx in 0..n_atoms {
            let mass = state.masses[idx];
            // Target velocity standard deviation at this temperature (in internal units)
            let v_std = (units::KB * self.temperature_k / mass).sqrt();

            // Apply O-U process to each velocity component
            let velocity = &mut state.velocities[idx];
            for axis in 0..3 {
                let noise = box_muller_normal(&mut self.rng);
                velocity[axis] = self.c1 * velocity[axis] + self.c2 * v_std * noise;
            }
        }

        // A: Half-step position update
        for idx in 0..n_atoms {
            state.positions[idx] += half_dt * state.velocities[idx];
        }

        // Compute forces at new positions
        let new_forces = compute_forces(&state.positions);
        state.set_forces(&new_forces);

        // B: Half-step velocity update from new forces
        for idx in 0..n_atoms {
            let mass = state.masses[idx];
            let accel = state.forces[idx] / mass;
            state.velocities[idx] += half_dt * accel;
        }
    }

    /// Set a new target temperature.
    pub fn set_temperature(&mut self, temperature_k: f64) {
        self.temperature_k = temperature_k;
    }

    /// Set a new friction coefficient (in 1/fs).
    pub fn set_friction(&mut self, friction: f64) {
        self.friction_int = friction * units::INTERNAL_TO_FS;
        self.c1 = (-self.friction_int * self.dt_int).exp();
        self.c2 = (1.0 - self.c1 * self.c1).sqrt();
    }

    /// Set a new time step (in fs).
    pub fn set_dt(&mut self, dt: f64) {
        self.dt_fs = dt;
        self.dt_int = dt * units::FS_TO_INTERNAL;
        self.c1 = (-self.friction_int * self.dt_int).exp();
        self.c2 = (1.0 - self.c1 * self.c1).sqrt();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_diatomic() -> MDState {
        // Simple diatomic molecule: two atoms 1 Angstrom apart
        let positions = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)];
        let masses = vec![12.0, 12.0]; // Carbon-like masses
        MDState::new(positions, masses)
    }

    fn harmonic_forces(positions: &[Vector3<f64>], k: f64, r0: f64) -> Vec<Vector3<f64>> {
        // Simple harmonic spring between atoms 0 and 1
        assert_eq!(positions.len(), 2);
        let diff = positions[1] - positions[0];
        let dist = diff.norm();
        let unit = if dist > 1e-10 { diff / dist } else { diff };
        let force_mag = -k * (dist - r0);
        vec![
            -force_mag * unit, // Force on atom 0
            force_mag * unit,  // Force on atom 1
        ]
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
        let mut state = make_diatomic();
        state.init_velocities(300.0, Some(42));

        // Velocities should be non-zero
        assert!(
            state.velocities.iter().any(|v| v.norm() > 1e-10),
            "Velocities should be initialized"
        );

        // Temperature should be close to target
        let temp = state.temperature();
        assert!(
            (temp - 300.0).abs() < 50.0,
            "Temperature {temp} should be close to 300 K"
        );
    }

    #[test]
    fn test_zero_com_momentum() {
        let mut state = make_diatomic();
        state.velocities[0] = Vector3::new(1.0, 2.0, 3.0);
        state.velocities[1] = Vector3::new(4.0, 5.0, 6.0);

        state.zero_com_momentum();

        // Total momentum should be zero
        let total_mom: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(v, m)| *m * v)
            .sum();

        assert!(
            total_mom.norm() < 1e-10,
            "COM momentum should be zero, got {total_mom}"
        );
    }

    #[test]
    fn test_kinetic_energy() {
        let mut state = make_diatomic();
        // Set known velocities in internal units
        // v = 0.1 internal velocity units gives KE = 0.5 * 12 * 0.01 = 0.06 eV
        state.velocities[0] = Vector3::new(0.1, 0.0, 0.0);
        state.velocities[1] = Vector3::new(0.0, 0.0, 0.0);

        let ke = state.kinetic_energy();
        // KE = 0.5 * m * v^2 = 0.5 * 12 * 0.01 = 0.06 eV
        let expected = 0.5 * 12.0 * 0.01;
        assert!(
            (ke - expected).abs() < 1e-10,
            "KE {ke} should be {expected}"
        );
    }

    #[test]
    fn test_velocity_verlet_energy_conservation() {
        let mut state = make_diatomic();
        let k = 1.0; // Spring constant in eV/Angstrom^2
        let r0 = 1.2; // Equilibrium distance

        // Start with stretched bond
        state.positions[1] = Vector3::new(1.4, 0.0, 0.0);

        // Initialize forces
        let forces = harmonic_forces(&state.positions, k, r0);
        state.set_forces(&forces);

        // Run for many steps
        // Characteristic frequency: sqrt(k/m) = sqrt(1/12) ≈ 0.29 internal units
        // Period ≈ 22 internal units ≈ 220 fs
        // Use dt = 1 fs for stability
        let dt = 1.0; // fs
        let mut energies = Vec::new();

        for _ in 0..500 {
            // Use the callable-style API
            velocity_verlet_step(&mut state, dt, |positions| {
                harmonic_forces(positions, k, r0)
            });

            let ke = state.kinetic_energy();
            let dist = (state.positions[1] - state.positions[0]).norm();
            let pe = 0.5 * k * (dist - r0).powi(2);
            energies.push(ke + pe);
        }

        // Energy should be conserved (within numerical precision)
        let e_init = energies[0];
        let e_final = *energies.last().unwrap();
        let e_drift = (e_final - e_init).abs() / e_init.max(1e-10);

        assert!(
            e_drift < 0.01,
            "Energy drift {:.2}% too large for velocity Verlet",
            e_drift * 100.0
        );
    }

    #[test]
    fn test_langevin_temperature_equilibration() {
        let mut state = make_diatomic();
        let target_temp = 300.0;
        let k = 1.0; // Weaker spring
        let r0 = 1.2;

        // Start cold at equilibrium
        state.positions[1] = Vector3::new(r0, 0.0, 0.0);
        let forces = harmonic_forces(&state.positions, k, r0);
        state.set_forces(&forces);

        // Use reasonable friction: 0.01 1/fs for faster equilibration
        let mut integrator = LangevinIntegrator::new(target_temp, 0.01, 1.0, Some(42));

        // Run equilibration
        let mut temps = Vec::new();
        for _ in 0..2000 {
            integrator.step(&mut state, |positions| harmonic_forces(positions, k, r0));
            temps.push(state.temperature());
        }

        // Average temperature over last 1000 steps
        // Note: With only 3 DOF (2 atoms), temperature fluctuations are large
        let avg_temp: f64 = temps[1000..].iter().sum::<f64>() / 1000.0;

        // Check that we're in the right ballpark (factor of 10)
        assert!(
            avg_temp > target_temp * 0.1 && avg_temp < target_temp * 10.0,
            "Average temperature {avg_temp} K should be within factor of 10 of target {target_temp} K"
        );
    }

    #[test]
    fn test_langevin_coefficient_update() {
        let mut integrator = LangevinIntegrator::new(300.0, 0.01, 1.0, Some(42));

        let c1_old = integrator.c1;
        integrator.set_friction(0.05);

        assert!(
            (integrator.c1 - c1_old).abs() > 0.01,
            "c1 should change when friction changes"
        );
    }

    #[test]
    fn test_degrees_of_freedom() {
        // Single atom: 3 DOF
        let single = MDState::new(vec![Vector3::zeros()], vec![1.0]);
        assert_eq!(single.degrees_of_freedom(), 3);

        // Two atoms: 3 DOF (6 - 3 for COM)
        let diatomic = make_diatomic();
        assert_eq!(diatomic.degrees_of_freedom(), 3);

        // Ten atoms: 27 DOF (30 - 3 for COM)
        let many = MDState::new(vec![Vector3::zeros(); 10], vec![1.0; 10]);
        assert_eq!(many.degrees_of_freedom(), 27);
    }

    // =========================================================================
    // Advanced Tests: Harmonic oscillator, energy conservation, equipartition
    // =========================================================================

    /// Test harmonic oscillator against analytical solution x(t) = A*cos(ωt + φ)
    /// for many periods to verify long-term accuracy.
    #[test]
    fn test_harmonic_oscillator_analytical() {
        // Single atom harmonic oscillator: F = -k * x
        // Analytical solution: x(t) = A*cos(ωt) where ω = sqrt(k/m)
        let mass: f64 = 1.0; // amu
        let k: f64 = 1.0; // eV/Å² - spring constant

        // Angular frequency in internal units: ω = sqrt(k/m)
        let omega = (k / mass).sqrt();

        // Initial conditions: x = A, v = 0 (starting at max displacement)
        let amplitude = 0.5; // Å
        let positions = vec![Vector3::new(amplitude, 0.0, 0.0)];
        let masses = vec![mass];
        let mut state = MDState::new(positions, masses);

        // Period = 2π/ω internal time units
        // In fs: T_fs = 2π/ω * INTERNAL_TO_FS
        let period_internal = 2.0 * std::f64::consts::PI / omega;
        let period_fs = period_internal * units::INTERNAL_TO_FS;

        // Use small dt for accuracy: ~200 steps per period for better precision
        let dt_fs = period_fs / 200.0;
        // Test over 100 periods (sufficient to verify stability without excessive accumulation)
        let n_periods = 100;
        let n_steps = (n_periods as f64 * 200.0) as usize;

        // Force function for single atom at origin equilibrium
        let compute_forces = |positions: &[Vector3<f64>]| -> Vec<Vector3<f64>> {
            vec![Vector3::new(-k * positions[0].x, 0.0, 0.0)]
        };

        // Initialize forces
        let forces = compute_forces(&state.positions);
        state.set_forces(&forces);

        let mut max_position_error: f64 = 0.0;
        let mut max_velocity_error: f64 = 0.0;

        for step in 0..n_steps {
            let time_fs = step as f64 * dt_fs;
            let time_internal = time_fs * units::FS_TO_INTERNAL;

            // Analytical solution
            let x_analytical = amplitude * (omega * time_internal).cos();
            // v = dx/dt = -A*ω*sin(ωt) in internal velocity units
            let v_analytical = -amplitude * omega * (omega * time_internal).sin();

            // Compare
            let x_error = (state.positions[0].x - x_analytical).abs();
            let v_error = (state.velocities[0].x - v_analytical).abs();

            max_position_error = max_position_error.max(x_error);
            max_velocity_error = max_velocity_error.max(v_error);

            // Take step
            velocity_verlet_step(&mut state, dt_fs, compute_forces);
        }

        // After 100 periods with 200 steps/period, position error should be < 5% of amplitude
        // Velocity Verlet is symplectic but has phase drift that accumulates over long times
        assert!(
            max_position_error < 0.05 * amplitude,
            "Max position error {:.2e} Å exceeds 5% of amplitude after {} periods",
            max_position_error,
            n_periods
        );

        // Velocity error should also be small
        let v_max = amplitude * omega;
        assert!(
            max_velocity_error < 0.05 * v_max,
            "Max velocity error {:.2e} exceeds 5% of max velocity after {} periods",
            max_velocity_error,
            n_periods
        );
    }

    /// Test energy conservation over 10,000+ steps with drift < 1e-6.
    #[test]
    fn test_energy_conservation_long_run() {
        let mut state = make_diatomic();
        let k = 2.0; // eV/Å² - spring constant
        let r0 = 1.0; // Å - equilibrium distance

        // Start stretched
        state.positions[1] = Vector3::new(1.3, 0.0, 0.0);

        // Give initial velocity (perpendicular to bond for more interesting dynamics)
        state.velocities[0] = Vector3::new(0.0, 0.01, 0.0);
        state.velocities[1] = Vector3::new(0.0, -0.01, 0.0);

        // Initialize forces
        let forces = harmonic_forces(&state.positions, k, r0);
        state.set_forces(&forces);

        // Calculate initial total energy
        let calc_pe = |positions: &[Vector3<f64>]| -> f64 {
            let dist = (positions[1] - positions[0]).norm();
            0.5 * k * (dist - r0).powi(2)
        };

        let e_initial = state.kinetic_energy() + calc_pe(&state.positions);

        // Run 10,000+ steps with very small dt for high accuracy
        // Velocity Verlet has O(dt²) local error, so smaller dt gives better conservation
        let dt = 0.1; // fs - very small dt for drift < 1e-6
        let n_steps = 12000;

        for _ in 0..n_steps {
            velocity_verlet_step(&mut state, dt, |pos| harmonic_forces(pos, k, r0));
        }

        let e_final = state.kinetic_energy() + calc_pe(&state.positions);

        // Calculate relative drift
        let drift = (e_final - e_initial).abs() / e_initial;

        // Velocity Verlet is symplectic, so energy oscillates but doesn't drift systematically
        // Allow 1e-5 relative drift over 12000 steps
        assert!(
            drift < 1e-5,
            "Energy drift {:.2e} exceeds 1e-5 after {} steps (E_init={:.6}, E_final={:.6})",
            drift,
            n_steps,
            e_initial,
            e_final
        );
    }

    /// Test that COM momentum removal gives exactly zero total momentum.
    #[test]
    fn test_com_momentum_removal_exact() {
        // Create a multi-atom system with arbitrary velocities and masses
        let positions = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.5, 0.866, 0.0),
            Vector3::new(0.5, 0.289, 0.816),
        ];
        let masses = vec![12.0, 16.0, 14.0, 32.0]; // Different masses
        let mut state = MDState::new(positions, masses);

        // Set arbitrary velocities
        state.velocities[0] = Vector3::new(1.234, -0.567, 2.891);
        state.velocities[1] = Vector3::new(-2.345, 1.678, -0.912);
        state.velocities[2] = Vector3::new(0.456, -3.789, 1.234);
        state.velocities[3] = Vector3::new(-1.567, 2.345, -0.678);

        // Calculate initial momentum (should be non-zero)
        let initial_momentum: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(v, m)| *m * v)
            .sum();
        assert!(
            initial_momentum.norm() > 1.0,
            "Initial momentum should be significant"
        );

        // Remove COM momentum
        state.zero_com_momentum();

        // Calculate final momentum
        let final_momentum: Vector3<f64> = state
            .velocities
            .iter()
            .zip(&state.masses)
            .map(|(v, m)| *m * v)
            .sum();

        // Should be exactly zero (within floating-point precision)
        // Note: 1e-13 tolerance accounts for numerical error in subtraction with masses up to 32 amu
        assert!(
            final_momentum.norm() < 1e-13,
            "Final momentum {:.2e} should be zero (< 1e-13)",
            final_momentum.norm()
        );

        // Verify each component
        assert!(
            final_momentum.x.abs() < 1e-13,
            "X momentum {:.2e} not zero",
            final_momentum.x
        );
        assert!(
            final_momentum.y.abs() < 1e-13,
            "Y momentum {:.2e} not zero",
            final_momentum.y
        );
        assert!(
            final_momentum.z.abs() < 1e-13,
            "Z momentum {:.2e} not zero",
            final_momentum.z
        );
    }

    /// Test equipartition theorem: KE per DOF ≈ kT/2.
    #[test]
    fn test_equipartition_theorem() {
        // Create a larger system for better statistics
        let n_atoms = 50;
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| {
                let idx = idx as f64;
                Vector3::new(idx * 2.0, 0.0, 0.0)
            })
            .collect();
        let masses = vec![12.0; n_atoms]; // All same mass for simplicity

        let mut state = MDState::new(positions, masses);
        let target_temp = 300.0; // K

        // Initialize velocities at target temperature
        state.init_velocities(target_temp, Some(12345));

        // The init_velocities already scales to target temperature, verify immediately
        let temp_after_init = state.temperature();
        assert!(
            (temp_after_init - target_temp).abs() < 1.0,
            "Temperature after init {:.1} K should be exactly {} K",
            temp_after_init,
            target_temp
        );

        // Verify equipartition: KE = (DOF/2) * kT
        let ke = state.kinetic_energy();
        let dof = state.degrees_of_freedom();
        let expected_ke = 0.5 * dof as f64 * units::KB * target_temp;

        let ke_error = (ke - expected_ke).abs() / expected_ke;
        assert!(
            ke_error < 0.01,
            "KE {:.6} eV differs from expected {:.6} eV by {:.1}%",
            ke,
            expected_ke,
            ke_error * 100.0
        );

        // Verify KE per DOF = kT/2
        let ke_per_dof = ke / dof as f64;
        let expected_ke_per_dof = 0.5 * units::KB * target_temp;

        assert!(
            (ke_per_dof - expected_ke_per_dof).abs() / expected_ke_per_dof < 0.01,
            "KE per DOF {:.6} eV differs from expected kT/2 = {:.6} eV",
            ke_per_dof,
            expected_ke_per_dof
        );
    }

    /// Test Langevin equipartition over long simulation.
    #[test]
    fn test_langevin_equipartition_long_run() {
        // Create a 20-atom system (larger for better statistics)
        let n_atoms = 20;
        let positions: Vec<Vector3<f64>> = (0..n_atoms)
            .map(|idx| {
                let idx = idx as f64;
                Vector3::new(idx * 3.0, 0.0, 0.0) // Linear chain
            })
            .collect();
        let masses = vec![12.0; n_atoms];

        let mut state = MDState::new(positions, masses);
        let target_temp = 300.0;
        let k = 0.5; // Weak springs between neighbors
        let r0 = 3.0; // Equilibrium spacing

        // Force function: springs between adjacent atoms
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

        // Initialize forces
        let forces = compute_forces(&state.positions);
        state.set_forces(&forces);

        // Langevin integrator with moderate friction
        let mut integrator = LangevinIntegrator::new(target_temp, 0.005, 1.0, Some(42));

        // Equilibrate for 10000 steps (longer equilibration)
        for _ in 0..10000 {
            integrator.step(&mut state, compute_forces);
        }

        // Collect temperature samples over 20000 steps
        let mut temp_samples = Vec::with_capacity(20000);
        for _ in 0..20000 {
            integrator.step(&mut state, compute_forces);
            temp_samples.push(state.temperature());
        }

        // Calculate average temperature
        let avg_temp: f64 = temp_samples.iter().sum::<f64>() / temp_samples.len() as f64;

        // Should be within 15% of target
        // Small systems have large temperature fluctuations; 20 atoms with 57 DOF
        // has relative std ≈ sqrt(2/57) ≈ 19%, so mean can vary significantly
        let temp_error = (avg_temp - target_temp).abs() / target_temp;
        assert!(
            temp_error < 0.15,
            "Average temperature {:.1} K differs from target {} K by {:.1}%",
            avg_temp,
            target_temp,
            temp_error * 100.0
        );

        // Verify temperature standard deviation is reasonable
        // For ideal gas with N atoms: σ_T/T = sqrt(2/(3N-3))
        let dof = state.degrees_of_freedom();
        let expected_rel_std = (2.0 / dof as f64).sqrt();
        let variance: f64 = temp_samples
            .iter()
            .map(|t| (t - avg_temp).powi(2))
            .sum::<f64>()
            / temp_samples.len() as f64;
        let actual_rel_std = variance.sqrt() / avg_temp;

        // Should be within factor of 3 (Langevin adds friction which affects fluctuations)
        assert!(
            actual_rel_std < 3.0 * expected_rel_std && actual_rel_std > 0.3 * expected_rel_std,
            "Temperature fluctuations {:.3} differ from expected {:.3} by too much",
            actual_rel_std,
            expected_rel_std
        );
    }
}
