//! Molecular dynamics state containers.

use nalgebra::{Matrix3, Vector3};
use rand::Rng;

use super::langevin::box_muller_normal;
use super::units;

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
        let mut rng = units::make_rng(seed);
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

/// Compute temperature in Kelvin.
///
/// Uses the equipartition theorem: E_kinetic = 0.5 * N_dof * k_B * T
/// with N_dof = 3N - 3 (translational DOF removed).
///
/// Returns 0.0 for systems with 0 or 1 atoms (no meaningful temperature).
pub fn temperature(state: &MDState) -> f64 {
    let n_atoms = state.num_atoms();
    if n_atoms <= 1 {
        return 0.0;
    }
    let ke = kinetic_energy(state);
    let n_dof = 3 * n_atoms - 3; // Remove COM
    2.0 * ke / (n_dof as f64 * units::KB)
}

/// Initialize velocities from Maxwell-Boltzmann distribution at given temperature.
///
/// Also removes center-of-mass motion.
pub fn init_velocities<R: Rng>(mut state: MDState, temperature_k: f64, rng: &mut R) -> MDState {
    // Skip for empty systems or zero temperature
    if state.num_atoms() == 0 || temperature_k <= 0.0 {
        return state;
    }

    // Maxwell-Boltzmann: sigma = sqrt(k_B * T / m)
    // Note: velocities are in internal units, so no explicit conversion needed
    for (idx, mass) in state.masses.iter().enumerate() {
        let sigma = (units::KB * temperature_k / mass).sqrt();
        state.velocities[idx] = Vector3::new(
            box_muller_normal(rng) * sigma,
            box_muller_normal(rng) * sigma,
            box_muller_normal(rng) * sigma,
        );
    }

    // Remove center-of-mass velocity
    remove_com_velocity(&mut state);

    state
}

/// Remove center-of-mass velocity from the system.
pub fn remove_com_velocity(state: &mut MDState) {
    if state.num_atoms() == 0 {
        return;
    }

    let total_mass: f64 = state.masses.iter().sum();

    let com_velocity: Vector3<f64> = state
        .velocities
        .iter()
        .zip(&state.masses)
        .map(|(vel, &mass)| vel * mass)
        .sum::<Vector3<f64>>()
        / total_mass;

    for vel in &mut state.velocities {
        *vel -= com_velocity;
    }
}
