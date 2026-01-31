//! Radial Distribution Function (RDF) calculation for crystal structures.
//!
//! This module provides methods to compute pair correlation functions g(r),
//! which describe how atomic density varies as a function of distance from
//! a reference atom.
//!
//! # Features
//!
//! - **Total RDF**: All atom pairs
//! - **Element-resolved RDF**: Filter by element pairs (e.g., Fe-O)
//! - **Auto-expansion**: Automatically expand to supercell to avoid finite-size effects
//! - **Occupancy weighting**: Proper handling of mixed-occupancy sites
//!
//! # Example
//!
//! ```rust,ignore
//! use ferrox::Structure;
//! use ferrox::rdf::{compute_rdf, RdfOptions, RdfResult};
//!
//! let structure = Structure::from_json(json_str)?;
//! let options = RdfOptions::default();
//! let RdfResult { radii, g_of_r } = compute_rdf(&structure, &options);
//! ```

use crate::element::Element;
use crate::structure::Structure;
use std::f64::consts::PI;

/// Result of an RDF calculation.
#[derive(Debug, Clone)]
pub struct RdfResult {
    /// Bin center positions in Angstroms.
    pub radii: Vec<f64>,
    /// RDF values g(r) at each bin center.
    pub g_of_r: Vec<f64>,
}

/// Options for RDF calculation.
#[derive(Debug, Clone)]
pub struct RdfOptions {
    /// Maximum distance (cutoff) in Angstroms. Default: 15.0
    pub r_max: f64,
    /// Number of histogram bins. Default: 75
    pub n_bins: usize,
    /// Whether to normalize by ideal gas density. Default: true
    pub normalize: bool,
    /// Whether to auto-expand structure to avoid finite-size effects. Default: true
    pub auto_expand: bool,
    /// Expansion factor: minimum lattice dimension = r_max × factor. Default: 2.0
    pub expansion_factor: f64,
}

impl Default for RdfOptions {
    fn default() -> Self {
        Self {
            r_max: 15.0,
            n_bins: 75,
            normalize: true,
            auto_expand: true,
            expansion_factor: 2.0,
        }
    }
}

impl RdfOptions {
    /// Create new options with specified r_max and n_bins.
    pub fn new(r_max: f64, n_bins: usize) -> Self {
        Self {
            r_max,
            n_bins,
            ..Default::default()
        }
    }

    /// Set whether to normalize the RDF.
    pub fn with_normalize(mut self, normalize: bool) -> Self {
        self.normalize = normalize;
        self
    }

    /// Set whether to auto-expand the structure.
    pub fn with_auto_expand(mut self, auto_expand: bool) -> Self {
        self.auto_expand = auto_expand;
        self
    }

    /// Set the expansion factor for auto-expansion.
    pub fn with_expansion_factor(mut self, factor: f64) -> Self {
        self.expansion_factor = factor;
        self
    }
}

// Helper: get occupancy at a site - total occupancy if element is None, else element-specific
fn get_element_occupancy(structure: &Structure, site_idx: usize, element: Option<Element>) -> f64 {
    let site = &structure.site_occupancies[site_idx].species;
    match element {
        None => site.iter().map(|(_, occ)| occ).sum(),
        Some(elem) => site
            .iter()
            .filter_map(|(sp, occ)| (sp.element == elem).then_some(occ))
            .sum(),
    }
}

// Helper: prepare structure (with auto-expansion if needed)
fn prepare_structure(structure: &Structure, options: &RdfOptions) -> Structure {
    if !options.auto_expand {
        return structure.clone();
    }
    let lengths = structure.lattice.lengths();
    let min_size = options.r_max * options.expansion_factor;
    // Clamp supercell size to avoid overflow and unreasonably large expansions
    const MAX_SUPERCELL: i32 = 100;
    let ns: [i32; 3] = std::array::from_fn(|idx| {
        let n = (min_size / lengths[idx]).ceil();
        if n.is_finite() && n <= MAX_SUPERCELL as f64 {
            n as i32
        } else {
            MAX_SUPERCELL
        }
    });

    if ns.iter().any(|&n| n > 1) {
        structure.make_supercell_diag(ns)
    } else {
        structure.clone()
    }
}

// Core RDF computation with optional element filtering
fn compute_rdf_internal(
    structure: &Structure,
    element_a: Option<Element>,
    element_b: Option<Element>,
    options: &RdfOptions,
) -> RdfResult {
    let n_bins = options.n_bins;
    let r_max = options.r_max;

    // Guard against n_bins=0 or invalid r_max
    if n_bins == 0 || r_max <= 0.0 {
        return RdfResult {
            radii: vec![],
            g_of_r: vec![],
        };
    }

    let bin_size = r_max / n_bins as f64;

    // Bin centers
    let radii: Vec<f64> = (0..n_bins)
        .map(|idx| (idx as f64 + 0.5) * bin_size)
        .collect();

    // Empty structure case
    if structure.num_sites() == 0 {
        return RdfResult {
            radii,
            g_of_r: vec![0.0; n_bins],
        };
    }

    // Prepare structure (auto-expand if enabled)
    let work_struct = prepare_structure(structure, options);

    // Get neighbor list (use the expanded structure, so no need for PBC - but the method
    // handles it correctly anyway)
    let (centers, neighbors, _images, distances) = work_struct.get_neighbor_list(r_max, 1e-8, true);

    // Build histogram with occupancy weighting
    let mut g_of_r = vec![0.0; n_bins];

    for ((&center_idx, &neighbor_idx), &dist) in
        centers.iter().zip(neighbors.iter()).zip(distances.iter())
    {
        // Weight by occupancy product (0.0 if element not at site)
        let weight = get_element_occupancy(&work_struct, center_idx, element_a)
            * get_element_occupancy(&work_struct, neighbor_idx, element_b);

        if weight > 0.0 && dist > 0.0 && dist < r_max {
            let bin_idx = (dist / bin_size).floor() as usize;
            let bin_idx = bin_idx.min(n_bins - 1);
            g_of_r[bin_idx] += weight;
        }
    }

    // Normalize if requested
    if options.normalize {
        // Helper to sum occupancies across all sites
        let sum_occupancy = |elem| -> f64 {
            (0..work_struct.num_sites())
                .map(|idx| get_element_occupancy(&work_struct, idx, elem))
                .sum()
        };

        let center_weight = sum_occupancy(element_a);
        let neighbor_weight = sum_occupancy(element_b);

        // Self-weight correction (for same-element pairs, exclude self-interactions)
        let self_weight = if element_a == element_b {
            (0..work_struct.num_sites())
                .map(|idx| get_element_occupancy(&work_struct, idx, element_a).powi(2))
                .sum()
        } else {
            0.0
        };

        let n_pairs = center_weight * neighbor_weight - self_weight;

        if n_pairs > 0.0 {
            let volume = work_struct.lattice.volume();
            for (bin_idx, g_val) in g_of_r.iter_mut().enumerate() {
                let shell_volume = 4.0 * PI * radii[bin_idx] * radii[bin_idx] * bin_size;
                *g_val /= n_pairs * shell_volume / volume;
            }
        }
    }

    RdfResult { radii, g_of_r }
}

/// Compute the total radial distribution function for all atom pairs.
///
/// # Arguments
///
/// * `structure` - The crystal structure to analyze
/// * `options` - RDF calculation options
///
/// # Returns
///
/// An `RdfResult` containing bin centers `radii` and RDF values `g_of_r`.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::rdf::{compute_rdf, RdfOptions};
///
/// let result = compute_rdf(&structure, &RdfOptions::default());
/// for (radius, g_val) in result.radii.iter().zip(result.g_of_r.iter()) {
///     println!("r={:.2} Å, g(r)={:.3}", radius, g_val);
/// }
/// ```
pub fn compute_rdf(structure: &Structure, options: &RdfOptions) -> RdfResult {
    compute_rdf_internal(structure, None, None, options)
}

/// Compute element-resolved radial distribution function.
///
/// Calculates g(r) for a specific element pair, counting distances from
/// atoms of `element_a` to atoms of `element_b`.
///
/// # Arguments
///
/// * `structure` - The crystal structure to analyze
/// * `element_a` - Center element (e.g., Element::Fe)
/// * `element_b` - Neighbor element (e.g., Element::O)
/// * `options` - RDF calculation options
///
/// # Returns
///
/// An `RdfResult` containing bin centers `radii` and RDF values `g_of_r`.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::element::Element;
/// use ferrox::rdf::{compute_element_rdf, RdfOptions};
///
/// // Compute Fe-O pair distribution
/// let result = compute_element_rdf(&structure, Element::Fe, Element::O, &RdfOptions::default());
/// ```
pub fn compute_element_rdf(
    structure: &Structure,
    element_a: Element,
    element_b: Element,
    options: &RdfOptions,
) -> RdfResult {
    compute_rdf_internal(structure, Some(element_a), Some(element_b), options)
}

/// Compute RDF for all unique element pairs in the structure.
///
/// Returns one RDF for each unique (element_a, element_b) pair where
/// element_a <= element_b (by atomic number), avoiding duplicates.
///
/// # Arguments
///
/// * `structure` - The crystal structure to analyze
/// * `options` - RDF calculation options
///
/// # Returns
///
/// A vector of tuples (element_a, element_b, RdfResult) for each unique pair.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::rdf::{compute_all_element_rdfs, RdfOptions};
///
/// for (elem_a, elem_b, result) in compute_all_element_rdfs(&structure, &RdfOptions::default()) {
///     println!("{}-{} RDF computed", elem_a.symbol(), elem_b.symbol());
/// }
/// ```
pub fn compute_all_element_rdfs(
    structure: &Structure,
    options: &RdfOptions,
) -> Vec<(Element, Element, RdfResult)> {
    // Get unique elements sorted by atomic number
    let mut elements = structure.unique_elements();
    elements.sort_by_key(|elem| elem.atomic_number());

    // Prepare structure once for all pairs (if auto_expand is enabled)
    let work_struct = prepare_structure(structure, options);
    let options_no_expand = RdfOptions {
        auto_expand: false,
        ..options.clone()
    };

    // Compute RDF for each unique pair (upper triangle including diagonal)
    let mut results = Vec::new();
    for (idx_a, &elem_a) in elements.iter().enumerate() {
        for &elem_b in elements.iter().skip(idx_a) {
            let rdf =
                compute_rdf_internal(&work_struct, Some(elem_a), Some(elem_b), &options_no_expand);
            results.push((elem_a, elem_b, rdf));
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lattice::Lattice;
    use crate::species::Species;

    // === Test Fixtures ===

    fn make_nacl() -> Structure {
        // NaCl rock salt (conventional cell, 8 atoms)
        let lattice = Lattice::cubic(5.64);
        let species = [
            Element::Na,
            Element::Na,
            Element::Na,
            Element::Na,
            Element::Cl,
            Element::Cl,
            Element::Cl,
            Element::Cl,
        ]
        .map(Species::neutral)
        .to_vec();
        let frac_coords = vec![
            [0.0, 0.0, 0.0].into(),
            [0.5, 0.5, 0.0].into(),
            [0.5, 0.0, 0.5].into(),
            [0.0, 0.5, 0.5].into(),
            [0.5, 0.5, 0.5].into(),
            [0.0, 0.0, 0.5].into(),
            [0.0, 0.5, 0.0].into(),
            [0.5, 0.0, 0.0].into(),
        ];
        Structure::new(lattice, species, frac_coords)
    }

    fn make_fcc(element: Element, lattice_const: f64) -> Structure {
        let lattice = Lattice::cubic(lattice_const);
        let species = vec![Species::neutral(element); 4];
        let frac_coords = vec![
            [0.0, 0.0, 0.0].into(),
            [0.5, 0.5, 0.0].into(),
            [0.5, 0.0, 0.5].into(),
            [0.0, 0.5, 0.5].into(),
        ];
        Structure::new(lattice, species, frac_coords)
    }

    fn find_peak_idx(g_of_r: &[f64]) -> usize {
        assert!(!g_of_r.is_empty(), "find_peak_idx requires non-empty slice");
        g_of_r
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(idx, _)| idx)
            .expect("find_peak_idx found no valid maximum")
    }

    fn rdf_opts(r_max: f64, n_bins: usize) -> RdfOptions {
        RdfOptions::new(r_max, n_bins).with_auto_expand(false)
    }

    // === Core Functionality Tests ===

    #[test]
    fn test_rdf_options() {
        // Default values
        let def = RdfOptions::default();
        assert!((def.r_max - 15.0).abs() < 1e-10);
        assert_eq!(def.n_bins, 75);
        assert!(def.normalize && def.auto_expand);

        // Builder pattern
        let custom = RdfOptions::new(10.0, 50)
            .with_normalize(false)
            .with_auto_expand(false);
        assert!((custom.r_max - 10.0).abs() < 1e-10);
        assert_eq!(custom.n_bins, 50);
        assert!(!custom.normalize && !custom.auto_expand);
    }

    #[test]
    fn test_rdf_basic_output() {
        let result = compute_rdf(&make_nacl(), &rdf_opts(8.0, 40));

        assert_eq!(result.radii.len(), 40);
        assert_eq!(result.g_of_r.len(), 40);
        assert!((result.radii[0] - 0.1).abs() < 1e-10); // First bin center
        assert!((result.radii[39] - 7.9).abs() < 1e-10); // Last bin center
        assert!(result.g_of_r.iter().any(|&g| g > 0.0)); // Has peaks
    }

    #[test]
    fn test_bin_centers_various_configs() {
        let structure = make_nacl();
        for (r_max, n_bins) in [(10.0, 50), (6.0, 30), (8.0, 20), (6.0, 600), (6.0, 1)] {
            let result = compute_rdf(&structure, &rdf_opts(r_max, n_bins));
            let bin_size = r_max / n_bins as f64;

            assert_eq!(result.radii.len(), n_bins);
            assert!(
                (result.radii[0] - 0.5 * bin_size).abs() < 1e-10,
                "First bin center wrong for r_max={r_max}, n_bins={n_bins}"
            );
            assert!(
                (result.radii[n_bins - 1] - (n_bins as f64 - 0.5) * bin_size).abs() < 1e-10,
                "Last bin center wrong for r_max={r_max}, n_bins={n_bins}"
            );

            // Uniform spacing
            for idx in 1..n_bins {
                assert!((result.radii[idx] - result.radii[idx - 1] - bin_size).abs() < 1e-10);
            }
        }
    }

    #[test]
    fn test_exact_bin_assignment() {
        // Dimer: two Fe atoms 2.0 Å apart in 4 Å cell
        let structure = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe); 2],
            vec![[0.0, 0.0, 0.0].into(), [0.5, 0.0, 0.0].into()],
        );
        let result = compute_rdf(&structure, &rdf_opts(5.0, 50).with_normalize(false));

        // 2.0 Å → bin 20 (bin_size=0.1 Å)
        assert!(
            result.g_of_r[20] > 0.0,
            "Expected count in bin 20 for 2.0 Å distance, got: {:?}",
            result
                .g_of_r
                .iter()
                .enumerate()
                .filter(|(_, v)| **v > 0.0)
                .collect::<Vec<_>>()
        );
    }

    // === Element Filtering Tests ===

    #[test]
    fn test_element_rdf_peak_ordering() {
        let structure = make_nacl();
        let options = rdf_opts(8.0, 40);

        let na_cl = compute_element_rdf(&structure, Element::Na, Element::Cl, &options);
        let na_na = compute_element_rdf(&structure, Element::Na, Element::Na, &options);

        // Na-Cl peak (~2.82 Å) should be closer than Na-Na peak (~3.99 Å)
        assert!(
            na_cl.radii[find_peak_idx(&na_cl.g_of_r)] < na_na.radii[find_peak_idx(&na_na.g_of_r)]
        );
    }

    #[test]
    fn test_element_filtering_changes_rdf() {
        let structure = make_nacl();
        let (r_max, n_bins) = (6.0, 30);
        let options = rdf_opts(r_max, n_bins).with_normalize(false);

        let total = compute_rdf(&structure, &options);
        let na_cl = compute_element_rdf(&structure, Element::Na, Element::Cl, &options);
        let na_na = compute_element_rdf(&structure, Element::Na, Element::Na, &options);

        assert!(
            na_cl.g_of_r != na_na.g_of_r,
            "Na-Cl should differ from Na-Na"
        );
        assert!(
            na_cl.g_of_r != total.g_of_r,
            "Na-Cl should differ from total"
        );

        // Na-Cl should dominate in 2.5-3.0 Å range (Na-Cl distance ~2.82 Å)
        let bin_size = r_max / n_bins as f64;
        let start = (2.5 / bin_size).floor() as usize;
        let end = (3.0 / bin_size).ceil() as usize;
        let na_cl_sum: f64 = na_cl.g_of_r[start..end].iter().sum();
        let na_na_sum: f64 = na_na.g_of_r[start..end].iter().sum();
        assert!(
            na_cl_sum > na_na_sum,
            "Na-Cl: {na_cl_sum}, Na-Na: {na_na_sum}"
        );
    }

    #[test]
    fn test_element_rdf_symmetry() {
        let structure = make_nacl();
        let options = rdf_opts(6.0, 30);

        let na_cl = compute_element_rdf(&structure, Element::Na, Element::Cl, &options);
        let cl_na = compute_element_rdf(&structure, Element::Cl, Element::Na, &options);

        // Peaks at same positions (values may differ due to normalization)
        for (idx, (&g1, &g2)) in na_cl.g_of_r.iter().zip(&cl_na.g_of_r).enumerate() {
            if g1 > 0.1 {
                assert!(g2 > 0.0, "Na-Cl peak at bin {idx} missing in Cl-Na");
            }
        }
    }

    #[test]
    fn test_all_element_rdfs() {
        let nacl = make_nacl();
        let fcc_cu = make_fcc(Element::Cu, 3.615);

        // NaCl: 3 pairs (Na-Na, Na-Cl, Cl-Cl)
        let nacl_pairs = compute_all_element_rdfs(&nacl, &rdf_opts(6.0, 30));
        assert_eq!(nacl_pairs.len(), 3);
        let pair_names: Vec<_> = nacl_pairs
            .iter()
            .map(|(a, b, _)| (a.symbol(), b.symbol()))
            .collect();
        assert!(
            pair_names.contains(&("Na", "Na"))
                && pair_names.contains(&("Na", "Cl"))
                && pair_names.contains(&("Cl", "Cl"))
        );

        // FCC Cu: 1 pair (Cu-Cu)
        let cu_pairs = compute_all_element_rdfs(&fcc_cu, &rdf_opts(5.0, 50));
        assert_eq!(cu_pairs.len(), 1);
        assert_eq!((cu_pairs[0].0, cu_pairs[0].1), (Element::Cu, Element::Cu));
    }

    #[test]
    fn test_total_rdf_equals_sum_of_partials() {
        let structure = make_nacl();
        let options = rdf_opts(6.0, 30).with_normalize(false);

        let total = compute_rdf(&structure, &options);
        let partials = compute_all_element_rdfs(&structure, &options);

        let mut summed = vec![0.0; 30];
        for (elem_a, elem_b, partial) in &partials {
            let mult = if elem_a == elem_b { 1.0 } else { 2.0 };
            for (idx, &g) in partial.g_of_r.iter().enumerate() {
                summed[idx] += g * mult;
            }
        }

        for (idx, (&total_g, &sum_g)) in total.g_of_r.iter().zip(&summed).enumerate() {
            assert!(
                (total_g - sum_g).abs() < 1e-10,
                "Bin {idx}: total {total_g} != sum {sum_g}"
            );
        }
    }

    // === Peak Position Tests ===

    #[test]
    fn test_nacl_peak_positions() {
        let structure = make_nacl();
        let options = rdf_opts(6.0, 60);

        // Na-Cl: a/2 = 2.82 Å
        let na_cl = compute_element_rdf(&structure, Element::Na, Element::Cl, &options);
        let na_cl_peak = na_cl.radii[find_peak_idx(&na_cl.g_of_r)];
        assert!(
            (na_cl_peak - 2.82).abs() < 0.2,
            "Na-Cl peak at {na_cl_peak:.2}, expected ~2.82 Å"
        );

        // Na-Na: a/√2 ≈ 3.99 Å
        let na_na = compute_element_rdf(&structure, Element::Na, Element::Na, &options);
        let na_na_peak = na_na.radii[find_peak_idx(&na_na.g_of_r)];
        assert!(
            (na_na_peak - 3.99).abs() < 0.3,
            "Na-Na peak at {na_na_peak:.2}, expected ~3.99 Å"
        );
    }

    #[test]
    fn test_fcc_peak_position() {
        let structure = make_fcc(Element::Cu, 3.615);
        let result = compute_rdf(&structure, &rdf_opts(5.0, 50));

        // FCC nearest neighbor: a/√2 ≈ 2.556 Å
        let expected = 3.615 / 2.0_f64.sqrt();
        let peak_r = result.radii[find_peak_idx(&result.g_of_r)];
        assert!(
            (peak_r - expected).abs() < 0.2,
            "FCC Cu peak at {peak_r:.2}, expected ~{expected:.2} Å"
        );
    }

    #[test]
    fn test_unnormalized_counts() {
        let structure = make_nacl();
        let (r_max, n_bins) = (4.0, 40);
        let options = rdf_opts(r_max, n_bins).with_normalize(false);
        let na_cl = compute_element_rdf(&structure, Element::Na, Element::Cl, &options);

        // Sum counts in 2.5-3.2 Å region (first shell, Na-Cl distance ~2.82 Å)
        let bin_size = r_max / n_bins as f64;
        let start = (2.5 / bin_size).floor() as usize;
        let end = (3.2 / bin_size).ceil() as usize;
        let count: f64 = na_cl.g_of_r[start..end.min(n_bins)].iter().sum();
        // 4 Na × 6 Cl neighbors = 24 pairs
        assert!(
            count > 20.0 && count < 30.0,
            "Expected ~24 Na-Cl pairs, got {count}"
        );
    }

    // === Edge Cases ===

    #[test]
    fn test_zero_rdf_cases() {
        let nacl = make_nacl();

        // Empty structure
        let empty = Structure::new(Lattice::cubic(5.0), vec![], vec![]);
        let empty_result = compute_rdf(&empty, &RdfOptions::default());
        assert!(empty_result.g_of_r.iter().all(|&g| g == 0.0));

        // r_max=0
        let zero_r = compute_rdf(
            &nacl,
            &RdfOptions {
                r_max: 0.0,
                n_bins: 10,
                normalize: false,
                auto_expand: false,
                expansion_factor: 2.0,
            },
        );
        assert!(zero_r.g_of_r.iter().all(|&g| g == 0.0));

        // r_max < nearest neighbor
        let small_r = compute_rdf(&nacl, &rdf_opts(1.0, 10));
        assert!(small_r.g_of_r.iter().all(|&g| g == 0.0));

        // Non-existent elements
        let fe_o = compute_element_rdf(&nacl, Element::Fe, Element::O, &rdf_opts(5.0, 25));
        assert!(fe_o.g_of_r.iter().all(|&g| g == 0.0));
    }

    #[test]
    fn test_single_atom_has_periodic_peaks() {
        let structure = Structure::new(
            Lattice::cubic(3.0),
            vec![Species::neutral(Element::Fe)],
            vec![[0.0, 0.0, 0.0].into()],
        );
        let result = compute_rdf(&structure, &rdf_opts(5.0, 25));

        // Peak at lattice constant (3.0 Å) from periodic images
        let bins_near_3a = &result.g_of_r[14..17]; // bins around 3.0 Å
        assert!(
            bins_near_3a.iter().any(|&g| g > 0.0),
            "Expected periodic image peak at 3.0 Å"
        );
    }

    #[test]
    fn test_auto_expand() {
        let structure = make_nacl();

        let expanded = compute_rdf(
            &structure,
            &RdfOptions::new(8.0, 40).with_expansion_factor(1.5),
        );
        let not_expanded = compute_rdf(&structure, &rdf_opts(8.0, 40));

        // Both produce valid results
        assert_eq!(expanded.radii.len(), not_expanded.radii.len());
        assert!(expanded.g_of_r.iter().any(|&g| g > 0.0));
        assert!(not_expanded.g_of_r.iter().any(|&g| g > 0.0));
    }

    #[test]
    fn test_partial_occupancy_weighting() {
        use crate::species::SiteOccupancy;

        // Create dimer with partial occupancy: site A has 0.5 Fe, site B has 1.0 Fe
        // Total RDF should weight pair by 0.5 * 1.0 = 0.5
        let lattice = Lattice::cubic(4.0);
        let site_a = SiteOccupancy::new(vec![(Species::neutral(Element::Fe), 0.5)]);
        let site_b = SiteOccupancy::new(vec![(Species::neutral(Element::Fe), 1.0)]);
        let frac_coords = vec![[0.0, 0.0, 0.0].into(), [0.5, 0.0, 0.0].into()];
        let partial_struct = Structure::try_new_from_occupancies(
            lattice.clone(),
            vec![site_a, site_b],
            frac_coords.clone(),
        )
        .unwrap();

        // Create same structure with full occupancy for comparison
        let full_struct =
            Structure::new(lattice, vec![Species::neutral(Element::Fe); 2], frac_coords);

        let options = rdf_opts(5.0, 50).with_normalize(false);

        let partial_rdf = compute_rdf(&partial_struct, &options);
        let full_rdf = compute_rdf(&full_struct, &options);

        // Find bin with the 2.0 Å peak
        let peak_bin = 20; // 2.0 Å / 0.1 Å bin_size = bin 20

        // Partial occupancy should give half the count of full occupancy
        // (0.5 * 1.0 = 0.5 vs 1.0 * 1.0 = 1.0 for the pair)
        let partial_count = partial_rdf.g_of_r[peak_bin];
        let full_count = full_rdf.g_of_r[peak_bin];

        assert!(
            partial_count > 0.0 && full_count > 0.0,
            "Both should have counts at 2.0 Å"
        );
        assert!(
            (partial_count / full_count - 0.5).abs() < 0.1,
            "Partial occupancy count ({partial_count}) should be ~0.5x full ({full_count})"
        );
    }
}
