//! Bond Orientational Order Parameters (Steinhardt parameters).
//!
//! This module computes Steinhardt order parameters q_l for characterizing
//! local crystalline order in atomistic structures. These parameters are
//! rotationally invariant and can distinguish different crystal structures.
//!
//! # References
//!
//! - Steinhardt, Nelson, Ronchetti, PRB 28, 784 (1983)
//! - Lechner, Dellago, JCP 129, 114707 (2008)
//!
//! # Example
//!
//! ```rust,ignore
//! use ferrox::order_params::{compute_steinhardt_q, classify_local_structure, classify_all_atoms};
//!
//! let q4 = compute_steinhardt_q(&structure, 4, 3.5);
//! let q6 = compute_steinhardt_q(&structure, 6, 3.5);
//!
//! // Classify a single atom (index 0)
//! let classification = classify_local_structure(q4[0], q6[0], 0.1);
//!
//! // Or classify all atoms at once
//! let all_classifications = classify_all_atoms(&q4, &q6, 0.1);
//! ```

use num_complex::Complex64;
use std::f64::consts::PI;

use crate::neighbors::{NeighborList, NeighborListConfig, build_neighbor_list};
use crate::structure::Structure;

/// Pre-index a neighbor list by center atom for O(1) lookup.
///
/// Returns a Vec where index i contains all (neighbor_idx, image) pairs for atom i.
fn index_neighbor_list(nl: &NeighborList, n_atoms: usize) -> Vec<Vec<(usize, [i32; 3])>> {
    let mut indexed = vec![Vec::new(); n_atoms];
    for (pair_idx, &center) in nl.center_indices.iter().enumerate() {
        indexed[center].push((nl.neighbor_indices[pair_idx], nl.images[pair_idx]));
    }
    indexed
}

/// Compute factorial.
fn factorial(n: i32) -> f64 {
    if n <= 1 {
        1.0
    } else {
        (2..=n).map(|idx| idx as f64).product()
    }
}

/// Compute associated Legendre polynomial P_l^m(x).
///
/// Uses recurrence relations for numerical stability.
fn associated_legendre(deg: i32, ord: i32, x: f64) -> f64 {
    let ord_abs = ord.abs();

    if ord_abs > deg {
        return 0.0;
    }

    // Start with P_m^m
    let mut pmm = 1.0;
    if ord_abs > 0 {
        let somx2 = (1.0 - x * x).sqrt();
        let mut fact = 1.0;
        for _idx in 0..ord_abs {
            pmm *= -fact * somx2;
            fact += 2.0;
        }
    }

    if deg == ord_abs {
        if ord < 0 {
            let sign = if ord_abs % 2 == 0 { 1.0 } else { -1.0 };
            return sign * factorial(deg - ord_abs) / factorial(deg + ord_abs) * pmm;
        }
        return pmm;
    }

    // Compute P_{m+1}^m
    let mut pmmp1 = x * (2 * ord_abs + 1) as f64 * pmm;

    if deg == ord_abs + 1 {
        if ord < 0 {
            let sign = if ord_abs % 2 == 0 { 1.0 } else { -1.0 };
            return sign * factorial(deg - ord_abs) / factorial(deg + ord_abs) * pmmp1;
        }
        return pmmp1;
    }

    // Use recurrence to reach P_l^m
    let mut pll = 0.0;
    for ll in (ord_abs + 2)..=deg {
        pll = (x * (2 * ll - 1) as f64 * pmmp1 - (ll + ord_abs - 1) as f64 * pmm)
            / (ll - ord_abs) as f64;
        pmm = pmmp1;
        pmmp1 = pll;
    }

    if ord < 0 {
        let sign = if ord_abs % 2 == 0 { 1.0 } else { -1.0 };
        return sign * factorial(deg - ord_abs) / factorial(deg + ord_abs) * pll;
    }
    pll
}

/// Compute spherical harmonic Y_l^m(theta, phi).
///
/// Returns a complex number.
///
/// # Arguments
///
/// * `deg` - Degree (deg >= 0)
/// * `ord` - Order (-deg <= ord <= deg)
/// * `theta` - Polar angle (0 to pi)
/// * `phi` - Azimuthal angle (0 to 2*pi)
pub fn spherical_harmonic(deg: i32, ord: i32, theta: f64, phi: f64) -> Complex64 {
    if ord.abs() > deg {
        return Complex64::new(0.0, 0.0);
    }

    // Normalization factor
    let norm = ((2 * deg + 1) as f64 / (4.0 * PI) * factorial(deg - ord.abs())
        / factorial(deg + ord.abs()))
    .sqrt();

    // Associated Legendre polynomial
    let plm = associated_legendre(deg, ord.abs(), theta.cos());

    // Phase factor exp(i*ord*φ)
    let phase = Complex64::from_polar(1.0, ord as f64 * phi);

    // For ord < 0, include the Condon-Shortley phase factor (-1)^|ord|
    // This ensures Y_l^{-ord} = (-1)^ord * conj(Y_l^ord)
    let coefficient = if ord < 0 {
        let sign = if ord.abs() % 2 == 0 { 1.0 } else { -1.0 };
        sign * norm * plm
    } else {
        norm * plm
    };

    Complex64::new(coefficient, 0.0) * phase
}

/// Compute local Steinhardt q_l for each atom.
///
/// q_l(i) = sqrt(4*pi / (2*deg+1) * sum_m |q_lm(i)|^2)
///
/// where q_lm(i) = (1/N_b) * sum_j Y_l^m(theta_ij, phi_ij)
///
/// # Arguments
///
/// * `structure` - The atomic structure
/// * `deg` - Degree of spherical harmonics (typical: 4 or 6)
/// * `cutoff` - Neighbor cutoff distance in Angstrom
///
/// # Returns
///
/// Vector of q_l values for each atom
pub fn compute_steinhardt_q(structure: &Structure, deg: i32, cutoff: f64) -> Vec<f64> {
    // Guard against invalid deg to prevent signed-to-usize wrap in (2*deg+1)
    if deg < 0 {
        return vec![];
    }

    let n_atoms = structure.num_sites();
    if n_atoms == 0 {
        return vec![];
    }

    // Build neighbor list
    let config = NeighborListConfig {
        cutoff,
        ..Default::default()
    };
    let nl = build_neighbor_list(structure, &config);

    // Get positions and lattice vectors for periodic image handling
    let positions = structure.cart_coords();
    let matrix = structure.lattice.matrix();
    let lattice_vecs = [
        matrix.row(0).transpose(),
        matrix.row(1).transpose(),
        matrix.row(2).transpose(),
    ];

    // Pre-index neighbor list for O(1) lookup per atom
    let neighbors_by_atom = index_neighbor_list(&nl, n_atoms);

    // For each atom, compute q_lm values
    let mut q_deg = vec![0.0; n_atoms];

    for center_idx in 0..n_atoms {
        let neighbors = &neighbors_by_atom[center_idx];
        let num_neighbors = neighbors.len();
        if num_neighbors == 0 {
            continue;
        }

        // Compute q_lm for each m
        let mut q_lm_sum = vec![Complex64::new(0.0, 0.0); (2 * deg + 1) as usize];

        let center_pos = &positions[center_idx];

        for (neighbor_idx, image) in neighbors {
            let neighbor_pos = &positions[*neighbor_idx];

            // Apply periodic image offset
            let image_offset = (image[0] as f64) * lattice_vecs[0]
                + (image[1] as f64) * lattice_vecs[1]
                + (image[2] as f64) * lattice_vecs[2];

            let delta = neighbor_pos + image_offset - center_pos;
            let dist = delta.norm();

            if dist < 1e-10 {
                continue;
            }

            // Convert to spherical coordinates (clamp to avoid NaN from floating error)
            let cos_theta = (delta.z / dist).clamp(-1.0, 1.0);
            let theta = cos_theta.acos();
            let phi = delta.y.atan2(delta.x);

            // Add contribution from each m
            for ord in -deg..=deg {
                let ylm = spherical_harmonic(deg, ord, theta, phi);
                q_lm_sum[(ord + deg) as usize] += ylm;
            }
        }

        // Normalize by number of neighbors
        let n_neigh_f64 = num_neighbors as f64;
        for q_val in &mut q_lm_sum {
            *q_val /= n_neigh_f64;
        }

        // Compute |q_l|^2 = sum_m |q_lm|^2
        let q_deg_sq: f64 = q_lm_sum.iter().map(|q_val| q_val.norm_sqr()).sum();

        // q_l = sqrt(4*pi / (2*deg+1) * sum_m |q_lm|^2)
        q_deg[center_idx] = (4.0 * PI / (2 * deg + 1) as f64 * q_deg_sq).sqrt();
    }

    q_deg
}

/// Compute global Steinhardt Q_l for a structure.
///
/// Q_l = sqrt(4*pi / (2*deg+1) * sum_m |<q_lm>|^2)
///
/// where <q_lm> is the average of q_lm(i) over all atoms i.
///
/// This is the correct global order parameter that averages the complex
/// q_lm values before computing the rotationally invariant quantity.
///
/// # Arguments
///
/// * `structure` - The atomic structure
/// * `deg` - Degree of spherical harmonics (typical: 4 or 6)
/// * `cutoff` - Neighbor cutoff distance in Angstrom
///
/// # Returns
///
/// Global Q_l value for the entire structure
pub fn compute_global_steinhardt_q(structure: &Structure, deg: i32, cutoff: f64) -> f64 {
    // Guard against invalid deg to prevent signed-to-usize wrap in (2*deg+1)
    if deg < 0 {
        return 0.0;
    }

    let n_atoms = structure.num_sites();
    if n_atoms == 0 {
        return 0.0;
    }

    // Build neighbor list
    let config = NeighborListConfig {
        cutoff,
        ..Default::default()
    };
    let nl = build_neighbor_list(structure, &config);

    // Get positions and lattice vectors for periodic image handling
    let positions = structure.cart_coords();
    let matrix = structure.lattice.matrix();
    let lattice_vecs = [
        matrix.row(0).transpose(),
        matrix.row(1).transpose(),
        matrix.row(2).transpose(),
    ];

    // Pre-index neighbor list for O(1) lookup per atom
    let neighbors_by_atom = index_neighbor_list(&nl, n_atoms);

    // Accumulate q_lm values from all atoms
    let mut global_qlm = vec![Complex64::new(0.0, 0.0); (2 * deg + 1) as usize];
    let mut atoms_with_neighbors = 0usize;

    for center_idx in 0..n_atoms {
        let neighbors = &neighbors_by_atom[center_idx];
        let num_neighbors = neighbors.len();
        if num_neighbors == 0 {
            continue;
        }

        atoms_with_neighbors += 1;

        // Compute q_lm for this atom
        let mut q_lm_sum = vec![Complex64::new(0.0, 0.0); (2 * deg + 1) as usize];
        let center_pos = &positions[center_idx];

        for (neighbor_idx, image) in neighbors {
            let neighbor_pos = &positions[*neighbor_idx];

            // Apply periodic image offset
            let image_offset = (image[0] as f64) * lattice_vecs[0]
                + (image[1] as f64) * lattice_vecs[1]
                + (image[2] as f64) * lattice_vecs[2];

            let delta = neighbor_pos + image_offset - center_pos;
            let dist = delta.norm();

            if dist < 1e-10 {
                continue;
            }

            // Convert to spherical coordinates (clamp to avoid NaN from floating error)
            let cos_theta = (delta.z / dist).clamp(-1.0, 1.0);
            let theta = cos_theta.acos();
            let phi = delta.y.atan2(delta.x);

            // Add contribution from each ord
            for ord in -deg..=deg {
                let ylm = spherical_harmonic(deg, ord, theta, phi);
                q_lm_sum[(ord + deg) as usize] += ylm;
            }
        }

        // Normalize by number of neighbors and add to global sum
        let n_neigh_f64 = num_neighbors as f64;
        for (ord_idx, q_val) in q_lm_sum.iter().enumerate() {
            global_qlm[ord_idx] += q_val / n_neigh_f64;
        }
    }

    if atoms_with_neighbors == 0 {
        return 0.0;
    }

    // Average over all atoms with neighbors
    let n_atoms_f64 = atoms_with_neighbors as f64;
    for q_val in &mut global_qlm {
        *q_val /= n_atoms_f64;
    }

    // Compute Q_l = sqrt(4*pi / (2*deg+1) * sum_m |<q_lm>|^2)
    let q_deg_sq: f64 = global_qlm.iter().map(|q_val| q_val.norm_sqr()).sum();
    (4.0 * PI / (2 * deg + 1) as f64 * q_deg_sq).sqrt()
}

/// Average of local q_l values (simple arithmetic mean).
///
/// This is NOT the true global Steinhardt Q_l parameter. For the correct
/// global order parameter, use `compute_global_steinhardt_q`.
///
/// This function is useful for quick statistics on local order parameter
/// distributions.
pub fn global_steinhardt_q(local_q: &[f64]) -> f64 {
    if local_q.is_empty() {
        return 0.0;
    }
    let sum: f64 = local_q.iter().sum();
    sum / local_q.len() as f64
}

/// Local crystal structure type based on order parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalStructure {
    /// Face-centered cubic
    Fcc,
    /// Body-centered cubic
    Bcc,
    /// Hexagonal close-packed
    Hcp,
    /// Icosahedral
    Icosahedral,
    /// Liquid/disordered
    Liquid,
    /// Unknown/unclassified
    Unknown,
}

impl LocalStructure {
    /// Convert to string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            LocalStructure::Fcc => "fcc",
            LocalStructure::Bcc => "bcc",
            LocalStructure::Hcp => "hcp",
            LocalStructure::Icosahedral => "icosahedral",
            LocalStructure::Liquid => "liquid",
            LocalStructure::Unknown => "unknown",
        }
    }
}

/// Classify local structure based on q4 and q6 values.
///
/// Uses characteristic values from pymatgen LocalStructOrderParams tests:
/// - FCC: q4 ≈ 0.19, q6 ≈ 0.57
/// - BCC: q4 ≈ 0.509, q6 ≈ 0.628 (pymatgen reference, 8 nearest neighbors)
/// - HCP: q4 ≈ 0.10, q6 ≈ 0.48
/// - Icosahedral: q4 ≈ 0.0, q6 ≈ 0.66
/// - Liquid: q4 ≈ 0.0, q6 ≈ 0.0
///
/// # Arguments
///
/// * `q4` - Local q4 value
/// * `q6` - Local q6 value
/// * `tolerance` - Tolerance for classification (default: 0.1)
pub fn classify_local_structure(q4: f64, q6: f64, tolerance: f64) -> LocalStructure {
    // Reference values from pymatgen LocalStructOrderParams
    const FCC_Q4: f64 = 0.19;
    const FCC_Q6: f64 = 0.57;
    // BCC values from pymatgen tests (test_local_env.py line 1081):
    // ops_087.get_order_parameters(self.bcc, 0) gives q4=0.509, q6=0.628
    const BCC_Q4: f64 = 0.509;
    const BCC_Q6: f64 = 0.628;
    const HCP_Q4: f64 = 0.10;
    const HCP_Q6: f64 = 0.48;
    const ICO_Q4: f64 = 0.0;
    const ICO_Q6: f64 = 0.66;

    // Compute distances to reference structures
    let dist_fcc = ((q4 - FCC_Q4).powi(2) + (q6 - FCC_Q6).powi(2)).sqrt();
    let dist_bcc = ((q4 - BCC_Q4).powi(2) + (q6 - BCC_Q6).powi(2)).sqrt();
    let dist_hcp = ((q4 - HCP_Q4).powi(2) + (q6 - HCP_Q6).powi(2)).sqrt();
    let dist_ico = ((q4 - ICO_Q4).powi(2) + (q6 - ICO_Q6).powi(2)).sqrt();

    // Check for liquid first (both q4 and q6 low)
    if q4 < 0.05 && q6 < 0.2 {
        return LocalStructure::Liquid;
    }

    // Find closest structure by comparing distances directly
    // This avoids floating-point equality issues with min_dist comparison
    let candidates = [
        (dist_fcc, LocalStructure::Fcc),
        (dist_bcc, LocalStructure::Bcc),
        (dist_hcp, LocalStructure::Hcp),
        (dist_ico, LocalStructure::Icosahedral),
    ];

    let (min_dist, closest) = candidates
        .into_iter()
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap())
        .unwrap(); // Safe: array is non-empty

    if min_dist > tolerance {
        LocalStructure::Unknown
    } else {
        closest
    }
}

/// Classify all atoms in a structure based on their local order parameters.
///
/// # Arguments
///
/// * `structure` - The atomic structure
/// * `cutoff` - Neighbor cutoff distance
/// * `tolerance` - Classification tolerance
///
/// # Returns
///
/// Vector of LocalStructure classifications for each atom
pub fn classify_all_atoms(
    structure: &Structure,
    cutoff: f64,
    tolerance: f64,
) -> Vec<LocalStructure> {
    let q4 = compute_steinhardt_q(structure, 4, cutoff);
    let q6 = compute_steinhardt_q(structure, 6, cutoff);

    q4.iter()
        .zip(&q6)
        .map(|(&q4_val, &q6_val)| classify_local_structure(q4_val, q6_val, tolerance))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use crate::lattice::Lattice;
    use crate::species::Species;
    use crate::structure::Structure;
    use nalgebra::Vector3;

    // === Factorial Tests ===

    #[test]
    fn test_factorial() {
        assert!((factorial(0) - 1.0).abs() < 1e-10);
        assert!((factorial(1) - 1.0).abs() < 1e-10);
        assert!((factorial(5) - 120.0).abs() < 1e-10);
        assert!((factorial(10) - 3628800.0).abs() < 1e-5);
    }

    // === Spherical Harmonics Tests ===

    #[test]
    fn test_spherical_harmonic_y00() {
        // Y_0^0 = 1 / sqrt(4*pi) for all (theta, phi)
        let expected = 1.0 / (4.0 * PI).sqrt();
        for &theta in &[0.0, PI / 4.0, PI / 2.0, 3.0 * PI / 4.0, PI] {
            for &phi in &[0.0, PI / 2.0, PI, 3.0 * PI / 2.0] {
                let y00 = spherical_harmonic(0, 0, theta, phi);
                assert!(
                    (y00.re - expected).abs() < 1e-10,
                    "Y_0^0({theta}, {phi}) = {}, expected {expected}",
                    y00.re
                );
                assert!(
                    y00.im.abs() < 1e-10,
                    "Y_0^0 should have zero imaginary part"
                );
            }
        }
    }

    #[test]
    fn test_spherical_harmonic_y10() {
        // Y_1^0 = sqrt(3/(4*pi)) * cos(theta)
        let norm = (3.0 / (4.0 * PI)).sqrt();
        for &theta in &[0.0, PI / 4.0, PI / 2.0, 3.0 * PI / 4.0, PI] {
            let expected = norm * theta.cos();
            let y10 = spherical_harmonic(1, 0, theta, 0.5);
            assert!(
                (y10.re - expected).abs() < 1e-10,
                "Y_1^0({theta}) = {}, expected {expected}",
                y10.re
            );
            assert!(y10.im.abs() < 1e-10);
        }
    }

    #[test]
    fn test_spherical_harmonic_y20() {
        // Y_2^0 = sqrt(5/(16*pi)) * (3*cos^2(theta) - 1)
        let norm = (5.0 / (16.0 * PI)).sqrt();
        for &theta in &[0.0, PI / 4.0, PI / 2.0, 3.0 * PI / 4.0, PI] {
            let cos_t = theta.cos();
            let expected = norm * (3.0 * cos_t * cos_t - 1.0);
            let y20 = spherical_harmonic(2, 0, theta, 0.5);
            assert!(
                (y20.re - expected).abs() < 1e-10,
                "Y_2^0({theta}) = {}, expected {expected}",
                y20.re
            );
            assert!(y20.im.abs() < 1e-10);
        }
    }

    #[test]
    fn test_spherical_harmonic_symmetry() {
        // Y_l^{-m}(theta, phi) = (-1)^m * conj(Y_l^m(theta, phi))
        let theta = 0.8;
        let phi = 1.2;

        for deg in 0..=6 {
            for ord in 1..=deg {
                let ylm = spherical_harmonic(deg, ord, theta, phi);
                let ylmn = spherical_harmonic(deg, -ord, theta, phi);
                let sign = if ord % 2 == 0 { 1.0 } else { -1.0 };
                let expected = ylm.conj() * sign;

                assert!(
                    (ylmn.re - expected.re).abs() < 1e-10,
                    "Y_{}^{{{}}}: real part mismatch",
                    deg,
                    -ord
                );
                assert!(
                    (ylmn.im - expected.im).abs() < 1e-10,
                    "Y_{}^{{{}}}: imag part mismatch",
                    deg,
                    -ord
                );
            }
        }
    }

    #[test]
    fn test_spherical_harmonic_normalization() {
        // For fixed theta, phi, sum over m of |Y_l^m|^2 should give (2l+1)/(4*pi)
        // This is a consequence of the addition theorem
        let theta = 1.0;
        let phi = 2.0;

        for deg in 0..=6 {
            let sum_sq: f64 = (-deg..=deg)
                .map(|ord| spherical_harmonic(deg, ord, theta, phi).norm_sqr())
                .sum();
            let expected = (2 * deg + 1) as f64 / (4.0 * PI);
            assert!(
                (sum_sq - expected).abs() < 1e-10,
                "deg={deg}: sum |Y_l^m|^2 = {sum_sq}, expected {expected}"
            );
        }
    }

    #[test]
    fn test_spherical_harmonic_y22() {
        // Y_2^2 = sqrt(15/(32*pi)) * sin^2(theta) * exp(2*i*phi)
        // |Y_2^2| = sqrt(15/(32*pi)) * sin^2(theta)
        let norm = (15.0 / (32.0 * PI)).sqrt();
        let test_cases = [
            (PI / 2.0, 0.0),      // theta=pi/2, phi=0
            (PI / 2.0, PI / 4.0), // theta=pi/2, phi=pi/4
            (PI / 3.0, PI / 6.0), // general case
            (PI / 4.0, PI / 2.0), // general case
        ];

        for &(theta, phi) in &test_cases {
            let y22 = spherical_harmonic(2, 2, theta, phi);
            let sin_t = theta.sin();
            let expected_magnitude = norm * sin_t * sin_t;
            let expected = Complex64::from_polar(expected_magnitude, 2.0 * phi);

            assert!(
                (y22.re - expected.re).abs() < 1e-10,
                "Y_2^2({theta}, {phi}) real: got {}, expected {}",
                y22.re,
                expected.re
            );
            assert!(
                (y22.im - expected.im).abs() < 1e-10,
                "Y_2^2({theta}, {phi}) imag: got {}, expected {}",
                y22.im,
                expected.im
            );
        }
    }

    #[test]
    fn test_spherical_harmonic_y40() {
        // Y_4^0 = (3/16) * sqrt(1/pi) * (35*cos^4(theta) - 30*cos^2(theta) + 3)
        let norm = 3.0 / 16.0 * (1.0 / PI).sqrt();
        let test_cases = [
            0.0,
            PI / 6.0,
            PI / 4.0,
            PI / 3.0,
            PI / 2.0,
            2.0 * PI / 3.0,
            PI,
        ];

        for &theta in &test_cases {
            let cos_t = theta.cos();
            let cos2 = cos_t * cos_t;
            let cos4 = cos2 * cos2;
            let expected = norm * (35.0 * cos4 - 30.0 * cos2 + 3.0);
            let y40 = spherical_harmonic(4, 0, theta, 0.5);

            assert!(
                (y40.re - expected).abs() < 1e-10,
                "Y_4^0({theta}) = {}, expected {expected}",
                y40.re
            );
            assert!(
                y40.im.abs() < 1e-10,
                "Y_4^0 should have zero imaginary part"
            );
        }
    }

    #[test]
    fn test_spherical_harmonic_y60() {
        // Y_6^0 = (1/32) * sqrt(13/pi) * (231*cos^6 - 315*cos^4 + 105*cos^2 - 5)
        let norm = (1.0 / 32.0) * (13.0 / PI).sqrt();
        let test_cases = [
            0.0,
            PI / 6.0,
            PI / 4.0,
            PI / 3.0,
            PI / 2.0,
            2.0 * PI / 3.0,
            PI,
        ];

        for &theta in &test_cases {
            let cos_t = theta.cos();
            let cos2 = cos_t * cos_t;
            let cos4 = cos2 * cos2;
            let cos6 = cos4 * cos2;
            let expected = norm * (231.0 * cos6 - 315.0 * cos4 + 105.0 * cos2 - 5.0);
            let y60 = spherical_harmonic(6, 0, theta, 1.2);

            assert!(
                (y60.re - expected).abs() < 1e-10,
                "Y_6^0({theta}) = {}, expected {expected}",
                y60.re
            );
            assert!(
                y60.im.abs() < 1e-10,
                "Y_6^0 should have zero imaginary part"
            );
        }
    }

    #[test]
    fn test_spherical_harmonic_grid() {
        // Test at grid of (deg, ord, theta, phi) values
        let degs = [0, 2, 4, 6];
        let thetas = [0.0, PI / 4.0, PI / 2.0, 3.0 * PI / 4.0, PI];
        let phis = [0.0, PI / 2.0, PI, 3.0 * PI / 2.0];

        for &deg in &degs {
            for ord in -deg..=deg {
                for &theta in &thetas {
                    for &phi in &phis {
                        let ylm = spherical_harmonic(deg, ord, theta, phi);
                        // Check that result is finite
                        assert!(
                            ylm.re.is_finite() && ylm.im.is_finite(),
                            "Y_{}^{}({}, {}) is not finite",
                            deg,
                            ord,
                            theta,
                            phi
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn test_spherical_harmonic_large_deg() {
        // Test numerical stability for large deg values
        for deg in [8, 10, 12] {
            for ord in -deg..=deg {
                let ylm = spherical_harmonic(deg, ord, PI / 3.0, PI / 4.0);
                assert!(
                    ylm.re.is_finite() && ylm.im.is_finite(),
                    "Y_{}^{} is not finite for large deg",
                    deg,
                    ord
                );
                // Also check magnitude is reasonable (shouldn't explode)
                assert!(
                    ylm.norm() < 10.0,
                    "Y_{}^{} has unexpectedly large magnitude: {}",
                    deg,
                    ord,
                    ylm.norm()
                );
            }
        }
    }

    #[test]
    fn test_spherical_harmonic_out_of_bounds_m() {
        // |m| > l should return zero
        let y43 = spherical_harmonic(3, 4, 0.5, 0.5);
        assert!(
            y43.re.abs() < 1e-15 && y43.im.abs() < 1e-15,
            "Y_3^4 should be zero"
        );
        let y3m4 = spherical_harmonic(3, -4, 0.5, 0.5);
        assert!(
            y3m4.re.abs() < 1e-15 && y3m4.im.abs() < 1e-15,
            "Y_3^{{-4}} should be zero"
        );
    }

    // === Associated Legendre Polynomial Tests ===

    #[test]
    fn test_associated_legendre_p00() {
        // P_0^0(x) = 1 for all x
        for x in [-1.0, -0.5, 0.0, 0.5, 1.0] {
            let p00 = associated_legendre(0, 0, x);
            assert!(
                (p00 - 1.0).abs() < 1e-10,
                "P_0^0({x}) = {p00}, expected 1.0"
            );
        }
    }

    #[test]
    fn test_associated_legendre_p10() {
        // P_1^0(x) = x
        for x in [-1.0, -0.5, 0.0, 0.5, 1.0] {
            let p10 = associated_legendre(1, 0, x);
            assert!((p10 - x).abs() < 1e-10, "P_1^0({x}) = {p10}, expected {x}");
        }
    }

    #[test]
    fn test_associated_legendre_p20() {
        // P_2^0(x) = (3x^2 - 1)/2
        for x in [-1.0, -0.5, 0.0, 0.5, 1.0] {
            let expected = (3.0 * x * x - 1.0) / 2.0;
            let p20 = associated_legendre(2, 0, x);
            assert!(
                (p20 - expected).abs() < 1e-10,
                "P_2^0({x}) = {p20}, expected {expected}"
            );
        }
    }

    // === Crystal Structure Helper Functions ===

    /// Create an FCC structure (conventional cell with 4 atoms).
    fn make_fcc(a: f64, element: Element, nx: usize, ny: usize, nz: usize) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = Species::neutral(element);
        // FCC basis: (0,0,0), (0.5,0.5,0), (0.5,0,0.5), (0,0.5,0.5)
        let frac_coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
        ];
        let structure = Structure::new(lattice, vec![species; 4], frac_coords);
        if nx > 1 || ny > 1 || nz > 1 {
            structure
                .make_supercell([[nx as i32, 0, 0], [0, ny as i32, 0], [0, 0, nz as i32]])
                .unwrap()
        } else {
            structure
        }
    }

    /// Create a BCC structure (conventional cell with 2 atoms).
    fn make_bcc(a: f64, element: Element, nx: usize, ny: usize, nz: usize) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = Species::neutral(element);
        // BCC basis: (0,0,0), (0.5,0.5,0.5)
        let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let structure = Structure::new(lattice, vec![species; 2], frac_coords);
        if nx > 1 || ny > 1 || nz > 1 {
            structure
                .make_supercell([[nx as i32, 0, 0], [0, ny as i32, 0], [0, 0, nz as i32]])
                .unwrap()
        } else {
            structure
        }
    }

    /// Create an HCP structure.
    fn make_hcp(a: f64, c: f64, element: Element, nx: usize, ny: usize, nz: usize) -> Structure {
        let lattice = Lattice::hexagonal(a, c);
        let species = Species::neutral(element);
        // HCP basis: (0,0,0), (1/3, 2/3, 0.5)
        let frac_coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0 / 3.0, 2.0 / 3.0, 0.5),
        ];
        let structure = Structure::new(lattice, vec![species; 2], frac_coords);
        if nx > 1 || ny > 1 || nz > 1 {
            structure
                .make_supercell([[nx as i32, 0, 0], [0, ny as i32, 0], [0, 0, nz as i32]])
                .unwrap()
        } else {
            structure
        }
    }

    // === Steinhardt Tests: FCC ===

    #[test]
    fn test_fcc_q4_q6_values() {
        // FCC Cu: a = 3.6 Å, nearest neighbor = a/sqrt(2) ≈ 2.55 Å
        // Literature values: q4 ≈ 0.19, q6 ≈ 0.57
        let a = 3.6;
        let structure = make_fcc(a, Element::Cu, 3, 3, 3);
        let cutoff = 1.1 * a / 2.0_f64.sqrt(); // 1.1 * nearest neighbor distance

        let q4 = compute_steinhardt_q(&structure, 4, cutoff);
        let q6 = compute_steinhardt_q(&structure, 6, cutoff);

        // Get interior atoms (not on boundaries) for accurate comparison
        let n_atoms = structure.num_sites();
        assert!(n_atoms > 0, "Structure should have atoms");

        // Average q values (interior atoms should converge to ideal values)
        let avg_q4: f64 = q4.iter().sum::<f64>() / n_atoms as f64;
        let avg_q6: f64 = q6.iter().sum::<f64>() / n_atoms as f64;

        // FCC literature values with tolerance for boundary effects
        assert!(
            (avg_q4 - 0.19).abs() < 0.05,
            "FCC avg q4 = {avg_q4}, expected ~0.19"
        );
        assert!(
            (avg_q6 - 0.57).abs() < 0.05,
            "FCC avg q6 = {avg_q6}, expected ~0.57"
        );
    }

    // === Steinhardt Tests: BCC ===

    #[test]
    fn test_bcc_q4_q6_values() {
        // BCC Fe: pymatgen reference q4=0.509, q6=0.628 (8 nearest neighbors)
        let a = 2.87;
        let structure = make_bcc(a, Element::Fe, 3, 3, 3);
        let cutoff = 2.6; // Between 1st shell (2.48 Å) and 2nd shell (2.87 Å)

        let q4 = compute_steinhardt_q(&structure, 4, cutoff);
        let q6 = compute_steinhardt_q(&structure, 6, cutoff);

        let avg_q4: f64 = q4.iter().sum::<f64>() / q4.len() as f64;
        let avg_q6: f64 = q6.iter().sum::<f64>() / q6.len() as f64;

        assert!(
            (avg_q4 - 0.509).abs() < 0.05,
            "BCC avg q4 = {avg_q4}, expected ~0.509"
        );
        assert!(
            (avg_q6 - 0.628).abs() < 0.05,
            "BCC avg q6 = {avg_q6}, expected ~0.628"
        );
    }

    // === Steinhardt Tests: HCP ===

    #[test]
    fn test_hcp_q4_q6_values() {
        // HCP Mg: a = 3.21 Å, c/a = 1.624, c ≈ 5.21 Å
        // Literature values: q4 ≈ 0.097, q6 ≈ 0.485
        let a = 3.21;
        let c = 5.21;
        let structure = make_hcp(a, c, Element::Mg, 4, 4, 4);
        let cutoff = 1.1 * a; // Nearest neighbor in HCP is approximately a

        let q4 = compute_steinhardt_q(&structure, 4, cutoff);
        let q6 = compute_steinhardt_q(&structure, 6, cutoff);

        let n_atoms = structure.num_sites();
        let avg_q4: f64 = q4.iter().sum::<f64>() / n_atoms as f64;
        let avg_q6: f64 = q6.iter().sum::<f64>() / n_atoms as f64;

        // HCP literature values
        assert!(
            (avg_q4 - 0.097).abs() < 0.05,
            "HCP avg q4 = {avg_q4}, expected ~0.097"
        );
        assert!(
            (avg_q6 - 0.485).abs() < 0.05,
            "HCP avg q6 = {avg_q6}, expected ~0.485"
        );
    }

    // === Large l Value Stability Tests ===

    #[test]
    fn test_large_l_numerical_stability() {
        // Test that l=10, 12 don't cause numerical overflow/underflow
        let structure = make_fcc(3.6, Element::Cu, 2, 2, 2);
        let cutoff = 3.0;

        for l in [8, 10, 12] {
            let q_l = compute_steinhardt_q(&structure, l, cutoff);
            for (idx, &q) in q_l.iter().enumerate() {
                assert!(q.is_finite(), "q_{l} for atom {idx} is not finite: {q}");
                assert!(
                    (0.0..=1.5).contains(&q),
                    "q_{l} for atom {idx} has unexpected value: {q}"
                );
            }
        }
    }

    // === Edge Cases ===

    #[test]
    fn test_empty_structure() {
        let lattice = Lattice::cubic(10.0);
        let structure = Structure::new(lattice, vec![], vec![]);
        let q4 = compute_steinhardt_q(&structure, 4, 3.0);
        assert!(
            q4.is_empty(),
            "Empty structure should return empty q values"
        );
    }

    #[test]
    fn test_single_atom_no_neighbors() {
        // Single atom with no neighbors should have q=0
        let lattice = Lattice::cubic(10.0);
        let structure = Structure::new(
            lattice,
            vec![Species::neutral(Element::Cu)],
            vec![Vector3::new(0.5, 0.5, 0.5)],
        );
        let q4 = compute_steinhardt_q(&structure, 4, 3.0);
        assert_eq!(q4.len(), 1);
        assert!(
            q4[0].abs() < 1e-10,
            "Single atom with no neighbors should have q4=0"
        );
    }

    #[test]
    fn test_two_atoms_isolated() {
        // Two atoms far apart (no neighbors) should both have q=0
        let lattice = Lattice::cubic(20.0);
        let structure = Structure::new(
            lattice,
            vec![Species::neutral(Element::Cu); 2],
            vec![Vector3::new(0.1, 0.1, 0.1), Vector3::new(0.9, 0.9, 0.9)],
        );
        let q4 = compute_steinhardt_q(&structure, 4, 3.0); // Cutoff too small
        assert_eq!(q4.len(), 2);
        assert!(q4[0].abs() < 1e-10 && q4[1].abs() < 1e-10);
    }

    // === Classification Tests ===

    #[test]
    fn test_classify_liquid() {
        // Low q4 and q6 should be classified as liquid
        let structure = classify_local_structure(0.02, 0.05, 0.1);
        assert_eq!(structure, LocalStructure::Liquid);
    }

    #[test]
    fn test_classify_fcc() {
        // q4 ≈ 0.19, q6 ≈ 0.57 should be FCC
        let structure = classify_local_structure(0.19, 0.57, 0.15);
        assert_eq!(structure, LocalStructure::Fcc);
    }

    #[test]
    fn test_classify_bcc() {
        // q4 ≈ 0.509, q6 ≈ 0.628 should be BCC (pymatgen reference values)
        let structure = classify_local_structure(0.509, 0.628, 0.15);
        assert_eq!(structure, LocalStructure::Bcc);
    }

    #[test]
    fn test_classify_hcp() {
        // q4 ≈ 0.10, q6 ≈ 0.48 should be HCP
        let structure = classify_local_structure(0.10, 0.48, 0.15);
        assert_eq!(structure, LocalStructure::Hcp);
    }

    #[test]
    fn test_classify_icosahedral() {
        // q4 ≈ 0.0, q6 ≈ 0.66 should be icosahedral
        let structure = classify_local_structure(0.0, 0.66, 0.15);
        assert_eq!(structure, LocalStructure::Icosahedral);
    }

    #[test]
    fn test_classify_unknown() {
        // Values far from any reference should be unknown
        let structure = classify_local_structure(0.5, 0.5, 0.1);
        assert_eq!(structure, LocalStructure::Unknown);
    }

    #[test]
    fn test_local_structure_as_str() {
        assert_eq!(LocalStructure::Fcc.as_str(), "fcc");
        assert_eq!(LocalStructure::Bcc.as_str(), "bcc");
        assert_eq!(LocalStructure::Hcp.as_str(), "hcp");
        assert_eq!(LocalStructure::Icosahedral.as_str(), "icosahedral");
        assert_eq!(LocalStructure::Liquid.as_str(), "liquid");
        assert_eq!(LocalStructure::Unknown.as_str(), "unknown");
    }

    // === Global Steinhardt Tests ===

    #[test]
    fn test_global_steinhardt_empty() {
        let result = global_steinhardt_q(&[]);
        assert!((result - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_global_steinhardt_average() {
        let local_q = vec![0.1, 0.2, 0.3, 0.4];
        let expected = 0.25; // Average
        let result = global_steinhardt_q(&local_q);
        assert!(
            (result - expected).abs() < 1e-10,
            "Global Q = {result}, expected {expected}"
        );
    }

    #[test]
    fn test_compute_global_steinhardt_q_fcc() {
        // Test the proper global Q_l computation on FCC structure
        let structure = make_fcc(3.6, Element::Cu, 3, 3, 3);
        let cutoff = 1.1 * 3.6 / 2.0_f64.sqrt();

        let q6_global = compute_global_steinhardt_q(&structure, 6, cutoff);

        // For a perfect crystal, global Q_l should be close to local q_l values
        // FCC Q6 should be around 0.57
        assert!(
            q6_global > 0.4 && q6_global < 0.7,
            "FCC global Q6 = {q6_global}, expected ~0.57"
        );

        // Compare with average of local values
        let local_q6 = compute_steinhardt_q(&structure, 6, cutoff);
        let avg_local = global_steinhardt_q(&local_q6);

        // For ordered structures, global Q_l and average local q_l should be similar
        // (they would differ more for disordered structures)
        assert!(
            (q6_global - avg_local).abs() < 0.15,
            "Global Q6 ({q6_global}) should be close to avg local q6 ({avg_local})"
        );
    }

    #[test]
    fn test_compute_global_steinhardt_q_empty() {
        let lattice = Lattice::cubic(10.0);
        let structure = Structure::new(lattice, vec![], vec![]);
        let q6 = compute_global_steinhardt_q(&structure, 6, 3.0);
        assert!((q6 - 0.0).abs() < 1e-10);
    }

    // === Classify All Atoms Tests ===

    #[test]
    fn test_classify_all_atoms_fcc() {
        let structure = make_fcc(3.6, Element::Cu, 3, 3, 3);
        let cutoff = 1.1 * 3.6 / 2.0_f64.sqrt();
        let classifications = classify_all_atoms(&structure, cutoff, 0.15);

        // Count FCC classifications
        let fcc_count = classifications
            .iter()
            .filter(|&&c| c == LocalStructure::Fcc)
            .count();

        // Most atoms should be classified as FCC
        let fcc_fraction = fcc_count as f64 / classifications.len() as f64;
        assert!(
            fcc_fraction > 0.5,
            "Expected majority FCC, got {:.1}% FCC",
            fcc_fraction * 100.0
        );
    }

    #[test]
    fn test_classify_all_atoms_bcc() {
        // BCC with pymatgen-compatible reference values
        let a = 2.87;
        let nn_dist = a * 3.0_f64.sqrt() / 2.0;
        let structure = make_bcc(a, Element::Fe, 4, 4, 4);
        // Cutoff between first and second shell (2.48 to 2.87 Å)
        let cutoff = 0.5 * (nn_dist + a);
        let classifications = classify_all_atoms(&structure, cutoff, 0.15);

        let bcc_count = classifications
            .iter()
            .filter(|&&c| c == LocalStructure::Bcc)
            .count();

        let bcc_fraction = bcc_count as f64 / classifications.len() as f64;
        assert!(
            bcc_fraction > 0.5,
            "Expected majority BCC, got {:.1}% BCC",
            bcc_fraction * 100.0
        );
    }
}
