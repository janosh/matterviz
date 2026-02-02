//! Classical interatomic potentials.
//!
//! This module provides native Rust implementations of classical force fields
//! for use in molecular dynamics and geometry optimization.
//!
//! Features:
//! - Per-element-pair parameters via `PairPotential<P>`
//! - Optional virial stress tensor calculation
//! - Lennard-Jones, Morse, Soft Sphere, and Harmonic potentials

use crate::error::{FerroxError, Result};
use nalgebra::{Matrix3, Vector3};
use std::collections::HashMap;

// === Common Types ===

/// Key for element pair (always ordered: min first for symmetry).
#[inline]
pub fn pair_key(z1: u8, z2: u8) -> (u8, u8) {
    if z1 <= z2 { (z1, z2) } else { (z2, z1) }
}

/// Generic pair parameter storage for element-specific interactions.
#[derive(Debug, Clone)]
pub struct PairPotential<P: Clone> {
    /// Element-pair specific parameters
    params: HashMap<(u8, u8), P>,
    /// Default parameters for pairs not explicitly set
    default: P,
    /// Cutoff distance in Angstrom
    pub cutoff: f64,
}

impl<P: Clone> PairPotential<P> {
    /// Create a new pair potential with default parameters.
    pub fn new(default: P, cutoff: f64) -> Self {
        Self {
            params: HashMap::new(),
            default,
            cutoff,
        }
    }

    /// Get parameters for a specific element pair.
    pub fn get(&self, z1: u8, z2: u8) -> &P {
        self.params.get(&pair_key(z1, z2)).unwrap_or(&self.default)
    }

    /// Set parameters for a specific element pair.
    pub fn set(&mut self, z1: u8, z2: u8, params: P) {
        self.params.insert(pair_key(z1, z2), params);
    }

    /// Get the default parameters.
    pub fn default_params(&self) -> &P {
        &self.default
    }
}

/// Result of potential energy/force calculation.
#[derive(Debug, Clone)]
pub struct PotentialResult {
    /// Total potential energy in eV
    pub energy: f64,
    /// Forces on each atom in eV/Angstrom (Nx3)
    pub forces: Vec<Vector3<f64>>,
    /// Virial stress tensor in eV/Å³ (optional, 3x3 symmetric)
    pub stress: Option<Matrix3<f64>>,
    /// Per-atom energies (optional)
    pub per_atom_energies: Option<Vec<f64>>,
}

// === Common Helpers ===

/// Apply minimum image convention to a displacement vector.
#[inline]
pub fn minimum_image(
    rij: Vector3<f64>,
    cell: Option<&Matrix3<f64>>,
    inv_cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
) -> Vector3<f64> {
    if let (Some(cell_mat), Some(inv)) = (cell, inv_cell) {
        let frac = inv * rij;
        let wrapped = Vector3::new(
            if pbc[0] {
                frac.x - frac.x.round()
            } else {
                frac.x
            },
            if pbc[1] {
                frac.y - frac.y.round()
            } else {
                frac.y
            },
            if pbc[2] {
                frac.z - frac.z.round()
            } else {
                frac.z
            },
        );
        cell_mat * wrapped
    } else {
        rij
    }
}

/// Initialize arrays for potential calculation.
#[inline]
fn init_potential_arrays(
    n_atoms: usize,
    compute_stress: bool,
) -> (Vec<Vector3<f64>>, Vec<f64>, Option<Matrix3<f64>>) {
    (
        vec![Vector3::zeros(); n_atoms],
        vec![0.0; n_atoms],
        if compute_stress {
            Some(Matrix3::zeros())
        } else {
            None
        },
    )
}

/// Finalize stress tensor by dividing by volume.
/// If no cell is provided, stress is set to None (can't compute without volume).
#[inline]
fn finalize_stress(stress: &mut Option<Matrix3<f64>>, cell: Option<&Matrix3<f64>>) {
    if let Some(s) = stress {
        if let Some(cell_mat) = cell {
            let volume = cell_mat.determinant().abs();
            if volume > 1e-10 {
                *s /= volume;
            }
        } else {
            // No cell means no volume - can't compute proper stress tensor
            *stress = None;
        }
    }
}

/// Add virial contribution to stress tensor: -r_ij ⊗ f_ij
#[inline]
fn add_virial_stress(
    stress: &mut Option<Matrix3<f64>>,
    rij: &Vector3<f64>,
    force_vec: &Vector3<f64>,
) {
    if let Some(s) = stress {
        for alpha in 0..3 {
            for beta in 0..3 {
                s[(alpha, beta)] -= rij[alpha] * force_vec[beta];
            }
        }
    }
}

/// Result of a single pair interaction calculation.
pub struct PairInteraction {
    /// Pair energy contribution
    pub energy: f64,
    /// Force magnitude times distance (force_vec = force_mag_r * rij / dist²)
    pub force_mag_r: f64,
}

/// Generic pair potential computation using a closure for the interaction.
///
/// This is the DRY core that all pair potentials can use.
///
/// # Arguments
/// * `positions` - Atomic positions
/// * `atomic_numbers` - Optional element numbers for per-pair parameters
/// * `cell` - Optional cell matrix
/// * `pbc` - Periodic boundary conditions
/// * `cutoff` - Cutoff distance
/// * `compute_stress` - Whether to compute stress tensor
/// * `interaction` - Closure (z_i, z_j, dist, dist_sq) -> Option<PairInteraction>
///
/// # Errors
/// - `FerroxError::InvalidStructure` if `atomic_numbers` length doesn't match `positions` length.
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if `cell` is provided but not invertible.
pub fn compute_pair_potential_generic<F>(
    positions: &[Vector3<f64>],
    atomic_numbers: Option<&[u8]>,
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    cutoff: f64,
    compute_stress: bool,
    mut interaction: F,
) -> Result<PotentialResult>
where
    F: FnMut(u8, u8, f64, f64) -> Option<PairInteraction>,
{
    // Guard: PBC requires a cell matrix
    if cell.is_none() && pbc.iter().any(|&enabled| enabled) {
        return Err(FerroxError::PbcWithoutCell);
    }

    let n_atoms = positions.len();

    // Validate atomic_numbers length if provided
    if let Some(z) = atomic_numbers
        && z.len() != n_atoms
    {
        return Err(FerroxError::InvalidStructure {
            index: 0,
            reason: format!(
                "atomic_numbers length ({}) must match positions length ({})",
                z.len(),
                n_atoms
            ),
        });
    }

    let mut energy = 0.0;
    let (mut forces, mut per_atom_energies, mut stress) =
        init_potential_arrays(n_atoms, compute_stress);

    let inv_cell = cell
        .map(|c| c.try_inverse().ok_or(FerroxError::SingularCell))
        .transpose()?;
    let cutoff_sq = cutoff * cutoff;

    for idx_i in 0..n_atoms {
        let z_i = atomic_numbers.map_or(0, |z| z[idx_i]);
        for idx_j in (idx_i + 1)..n_atoms {
            let z_j = atomic_numbers.map_or(0, |z| z[idx_j]);

            let rij = minimum_image(
                positions[idx_j] - positions[idx_i],
                cell,
                inv_cell.as_ref(),
                pbc,
            );

            let dist_sq = rij.norm_squared();
            if dist_sq > cutoff_sq {
                continue;
            }

            let dist = dist_sq.sqrt();
            if dist < 1e-10 {
                continue;
            }

            if let Some(pair) = interaction(z_i, z_j, dist, dist_sq) {
                energy += pair.energy;
                per_atom_energies[idx_i] += 0.5 * pair.energy;
                per_atom_energies[idx_j] += 0.5 * pair.energy;

                // force_vec = force_mag_r * rij / dist² (since rij has magnitude dist)
                let force_vec = (pair.force_mag_r / dist_sq) * rij;

                forces[idx_i] -= force_vec;
                forces[idx_j] += force_vec;

                add_virial_stress(&mut stress, &rij, &force_vec);
            }
        }
    }

    finalize_stress(&mut stress, cell);

    Ok(PotentialResult {
        energy,
        forces,
        stress,
        per_atom_energies: Some(per_atom_energies),
    })
}

// === Lennard-Jones Potential ===

/// Lennard-Jones pair parameters for use with `PairPotential<LJParams>`.
///
/// For simple single-species LJ, use `LennardJonesParams` instead.
#[derive(Debug, Clone, Copy)]
pub struct LJParams {
    /// Distance parameter sigma in Angstrom
    pub sigma: f64,
    /// Energy parameter epsilon in eV
    pub epsilon: f64,
}

impl Default for LJParams {
    fn default() -> Self {
        Self {
            sigma: 3.4,      // Typical for Ar
            epsilon: 0.0103, // ~0.0103 eV for Ar
        }
    }
}

impl LJParams {
    /// Create new LJ parameters.
    pub fn new(sigma: f64, epsilon: f64) -> Self {
        Self { sigma, epsilon }
    }

    /// Parameters for Argon.
    pub fn argon() -> Self {
        Self::default()
    }
}

/// Lennard-Jones potential parameters for simple single-species calculations.
///
/// For multi-species with per-element-pair parameters, use `PairPotential<LJParams>`.
#[derive(Debug, Clone, Copy)]
pub struct LennardJonesParams {
    /// Distance parameter sigma in Angstrom
    pub sigma: f64,
    /// Energy parameter epsilon in eV
    pub epsilon: f64,
    /// Cutoff distance in Angstrom (None = no cutoff)
    pub cutoff: Option<f64>,
}

impl Default for LennardJonesParams {
    fn default() -> Self {
        Self {
            sigma: 3.4,
            epsilon: 0.0103,
            cutoff: Some(10.0),
        }
    }
}

impl LennardJonesParams {
    /// Create new LJ parameters.
    pub fn new(sigma: f64, epsilon: f64, cutoff: Option<f64>) -> Self {
        Self {
            sigma,
            epsilon,
            cutoff,
        }
    }

    /// Create parameters for Argon.
    pub fn argon() -> Self {
        Self::default()
    }
}

/// Result of simple Lennard-Jones energy/force calculation (no stress tensor).
#[derive(Debug, Clone)]
pub struct LennardJonesResult {
    /// Total potential energy in eV
    pub energy: f64,
    /// Forces on each atom in eV/Angstrom
    pub forces: Vec<Vector3<f64>>,
    /// Per-atom energies
    pub per_atom_energies: Option<Vec<f64>>,
}

/// Compute Lennard-Jones energy and forces for a set of positions.
///
/// Uses minimum image convention for periodic systems.
///
/// # Arguments
/// * `positions` - Atomic positions in Angstrom (Nx3)
/// * `cell` - Optional 3x3 cell matrix (rows are lattice vectors)
/// * `pbc` - Periodic boundary conditions [x, y, z]
/// * `params` - LJ parameters
///
/// # Returns
/// Energy and forces
///
/// # Errors
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if `cell` is provided but not invertible.
pub fn compute_lennard_jones(
    positions: &[Vector3<f64>],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    params: &LennardJonesParams,
) -> Result<LennardJonesResult> {
    let result = compute_lj_full(positions, cell, pbc, params, false)?;
    Ok(LennardJonesResult {
        energy: result.energy,
        forces: result.forces,
        per_atom_energies: result.per_atom_energies,
    })
}

/// Compute LJ forces only.
///
/// # Errors
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if `cell` is provided but not invertible.
pub fn compute_lennard_jones_forces(
    positions: &[Vector3<f64>],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    params: &LennardJonesParams,
) -> Result<Vec<Vector3<f64>>> {
    Ok(compute_lennard_jones(positions, cell, pbc, params)?.forces)
}

/// Compute Lennard-Jones with optional stress tensor.
/// V(r) = 4ε[(σ/r)¹² - (σ/r)⁶]
///
/// # Errors
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if `cell` is provided but not invertible.
pub fn compute_lj_full(
    positions: &[Vector3<f64>],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    params: &LennardJonesParams,
    compute_stress: bool,
) -> Result<PotentialResult> {
    let sigma6 = params.sigma.powi(6);
    let sigma12 = sigma6 * sigma6;
    let epsilon = params.epsilon;
    let cutoff = params.cutoff.unwrap_or(f64::INFINITY);

    compute_pair_potential_generic(
        positions,
        None,
        cell,
        pbc,
        cutoff,
        compute_stress,
        |_, _, _dist, dist_sq| {
            let dist6_inv = 1.0 / (dist_sq * dist_sq * dist_sq);
            let dist12_inv = dist6_inv * dist6_inv;
            let energy = 4.0 * epsilon * (sigma12 * dist12_inv - sigma6 * dist6_inv);
            let force_mag_r = 24.0 * epsilon * (2.0 * sigma12 * dist12_inv - sigma6 * dist6_inv);
            Some(PairInteraction {
                energy,
                force_mag_r,
            })
        },
    )
}

/// Compute LJ with per-element-pair parameters.
///
/// # Errors
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if `cell` is provided but not invertible.
pub fn compute_lj_pair(
    positions: &[Vector3<f64>],
    atomic_numbers: &[u8],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    potential: &PairPotential<LJParams>,
    compute_stress: bool,
) -> Result<PotentialResult> {
    compute_pair_potential_generic(
        positions,
        Some(atomic_numbers),
        cell,
        pbc,
        potential.cutoff,
        compute_stress,
        |z_i, z_j, _dist, dist_sq| {
            let params = potential.get(z_i, z_j);
            let sigma6 = params.sigma.powi(6);
            let sigma12 = sigma6 * sigma6;
            let dist6_inv = 1.0 / (dist_sq * dist_sq * dist_sq);
            let dist12_inv = dist6_inv * dist6_inv;
            let energy = 4.0 * params.epsilon * (sigma12 * dist12_inv - sigma6 * dist6_inv);
            let force_mag_r =
                24.0 * params.epsilon * (2.0 * sigma12 * dist12_inv - sigma6 * dist6_inv);
            Some(PairInteraction {
                energy,
                force_mag_r,
            })
        },
    )
}

// === Morse Potential ===

/// Morse pair parameters: V(r) = D * (1 - exp(-alpha*(r - r0)))^2 - D
#[derive(Debug, Clone, Copy)]
pub struct MorseParams {
    /// Well depth in eV
    pub d: f64,
    /// Width parameter in 1/Angstrom
    pub alpha: f64,
    /// Equilibrium distance in Angstrom
    pub r0: f64,
}

impl Default for MorseParams {
    fn default() -> Self {
        Self {
            d: 1.0,
            alpha: 1.0,
            r0: 1.0,
        }
    }
}

impl MorseParams {
    /// Create new Morse parameters.
    pub fn new(d: f64, alpha: f64, r0: f64) -> Self {
        Self { d, alpha, r0 }
    }
}

/// Compute Morse potential energy and forces.
/// V(r) = D * (1 - exp(-alpha*(r - r0)))^2 - D
///
/// # Errors
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if `cell` is provided but not invertible.
pub fn compute_morse(
    positions: &[Vector3<f64>],
    atomic_numbers: &[u8],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    potential: &PairPotential<MorseParams>,
    compute_stress: bool,
) -> Result<PotentialResult> {
    compute_pair_potential_generic(
        positions,
        Some(atomic_numbers),
        cell,
        pbc,
        potential.cutoff,
        compute_stress,
        |z_i, z_j, dist, _dist_sq| {
            let params = potential.get(z_i, z_j);
            let exp_term = (-params.alpha * (dist - params.r0)).exp();
            let one_minus_exp = 1.0 - exp_term;
            let energy = params.d * one_minus_exp * one_minus_exp - params.d;
            // dV/dr = 2*D*alpha*(1-exp)*exp, force_mag_r = -dV/dr * dist
            let dvdr = 2.0 * params.d * params.alpha * one_minus_exp * exp_term;
            let force_mag_r = -dvdr * dist;
            Some(PairInteraction {
                energy,
                force_mag_r,
            })
        },
    )
}

/// Simple Morse computation without per-pair parameters.
///
/// # Errors
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if `cell` is provided but not invertible.
#[allow(clippy::too_many_arguments)]
pub fn compute_morse_simple(
    positions: &[Vector3<f64>],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    d: f64,
    alpha: f64,
    r0: f64,
    cutoff: f64,
    compute_stress: bool,
) -> Result<PotentialResult> {
    let dummy_z = vec![0u8; positions.len()];
    let potential = PairPotential::new(MorseParams::new(d, alpha, r0), cutoff);
    compute_morse(positions, &dummy_z, cell, pbc, &potential, compute_stress)
}

// === Soft Sphere Potential ===

/// Soft Sphere pair parameters: V(r) = epsilon * (sigma/r)^alpha
#[derive(Debug, Clone, Copy)]
pub struct SoftSphereParams {
    /// Length scale in Angstrom
    pub sigma: f64,
    /// Energy scale in eV
    pub epsilon: f64,
    /// Exponent (12 = hard, 2 = soft)
    pub alpha: f64,
}

impl Default for SoftSphereParams {
    fn default() -> Self {
        Self {
            sigma: 1.0,
            epsilon: 1.0,
            alpha: 12.0,
        }
    }
}

impl SoftSphereParams {
    /// Create new Soft Sphere parameters.
    pub fn new(sigma: f64, epsilon: f64, alpha: f64) -> Self {
        Self {
            sigma,
            epsilon,
            alpha,
        }
    }
}

/// Compute Soft Sphere potential energy and forces.
/// V(r) = epsilon * (sigma/r)^alpha
///
/// # Errors
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if `cell` is provided but not invertible.
pub fn compute_soft_sphere(
    positions: &[Vector3<f64>],
    atomic_numbers: &[u8],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    potential: &PairPotential<SoftSphereParams>,
    compute_stress: bool,
) -> Result<PotentialResult> {
    compute_pair_potential_generic(
        positions,
        Some(atomic_numbers),
        cell,
        pbc,
        potential.cutoff,
        compute_stress,
        |z_i, z_j, dist, _dist_sq| {
            let params = potential.get(z_i, z_j);
            let energy = params.epsilon * (params.sigma / dist).powf(params.alpha);
            // dV/dr = -alpha*V/r, force_mag_r = alpha*V (since force_vec = force_mag_r/dist² * rij)
            let force_mag_r = params.alpha * energy;
            Some(PairInteraction {
                energy,
                force_mag_r,
            })
        },
    )
}

/// Simple Soft Sphere computation without per-pair parameters.
///
/// # Errors
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if `cell` is provided but not invertible.
#[allow(clippy::too_many_arguments)]
pub fn compute_soft_sphere_simple(
    positions: &[Vector3<f64>],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    sigma: f64,
    epsilon: f64,
    alpha: f64,
    cutoff: f64,
    compute_stress: bool,
) -> Result<PotentialResult> {
    let dummy_z = vec![0u8; positions.len()];
    let potential = PairPotential::new(SoftSphereParams::new(sigma, epsilon, alpha), cutoff);
    compute_soft_sphere(positions, &dummy_z, cell, pbc, &potential, compute_stress)
}

// === Harmonic Bonds ===

/// A harmonic bond between two atoms.
#[derive(Debug, Clone, Copy)]
pub struct HarmonicBond {
    /// First atom index
    pub i: usize,
    /// Second atom index
    pub j: usize,
    /// Spring constant in eV/Å²
    pub k: f64,
    /// Equilibrium distance in Å
    pub r0: f64,
}

impl HarmonicBond {
    /// Create a new harmonic bond.
    pub fn new(i: usize, j: usize, k: f64, r0: f64) -> Self {
        Self { i, j, k, r0 }
    }
}

/// Compute harmonic bond energy and forces.
///
/// V = 0.5 * k * (r - r0)^2
/// F = -k * (r - r0) * r_hat
///
/// # Errors
/// - `FerroxError::PbcWithoutCell` if PBC is enabled but no cell matrix is provided.
/// - `FerroxError::SingularCell` if the cell matrix is singular (non-invertible).
/// - `FerroxError::InvalidStructure` if any bond index is out of bounds.
pub fn compute_harmonic_bonds(
    positions: &[Vector3<f64>],
    bonds: &[HarmonicBond],
    cell: Option<&Matrix3<f64>>,
    pbc: [bool; 3],
    compute_stress: bool,
) -> Result<PotentialResult> {
    // Guard: PBC requires a cell matrix
    if cell.is_none() && pbc.iter().any(|&enabled| enabled) {
        return Err(FerroxError::PbcWithoutCell);
    }

    let n_atoms = positions.len();
    let mut energy = 0.0;
    let (mut forces, mut per_atom_energies, mut stress) =
        init_potential_arrays(n_atoms, compute_stress);

    let inv_cell = cell
        .map(|c| c.try_inverse().ok_or(FerroxError::SingularCell))
        .transpose()?;

    for (bond_idx, bond) in bonds.iter().enumerate() {
        let idx_i = bond.i;
        let idx_j = bond.j;

        // Validate bond indices are within bounds
        if idx_i >= n_atoms {
            return Err(FerroxError::InvalidStructure {
                index: bond_idx,
                reason: format!("bond atom index i={idx_i} out of bounds (n_atoms={n_atoms})"),
            });
        }
        if idx_j >= n_atoms {
            return Err(FerroxError::InvalidStructure {
                index: bond_idx,
                reason: format!("bond atom index j={idx_j} out of bounds (n_atoms={n_atoms})"),
            });
        }

        let rij = minimum_image(
            positions[idx_j] - positions[idx_i],
            cell,
            inv_cell.as_ref(),
            pbc,
        );

        let dist = rij.norm();
        if dist < 1e-10 {
            continue;
        }

        let spring_k = bond.k;
        let eq_dist = bond.r0;
        let delta_r = dist - eq_dist;

        // V = 0.5 * k * dr^2
        let pair_energy = 0.5 * spring_k * delta_r * delta_r;
        energy += pair_energy;
        per_atom_energies[idx_i] += 0.5 * pair_energy;
        per_atom_energies[idx_j] += 0.5 * pair_energy;

        // F = -k * dr * r_hat = -k * dr / r * rij
        let force_mag = -spring_k * delta_r / dist;
        let force_vec = force_mag * rij;

        forces[idx_i] -= force_vec;
        forces[idx_j] += force_vec;

        add_virial_stress(&mut stress, &rij, &force_vec);
    }

    finalize_stress(&mut stress, cell);

    Ok(PotentialResult {
        energy,
        forces,
        stress,
        per_atom_energies: Some(per_atom_energies),
    })
}

// === Tests ===

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    // === Test Helpers ===

    // Helper: check momentum conservation (Newton's 3rd law)
    fn assert_momentum_conserved(forces: &[Vector3<f64>]) {
        let total: Vector3<f64> = forces.iter().sum();
        assert_relative_eq!(total.norm(), 0.0, epsilon = 1e-10);
    }

    // Helper: check stress tensor symmetry
    fn assert_stress_symmetric(stress: &Matrix3<f64>) {
        assert_relative_eq!(stress[(0, 1)], stress[(1, 0)], epsilon = 1e-14);
        assert_relative_eq!(stress[(0, 2)], stress[(2, 0)], epsilon = 1e-14);
        assert_relative_eq!(stress[(1, 2)], stress[(2, 1)], epsilon = 1e-14);
    }

    // Helper: two-atom positions at given distance
    fn two_atoms(dist: f64) -> Vec<Vector3<f64>> {
        vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(dist, 0.0, 0.0)]
    }

    // Helper: three-atom configuration for multi-body tests
    fn three_atoms() -> Vec<Vector3<f64>> {
        vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.5, 0.8, 0.0),
        ]
    }

    // Helper: FCC unit cell positions
    fn fcc_positions(lattice_a: f64) -> Vec<Vector3<f64>> {
        vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.0, 0.5 * lattice_a, 0.5 * lattice_a),
            Vector3::new(0.5 * lattice_a, 0.0, 0.5 * lattice_a),
            Vector3::new(0.5 * lattice_a, 0.5 * lattice_a, 0.0),
        ]
    }

    // Helper: asymmetric 4-atom configuration for stress tests
    fn asymmetric_positions() -> Vec<Vector3<f64>> {
        vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.5, 0.8, 0.3),
            Vector3::new(2.5, 1.2, 0.6),
            Vector3::new(0.5, 2.0, 1.0),
        ]
    }

    // === LJ Tests ===

    #[test]
    fn test_lj_special_distances() {
        // At r = σ, energy = 0; at r = 2^(1/6)σ, energy = -ε and force = 0
        let params = LennardJonesParams::new(1.0, 1.0, None);

        // r = σ: V = 4ε(1 - 1) = 0
        let result = compute_lennard_jones(&two_atoms(1.0), None, [false; 3], &params).unwrap();
        assert_relative_eq!(result.energy, 0.0, epsilon = 1e-10);

        // r = 2^(1/6)σ: equilibrium, V = -ε, F = 0
        let r_eq = 2.0_f64.powf(1.0 / 6.0);
        let result = compute_lennard_jones(&two_atoms(r_eq), None, [false; 3], &params).unwrap();
        assert_relative_eq!(result.energy, -1.0, epsilon = 1e-10);
        assert_relative_eq!(result.forces[0].norm(), 0.0, epsilon = 1e-10);
    }

    #[test]
    fn test_repulsive_force_direction() {
        // At short distances: atom 0 pushed left (F<0), atom 1 pushed right (F>0)
        let z = vec![0u8; 2];

        // LJ at r < r_eq
        let lj = compute_lennard_jones(
            &two_atoms(0.9),
            None,
            [false; 3],
            &LennardJonesParams::new(1.0, 1.0, None),
        )
        .unwrap();
        assert!(lj.forces[0].x < 0.0 && lj.forces[1].x > 0.0, "LJ repulsive");

        // Morse at r < r0
        let morse = compute_morse(
            &two_atoms(1.0),
            &z,
            None,
            [false; 3],
            &PairPotential::new(MorseParams::new(1.0, 1.0, 1.5), 10.0),
            false,
        )
        .unwrap();
        assert!(
            morse.forces[0].x < 0.0 && morse.forces[1].x > 0.0,
            "Morse repulsive"
        );

        // Soft sphere (always repulsive)
        let ss = compute_soft_sphere(
            &two_atoms(0.5),
            &z,
            None,
            [false; 3],
            &PairPotential::new(SoftSphereParams::new(1.0, 1.0, 2.0), 10.0),
            false,
        )
        .unwrap();
        assert!(
            ss.forces[0].x < 0.0 && ss.forces[1].x > 0.0,
            "Soft sphere repulsive"
        );
    }

    #[test]
    fn test_lj_cutoff() {
        let params = LennardJonesParams::new(1.0, 1.0, Some(2.0));
        let result = compute_lennard_jones(&two_atoms(3.0), None, [false; 3], &params).unwrap();
        assert_relative_eq!(result.energy, 0.0, epsilon = 1e-10);
    }

    #[test]
    fn test_lj_periodic() {
        let params = LennardJonesParams::new(1.0, 1.0, None);
        let cell = Matrix3::from_diagonal(&Vector3::new(5.0, 5.0, 5.0));
        let positions = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(4.5, 0.0, 0.0)];
        let result = compute_lennard_jones(&positions, Some(&cell), [true; 3], &params).unwrap();
        // Minimum image distance is 0.5
        let expected = 4.0 * (1.0 / 0.5_f64.powi(12) - 1.0 / 0.5_f64.powi(6));
        assert_relative_eq!(result.energy, expected, epsilon = 1e-10);
    }

    #[test]
    fn test_lj_argon_fcc() {
        // FCC Ar at experimental lattice constant should have negative energy and small forces
        let params = LennardJonesParams::argon(); // σ=3.4, ε=0.0103 eV
        let lattice_a = 5.26;
        let cell = Matrix3::from_diagonal(&Vector3::new(lattice_a, lattice_a, lattice_a));
        let result =
            compute_lennard_jones(&fcc_positions(lattice_a), Some(&cell), [true; 3], &params)
                .unwrap();
        // Energy should be negative (bound state) - actual ~-0.06 eV for 4-atom cell
        assert!(
            result.energy < 0.0 && result.energy > -0.5,
            "Energy {} not in expected range",
            result.energy
        );
        let max_force = result.forces.iter().map(|f| f.norm()).fold(0.0, f64::max);
        assert!(
            max_force < 0.02,
            "Max force {max_force} should be small near equilibrium"
        );
    }

    #[test]
    fn test_momentum_conservation_all_potentials() {
        // Newton's 3rd law: total force must be zero for all potentials
        let pos = three_atoms();
        let z = vec![0u8; 3];

        // LJ
        let lj = compute_lennard_jones(
            &pos,
            None,
            [false; 3],
            &LennardJonesParams::new(1.0, 1.0, None),
        )
        .unwrap();
        assert_momentum_conserved(&lj.forces);

        // Morse
        let morse = compute_morse(
            &pos,
            &z,
            None,
            [false; 3],
            &PairPotential::new(MorseParams::new(1.0, 1.0, 1.5), 10.0),
            false,
        )
        .unwrap();
        assert_momentum_conserved(&morse.forces);

        // Soft sphere
        let ss = compute_soft_sphere(
            &pos,
            &z,
            None,
            [false; 3],
            &PairPotential::new(SoftSphereParams::new(1.0, 1.0, 6.0), 10.0),
            false,
        )
        .unwrap();
        assert_momentum_conserved(&ss.forces);

        // Harmonic
        let bonds = vec![
            HarmonicBond::new(0, 1, 1.0, 0.8),
            HarmonicBond::new(1, 2, 1.0, 0.9),
        ];
        let harm = compute_harmonic_bonds(&pos, &bonds, None, [false; 3], false).unwrap();
        assert_momentum_conserved(&harm.forces);
    }

    #[test]
    fn test_lj_stress_tensor() {
        let params = LennardJonesParams::new(1.0, 1.0, Some(5.0));
        let cell = Matrix3::from_diagonal(&Vector3::new(6.0, 3.0, 3.0));
        let result =
            compute_lj_full(&two_atoms(3.0), Some(&cell), [true; 3], &params, true).unwrap();
        let stress = result.stress.unwrap();
        assert_stress_symmetric(&stress);
        assert!(stress[(0, 0)].abs() > 1e-10); // 1D chain has non-zero xx stress
    }

    #[test]
    fn test_lj_per_pair_params() {
        let mut potential = PairPotential::new(LJParams::new(1.0, 1.0), 10.0);
        potential.set(18, 36, LJParams::new(3.6, 0.015)); // Ar-Kr
        let dist = 3.5;
        let result = compute_lj_pair(
            &two_atoms(dist),
            &[18, 36],
            None,
            [false; 3],
            &potential,
            false,
        )
        .unwrap();
        // Verify Ar-Kr params (σ=3.6, ε=0.015) are used, not default (σ=1, ε=1)
        let s6 = (3.6 / dist).powi(6);
        let expected = 4.0 * 0.015 * (s6 * s6 - s6);
        assert_relative_eq!(result.energy, expected, epsilon = 1e-12);
    }

    // === Morse Tests ===

    #[test]
    fn test_morse_equilibrium() {
        // At r = r0: V = -D, F = 0
        let potential = PairPotential::new(MorseParams::new(1.0, 1.0, 1.5), 10.0);
        let result = compute_morse(
            &two_atoms(1.5),
            &[0, 0],
            None,
            [false; 3],
            &potential,
            false,
        )
        .unwrap();
        assert_relative_eq!(result.energy, -1.0, epsilon = 1e-10);
        assert_relative_eq!(result.forces[0].norm(), 0.0, epsilon = 1e-10);
    }

    #[test]
    fn test_morse_asymptotic() {
        // At large r, energy → 0
        let potential = PairPotential::new(MorseParams::new(1.0, 2.0, 1.0), 100.0);
        let result = compute_morse(
            &two_atoms(20.0),
            &[0, 0],
            None,
            [false; 3],
            &potential,
            false,
        )
        .unwrap();
        assert_relative_eq!(result.energy, 0.0, epsilon = 1e-6);
    }

    // === Soft Sphere Tests ===

    #[test]
    fn test_soft_sphere_energy() {
        // At r = σ: V = ε
        let potential = PairPotential::new(SoftSphereParams::new(1.0, 1.0, 12.0), 10.0);
        let result = compute_soft_sphere(
            &two_atoms(1.0),
            &[0, 0],
            None,
            [false; 3],
            &potential,
            false,
        )
        .unwrap();
        assert_relative_eq!(result.energy, 1.0, epsilon = 1e-10);
    }

    // === Harmonic Bond Tests ===

    #[test]
    fn test_harmonic_equilibrium() {
        let bonds = vec![HarmonicBond::new(0, 1, 1.0, 1.5)];
        let result =
            compute_harmonic_bonds(&two_atoms(1.5), &bonds, None, [false; 3], false).unwrap();
        assert_relative_eq!(result.energy, 0.0, epsilon = 1e-10);
        assert_relative_eq!(result.forces[0].norm(), 0.0, epsilon = 1e-10);
    }

    #[test]
    fn test_harmonic_stretched_and_compressed() {
        // Stretched: r = 2, r0 = 1, k = 2 → V = 0.5*2*1 = 1, attractive
        let bonds = vec![HarmonicBond::new(0, 1, 2.0, 1.0)];
        let result =
            compute_harmonic_bonds(&two_atoms(2.0), &bonds, None, [false; 3], false).unwrap();
        assert_relative_eq!(result.energy, 1.0, epsilon = 1e-10);
        assert!(result.forces[0].x > 0.0 && result.forces[1].x < 0.0); // Attractive

        // Compressed: r = 0.5, r0 = 1 → V = 0.5*2*0.25 = 0.25, repulsive
        let result =
            compute_harmonic_bonds(&two_atoms(0.5), &bonds, None, [false; 3], false).unwrap();
        assert_relative_eq!(result.energy, 0.25, epsilon = 1e-10);
        assert!(result.forces[0].x < 0.0 && result.forces[1].x > 0.0); // Repulsive
    }

    // === Finite Difference Force Validation ===

    #[test]
    fn test_finite_difference_all_potentials() {
        // F = -dE/dr validated for all potentials
        let delta = 1e-6;
        let z = vec![0u8; 2];

        // Helper to compute FD force and compare
        let check_fd = |e0: f64, e1: f64, analytical: f64| {
            let fd = -(e1 - e0) / delta;
            assert!(
                (fd - analytical).abs() < 1e-5,
                "FD={fd:.6} vs analytical={analytical:.6}"
            );
        };

        // LJ at dist=1.5
        let lj_params = LennardJonesParams::new(1.0, 1.0, Some(5.0));
        let lj0 = compute_lennard_jones(&two_atoms(1.5), None, [false; 3], &lj_params).unwrap();
        let lj1 =
            compute_lennard_jones(&two_atoms(1.5 + delta), None, [false; 3], &lj_params).unwrap();
        check_fd(lj0.energy, lj1.energy, lj0.forces[1].x);

        // Morse at dist=1.8
        let morse_pot = PairPotential::new(MorseParams::new(1.0, 2.0, 1.5), 10.0);
        let m0 = compute_morse(&two_atoms(1.8), &z, None, [false; 3], &morse_pot, false).unwrap();
        let m1 = compute_morse(
            &two_atoms(1.8 + delta),
            &z,
            None,
            [false; 3],
            &morse_pot,
            false,
        )
        .unwrap();
        check_fd(m0.energy, m1.energy, m0.forces[1].x);

        // Soft sphere at dist=1.5
        let ss_pot = PairPotential::new(SoftSphereParams::new(1.0, 1.0, 6.0), 10.0);
        let s0 =
            compute_soft_sphere(&two_atoms(1.5), &z, None, [false; 3], &ss_pot, false).unwrap();
        let s1 = compute_soft_sphere(
            &two_atoms(1.5 + delta),
            &z,
            None,
            [false; 3],
            &ss_pot,
            false,
        )
        .unwrap();
        check_fd(s0.energy, s1.energy, s0.forces[1].x);

        // Harmonic at dist=1.8
        let bonds = vec![HarmonicBond::new(0, 1, 2.0, 1.5)];
        let h0 = compute_harmonic_bonds(&two_atoms(1.8), &bonds, None, [false; 3], false).unwrap();
        let h1 = compute_harmonic_bonds(&two_atoms(1.8 + delta), &bonds, None, [false; 3], false)
            .unwrap();
        check_fd(h0.energy, h1.energy, h0.forces[1].x);

        // 3D check (all axes) for LJ
        let base = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.2, 0.8, 0.5)];
        let params = LennardJonesParams::new(1.0, 1.0, None);
        let result = compute_lennard_jones(&base, None, [false; 3], &params).unwrap();
        for axis in 0..3 {
            let mut pos_plus = base.clone();
            pos_plus[1][axis] += 1e-7;
            let e_plus = compute_lennard_jones(&pos_plus, None, [false; 3], &params)
                .unwrap()
                .energy;
            let fd = -(e_plus - result.energy) / 1e-7;
            assert!((fd - result.forces[1][axis]).abs() < 1e-5);
        }
    }

    // === Analytical Reference Values ===

    #[test]
    fn test_lj_analytical_values() {
        // V = 4ε[(σ/r)^12 - (σ/r)^6], F = 24ε/r[2(σ/r)^12 - (σ/r)^6]
        let params = LennardJonesParams::new(1.0, 1.0, None);
        for dist in [0.9, 1.0, 1.122462, 1.5, 2.0, 3.0] {
            let result =
                compute_lennard_jones(&two_atoms(dist), None, [false; 3], &params).unwrap();
            let s6 = (1.0 / dist).powi(6);
            let s12 = s6 * s6;
            assert!((result.energy - 4.0 * (s12 - s6)).abs() < 1e-12);
            assert!((result.forces[1].x - 24.0 / dist * (2.0 * s12 - s6)).abs() < 1e-12);
        }
    }

    #[test]
    fn test_morse_analytical_values() {
        // V = D(1-exp(-α(r-r0)))² - D
        let (d, alpha, r0) = (2.0, 1.5, 1.2);
        let potential = PairPotential::new(MorseParams::new(d, alpha, r0), 20.0);
        for dist in [0.8, 1.0, 1.2, 1.5, 2.0, 3.0] {
            let result = compute_morse(
                &two_atoms(dist),
                &[0, 0],
                None,
                [false; 3],
                &potential,
                false,
            )
            .unwrap();
            let exp_term = (-alpha * (dist - r0)).exp();
            let one_minus = 1.0 - exp_term;
            assert!((result.energy - (d * one_minus * one_minus - d)).abs() < 1e-12);
            assert!((result.forces[1].x - (-2.0 * d * alpha * one_minus * exp_term)).abs() < 1e-12);
        }
    }

    #[test]
    fn test_soft_sphere_analytical_values() {
        // V = ε(σ/r)^α, F = αε(σ^α)/r^(α+1)
        let (sigma, eps, alpha) = (1.5, 0.5, 8.0);
        let potential = PairPotential::new(SoftSphereParams::new(sigma, eps, alpha), 20.0);
        for dist in [1.0, 1.5, 2.0, 3.0] {
            let result = compute_soft_sphere(
                &two_atoms(dist),
                &[0, 0],
                None,
                [false; 3],
                &potential,
                false,
            )
            .unwrap();
            let expected_e = eps * (sigma / dist).powf(alpha);
            let expected_f = alpha * eps * sigma.powf(alpha) / dist.powf(alpha + 1.0);
            assert!((result.energy - expected_e).abs() < 1e-12);
            assert!((result.forces[1].x - expected_f).abs() < 1e-10);
        }
    }

    #[test]
    fn test_lj_per_atom_energies_sum() {
        let params = LennardJonesParams::new(1.0, 1.0, Some(10.0));
        let lattice_a = 2.0;
        let cell = Matrix3::from_diagonal(&Vector3::new(lattice_a, lattice_a, lattice_a));
        let result = compute_lj_full(
            &fcc_positions(lattice_a),
            Some(&cell),
            [true; 3],
            &params,
            false,
        )
        .unwrap();
        let per_atom_sum: f64 = result.per_atom_energies.as_ref().unwrap().iter().sum();
        assert_relative_eq!(result.energy, per_atom_sum, epsilon = 1e-10);
    }

    #[test]
    fn test_generic_pair_potential_matches_specialized() {
        let (sigma, eps, cutoff) = (3.4, 0.0103, 10.0);
        let params = LennardJonesParams::new(sigma, eps, Some(cutoff));
        let positions = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(3.0, 0.0, 0.0),
            Vector3::new(0.0, 4.0, 0.0),
        ];
        let specialized = compute_lennard_jones(&positions, None, [false; 3], &params).unwrap();
        let (s6, s12) = (sigma.powi(6), sigma.powi(12));
        let generic = compute_pair_potential_generic(
            &positions,
            None,
            None,
            [false; 3],
            cutoff,
            false,
            |_, _, _, dist_sq| {
                let d6_inv = 1.0 / (dist_sq * dist_sq * dist_sq);
                let d12_inv = d6_inv * d6_inv;
                Some(PairInteraction {
                    energy: 4.0 * eps * (s12 * d12_inv - s6 * d6_inv),
                    force_mag_r: 24.0 * eps * (2.0 * s12 * d12_inv - s6 * d6_inv),
                })
            },
        )
        .unwrap();
        assert_relative_eq!(generic.energy, specialized.energy, epsilon = 1e-12);
    }

    // === Stress Symmetry Tests (consolidated) ===

    #[test]
    fn test_stress_symmetry_all_potentials() {
        let cell = Matrix3::from_diagonal(&Vector3::new(5.0, 5.0, 5.0));
        let pos = asymmetric_positions();
        let z = vec![0u8; 4];

        // LJ
        let lj = compute_lj_full(
            &pos,
            Some(&cell),
            [true; 3],
            &LennardJonesParams::new(1.0, 1.0, Some(5.0)),
            true,
        )
        .unwrap();
        assert_stress_symmetric(&lj.stress.unwrap());

        // Morse
        let morse = compute_morse(
            &pos,
            &z,
            Some(&cell),
            [true; 3],
            &PairPotential::new(MorseParams::new(1.0, 1.5, 1.2), 10.0),
            true,
        )
        .unwrap();
        assert_stress_symmetric(&morse.stress.unwrap());

        // Soft sphere
        let ss = compute_soft_sphere(
            &pos,
            &z,
            Some(&cell),
            [true; 3],
            &PairPotential::new(SoftSphereParams::new(1.0, 1.0, 6.0), 10.0),
            true,
        )
        .unwrap();
        assert_stress_symmetric(&ss.stress.unwrap());

        // Harmonic (3 atoms with 2 bonds)
        let pos3 = vec![pos[0], pos[1], pos[2]];
        let bonds = vec![
            HarmonicBond::new(0, 1, 1.0, 1.0),
            HarmonicBond::new(1, 2, 1.0, 1.0),
        ];
        let harm = compute_harmonic_bonds(&pos3, &bonds, Some(&cell), [true; 3], true).unwrap();
        assert_stress_symmetric(&harm.stress.unwrap());
    }

    #[test]
    fn test_lj_stress_vs_numerical_derivative() {
        let params = LennardJonesParams::new(1.0, 1.0, Some(5.0));
        let lattice_a = 4.0;
        let positions = fcc_positions(lattice_a);
        let cell = Matrix3::from_diagonal(&Vector3::new(lattice_a, lattice_a, lattice_a));

        let result = compute_lj_full(&positions, Some(&cell), [true; 3], &params, true).unwrap();
        let stress = result.stress.unwrap();

        // Apply isotropic strain
        let delta = 1e-6;
        let strain = 1.0 + delta;
        let cell_s = cell * strain;
        let pos_s: Vec<_> = positions.iter().map(|p| p * strain).collect();
        let result_s = compute_lj_full(&pos_s, Some(&cell_s), [true; 3], &params, false).unwrap();

        let de_dv = (result_s.energy - result.energy)
            / (cell_s.determinant().abs() - cell.determinant().abs());
        let stress_trace = (stress[(0, 0)] + stress[(1, 1)] + stress[(2, 2)]) / 3.0;

        // Check magnitudes are consistent
        assert!(
            (de_dv.abs() - stress_trace.abs()).abs()
                < 0.5 * (de_dv.abs() + stress_trace.abs()).max(0.01)
        );
    }

    // === Edge Case Tests (coverage gaps) ===

    #[test]
    fn test_empty_positions() {
        // All potentials should handle empty input gracefully
        let empty: Vec<Vector3<f64>> = vec![];
        let params = LennardJonesParams::new(1.0, 1.0, None);

        let lj = compute_lennard_jones(&empty, None, [false; 3], &params).unwrap();
        assert_eq!(lj.energy, 0.0);
        assert!(lj.forces.is_empty());

        let morse =
            compute_morse_simple(&empty, None, [false; 3], 1.0, 1.0, 1.0, 10.0, false).unwrap();
        assert_eq!(morse.energy, 0.0);

        let ss = compute_soft_sphere_simple(&empty, None, [false; 3], 1.0, 1.0, 6.0, 10.0, false)
            .unwrap();
        assert_eq!(ss.energy, 0.0);

        let harm = compute_harmonic_bonds(&empty, &[], None, [false; 3], false).unwrap();
        assert_eq!(harm.energy, 0.0);
    }

    #[test]
    fn test_single_atom() {
        // Single atom has no pairs - energy should be zero
        let single = vec![Vector3::new(1.0, 2.0, 3.0)];
        let params = LennardJonesParams::new(1.0, 1.0, None);

        let result = compute_lennard_jones(&single, None, [false; 3], &params).unwrap();
        assert_eq!(result.energy, 0.0);
        assert_eq!(result.forces.len(), 1);
        assert_eq!(result.forces[0], Vector3::zeros());
    }

    #[test]
    fn test_atoms_at_same_position() {
        // Atoms at same position (dist < 1e-10) should be skipped, not cause NaN/Inf
        let coincident = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.0, 0.0, 0.0)];
        let params = LennardJonesParams::new(1.0, 1.0, None);

        let result = compute_lennard_jones(&coincident, None, [false; 3], &params).unwrap();
        assert_eq!(result.energy, 0.0);
        assert!(result.forces[0].norm().is_finite());
        assert!(result.forces[1].norm().is_finite());
    }

    #[test]
    fn test_atoms_very_close() {
        // Atoms just above the 1e-10 threshold should compute (large but finite values)
        // Using 1e-8 which is well above 1e-10 but still very small
        let very_close = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1e-8, 0.0, 0.0)];
        let params = LennardJonesParams::new(1.0, 1.0, None);

        let result = compute_lennard_jones(&very_close, None, [false; 3], &params).unwrap();
        assert!(result.energy.is_finite());
        assert!(
            result.energy != 0.0,
            "Should compute energy for dist > 1e-10"
        );
        assert!(result.forces[0].norm().is_finite());
        assert!(
            result.forces[0].norm() > 0.0,
            "Should compute forces for dist > 1e-10"
        );
    }

    #[test]
    fn test_cutoff_boundary_exact() {
        // At exactly cutoff: pair should be included (<=)
        // Just beyond cutoff: pair should be excluded
        let cutoff = 2.5;
        let params = LennardJonesParams::new(1.0, 1.0, Some(cutoff));

        // Exactly at cutoff
        let at_cutoff = two_atoms(cutoff);
        let result = compute_lennard_jones(&at_cutoff, None, [false; 3], &params).unwrap();
        assert!(
            result.energy != 0.0,
            "Pair at exactly cutoff should be included"
        );

        // Just beyond cutoff
        let beyond = two_atoms(cutoff + 1e-10);
        let result = compute_lennard_jones(&beyond, None, [false; 3], &params).unwrap();
        assert_eq!(result.energy, 0.0, "Pair beyond cutoff should be excluded");
    }

    #[test]
    fn test_mixed_pbc() {
        // Periodic in some directions, not others
        let cell = Matrix3::from_diagonal(&Vector3::new(5.0, 5.0, 5.0));
        let params = LennardJonesParams::new(1.0, 1.0, None);

        // Atoms far apart in x (4.5), close in real space only via PBC
        let positions = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(4.5, 0.0, 0.0)];

        // With PBC in x: minimum image distance is 0.5
        let pbc_x =
            compute_lennard_jones(&positions, Some(&cell), [true, false, false], &params).unwrap();
        let expected_e = 4.0 * (1.0 / 0.5_f64.powi(12) - 1.0 / 0.5_f64.powi(6));
        assert_relative_eq!(pbc_x.energy, expected_e, epsilon = 1e-10);

        // Without PBC in x: real distance is 4.5
        let no_pbc_x =
            compute_lennard_jones(&positions, Some(&cell), [false, true, true], &params).unwrap();
        let expected_e_no = 4.0 * (1.0 / 4.5_f64.powi(12) - 1.0 / 4.5_f64.powi(6));
        assert_relative_eq!(no_pbc_x.energy, expected_e_no, epsilon = 1e-10);
    }

    #[test]
    fn test_triclinic_cell() {
        // Non-orthorhombic cell (off-diagonal elements)
        let params = LennardJonesParams::new(1.0, 1.0, None);

        // Triclinic cell: a along x, b tilted in xy plane, c tilted in xz
        #[rustfmt::skip]
        let cell = Matrix3::new(
            5.0, 0.0, 0.0,   // a vector
            1.0, 5.0, 0.0,   // b vector (tilted)
            0.5, 0.0, 5.0,   // c vector (tilted)
        );

        let positions = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(2.0, 0.0, 0.0)];
        let result = compute_lj_full(&positions, Some(&cell), [true; 3], &params, true).unwrap();

        // Should compute without panic and give finite results
        assert!(result.energy.is_finite());
        assert!(result.stress.unwrap().iter().all(|x| x.is_finite()));
        assert_momentum_conserved(&result.forces);
    }

    #[test]
    fn test_harmonic_bond_indices_order() {
        // Bond (0, 1) and (1, 0) should give same result
        let positions = two_atoms(1.5);
        let bonds_01 = vec![HarmonicBond::new(0, 1, 1.0, 1.0)];
        let bonds_10 = vec![HarmonicBond::new(1, 0, 1.0, 1.0)];

        let result_01 =
            compute_harmonic_bonds(&positions, &bonds_01, None, [false; 3], false).unwrap();
        let result_10 =
            compute_harmonic_bonds(&positions, &bonds_10, None, [false; 3], false).unwrap();

        assert_relative_eq!(result_01.energy, result_10.energy, epsilon = 1e-14);
        // Forces should be equal (Newton's 3rd law preserved either way)
        assert_relative_eq!(
            result_01.forces[0].norm(),
            result_10.forces[0].norm(),
            epsilon = 1e-14
        );
    }

    #[test]
    fn test_per_atom_energies_symmetry() {
        // In FCC, all atoms have identical local environment → equal per-atom energies
        let params = LennardJonesParams::new(1.0, 1.0, Some(10.0));
        let lattice_a = 2.0;
        let cell = Matrix3::from_diagonal(&Vector3::new(lattice_a, lattice_a, lattice_a));

        let result = compute_lj_full(
            &fcc_positions(lattice_a),
            Some(&cell),
            [true; 3],
            &params,
            false,
        )
        .unwrap();
        let energies = result.per_atom_energies.unwrap();

        // FCC has 4 equivalent sites - all per-atom energies should be equal
        let mean = energies.iter().sum::<f64>() / energies.len() as f64;
        for energy in &energies {
            assert_relative_eq!(*energy, mean, epsilon = 1e-12);
        }
    }

    #[test]
    fn test_stress_requires_cell() {
        // Stress computation without a cell returns None (can't normalize without volume)
        let params = LennardJonesParams::new(1.0, 1.0, None);
        let result = compute_lj_full(&two_atoms(1.5), None, [false; 3], &params, true).unwrap();
        assert!(
            result.stress.is_none(),
            "Stress should be None without cell (no volume for normalization)"
        );

        // With a cell, stress should be computed
        let cell = Matrix3::from_diagonal(&Vector3::new(5.0, 5.0, 5.0));
        let result_with_cell =
            compute_lj_full(&two_atoms(1.5), Some(&cell), [true; 3], &params, true).unwrap();
        assert!(result_with_cell.stress.is_some());
        assert_stress_symmetric(&result_with_cell.stress.unwrap());
    }

    #[test]
    fn test_no_stress_when_disabled() {
        // When compute_stress=false, stress should be None
        let params = LennardJonesParams::new(1.0, 1.0, None);
        let result = compute_lj_full(&two_atoms(1.5), None, [false; 3], &params, false).unwrap();
        assert!(result.stress.is_none());
    }

    #[test]
    fn test_translational_invariance() {
        // Energy and forces should be invariant under rigid translation
        let params = LennardJonesParams::new(1.0, 1.0, None);
        let original = three_atoms();
        let translated: Vec<_> = original
            .iter()
            .map(|p| p + Vector3::new(100.0, -50.0, 25.0))
            .collect();

        let result_orig = compute_lennard_jones(&original, None, [false; 3], &params).unwrap();
        let result_trans = compute_lennard_jones(&translated, None, [false; 3], &params).unwrap();

        assert_relative_eq!(result_orig.energy, result_trans.energy, epsilon = 1e-10);
        for idx in 0..3 {
            assert_relative_eq!(
                result_orig.forces[idx].norm(),
                result_trans.forces[idx].norm(),
                epsilon = 1e-10
            );
        }
    }

    #[test]
    fn test_multiple_harmonic_bonds_same_atom() {
        // An atom can participate in multiple bonds
        let positions = vec![
            Vector3::new(0.0, 0.0, 0.0), // Central atom
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
        ];
        let bonds = vec![
            HarmonicBond::new(0, 1, 1.0, 1.0),
            HarmonicBond::new(0, 2, 1.0, 1.0),
            HarmonicBond::new(0, 3, 1.0, 1.0),
        ];

        let result = compute_harmonic_bonds(&positions, &bonds, None, [false; 3], false).unwrap();

        // All bonds at equilibrium, so energy should be 0
        assert_relative_eq!(result.energy, 0.0, epsilon = 1e-12);
        // Central atom should have zero net force (symmetric)
        assert_relative_eq!(result.forces[0].norm(), 0.0, epsilon = 1e-12);
    }

    #[test]
    fn test_harmonic_bond_index_out_of_bounds() {
        let positions = two_atoms(1.5);
        // Bond with invalid index (only 2 atoms, but referencing index 5)
        let invalid_bonds = vec![HarmonicBond::new(0, 5, 1.0, 1.5)];
        let result = compute_harmonic_bonds(&positions, &invalid_bonds, None, [false; 3], false);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("out of bounds"));
        assert!(err_msg.contains("j=5"));

        // Also test invalid first index
        let invalid_bonds_i = vec![HarmonicBond::new(10, 1, 1.0, 1.5)];
        let result_i =
            compute_harmonic_bonds(&positions, &invalid_bonds_i, None, [false; 3], false);
        assert!(result_i.is_err());
        let err_msg_i = result_i.unwrap_err().to_string();
        assert!(err_msg_i.contains("out of bounds"));
        assert!(err_msg_i.contains("i=10"));
    }

    #[test]
    fn test_singular_cell_returns_error() {
        let positions = two_atoms(3.0);
        let singular_cell = Matrix3::zeros(); // All zeros = singular
        let params = LennardJonesParams::new(3.4, 0.0103, Some(10.0));
        let result = compute_lj_full(&positions, Some(&singular_cell), [true; 3], &params, false);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), FerroxError::SingularCell));

        // Also test harmonic bonds with singular cell
        let bonds = vec![HarmonicBond::new(0, 1, 1.0, 3.0)];
        let result_bonds =
            compute_harmonic_bonds(&positions, &bonds, Some(&singular_cell), [true; 3], false);
        assert!(result_bonds.is_err());
        assert!(matches!(
            result_bonds.unwrap_err(),
            FerroxError::SingularCell
        ));
    }

    #[test]
    fn test_pbc_without_cell_returns_error() {
        let positions = two_atoms(3.0);
        let bonds = vec![HarmonicBond::new(0, 1, 1.0, 3.0)];

        // PBC enabled but no cell provided should return error
        let result = compute_harmonic_bonds(&positions, &bonds, None, [true, false, false], false);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), FerroxError::PbcWithoutCell));

        // All PBC enabled, no cell
        let result_all =
            compute_harmonic_bonds(&positions, &bonds, None, [true, true, true], false);
        assert!(result_all.is_err());
        assert!(matches!(
            result_all.unwrap_err(),
            FerroxError::PbcWithoutCell
        ));

        // No PBC, no cell should work fine
        let result_no_pbc =
            compute_harmonic_bonds(&positions, &bonds, None, [false, false, false], false);
        assert!(result_no_pbc.is_ok());
    }

    #[test]
    fn test_atomic_numbers_length_mismatch_returns_error() {
        let positions = two_atoms(3.0); // 2 atoms
        let wrong_length_z = vec![0u8, 1, 2]; // 3 elements - mismatch!

        let potential = PairPotential::new(LJParams::default(), 10.0);
        let result = compute_lj_pair(
            &positions,
            &wrong_length_z,
            None,
            [false; 3],
            &potential,
            false,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, FerroxError::InvalidStructure { .. }));
        assert!(err.to_string().contains("atomic_numbers length"));
    }
}
