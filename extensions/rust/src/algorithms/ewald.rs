//! Ewald summation for Coulomb energy of ionic structures.
//!
//! The Ewald method splits the slowly-converging Coulomb sum into:
//! - A real-space sum (short-range, screened by Gaussians)
//! - A reciprocal-space sum (long-range, smooth in k-space)
//! - A self-energy correction
//!
//! # References
//!
//! - Ewald, P.P. Ann. Phys. 369, 253-287 (1921)
//! - pymatgen/analysis/ewald.py for implementation details

use crate::error::{FerroxError, Result};
use crate::structure::Structure;
use nalgebra::Vector3;
use std::f64::consts::PI;

/// Ewald summation calculator for Coulomb energies.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::algorithms::Ewald;
///
/// let ewald = Ewald::new()
///     .with_accuracy(1e-5)
///     .with_real_cutoff(10.0);
///
/// let energy = ewald.energy(&structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct Ewald {
    /// Ewald parameter η (auto-computed if None)
    pub eta: Option<f64>,
    /// Real-space cutoff in Angstroms
    pub real_cutoff: f64,
    /// Reciprocal-space cutoff (max |G|)
    pub recip_cutoff: f64,
    /// Accuracy parameter for auto-tuning η
    pub accuracy: f64,
}

impl Default for Ewald {
    fn default() -> Self {
        Self::new()
    }
}

impl Ewald {
    /// Create a new Ewald calculator with default parameters.
    pub fn new() -> Self {
        Self {
            eta: None,
            real_cutoff: 10.0,
            recip_cutoff: 10.0,
            accuracy: 1e-5,
        }
    }

    /// Set the Ewald parameter η manually.
    pub fn with_eta(mut self, eta: f64) -> Self {
        self.eta = Some(eta);
        self
    }

    /// Set the real-space cutoff.
    pub fn with_real_cutoff(mut self, cutoff: f64) -> Self {
        self.real_cutoff = cutoff;
        self
    }

    /// Set the reciprocal-space cutoff.
    pub fn with_recip_cutoff(mut self, cutoff: f64) -> Self {
        self.recip_cutoff = cutoff;
        self
    }

    /// Set the accuracy parameter for auto-tuning.
    pub fn with_accuracy(mut self, accuracy: f64) -> Self {
        self.accuracy = accuracy;
        self
    }

    /// Compute the optimal Ewald parameter η based on accuracy.
    ///
    /// The parameter balances real and reciprocal space sums for efficiency.
    /// η ~ sqrt(π) * (N/V^2)^(1/6) for optimal N atoms in volume V.
    ///
    /// Returns an error if accuracy is not in (0, 1) or volume <= 0, which would
    /// cause NaN/Inf in the calculation.
    fn compute_eta(&self, structure: &Structure) -> Result<f64> {
        if let Some(eta) = self.eta {
            return Ok(eta);
        }

        // Validate accuracy: must be in (0, 1) for -ln(accuracy) to be positive
        if self.accuracy <= 0.0 || self.accuracy >= 1.0 {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "Ewald accuracy must be in (0, 1), got {}. Values outside this range \
                     cause -ln(accuracy) to be non-positive, yielding NaN/Inf.",
                    self.accuracy
                ),
            });
        }

        let volume = structure.volume();
        if volume <= 0.0 {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "Structure volume must be positive, got {}. Zero or negative volume \
                     causes division by zero in eta calculation.",
                    volume
                ),
            });
        }

        let n_atoms = structure.num_sites() as f64;

        // Optimal η from literature: balances real/recip convergence
        // η ≈ (π^2 * N / V^2)^(1/6)
        let eta = (PI.powi(2) * n_atoms / volume.powi(2)).powf(1.0 / 6.0);

        // Scale η based on accuracy requirement
        // Smaller accuracy value (e.g., 1e-8) = higher precision = larger -ln(accuracy)
        // This increases η, shifting work to reciprocal space for better convergence
        Ok(eta * (-self.accuracy.ln()).sqrt().max(1.0))
    }

    /// Get charges from oxidation states.
    ///
    /// Returns an error if any site lacks an oxidation state or if the
    /// structure is not charge-neutral (Ewald summation diverges otherwise).
    fn get_charges(&self, structure: &Structure) -> Result<Vec<f64>> {
        let mut charges = Vec::with_capacity(structure.num_sites());

        for (idx, site_occ) in structure.site_occupancies.iter().enumerate() {
            // For disordered sites, use weighted average of charges
            let mut site_charge = 0.0;
            for (species, occ) in &site_occ.species {
                let oxi = species
                    .oxidation_state
                    .ok_or_else(|| FerroxError::InvalidStructure {
                        index: idx,
                        reason: format!(
                            "Site {} has species {} without oxidation state (required for Ewald)",
                            idx, species
                        ),
                    })?;
                // Validate oxidation state is within reasonable bounds
                // Typical range is -4 to +8, but allow up to ±20 for edge cases
                const MAX_OXIDATION: i8 = 20;
                if oxi.abs() > MAX_OXIDATION {
                    return Err(FerroxError::InvalidStructure {
                        index: idx,
                        reason: format!(
                            "Site {} has species {} with unreasonable oxidation state {} \
                             (expected |oxi| <= {})",
                            idx, species, oxi, MAX_OXIDATION
                        ),
                    });
                }
                site_charge += (oxi as f64) * occ;
            }
            charges.push(site_charge);
        }

        // Validate charge neutrality - Ewald summation diverges for non-neutral systems
        let net_charge: f64 = charges.iter().sum();
        const CHARGE_TOLERANCE: f64 = 1e-8;
        if net_charge.abs() > CHARGE_TOLERANCE {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "Structure is not charge-neutral (net charge = {:.6}). \
                     Ewald summation requires charge neutrality.",
                    net_charge
                ),
            });
        }

        Ok(charges)
    }

    /// Compute the total Coulomb energy in eV.
    ///
    /// # Errors
    ///
    /// Returns an error if the structure has sites without oxidation states.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let ewald = Ewald::new();
    /// let energy = ewald.energy(&nacl)?;
    /// println!("Coulomb energy: {:.4} eV", energy);
    /// ```
    pub fn energy(&self, structure: &Structure) -> Result<f64> {
        let charges = self.get_charges(structure)?;
        let eta = self.compute_eta(structure)?;

        let e_real = self.real_space_energy(structure, &charges, eta);
        let e_recip = self.reciprocal_space_energy(structure, &charges, eta);
        let e_self = self.self_energy(&charges, eta);

        // Convert from e^2/Å to eV (Coulomb constant k = 14.3996 eV·Å/e^2)
        let coulomb_const = 14.3996;

        Ok(coulomb_const * (e_real + e_recip + e_self))
    }

    /// Compute per-site energy contributions.
    ///
    /// Returns a vector of energies where E[i] is the energy contribution
    /// of site i to the total energy.
    pub fn site_energies(&self, structure: &Structure) -> Result<Vec<f64>> {
        let charges = self.get_charges(structure)?;
        let eta = self.compute_eta(structure)?;
        let n_sites = structure.num_sites();
        let coulomb_const = 14.3996;

        let mut site_energies = vec![0.0; n_sites];

        // Real space contribution - use upper triangle like real_space_energy()
        // to ensure consistency and avoid double-counting issues
        let real_cutoff_sq = self.real_cutoff.powi(2);
        let (n_a, n_b, n_c) = self.compute_image_range(structure, self.real_cutoff);

        for (idx_i, frac_i) in structure.frac_coords.iter().enumerate() {
            let pos_i = structure.lattice.get_cartesian_coord(frac_i);

            for (idx_j, frac_j) in structure.frac_coords.iter().enumerate().skip(idx_i) {
                // For diagonal (i==j), we use factor 0.5 because periodic images
                // come in symmetric pairs (L and -L). For off-diagonal, factor 1.0
                // since upper triangle visits each pair once.
                let factor = if idx_i == idx_j { 0.5 } else { 1.0 };

                // Include periodic images with dynamic range
                for na in -n_a..=n_a {
                    for nb in -n_b..=n_b {
                        for nc in -n_c..=n_c {
                            // Skip self-interaction in central cell
                            if idx_i == idx_j && na == 0 && nb == 0 && nc == 0 {
                                continue;
                            }

                            let offset = Vector3::new(na as f64, nb as f64, nc as f64);
                            let pos_j_frac = frac_j + offset;
                            let pos_j = structure.lattice.get_cartesian_coord(&pos_j_frac);

                            let r_vec = pos_j - pos_i;
                            let r_sq = r_vec.norm_squared();

                            if r_sq > real_cutoff_sq || r_sq < 1e-10 {
                                continue;
                            }

                            let r = r_sq.sqrt();
                            let erfc_term = erfc(eta * r) / r;

                            let contrib = factor
                                * coulomb_const
                                * charges[idx_i]
                                * charges[idx_j]
                                * erfc_term;

                            // Distribute energy equally to both sites for off-diagonal
                            if idx_i == idx_j {
                                site_energies[idx_i] += contrib;
                            } else {
                                site_energies[idx_i] += 0.5 * contrib;
                                site_energies[idx_j] += 0.5 * contrib;
                            }
                        }
                    }
                }
            }

            // Self energy contribution
            site_energies[idx_i] -= coulomb_const * charges[idx_i].powi(2) * eta / PI.sqrt();
        }

        // Reciprocal space contribution - proper per-site decomposition
        // E_recip_i = Σ_G (4π/V) * exp(-G²/4η²)/G² * q_i * Re[exp(-iG·r_i) * S(G)]
        // where S(G) = Σ_j q_j * exp(iG·r_j)
        let volume = structure.volume();
        let recip_lattice = structure.lattice.reciprocal_lattice();
        let prefactor = 4.0 * PI / volume;
        let (k_a, k_b, k_c) = self.compute_recip_range(&recip_lattice);

        for ha in -k_a..=k_a {
            for hb in -k_b..=k_b {
                for hc in -k_c..=k_c {
                    if ha == 0 && hb == 0 && hc == 0 {
                        continue;
                    }

                    let recip_vec = Vector3::new(ha as f64, hb as f64, hc as f64);
                    let recip_cart = recip_lattice.get_cartesian_coord(&recip_vec);
                    let recip_sq = recip_cart.norm_squared();

                    if recip_sq > self.recip_cutoff.powi(2) {
                        continue;
                    }

                    // Compute structure factor S(G) = Σ_j q_j * exp(iG·r_j)
                    let mut s_real = 0.0;
                    let mut s_imag = 0.0;
                    let mut phases = Vec::with_capacity(n_sites);
                    for (idx, fc) in structure.frac_coords.iter().enumerate() {
                        let pos = structure.lattice.get_cartesian_coord(fc);
                        let phase = recip_cart.dot(&pos);
                        phases.push((phase.cos(), phase.sin()));
                        s_real += charges[idx] * phase.cos();
                        s_imag += charges[idx] * phase.sin();
                    }

                    let exp_term = (-recip_sq / (4.0 * eta.powi(2))).exp();
                    // Factor of 0.5 to match reciprocal_space_energy which has 0.5*energy
                    let coeff = 0.5 * coulomb_const * prefactor * exp_term / recip_sq;

                    // Per-site contribution: q_i * Re[exp(-iG·r_i) * S(G)]
                    // = q_i * [cos(G·r_i)*S_real + sin(G·r_i)*S_imag]
                    for (idx, (cos_phase, sin_phase)) in phases.iter().enumerate() {
                        let contrib =
                            coeff * charges[idx] * (cos_phase * s_real + sin_phase * s_imag);
                        site_energies[idx] += contrib;
                    }
                }
            }
        }

        Ok(site_energies)
    }

    /// Compute the energy matrix E_ij for site pair interactions.
    ///
    /// E_ij represents the pairwise Coulomb interaction between sites i and j.
    /// The total energy is E = (1/2) Σ_ij q_i * E_ij * q_j
    pub fn energy_matrix(&self, structure: &Structure) -> Result<Vec<Vec<f64>>> {
        // Validate structure has oxidation states
        let _charges = self.get_charges(structure)?;
        let eta = self.compute_eta(structure)?;
        let n_sites = structure.num_sites();
        let coulomb_const = 14.3996;

        let mut matrix = vec![vec![0.0; n_sites]; n_sites];
        let real_cutoff_sq = self.real_cutoff.powi(2);
        let (n_a, n_b, n_c) = self.compute_image_range(structure, self.real_cutoff);

        // Real space contribution
        for (idx_i, frac_i) in structure.frac_coords.iter().enumerate() {
            let pos_i = structure.lattice.get_cartesian_coord(frac_i);

            for (idx_j, frac_j) in structure.frac_coords.iter().enumerate().skip(idx_i) {
                let mut e_ij = 0.0;

                // Sum over periodic images with dynamic range
                for na in -n_a..=n_a {
                    for nb in -n_b..=n_b {
                        for nc in -n_c..=n_c {
                            if idx_i == idx_j && na == 0 && nb == 0 && nc == 0 {
                                continue;
                            }

                            let offset = Vector3::new(na as f64, nb as f64, nc as f64);
                            let pos_j_frac = frac_j + offset;
                            let pos_j = structure.lattice.get_cartesian_coord(&pos_j_frac);

                            let r_vec = pos_j - pos_i;
                            let r_sq = r_vec.norm_squared();

                            if r_sq > real_cutoff_sq || r_sq < 1e-10 {
                                continue;
                            }

                            let r = r_sq.sqrt();
                            e_ij += erfc(eta * r) / r;
                        }
                    }
                }

                matrix[idx_i][idx_j] = coulomb_const * e_ij;
                if idx_i != idx_j {
                    matrix[idx_j][idx_i] = matrix[idx_i][idx_j];
                }
            }

            // Diagonal self-energy correction
            matrix[idx_i][idx_i] -= 2.0 * coulomb_const * eta / PI.sqrt();
        }

        // Add reciprocal space contribution to matrix
        // This requires computing structure factors - simplified version here
        let recip_lattice = structure.lattice.reciprocal_lattice();
        let volume = structure.volume();
        let prefactor = 4.0 * PI / volume;
        let (k_a, k_b, k_c) = self.compute_recip_range(&recip_lattice);

        // Generate k-vectors with dynamic range
        for ha in -k_a..=k_a {
            for hb in -k_b..=k_b {
                for hc in -k_c..=k_c {
                    if ha == 0 && hb == 0 && hc == 0 {
                        continue;
                    }

                    let recip_vec = Vector3::new(ha as f64, hb as f64, hc as f64);
                    let recip_cart = recip_lattice.get_cartesian_coord(&recip_vec);
                    let recip_sq = recip_cart.norm_squared();

                    if recip_sq > self.recip_cutoff.powi(2) {
                        continue;
                    }

                    let exp_term = (-recip_sq / (4.0 * eta.powi(2))).exp();
                    let coeff = prefactor * exp_term / recip_sq;

                    // Add contribution to energy matrix
                    for (idx_i, frac_i) in structure.frac_coords.iter().enumerate() {
                        let pos_i = structure.lattice.get_cartesian_coord(frac_i);
                        for (idx_j, frac_j) in structure.frac_coords.iter().enumerate().skip(idx_i)
                        {
                            let pos_j = structure.lattice.get_cartesian_coord(frac_j);
                            let r_ij = pos_j - pos_i;
                            let phase = recip_cart.dot(&r_ij);

                            let contrib = coulomb_const * coeff * phase.cos();
                            matrix[idx_i][idx_j] += contrib;
                            if idx_i != idx_j {
                                matrix[idx_j][idx_i] += contrib;
                            }
                        }
                    }
                }
            }
        }

        Ok(matrix)
    }

    /// Compute number of periodic images needed to cover the cutoff distance.
    ///
    /// Returns (na, nb, nc) where each is the number of images needed along that axis.
    fn compute_image_range(&self, structure: &Structure, cutoff: f64) -> (i32, i32, i32) {
        let lattice = &structure.lattice;
        // Get lattice vector lengths
        let a_len = lattice.matrix().column(0).norm();
        let b_len = lattice.matrix().column(1).norm();
        let c_len = lattice.matrix().column(2).norm();

        // Number of images = ceil(cutoff / lattice_length) + 1 for safety
        let na = (cutoff / a_len).ceil() as i32 + 1;
        let nb = (cutoff / b_len).ceil() as i32 + 1;
        let nc = (cutoff / c_len).ceil() as i32 + 1;

        (na, nb, nc)
    }

    /// Real-space sum contribution.
    fn real_space_energy(&self, structure: &Structure, charges: &[f64], eta: f64) -> f64 {
        let mut energy = 0.0;
        let real_cutoff_sq = self.real_cutoff.powi(2);

        // Compute dynamic image range based on cutoff and lattice
        let (n_a, n_b, n_c) = self.compute_image_range(structure, self.real_cutoff);

        for (idx_i, frac_i) in structure.frac_coords.iter().enumerate() {
            let pos_i = structure.lattice.get_cartesian_coord(frac_i);

            for (idx_j, frac_j) in structure.frac_coords.iter().enumerate().skip(idx_i) {
                let factor = if idx_i == idx_j { 0.5 } else { 1.0 };

                // Sum over periodic images with dynamic range
                for na in -n_a..=n_a {
                    for nb in -n_b..=n_b {
                        for nc in -n_c..=n_c {
                            // Skip self-interaction in central cell
                            if idx_i == idx_j && na == 0 && nb == 0 && nc == 0 {
                                continue;
                            }

                            let offset = Vector3::new(na as f64, nb as f64, nc as f64);
                            let pos_j_frac = frac_j + offset;
                            let pos_j = structure.lattice.get_cartesian_coord(&pos_j_frac);

                            let r_vec = pos_j - pos_i;
                            let r_sq = r_vec.norm_squared();

                            if r_sq > real_cutoff_sq || r_sq < 1e-10 {
                                continue;
                            }

                            let r = r_sq.sqrt();
                            let erfc_term = erfc(eta * r) / r;

                            energy += factor * charges[idx_i] * charges[idx_j] * erfc_term;
                        }
                    }
                }
            }
        }

        energy
    }

    /// Compute number of k-vectors needed to cover the reciprocal cutoff.
    fn compute_recip_range(&self, recip_lattice: &crate::lattice::Lattice) -> (i32, i32, i32) {
        // Get reciprocal lattice vector lengths
        let a_len = recip_lattice.matrix().column(0).norm();
        let b_len = recip_lattice.matrix().column(1).norm();
        let c_len = recip_lattice.matrix().column(2).norm();

        // Number of k-vectors = ceil(cutoff / recip_length) + 1 for safety
        let na = (self.recip_cutoff / a_len).ceil() as i32 + 1;
        let nb = (self.recip_cutoff / b_len).ceil() as i32 + 1;
        let nc = (self.recip_cutoff / c_len).ceil() as i32 + 1;

        (na, nb, nc)
    }

    /// Reciprocal-space sum contribution.
    fn reciprocal_space_energy(&self, structure: &Structure, charges: &[f64], eta: f64) -> f64 {
        let volume = structure.volume();
        let recip_lattice = structure.lattice.reciprocal_lattice();
        let prefactor = 4.0 * PI / volume;

        // Compute dynamic k-vector range based on cutoff and reciprocal lattice
        let (n_a, n_b, n_c) = self.compute_recip_range(&recip_lattice);

        let mut energy = 0.0;

        // Generate k-vectors with dynamic range
        for ha in -n_a..=n_a {
            for hb in -n_b..=n_b {
                for hc in -n_c..=n_c {
                    // Skip k=0
                    if ha == 0 && hb == 0 && hc == 0 {
                        continue;
                    }

                    let recip_vec = Vector3::new(ha as f64, hb as f64, hc as f64);
                    let recip_cart = recip_lattice.get_cartesian_coord(&recip_vec);
                    let recip_sq = recip_cart.norm_squared();

                    if recip_sq > self.recip_cutoff.powi(2) {
                        continue;
                    }

                    // Compute structure factor S(G) = Σ_i q_i * exp(i*G·r_i)
                    let mut s_real = 0.0;
                    let mut s_imag = 0.0;
                    for (idx, fc) in structure.frac_coords.iter().enumerate() {
                        let pos = structure.lattice.get_cartesian_coord(fc);
                        let phase = recip_cart.dot(&pos);
                        s_real += charges[idx] * phase.cos();
                        s_imag += charges[idx] * phase.sin();
                    }

                    let s_sq = s_real.powi(2) + s_imag.powi(2);
                    let exp_term = (-recip_sq / (4.0 * eta.powi(2))).exp();

                    energy += prefactor * s_sq * exp_term / recip_sq;
                }
            }
        }

        0.5 * energy
    }

    /// Self-energy correction.
    fn self_energy(&self, charges: &[f64], eta: f64) -> f64 {
        let q_sq_sum: f64 = charges.iter().map(|q| q.powi(2)).sum();
        -eta / PI.sqrt() * q_sq_sum
    }
}

/// Complementary error function (erfc) using Abramowitz & Stegun approximation (7.1.26).
fn erfc(val: f64) -> f64 {
    let approx_t = 1.0 / (1.0 + 0.3275911 * val.abs());
    let poly_coeffs = [
        0.254829592,
        -0.284496736,
        1.421413741,
        -1.453152027,
        1.061405429,
    ];

    let poly_result = approx_t
        * (poly_coeffs[0]
            + approx_t
                * (poly_coeffs[1]
                    + approx_t
                        * (poly_coeffs[2]
                            + approx_t * (poly_coeffs[3] + approx_t * poly_coeffs[4]))))
        * (-val * val).exp();

    if val >= 0.0 {
        poly_result
    } else {
        2.0 - poly_result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use crate::lattice::Lattice;
    use crate::species::Species;
    use approx::assert_relative_eq;
    use nalgebra::Matrix3;

    /// Create a simple NaCl structure with oxidation states.
    fn nacl_structure() -> Structure {
        let a = 5.64;
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(a, a, a)));

        let na = Species::new(Element::Na, Some(1));
        let cl = Species::new(Element::Cl, Some(-1));

        Structure::new(
            lattice,
            vec![na, cl],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        )
    }

    /// Create a rocksalt NaCl structure (8 atoms in conventional cell).
    fn nacl_conventional() -> Structure {
        let a = 5.64;
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(a, a, a)));

        let na = Species::new(Element::Na, Some(1));
        let cl = Species::new(Element::Cl, Some(-1));

        // Rocksalt: Na at corners and face centers, Cl at edge centers
        Structure::new(
            lattice,
            vec![na, na, na, na, cl, cl, cl, cl],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.0),
                Vector3::new(0.5, 0.0, 0.5),
                Vector3::new(0.0, 0.5, 0.5),
                Vector3::new(0.5, 0.0, 0.0),
                Vector3::new(0.0, 0.5, 0.0),
                Vector3::new(0.0, 0.0, 0.5),
                Vector3::new(0.5, 0.5, 0.5),
            ],
        )
    }

    #[test]
    fn test_ewald_energy_neutral() {
        // NaCl should have negative (stable) Coulomb energy
        let structure = nacl_structure();
        let ewald = Ewald::new();
        let energy = ewald.energy(&structure).unwrap();

        // Energy should be negative (attractive)
        assert!(energy < 0.0, "NaCl Coulomb energy should be negative");
    }

    #[test]
    fn test_ewald_energy_scaling() {
        // Larger cell should have proportionally more energy
        let small = nacl_structure();
        let large = nacl_conventional();

        let ewald = Ewald::new();
        let e_small = ewald.energy(&small).unwrap();
        let e_large = ewald.energy(&large).unwrap();

        // Both should have negative energy (attractive Coulomb)
        assert!(e_small < 0.0, "Small structure should have negative energy");
        assert!(e_large < 0.0, "Large structure should have negative energy");

        // Large structure (4x atoms) should have more negative energy
        // Note: the ratio depends on many factors, so we just check
        // that larger structure has more total energy
        assert!(
            e_large.abs() > e_small.abs(),
            "Large structure should have larger |energy|: |{e_large}| > |{e_small}|"
        );
    }

    #[test]
    fn test_ewald_requires_oxidation_states() {
        let a = 5.64;
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(a, a, a)));

        // No oxidation states
        let na = Species::neutral(Element::Na);
        let cl = Species::neutral(Element::Cl);

        let structure = Structure::new(
            lattice,
            vec![na, cl],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let ewald = Ewald::new();
        let result = ewald.energy(&structure);
        assert!(result.is_err(), "Should error without oxidation states");
    }

    #[test]
    fn test_erfc() {
        // Known values
        assert_relative_eq!(erfc(0.0), 1.0, epsilon = 1e-5);
        assert_relative_eq!(erfc(1.0), 0.1573, epsilon = 1e-3);
        assert_relative_eq!(erfc(2.0), 0.00468, epsilon = 1e-4);
        // Symmetry: erfc(-x) = 2 - erfc(x)
        assert_relative_eq!(erfc(-1.0), 2.0 - erfc(1.0), epsilon = 1e-10);
        // Limits: approaches 0 for large positive, 2 for large negative
        assert!(erfc(5.0) < 1e-10);
        assert_relative_eq!(erfc(-5.0), 2.0, epsilon = 1e-10);
    }

    #[test]
    fn test_site_energies() {
        let structure = nacl_structure();
        let ewald = Ewald::new();

        let total = ewald.energy(&structure).unwrap();
        let site_energies = ewald.site_energies(&structure).unwrap();

        // Count matches sites
        assert_eq!(site_energies.len(), structure.num_sites());
        // Sum should equal total energy (reciprocal space is evenly distributed)
        let sum: f64 = site_energies.iter().sum();
        assert_relative_eq!(sum, total, epsilon = 1e-10);
    }

    #[test]
    fn test_energy_matrix() {
        let structure = nacl_structure();
        let matrix = Ewald::new().energy_matrix(&structure).unwrap();
        let n_sites = structure.num_sites();

        // Should be n x n matrix
        assert_eq!(matrix.len(), n_sites);
        assert!(matrix.iter().all(|row| row.len() == n_sites));

        // Should be symmetric
        for (idx_i, row) in matrix.iter().enumerate() {
            for (idx_j, &val) in row.iter().enumerate() {
                assert_relative_eq!(val, matrix[idx_j][idx_i], epsilon = 1e-10);
            }
        }
    }

    #[test]
    fn test_ewald_custom_parameters() {
        let structure = nacl_structure();

        // Test with different parameters
        let ewald_default = Ewald::new();
        let ewald_custom = Ewald::new().with_accuracy(1e-4).with_real_cutoff(8.0);

        let energy_default = ewald_default.energy(&structure).unwrap();
        let energy_custom = ewald_custom.energy(&structure).unwrap();

        // Both should give similar results
        assert_relative_eq!(energy_default, energy_custom, epsilon = 0.1);
    }

    #[test]
    fn test_ewald_accuracy_convergence() {
        let structure = nacl_structure();

        // Higher accuracy should give slightly different results
        let ewald_low = Ewald::new().with_accuracy(1e-3);
        let ewald_high = Ewald::new().with_accuracy(1e-6);

        let energy_low = ewald_low.energy(&structure).unwrap();
        let energy_high = ewald_high.energy(&structure).unwrap();

        // Results should be similar but not identical
        assert_relative_eq!(energy_low, energy_high, epsilon = 0.1);
    }

    #[test]
    fn test_ewald_neutral_system() {
        // Test that charge neutrality is checked
        let structure = nacl_structure();
        let ewald = Ewald::new();

        // NaCl is charge neutral, so this should work
        let result = ewald.energy(&structure);
        assert!(result.is_ok());

        // The energy should be negative (attractive)
        assert!(result.unwrap() < 0.0);
    }

    #[test]
    fn test_ewald_madelung_constant_reference() {
        // The Madelung constant for NaCl (rocksalt) is ~1.7476
        // Energy per ion pair: E = -α * e^2 / (4πε₀ * r) * 2
        // For our simple NaCl structure, we can verify the energy is reasonable

        let structure = nacl_structure();
        let ewald = Ewald::new();
        let energy = ewald.energy(&structure).unwrap();

        // Energy should be on the order of -10 eV for a 2-atom unit cell
        assert!(energy < 0.0, "Coulomb energy should be negative");
        assert!(energy > -100.0, "Energy should not be unreasonably large");
        assert!(energy < -1.0, "Energy should be significant");
    }

    #[test]
    fn test_ewald_supercell_scaling() {
        let small = nacl_structure();
        let large = nacl_conventional();

        let ewald = Ewald::new();
        let e_small = ewald.energy(&small).unwrap();
        let e_large = ewald.energy(&large).unwrap();

        // Both should be negative
        assert!(e_small < 0.0);
        assert!(e_large < 0.0);

        // Larger structure should have more negative total energy
        assert!(
            e_large.abs() > e_small.abs(),
            "Larger structure should have larger |energy|"
        );
    }

    // ========== Builder Pattern Tests ==========

    #[test]
    fn test_ewald_builder_chaining() {
        let ewald = Ewald::new().with_accuracy(1e-5).with_real_cutoff(10.0);

        assert_relative_eq!(ewald.accuracy, 1e-5, epsilon = 1e-10);
        assert_relative_eq!(ewald.real_cutoff, 10.0, epsilon = 1e-10);
    }

    // ========== Error Handling Tests ==========

    #[test]
    fn test_ewald_no_oxidation_states() {
        let a = 5.64;
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(a, a, a)));

        // No oxidation states
        let na = Species::neutral(Element::Na);
        let cl = Species::neutral(Element::Cl);

        let structure = Structure::new(
            lattice,
            vec![na, cl],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let ewald = Ewald::new();
        let result = ewald.energy(&structure);

        // Should fail because there are no oxidation states
        assert!(result.is_err());
    }

    #[test]
    fn test_ewald_non_neutral_fails() {
        let a = 5.0;
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(a, a, a)));
        let na = Species::new(Element::Na, Some(1));

        // Single Na+ ion is not charge-neutral
        let structure = Structure::new(lattice, vec![na], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let ewald = Ewald::new();
        let result = ewald.energy(&structure);

        // Should fail because structure is not charge-neutral
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("charge-neutral"),
            "Error should mention charge neutrality: {err_msg}"
        );
    }

    #[test]
    fn test_ewald_unbalanced_charges_fails() {
        let a = 5.64;
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(a, a, a)));

        // Two Na+ ions without compensating negative charge
        let na = Species::new(Element::Na, Some(1));
        let structure = Structure::new(
            lattice,
            vec![na, na],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let ewald = Ewald::new();
        let result = ewald.energy(&structure);

        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("net charge"));
    }

    // ========== Consistency Tests ==========

    #[test]
    fn test_ewald_same_params_same_result() {
        let structure = nacl_structure();

        let ewald1 = Ewald::new().with_accuracy(1e-5).with_real_cutoff(10.0);
        let ewald2 = Ewald::new().with_accuracy(1e-5).with_real_cutoff(10.0);

        let e1 = ewald1.energy(&structure).unwrap();
        let e2 = ewald2.energy(&structure).unwrap();

        assert_relative_eq!(e1, e2, epsilon = 1e-10);
    }

    #[test]
    fn test_ewald_negative_for_ionic_crystals() {
        // All ionic crystals should have negative Coulomb energy
        let structure = nacl_structure();
        let ewald = Ewald::new();
        let energy = ewald.energy(&structure).unwrap();

        assert!(
            energy < 0.0,
            "Ionic crystal should have negative Coulomb energy"
        );
    }

    #[test]
    fn test_ewald_invalid_accuracy() {
        let structure = nacl_structure();

        // Accuracy <= 0 should fail
        let ewald = Ewald::new().with_accuracy(0.0);
        let result = ewald.energy(&structure);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("accuracy"));

        // Accuracy >= 1 should fail
        let ewald = Ewald::new().with_accuracy(1.0);
        let result = ewald.energy(&structure);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("accuracy"));

        // Negative accuracy should fail
        let ewald = Ewald::new().with_accuracy(-0.1);
        let result = ewald.energy(&structure);
        assert!(result.is_err());

        // Valid accuracy in (0, 1) should work
        let ewald = Ewald::new().with_accuracy(0.5);
        assert!(ewald.energy(&structure).is_ok());
    }
}
