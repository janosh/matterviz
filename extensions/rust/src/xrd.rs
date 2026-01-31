//! X-ray diffraction pattern calculation.
//!
//! This module provides powder XRD pattern calculation from crystal structures
//! using kinematic diffraction theory. The implementation is based on pymatgen's
//! XRDCalculator and the TypeScript port in matterviz.
//!
//! ## Algorithm
//!
//! 1. Compute reciprocal lattice vectors from direct lattice
//! 2. Enumerate (hkl) planes within 2θ range using Bragg's law
//! 3. Calculate structure factors using atomic scattering factors
//! 4. Apply Lorentz-polarization correction
//! 5. Merge peaks within tolerance and scale intensities

use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::f64::consts::PI;
use std::sync::OnceLock;

use crate::element::Element;
use crate::structure::Structure;

// =============================================================================
// Constants and Wavelengths
// =============================================================================

/// Common X-ray wavelengths in Angstroms.
pub mod wavelengths {
    /// Cu Kα average (1.54184 Å)
    pub const CU_KA: f64 = 1.54184;
    /// Cu Kα1 (1.54056 Å)
    pub const CU_KA1: f64 = 1.54056;
    /// Cu Kα2 (1.54439 Å)
    pub const CU_KA2: f64 = 1.54439;
    /// Cu Kβ1 (1.39222 Å)
    pub const CU_KB1: f64 = 1.39222;
    /// Mo Kα average (0.71073 Å)
    pub const MO_KA: f64 = 0.71073;
    /// Mo Kα1 (0.7093 Å)
    pub const MO_KA1: f64 = 0.7093;
    /// Mo Kα2 (0.71359 Å)
    pub const MO_KA2: f64 = 0.71359;
    /// Cr Kα average (2.291 Å)
    pub const CR_KA: f64 = 2.291;
    /// Fe Kα average (1.93735 Å)
    pub const FE_KA: f64 = 1.93735;
    /// Co Kα average (1.79026 Å)
    pub const CO_KA: f64 = 1.79026;
    /// Ag Kα average (0.560885 Å)
    pub const AG_KA: f64 = 0.560885;
}

/// Default tolerances matching pymatgen.
const TWO_THETA_TOL: f64 = 1e-5;
const SCALED_INTENSITY_TOL: f64 = 1e-3;

// =============================================================================
// Atomic Scattering Parameters
// =============================================================================

/// Cromer-Mann coefficients: [[a1, b1], [a2, b2], [a3, b3], [a4, b4]]
type ScatteringCoeffs = [[f64; 2]; 4];

/// Atomic scattering parameters (Cromer-Mann coefficients).
/// Embedded at compile time from JSON file.
/// Public for access from Python bindings.
pub const SCATTERING_PARAMS_JSON: &str = include_str!("atomic_scattering_params.json");

static SCATTERING_PARAMS: OnceLock<HashMap<String, ScatteringCoeffs>> = OnceLock::new();

/// Get the cached scattering parameters map.
/// Public for use in Python/WASM bindings.
pub fn get_scattering_params() -> &'static HashMap<String, ScatteringCoeffs> {
    SCATTERING_PARAMS.get_or_init(|| {
        serde_json::from_str(SCATTERING_PARAMS_JSON)
            .expect("Failed to parse atomic scattering parameters JSON")
    })
}

/// Get atomic scattering coefficients for an element.
fn get_scattering_coeffs(element: Element) -> Option<&'static ScatteringCoeffs> {
    let params = get_scattering_params();
    params.get(element.symbol())
}

/// Calculate atomic scattering factor f(s) using Cromer-Mann formula.
/// f(s) = Σ(aᵢ × exp(-bᵢ × s²)) where s = sin(θ)/λ
fn atomic_scattering_factor(coeffs: &ScatteringCoeffs, sin_theta_over_lambda_sq: f64) -> f64 {
    coeffs
        .iter()
        .map(|[a, b]| a * (-b * sin_theta_over_lambda_sq).exp())
        .sum()
}

// =============================================================================
// XRD Data Structures
// =============================================================================

/// Miller index information for a peak.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HklInfo {
    /// Miller indices [h, k, l]
    pub hkl: [i32; 3],
    /// Multiplicity (number of symmetry-equivalent reflections)
    pub multiplicity: usize,
}

/// XRD pattern result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XrdPattern {
    /// 2θ angles in degrees
    pub two_theta: Vec<f64>,
    /// Peak intensities (scaled 0-100 if scaled=true)
    pub intensities: Vec<f64>,
    /// Miller indices for each peak (grouped by unique families)
    pub hkls: Vec<Vec<HklInfo>>,
    /// d-spacings in Angstroms
    pub d_spacings: Vec<f64>,
}

/// Configuration for XRD calculation.
#[derive(Debug, Clone)]
pub struct XrdConfig {
    /// X-ray wavelength in Angstroms (default: Cu Kα = 1.54184)
    pub wavelength: f64,
    /// 2θ range in degrees as (min, max). None = all accessible angles
    pub two_theta_range: Option<(f64, f64)>,
    /// Debye-Waller factors per element symbol (thermal damping)
    pub debye_waller_factors: HashMap<String, f64>,
    /// Peak merge tolerance in degrees (default: 1e-5)
    pub peak_merge_tol: f64,
    /// Scaled intensity tolerance for filtering weak peaks (default: 1e-3)
    pub scaled_intensity_tol: f64,
    /// Whether to scale intensities to 0-100 (default: true)
    pub scaled: bool,
}

impl Default for XrdConfig {
    fn default() -> Self {
        Self {
            wavelength: wavelengths::CU_KA,
            two_theta_range: Some((0.0, 180.0)),
            debye_waller_factors: HashMap::new(),
            peak_merge_tol: TWO_THETA_TOL,
            scaled_intensity_tol: SCALED_INTENSITY_TOL,
            scaled: true,
        }
    }
}

// =============================================================================
// XRD Calculation
// =============================================================================

/// Reciprocal point with hkl indices and |g| magnitude.
#[derive(Debug)]
struct RecipPoint {
    hkl: [i32; 3],
    g_norm: f64,
}

/// Compute reciprocal lattice matrix (rows are b1, b2, b3).
/// For row-wise lattice matrix A, reciprocal is (A^-1)^T.
fn compute_reciprocal_lattice(lattice_matrix: &Matrix3<f64>) -> Matrix3<f64> {
    lattice_matrix
        .try_inverse()
        .expect("Lattice matrix must be invertible")
        .transpose()
}

/// Enumerate reciprocal space points within a radius range.
fn enumerate_reciprocal_points(
    recip_matrix: &Matrix3<f64>,
    min_radius: f64,
    max_radius: f64,
) -> Vec<RecipPoint> {
    let recip_b1 = recip_matrix.row(0).transpose();
    let recip_b2 = recip_matrix.row(1).transpose();
    let recip_b3 = recip_matrix.row(2).transpose();

    let n1 = recip_b1.norm().max(1e-12);
    let n2 = recip_b2.norm().max(1e-12);
    let n3 = recip_b3.norm().max(1e-12);

    let h_max = ((max_radius / n1) + 2.0).ceil() as i32;
    let k_max = ((max_radius / n2) + 2.0).ceil() as i32;
    let l_max = ((max_radius / n3) + 2.0).ceil() as i32;

    // Safety cap to avoid pathological enumeration
    const CAP: i32 = 512;
    let h_max = h_max.min(CAP);
    let k_max = k_max.min(CAP);
    let l_max = l_max.min(CAP);

    let mut points = Vec::new();

    for h in -h_max..=h_max {
        for k in -k_max..=k_max {
            for l in -l_max..=l_max {
                if h == 0 && k == 0 && l == 0 {
                    continue;
                }
                let g_vec = (h as f64) * recip_b1 + (k as f64) * recip_b2 + (l as f64) * recip_b3;
                let g_norm = g_vec.norm();
                if g_norm >= min_radius && g_norm <= max_radius {
                    points.push(RecipPoint {
                        hkl: [h, k, l],
                        g_norm,
                    });
                }
            }
        }
    }

    // Sort by (g_norm asc, -h, -k, -l) to match pymatgen ordering
    points.sort_by(|p1, p2| {
        p1.g_norm
            .partial_cmp(&p2.g_norm)
            .unwrap()
            .then_with(|| p2.hkl[0].cmp(&p1.hkl[0]))
            .then_with(|| p2.hkl[1].cmp(&p1.hkl[1]))
            .then_with(|| p2.hkl[2].cmp(&p1.hkl[2]))
    });

    points
}

/// Get unique Miller index families with multiplicities.
/// Groups hkl by absolute-value permutations and returns representative + count.
fn get_unique_families(hkls: &[[i32; 3]]) -> Vec<HklInfo> {
    let mut key_map: HashMap<[i32; 3], Vec<[i32; 3]>> = HashMap::new();

    for &hkl in hkls {
        let mut abs_sorted = [hkl[0].abs(), hkl[1].abs(), hkl[2].abs()];
        abs_sorted.sort();
        key_map.entry(abs_sorted).or_default().push(hkl);
    }

    let mut families = Vec::new();
    for group in key_map.values() {
        // Choose representative with max tuple (lexicographic)
        let representative = group
            .iter()
            .max_by(|a, b| {
                a[0].cmp(&b[0])
                    .then_with(|| a[1].cmp(&b[1]))
                    .then_with(|| a[2].cmp(&b[2]))
            })
            .copied()
            .unwrap();
        families.push(HklInfo {
            hkl: representative,
            multiplicity: group.len(),
        });
    }

    families
}

/// Compute powder XRD pattern from a crystal structure.
///
/// # Arguments
///
/// * `structure` - Crystal structure with lattice and atomic sites
/// * `config` - XRD calculation configuration
///
/// # Returns
///
/// XRD pattern with 2θ angles, intensities, hkl indices, and d-spacings.
///
/// # Example
///
/// ```ignore
/// use ferrox::xrd::{compute_xrd, XrdConfig};
///
/// let pattern = compute_xrd(&structure, &XrdConfig::default());
/// ```
pub fn compute_xrd(structure: &Structure, config: &XrdConfig) -> XrdPattern {
    let wavelength = config.wavelength;

    // Get lattice matrix (rows are a, b, c vectors)
    let lattice_matrix = structure.lattice.matrix();
    let recip_matrix = compute_reciprocal_lattice(lattice_matrix);

    // Compute radius bounds from 2θ range using Bragg's law
    // r = 2 sin(θ) / λ
    let (min_radius, max_radius) = match config.two_theta_range {
        Some((t_min, t_max)) => {
            let r_min = (2.0 * (t_min / 2.0).to_radians().sin()) / wavelength;
            let r_max = (2.0 * (t_max / 2.0).to_radians().sin()) / wavelength;
            (r_min, r_max)
        }
        None => (0.0, 2.0 / wavelength),
    };

    let recip_points = enumerate_reciprocal_points(&recip_matrix, min_radius, max_radius);

    // Collect site information for structure factor calculation
    let frac_coords = &structure.frac_coords;
    let site_occupancies = &structure.site_occupancies;

    // Build per-species scattering data
    struct SiteData {
        coeffs: ScatteringCoeffs,
        frac_coord: Vector3<f64>,
        occu: f64,
        dw_factor: f64,
    }

    let mut site_data_list: Vec<SiteData> = Vec::new();

    for (idx, site_occu) in site_occupancies.iter().enumerate() {
        let coord = frac_coords[idx];
        for (species, occu) in &site_occu.species {
            let element = species.element;
            let coeffs = match get_scattering_coeffs(element) {
                Some(c) => *c,
                None => {
                    // Skip elements without scattering data
                    continue;
                }
            };
            let dw_factor = config
                .debye_waller_factors
                .get(element.symbol())
                .copied()
                .unwrap_or(0.0);
            site_data_list.push(SiteData {
                coeffs,
                frac_coord: coord,
                occu: *occu,
                dw_factor,
            });
        }
    }

    // If no valid sites with scattering data, return empty pattern
    if site_data_list.is_empty() {
        return XrdPattern {
            two_theta: vec![],
            intensities: vec![],
            hkls: vec![],
            d_spacings: vec![],
        };
    }

    // Calculate peaks
    struct PeakData {
        intensity: f64,
        hkls: Vec<[i32; 3]>,
        d_hkl: f64,
    }

    let mut peaks: HashMap<i64, PeakData> = HashMap::new();
    let mut two_thetas: Vec<f64> = Vec::new();
    let merge_tol = config.peak_merge_tol;

    for point in &recip_points {
        let hkl = point.hkl;
        let g_norm = point.g_norm;

        if g_norm == 0.0 {
            continue;
        }

        // Bragg angle
        let asin_arg = (wavelength * g_norm / 2.0).clamp(-1.0, 1.0);
        let theta = asin_arg.asin();
        let sin_theta_over_lambda = g_norm / 2.0;
        let sin_theta_over_lambda_sq = sin_theta_over_lambda * sin_theta_over_lambda;

        // Structure factor: F = Σ(f × occ × exp(2πi g·r) × DW)
        let mut f_real = 0.0;
        let mut f_imag = 0.0;

        for site in &site_data_list {
            let f_scatter = atomic_scattering_factor(&site.coeffs, sin_theta_over_lambda_sq);
            let dw_corr = (-site.dw_factor * sin_theta_over_lambda_sq).exp();

            // g·r = h*x + k*y + l*z
            let g_dot_r = (hkl[0] as f64) * site.frac_coord.x
                + (hkl[1] as f64) * site.frac_coord.y
                + (hkl[2] as f64) * site.frac_coord.z;

            let phase = 2.0 * PI * g_dot_r;
            let weight = f_scatter * site.occu * dw_corr;

            f_real += weight * phase.cos();
            f_imag += weight * phase.sin();
        }

        // Lorentz-polarization factor
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();
        let denom = (sin_theta * sin_theta * cos_theta.abs()).max(1e-12);
        let lorentz = (1.0 + (2.0 * theta).cos().powi(2)) / denom;

        let intensity_hkl = (f_real * f_real + f_imag * f_imag) * lorentz;
        let two_theta = 2.0 * theta.to_degrees();

        // Merge peaks within tolerance
        let mut found_key: Option<i64> = None;
        for (idx, &existing_tt) in two_thetas.iter().enumerate() {
            if (existing_tt - two_theta).abs() < merge_tol {
                found_key = Some(idx as i64);
                break;
            }
        }

        if let Some(key) = found_key {
            if let Some(peak) = peaks.get_mut(&key) {
                peak.intensity += intensity_hkl;
                peak.hkls.push(hkl);
            }
        } else {
            let d_hkl = 1.0 / g_norm;
            let key = two_thetas.len() as i64;
            peaks.insert(
                key,
                PeakData {
                    intensity: intensity_hkl,
                    hkls: vec![hkl],
                    d_hkl,
                },
            );
            two_thetas.push(two_theta);
        }
    }

    if peaks.is_empty() {
        return XrdPattern {
            two_theta: vec![],
            intensities: vec![],
            hkls: vec![],
            d_spacings: vec![],
        };
    }

    // Sort by 2θ and filter weak peaks
    let max_intensity = peaks
        .values()
        .map(|p| p.intensity)
        .fold(f64::NEG_INFINITY, f64::max);

    let mut sorted_indices: Vec<i64> = peaks.keys().copied().collect();
    sorted_indices.sort_by(|&a, &b| {
        two_thetas[a as usize]
            .partial_cmp(&two_thetas[b as usize])
            .unwrap()
    });

    let mut result_two_theta = Vec::new();
    let mut result_intensities = Vec::new();
    let mut result_hkls = Vec::new();
    let mut result_d_spacings = Vec::new();

    for key in sorted_indices {
        let peak = &peaks[&key];
        let scaled_val = (peak.intensity / max_intensity) * 100.0;
        if scaled_val > config.scaled_intensity_tol {
            result_two_theta.push(two_thetas[key as usize]);
            result_intensities.push(peak.intensity);
            result_hkls.push(get_unique_families(&peak.hkls));
            result_d_spacings.push(peak.d_hkl);
        }
    }

    // Scale intensities if requested
    if config.scaled && !result_intensities.is_empty() {
        let max_y = result_intensities.iter().fold(1.0_f64, |a, &b| a.max(b));
        for intensity in &mut result_intensities {
            *intensity = (*intensity / max_y) * 100.0;
        }
    }

    XrdPattern {
        two_theta: result_two_theta,
        intensities: result_intensities,
        hkls: result_hkls,
        d_spacings: result_d_spacings,
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lattice::Lattice;
    use crate::species::Species;

    fn make_nacl() -> Structure {
        // Simple NaCl structure (rock salt)
        let lattice = Lattice::cubic(5.64);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let frac_coords = vec![
            Vector3::new(0.0, 0.0, 0.0), // Na at origin
            Vector3::new(0.5, 0.5, 0.5), // Cl at body center
        ];
        Structure::new(lattice, species, frac_coords)
    }

    fn make_si() -> Structure {
        // Silicon diamond structure
        let lattice = Lattice::cubic(5.431);
        let species = vec![Species::neutral(Element::Si), Species::neutral(Element::Si)];
        let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.25, 0.25, 0.25)];
        Structure::new(lattice, species, frac_coords)
    }

    #[test]
    fn test_scattering_params_loaded() {
        let params = get_scattering_params();
        assert!(params.contains_key("Fe"));
        assert!(params.contains_key("Na"));
        assert!(params.contains_key("Cl"));
        assert!(params.contains_key("Si"));
    }

    #[test]
    fn test_atomic_scattering_factor() {
        let coeffs = get_scattering_coeffs(Element::Fe).unwrap();
        // At s=0, f should be sum of all a coefficients
        let f_0 = atomic_scattering_factor(coeffs, 0.0);
        let expected_f_0: f64 = coeffs.iter().map(|[a, _]| a).sum();
        assert!((f_0 - expected_f_0).abs() < 1e-10);

        // f should decrease with increasing s
        let f_1 = atomic_scattering_factor(coeffs, 0.1);
        assert!(f_1 < f_0);
    }

    #[test]
    fn test_reciprocal_lattice() {
        let lattice = Matrix3::from_row_slice(&[5.0, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0]);
        let recip = compute_reciprocal_lattice(&lattice);
        // For cubic lattice with a=5, reciprocal should have b*=1/5=0.2
        assert!((recip[(0, 0)] - 0.2).abs() < 1e-10);
        assert!((recip[(1, 1)] - 0.2).abs() < 1e-10);
        assert!((recip[(2, 2)] - 0.2).abs() < 1e-10);
    }

    #[test]
    fn test_enumerate_reciprocal_points() {
        let recip = Matrix3::from_row_slice(&[0.2, 0.0, 0.0, 0.0, 0.2, 0.0, 0.0, 0.0, 0.2]);
        let points = enumerate_reciprocal_points(&recip, 0.0, 0.5);
        // Should have points like (1,0,0), (0,1,0), etc.
        assert!(!points.is_empty());
        // (1,0,0) has |g| = 0.2
        let has_100 = points
            .iter()
            .any(|p| p.hkl == [1, 0, 0] || p.hkl == [-1, 0, 0]);
        assert!(has_100, "Should contain (1,0,0) or equivalent");
    }

    #[test]
    fn test_get_unique_families() {
        let hkls = vec![
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
            [0, 0, 1],
            [0, 0, -1],
        ];
        let families = get_unique_families(&hkls);
        // All these should merge to one family (1,0,0) with multiplicity 6
        assert_eq!(families.len(), 1);
        assert_eq!(families[0].multiplicity, 6);
    }

    #[test]
    fn test_compute_xrd_nacl() {
        let structure = make_nacl();
        let config = XrdConfig {
            two_theta_range: Some((10.0, 90.0)),
            ..Default::default()
        };
        let pattern = compute_xrd(&structure, &config);

        // Should have peaks
        assert!(!pattern.two_theta.is_empty());
        assert_eq!(pattern.two_theta.len(), pattern.intensities.len());
        assert_eq!(pattern.two_theta.len(), pattern.hkls.len());
        assert_eq!(pattern.two_theta.len(), pattern.d_spacings.len());

        // 2θ should be in range
        for &tt in &pattern.two_theta {
            assert!((10.0..=90.0).contains(&tt), "2θ = {tt} out of range");
        }

        // Intensities should be scaled 0-100
        let max_i = pattern.intensities.iter().fold(0.0_f64, |a, &b| a.max(b));
        assert!((max_i - 100.0).abs() < 0.01, "Max intensity should be ~100");

        // d-spacings should be positive
        for &d in &pattern.d_spacings {
            assert!(d > 0.0, "d-spacing must be positive");
        }
    }

    #[test]
    fn test_compute_xrd_si() {
        let structure = make_si();
        let pattern = compute_xrd(&structure, &XrdConfig::default());

        // Silicon should have characteristic peaks
        assert!(!pattern.two_theta.is_empty());

        // Check that (111) peak exists (strongest for diamond cubic)
        let has_111 = pattern.hkls.iter().any(|families| {
            families.iter().any(|info| {
                let h = info.hkl;
                [h[0].abs(), h[1].abs(), h[2].abs()] == [1, 1, 1]
            })
        });
        assert!(has_111, "Si should have (111) reflection");
    }

    #[test]
    fn test_compute_xrd_empty_range() {
        let structure = make_nacl();
        let config = XrdConfig {
            two_theta_range: Some((0.1, 0.2)), // Very narrow range, likely no peaks
            ..Default::default()
        };
        let pattern = compute_xrd(&structure, &config);
        // May be empty, that's OK - just shouldn't panic
        assert!(pattern.two_theta.len() == pattern.intensities.len());
    }

    #[test]
    fn test_compute_xrd_with_debye_waller() {
        let structure = make_nacl();
        let mut dw_factors = HashMap::new();
        dw_factors.insert("Na".to_string(), 0.5);
        dw_factors.insert("Cl".to_string(), 0.5);

        let config_no_dw = XrdConfig::default();
        let config_with_dw = XrdConfig {
            debye_waller_factors: dw_factors,
            ..Default::default()
        };

        let pattern_no_dw = compute_xrd(&structure, &config_no_dw);
        let pattern_with_dw = compute_xrd(&structure, &config_with_dw);

        // Both should have peaks
        assert!(!pattern_no_dw.two_theta.is_empty());
        assert!(!pattern_with_dw.two_theta.is_empty());

        // Peak positions should be the same (DW only affects intensity)
        // Just check counts are similar
        assert!(
            (pattern_no_dw.two_theta.len() as i32 - pattern_with_dw.two_theta.len() as i32).abs()
                <= 2
        );
    }

    #[test]
    fn test_compute_xrd_unscaled() {
        let structure = make_nacl();
        let config = XrdConfig {
            scaled: false,
            ..Default::default()
        };
        let pattern = compute_xrd(&structure, &config);

        // Should have peaks
        assert!(!pattern.intensities.is_empty());

        // Just verify intensities are positive (when unscaled, max won't be 100)
        for &intensity in &pattern.intensities {
            assert!(intensity > 0.0);
        }
    }
}
