//! CIF (Crystallographic Information File) parser.
//!
//! This module provides functions for parsing crystal structures from CIF format.
//!
//! # Limitations
//!
//! Currently only supports CIF files with P1 symmetry (space group 1) or files that
//! already contain all atoms in the unit cell. Files with higher symmetry that require
//! symmetry expansion are not yet supported.

use crate::element::{Element, normalize_symbol};
use crate::error::{FerroxError, Result};
use crate::lattice::Lattice;
use crate::species::{SiteOccupancy, Species};
use crate::structure::Structure;
use nalgebra::Vector3;
use std::collections::HashMap;
use std::path::Path;

/// Parse a structure from a CIF file.
///
/// # Arguments
///
/// * `path` - Path to the CIF file
///
/// # Returns
///
/// The parsed structure or an error if parsing fails.
///
/// # Limitations
///
/// Only P1 structures are currently supported. For non-P1 structures,
/// pre-expand the asymmetric unit before using this function.
pub fn parse_cif(path: &Path) -> Result<Structure> {
    let content = std::fs::read_to_string(path)?;
    parse_cif_str(&content, path)
}

/// Parse a structure from CIF content string.
pub fn parse_cif_str(content: &str, path: &Path) -> Result<Structure> {
    let path_str = path.display().to_string();

    // Parse cell parameters
    let a = parse_cif_float(content, "_cell_length_a", &path_str)?;
    let b = parse_cif_float(content, "_cell_length_b", &path_str)?;
    let c = parse_cif_float(content, "_cell_length_c", &path_str)?;
    let alpha = parse_cif_float(content, "_cell_angle_alpha", &path_str)?;
    let beta = parse_cif_float(content, "_cell_angle_beta", &path_str)?;
    let gamma = parse_cif_float(content, "_cell_angle_gamma", &path_str)?;

    // from_parameters expects angles in degrees
    let lattice = Lattice::from_parameters(a, b, c, alpha, beta, gamma);

    // Check for space group - warn if not P1
    if let Some(sg) = find_space_group(content)
        && sg != "1"
        && sg != "P1"
        && sg != "P 1"
    {
        tracing::warn!(
            "CIF file has space group '{}'. Only P1 symmetry is fully supported. \
             Atoms will be read as-is without symmetry expansion.",
            sg
        );
    }

    // Parse atom site loop
    let sites = parse_atom_site_loop(content, &path_str)?;

    if sites.is_empty() {
        return Err(FerroxError::ParseError {
            path: path_str,
            reason: "No atom sites found in CIF file".to_string(),
        });
    }

    // Convert to Structure
    let mut site_occupancies = Vec::with_capacity(sites.len());
    let mut frac_coords = Vec::with_capacity(sites.len());

    for site in sites {
        // Check occupancy
        if site.occupancy < 0.99 {
            tracing::warn!(
                "Site {} has partial occupancy ({:.2}), treating as fully occupied",
                site.label.as_deref().unwrap_or(site.element.symbol()),
                site.occupancy
            );
        }

        // Create species with oxidation state if extracted
        let species = Species::new(site.element, site.oxidation_state);

        // Build site properties from metadata and label
        let mut props = site.metadata;
        if let Some(label) = site.label {
            props.insert("label".to_string(), serde_json::json!(label));
        }

        let site_occ = SiteOccupancy::with_properties(vec![(species, 1.0)], props);
        site_occupancies.push(site_occ);
        frac_coords.push(Vector3::new(site.x, site.y, site.z));
    }

    Structure::try_new_from_occupancies(lattice, site_occupancies, frac_coords)
}

/// Parsed atom site from CIF.
#[derive(Debug)]
struct AtomSite {
    element: Element,
    oxidation_state: Option<i8>,
    label: Option<String>,
    x: f64,
    y: f64,
    z: f64,
    occupancy: f64,
    /// Metadata extracted from symbol normalization
    metadata: HashMap<String, serde_json::Value>,
}

/// Parse a float value from CIF, handling uncertainties like "1.234(5)".
fn parse_cif_float(content: &str, key: &str, path: &str) -> Result<f64> {
    let value_str = find_cif_value(content, key).ok_or_else(|| FerroxError::ParseError {
        path: path.to_string(),
        reason: format!("Missing required field: {key}"),
    })?;

    parse_cif_float_opt(value_str).ok_or_else(|| FerroxError::ParseError {
        path: path.to_string(),
        reason: format!("Invalid value for {key}: '{value_str}'"),
    })
}

/// Find a simple key-value pair in CIF content.
fn find_cif_value<'a>(content: &'a str, key: &str) -> Option<&'a str> {
    for line in content.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            // Ensure the key is followed by whitespace (complete key match)
            // This prevents `_cell_length_a` from matching `_cell_length_a_backup`
            if rest.is_empty() || rest.starts_with(char::is_whitespace) {
                let value = rest.trim();
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
    }
    None
}

/// Find space group from CIF content.
fn find_space_group(content: &str) -> Option<String> {
    const KEYS: [&str; 4] = [
        "_symmetry_space_group_name_H-M",
        "_space_group_name_H-M_alt",
        "_symmetry_Int_Tables_number",
        "_space_group_IT_number",
    ];
    KEYS.iter()
        .find_map(|key| find_cif_value(content, key))
        .map(|v| v.trim_matches(['\'', '"']).to_string())
}

/// Parse the _atom_site loop in CIF.
fn parse_atom_site_loop(content: &str, path: &str) -> Result<Vec<AtomSite>> {
    // Find the loop_ block containing _atom_site
    let mut lines = content.lines().peekable();
    let mut in_atom_site_loop = false;
    let mut headers: Vec<String> = Vec::new();
    let mut sites = Vec::new();

    while let Some(line) = lines.next() {
        let line = line.trim();

        // Skip empty lines and comments
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Check for loop_ start
        if line == "loop_" {
            // Check if next lines contain _atom_site
            headers.clear();
            in_atom_site_loop = false;

            while let Some(next_line) = lines.peek() {
                let next_line = next_line.trim();
                if next_line.starts_with('_') {
                    if next_line.starts_with("_atom_site") {
                        in_atom_site_loop = true;
                        headers.push(next_line.to_string());
                    } else if in_atom_site_loop {
                        // Different loop, stop
                        break;
                    }
                    lines.next();
                } else {
                    break;
                }
            }
            continue;
        }

        // Parse data rows in atom_site loop
        if in_atom_site_loop
            && !line.starts_with('_')
            && !line.starts_with("loop_")
            && let Some(site) = parse_atom_site_row(line, &headers, path)?
        {
            sites.push(site);
        }
    }

    Ok(sites)
}

/// Parse a single row of atom site data.
fn parse_atom_site_row(line: &str, headers: &[String], path: &str) -> Result<Option<AtomSite>> {
    // Split by whitespace, but handle quoted strings
    let values: Vec<&str> = split_cif_line(line);

    if values.len() < headers.len() {
        // Incomplete row, skip
        return Ok(None);
    }

    // Create a map of header -> value
    let map: HashMap<&str, &str> = headers
        .iter()
        .map(String::as_str)
        .zip(values.iter().copied())
        .collect();

    // Extract element symbol
    let raw_symbol = map
        .get("_atom_site_type_symbol")
        .or_else(|| map.get("_atom_site_label"))
        .ok_or_else(|| FerroxError::ParseError {
            path: path.to_string(),
            reason: "Atom site missing element symbol".to_string(),
        })?;

    // Normalize element symbol (extracts element, oxidation state, metadata)
    let normalized = normalize_symbol(raw_symbol).map_err(|e| FerroxError::ParseError {
        path: path.to_string(),
        reason: format!("Invalid element symbol '{}': {}", raw_symbol, e),
    })?;

    // Extract label
    let label = map.get("_atom_site_label").map(|s| s.to_string());

    // Extract fractional coordinates
    let x = parse_cif_coord(map.get("_atom_site_fract_x").copied(), path)?;
    let y = parse_cif_coord(map.get("_atom_site_fract_y").copied(), path)?;
    let z = parse_cif_coord(map.get("_atom_site_fract_z").copied(), path)?;

    // Extract occupancy (default 1.0)
    let occupancy = map
        .get("_atom_site_occupancy")
        .and_then(|s| parse_cif_float_opt(s))
        .unwrap_or(1.0);

    Ok(Some(AtomSite {
        element: normalized.element,
        oxidation_state: normalized.oxidation_state,
        label,
        x,
        y,
        z,
        occupancy,
        metadata: normalized.metadata,
    }))
}

/// Parse a coordinate value from CIF.
fn parse_cif_coord(value: Option<&str>, path: &str) -> Result<f64> {
    let value = value.ok_or_else(|| FerroxError::ParseError {
        path: path.to_string(),
        reason: "Missing fractional coordinate".to_string(),
    })?;

    parse_cif_float_opt(value).ok_or_else(|| FerroxError::ParseError {
        path: path.to_string(),
        reason: format!("Invalid coordinate value: {value}"),
    })
}

/// Try to parse a float from CIF, handling uncertainties like "1.234(5)" and fractions like "1/2".
fn parse_cif_float_opt(value: &str) -> Option<f64> {
    // Strip uncertainty suffix: "1.234(5)" -> "1.234"
    let clean = value.split_once('(').map_or(value, |(v, _)| v).trim();

    // Handle rational fractions: "1/2", "-1/3", "2/3"
    if let Some((num_str, denom_str)) = clean.split_once('/') {
        let num: f64 = num_str.trim().parse().ok()?;
        let denom: f64 = denom_str.trim().parse().ok()?;
        if denom == 0.0 {
            return None;
        }
        return Some(num / denom);
    }

    // Fall back to decimal parsing
    clean.parse().ok()
}

/// Split a CIF line by whitespace, respecting quotes.
fn split_cif_line(line: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let chars = line.char_indices();
    let mut start = 0;
    let mut in_quote = false;
    let mut quote_char = ' ';

    for (idx, ch) in chars {
        if !in_quote {
            if ch == '\'' || ch == '"' {
                in_quote = true;
                quote_char = ch;
                start = idx + 1;
            } else if ch.is_whitespace() {
                if start < idx {
                    result.push(&line[start..idx]);
                }
                start = idx + 1;
            }
        } else if ch == quote_char {
            result.push(&line[start..idx]);
            in_quote = false;
            start = idx + 1;
        }
    }

    if start < line.len() && !in_quote {
        let remaining = line[start..].trim();
        if !remaining.is_empty() {
            result.push(remaining);
        }
    }

    result
}

// Note: clean_element_symbol has been replaced by normalize_symbol from element module

// ============================================================================
// CIF Writer
// ============================================================================

/// Convert a structure to CIF format string.
///
/// The output is a valid CIF file with P1 symmetry.
///
/// # Arguments
///
/// * `structure` - The structure to serialize
/// * `data_name` - Optional data block name (defaults to reduced formula)
///
/// # Returns
///
/// CIF format string.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::cif::structure_to_cif;
///
/// let cif_string = structure_to_cif(&structure, None);
/// ```
pub fn structure_to_cif(structure: &Structure, data_name: Option<&str>) -> String {
    let mut lines = Vec::new();

    // Data block header - use provided name or fall back to formula
    let name = match data_name {
        Some(n) if !n.is_empty() => n.to_string(),
        _ => structure.composition().reduced_formula(),
    }
    .replace([' ', '-'], "_"); // CIF data names cannot contain spaces or special characters
    lines.push(format!("data_{}", name));
    lines.push(String::new());

    // Cell parameters
    let lengths = structure.lattice.lengths();
    let angles = structure.lattice.angles();
    lines.push(format!("_cell_length_a   {:.10}", lengths.x));
    lines.push(format!("_cell_length_b   {:.10}", lengths.y));
    lines.push(format!("_cell_length_c   {:.10}", lengths.z));
    lines.push(format!("_cell_angle_alpha   {:.6}", angles.x));
    lines.push(format!("_cell_angle_beta   {:.6}", angles.y));
    lines.push(format!("_cell_angle_gamma   {:.6}", angles.z));
    lines.push(String::new());

    // Symmetry (always P1 for now)
    lines.push("_symmetry_space_group_name_H-M   'P 1'".to_string());
    lines.push("_symmetry_Int_Tables_number   1".to_string());
    lines.push(String::new());

    // Atom site loop
    lines.push("loop_".to_string());
    lines.push("_atom_site_type_symbol".to_string());
    lines.push("_atom_site_label".to_string());
    lines.push("_atom_site_fract_x".to_string());
    lines.push("_atom_site_fract_y".to_string());
    lines.push("_atom_site_fract_z".to_string());
    lines.push("_atom_site_occupancy".to_string());

    // Count occurrences of each element for labeling (Fe1, Fe2, etc.)
    let mut element_counts: HashMap<&str, usize> = HashMap::new();

    for (site_occ, frac) in structure
        .site_occupancies
        .iter()
        .zip(structure.frac_coords.iter())
    {
        // For disordered sites, write each species as a separate entry at the same position
        for (species, occupancy) in &site_occ.species {
            let symbol = species.element.symbol();
            let count = element_counts.entry(symbol).or_insert(0);
            *count += 1;

            // Generate label
            let label = format!("{}{}", symbol, *count);

            // Build type symbol with oxidation state if present
            let type_symbol = match species.oxidation_state {
                Some(oxi) if oxi > 0 => format!("{}{}+", symbol, oxi),
                Some(oxi) if oxi < 0 => format!("{}{}-", symbol, -oxi),
                _ => symbol.to_string(),
            };

            lines.push(format!(
                "  {}  {}  {:.10}  {:.10}  {:.10}  {:.6}",
                type_symbol, label, frac.x, frac.y, frac.z, occupancy
            ));
        }
    }

    lines.join("\n") + "\n"
}

/// Write a structure to a CIF file.
///
/// # Arguments
///
/// * `structure` - The structure to write
/// * `path` - Path to the output file
/// * `data_name` - Optional data block name
///
/// # Returns
///
/// Result indicating success or file I/O error.
pub fn write_cif(
    structure: &Structure,
    path: &Path,
    data_name: Option<&str>,
) -> crate::error::Result<()> {
    let content = structure_to_cif(structure, data_name);
    std::fs::write(path, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to count elements in a structure (counts dominant species per site)
    fn count_element(structure: &Structure, elem: Element) -> usize {
        structure
            .species()
            .iter()
            .filter(|sp| sp.element == elem)
            .count()
    }

    // Helper for float comparison
    fn assert_float_eq(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-10, "{actual} != {expected}");
    }

    #[test]
    fn test_parse_cif_float() {
        for (content, expected) in [
            ("_cell_length_a 5.64", 5.64),
            ("_cell_length_a 5.6432(12)", 5.6432), // with uncertainty
        ] {
            assert_float_eq(
                parse_cif_float(content, "_cell_length_a", "test").unwrap(),
                expected,
            );
        }
    }

    #[test]
    fn test_parse_cif_float_opt_fractions() {
        // Valid values: (input, expected)
        for (input, expected) in [
            ("1/2", 0.5),
            ("1/3", 1.0 / 3.0),
            ("2/3", 2.0 / 3.0),
            ("1/4", 0.25),
            ("3/4", 0.75),
            ("-1/2", -0.5),
            ("-1/3", -1.0 / 3.0), // negative
            ("1 / 2", 0.5),
            (" 1/2 ", 0.5), // whitespace
            ("0.5", 0.5),
            ("0.333333", 0.333333), // decimals
            ("1/2(1)", 0.5),        // fraction with uncertainty
        ] {
            assert_float_eq(parse_cif_float_opt(input).unwrap(), expected);
        }
        // Invalid: division by zero
        assert!(parse_cif_float_opt("1/0").is_none());
    }

    #[test]
    fn test_find_cif_value_exact_key_match() {
        // Valid matches
        for (content, expected) in [
            ("_cell_length_a 5.64", Some("5.64")),
            ("_cell_length_a\t5.64", Some("5.64")),
            (
                "_cell_length_a_backup 5.0\n_cell_length_a 5.64",
                Some("5.64"),
            ),
            // Should NOT match
            ("_cell_length_a_backup 5.0", None), // partial key
            ("_cell_length_alpha 90", None),     // different key
            ("_cell_length_a   ", None),         // empty value
            ("_cell_length_a", None),            // no value
        ] {
            assert_eq!(find_cif_value(content, "_cell_length_a"), expected);
        }
    }

    #[test]
    fn test_normalize_symbol_in_cif() {
        use crate::element::Element;

        // Test that normalize_symbol extracts element correctly from CIF-style symbols
        for (input, expected_elem, expected_oxi) in [
            ("O", Element::O, None),
            ("Na", Element::Na, None),
            ("Mn", Element::Mn, None),
            ("O2-", Element::O, Some(-2)),
            ("Fe3+", Element::Fe, Some(3)),
            ("Ti4+", Element::Ti, Some(4)),
            ("Ca1", Element::Ca, None),  // CIF label, element extracted
            ("Li1", Element::Li, None),  // CIF label
            ("O2", Element::O, None),    // CIF label (O with number)
            ("D", Element::D, None),     // Deuterium
            ("X", Element::Dummy, None), // Dummy atom
        ] {
            let result = normalize_symbol(input).unwrap();
            assert_eq!(
                result.element, expected_elem,
                "element mismatch for '{input}'"
            );
            assert_eq!(
                result.oxidation_state, expected_oxi,
                "oxi mismatch for '{input}'"
            );
        }
    }

    #[test]
    fn test_split_cif_line() {
        assert_eq!(
            split_cif_line("Na Na1 0.0 0.0 0.0 1.0"),
            vec!["Na", "Na1", "0.0", "0.0", "0.0", "1.0"]
        );
        assert_eq!(
            split_cif_line("'Na' 'Na site 1' 0.0 0.0 0.0"),
            vec!["Na", "Na site 1", "0.0", "0.0", "0.0"]
        );
    }

    #[test]
    fn test_parse_simple_cif() {
        let cif_content = r#"
data_NaCl
_cell_length_a 5.64
_cell_length_b 5.64
_cell_length_c 5.64
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 1'

loop_
_atom_site_type_symbol
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na Na1 0.0 0.0 0.0
Cl Cl1 0.5 0.5 0.5
"#;

        let structure = parse_cif_str(cif_content, Path::new("test.cif")).unwrap();
        assert_eq!(structure.num_sites(), 2);
        assert_eq!(structure.species()[0].element, Element::Na);
        assert_eq!(structure.species()[1].element, Element::Cl);
    }

    #[test]
    fn test_parse_cif_tio2_rutile() {
        // TiO2 rutile structure from pymatgen
        let cif_content = r#"# generated using pymatgen
data_TiO2
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   4.59983732
_cell_length_b   4.59983732
_cell_length_c   2.95921356
_cell_angle_alpha   90.00000000
_cell_angle_beta   90.00000000
_cell_angle_gamma   90.00000000
_symmetry_Int_Tables_number   1
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_symmetry_multiplicity
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  Ti4+  Ti0  1  0.50000000  0.50000000  0.00000000  1
  Ti4+  Ti1  1  0.00000000  0.00000000  0.50000000  1
  O2-  O2  1  0.69567869  0.69567869  0.50000000  1
  O2-  O3  1  0.19567869  0.80432131  0.00000000  1
  O2-  O4  1  0.80432131  0.19567869  0.00000000  1
  O2-  O5  1  0.30432131  0.30432131  0.50000000  1
"#;

        let structure = parse_cif_str(cif_content, Path::new("TiO2.cif")).unwrap();
        assert_eq!(structure.num_sites(), 6);

        // Count elements
        assert_eq!(count_element(&structure, Element::Ti), 2);
        assert_eq!(count_element(&structure, Element::O), 4);

        // Check lattice parameters
        let lengths = structure.lattice.lengths();
        assert!((lengths.x - 4.59983732).abs() < 1e-5);
        assert!((lengths.y - 4.59983732).abs() < 1e-5);
        assert!((lengths.z - 2.95921356).abs() < 1e-5);
    }

    #[test]
    fn test_parse_cif_hexagonal_lattice() {
        // Hexagonal lattice (gamma = 120)
        let cif_content = r#"data_quartz_alpha
_chemical_name_mineral                 'Quartz'
_cell_length_a                         4.916
_cell_length_b                         4.916
_cell_length_c                         5.405
_cell_angle_alpha                      90
_cell_angle_beta                       90
_cell_angle_gamma                      120

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Si1  Si  0.470  0.000  0.000  1.000
O1   O   0.410  0.270  0.120  1.000
O2   O   0.410  0.140  0.880  1.000
"#;

        let structure = parse_cif_str(cif_content, Path::new("quartz.cif")).unwrap();
        assert_eq!(structure.num_sites(), 3);

        // Check lattice angles (alpha, beta, gamma)
        let angles = structure.lattice.angles();
        assert!((angles.x - 90.0).abs() < 1e-5);
        assert!((angles.y - 90.0).abs() < 1e-5);
        assert!((angles.z - 120.0).abs() < 1e-5);

        // Check coordinates
        assert!((structure.frac_coords[0].x - 0.470).abs() < 1e-10);
        assert!((structure.frac_coords[1].y - 0.270).abs() < 1e-10);
    }

    #[test]
    fn test_parse_cif_monoclinic() {
        // Monoclinic lattice (beta != 90)
        let cif_content = r#"data_monoclinic_test
_cell_length_a                         10.000
_cell_length_b                         5.000
_cell_length_c                         8.000
_cell_angle_alpha                      90
_cell_angle_beta                       95
_cell_angle_gamma                      90
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Ru1  Ru  0.000  0.000  0.000  1.000
P1   P   0.250  0.250  0.250  1.000
S1   S   0.500  0.500  0.500  1.000
"#;

        let structure = parse_cif_str(cif_content, Path::new("monoclinic.cif")).unwrap();
        assert_eq!(structure.num_sites(), 3);

        // Check monoclinic angle (beta = angles.y)
        let angles = structure.lattice.angles();
        assert!((angles.y - 95.0).abs() < 1e-5);

        // Check elements
        assert_eq!(structure.species()[0].element, Element::Ru);
        assert_eq!(structure.species()[1].element, Element::P);
        assert_eq!(structure.species()[2].element, Element::S);
    }

    #[test]
    fn test_parse_cif_with_uncertainty() {
        // CIF values with uncertainties in parentheses
        let cif_content = r#"data_test
_cell_length_a   5.6432(12)
_cell_length_b   5.6432(12)
_cell_length_c   5.6432(12)
_cell_angle_alpha   90.00(5)
_cell_angle_beta   90.00(5)
_cell_angle_gamma   90.00(5)

loop_
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na 0.0000(1) 0.0000(1) 0.0000(1)
Cl 0.5000(2) 0.5000(2) 0.5000(2)
"#;

        let structure = parse_cif_str(cif_content, Path::new("uncertain.cif")).unwrap();
        assert_eq!(structure.num_sites(), 2);

        // Uncertainties should be stripped
        let lengths = structure.lattice.lengths();
        assert!((lengths.x - 5.6432).abs() < 1e-4);
        assert!((structure.frac_coords[0].x - 0.0).abs() < 1e-10);
        assert!((structure.frac_coords[1].x - 0.5).abs() < 1e-10);
    }

    #[test]
    fn test_parse_cif_label_only() {
        // CIF with only _atom_site_label (no _atom_site_type_symbol)
        let cif_content = r#"data_test_structure
_cell_length_a  5.000
_cell_length_b  5.000
_cell_length_c  5.000
_cell_angle_alpha  90
_cell_angle_beta   90
_cell_angle_gamma  90
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Ru1  0.000  0.000  0.000  1.000
P2   0.250  0.250  0.250  1.000
S3   0.500  0.500  0.500  1.000
N4   0.750  0.750  0.750  1.000
"#;

        let structure = parse_cif_str(cif_content, Path::new("label_only.cif")).unwrap();
        assert_eq!(structure.num_sites(), 4);

        // Elements should be extracted from labels
        assert_eq!(structure.species()[0].element, Element::Ru);
        assert_eq!(structure.species()[1].element, Element::P);
        assert_eq!(structure.species()[2].element, Element::S);
        assert_eq!(structure.species()[3].element, Element::N);
    }

    #[test]
    fn test_parse_cif_with_oxidation_states() {
        // CIF with oxidation states in type_symbol (e.g., Fe3+, O2-)
        let cif_content = r#"data_test
_cell_length_a   5.0
_cell_length_b   5.0
_cell_length_c   5.0
_cell_angle_alpha   90
_cell_angle_beta   90
_cell_angle_gamma   90

loop_
_atom_site_type_symbol
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Fe3+ Fe1 0.0 0.0 0.0
O2-  O1  0.5 0.5 0.5
"#;

        let structure = parse_cif_str(cif_content, Path::new("oxidation.cif")).unwrap();
        assert_eq!(structure.num_sites(), 2);

        // Oxidation states should be stripped from element
        assert_eq!(structure.species()[0].element, Element::Fe);
        assert_eq!(structure.species()[1].element, Element::O);
    }

    #[test]
    fn test_parse_cif_with_fractional_coords() {
        // CIF with rational fraction coordinates (common in high-symmetry structures)
        let cif_content = r#"data_test
_cell_length_a   5.0
_cell_length_b   5.0
_cell_length_c   5.0
_cell_angle_alpha   90
_cell_angle_beta   90
_cell_angle_gamma   90

loop_
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na 0 0 0
Cl 1/2 1/2 1/2
O 1/3 2/3 1/4
"#;

        let structure = parse_cif_str(cif_content, Path::new("fractions.cif")).unwrap();
        assert_eq!(structure.num_sites(), 3);

        // Check fractional coordinates were parsed correctly
        assert!((structure.frac_coords[0].x - 0.0).abs() < 1e-10);
        assert!((structure.frac_coords[1].x - 0.5).abs() < 1e-10);
        assert!((structure.frac_coords[1].y - 0.5).abs() < 1e-10);
        assert!((structure.frac_coords[2].x - 1.0 / 3.0).abs() < 1e-10);
        assert!((structure.frac_coords[2].y - 2.0 / 3.0).abs() < 1e-10);
        assert!((structure.frac_coords[2].z - 0.25).abs() < 1e-10);
    }

    #[test]
    fn test_parse_cif_missing_required_field() {
        // CIF missing required cell parameter
        let cif_content = r#"data_incomplete
_cell_length_a   5.0
_cell_length_b   5.0
_cell_angle_alpha   90
_cell_angle_beta   90
_cell_angle_gamma   90

loop_
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na 0.0 0.0 0.0
"#;

        let result = parse_cif_str(cif_content, Path::new("incomplete.cif"));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("_cell_length_c"));
    }

    #[test]
    fn test_parse_cif_no_atoms() {
        // CIF with lattice but no atoms
        let cif_content = r#"data_empty
_cell_length_a   5.0
_cell_length_b   5.0
_cell_length_c   5.0
_cell_angle_alpha   90
_cell_angle_beta   90
_cell_angle_gamma   90
"#;

        let result = parse_cif_str(cif_content, Path::new("empty.cif"));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("No atom sites"));
    }

    #[test]
    fn test_parse_cif_multiple_loops() {
        // CIF with multiple loop sections (symmetry + atoms)
        let cif_content = r#"data_multiloop
_cell_length_a   5.0
_cell_length_b   5.0
_cell_length_c   5.0
_cell_angle_alpha   90
_cell_angle_beta   90
_cell_angle_gamma   90

loop_
_symmetry_equiv_pos_as_xyz
x,y,z

loop_
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na 0.0 0.0 0.0
Cl 0.5 0.5 0.5
"#;

        let structure = parse_cif_str(cif_content, Path::new("multiloop.cif")).unwrap();
        assert_eq!(structure.num_sites(), 2);
    }

    #[test]
    fn test_parse_cif_cubic_lattice() {
        // Simple cubic lattice
        let cif_content = r#"data_cubic
_cell_length_a   4.0
_cell_length_b   4.0
_cell_length_c   4.0
_cell_angle_alpha   90
_cell_angle_beta   90
_cell_angle_gamma   90

loop_
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Cu 0.0 0.0 0.0
"#;

        let structure = parse_cif_str(cif_content, Path::new("cubic.cif")).unwrap();

        // Check it's cubic
        let lengths = structure.lattice.lengths();
        let angles = structure.lattice.angles();
        assert!((lengths.x - 4.0).abs() < 1e-10);
        assert!((lengths.y - 4.0).abs() < 1e-10);
        assert!((lengths.z - 4.0).abs() < 1e-10);
        assert!((angles.x - 90.0).abs() < 1e-10);
        assert!((angles.y - 90.0).abs() < 1e-10);
        assert!((angles.z - 90.0).abs() < 1e-10);

        // Volume should be a^3 = 64
        assert!((structure.lattice.volume() - 64.0).abs() < 1e-6);
    }

    // =========================================================================
    // Pymatgen Edge Case Tests (ported from pymatgen test suite)
    // =========================================================================

    fn make_cif(atoms: &str) -> String {
        format!(
            "data_test\n_cell_length_a 5\n_cell_length_b 5\n_cell_length_c 5\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n{atoms}"
        )
    }

    fn make_cif_with_labels(atoms: &str) -> String {
        format!(
            "data_test\n_cell_length_a 5\n_cell_length_b 5\n_cell_length_c 5\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_atom_site_label\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n{atoms}"
        )
    }

    #[test]
    fn test_cif_symbol_parsing() {
        // Various symbol formats that need normalization
        let cases: &[(&str, &[Element])] = &[
            ("Fe2+ 0 0 0\nO2- 0.5 0.5 0.5", &[Element::Fe, Element::O]), // oxidation states
            (
                "Ca_pv 0 0 0\nFe_sv 0.5 0.5 0.5",
                &[Element::Ca, Element::Fe],
            ), // POTCAR
            ("D 0 0 0\nO 0.5 0.5 0.5", &[Element::D, Element::O]),       // deuterium
        ];
        for (atoms, expected) in cases {
            let s = parse_cif_str(&make_cif(atoms), Path::new("t.cif")).unwrap();
            assert_eq!(s.num_sites(), expected.len(), "{atoms}");
            for (idx, elem) in expected.iter().enumerate() {
                assert_eq!(s.species()[idx].element, *elem, "{atoms}");
            }
        }

        // Site labels with numbers (Fe1, Na2) - uses _atom_site_label
        let s = parse_cif_str(
            &make_cif_with_labels("Fe1 0 0 0\nNa2 0.5 0.5 0.5"),
            Path::new("l.cif"),
        )
        .unwrap();
        assert_eq!(s.num_sites(), 2);
        assert_eq!(s.species()[0].element, Element::Fe);
        assert_eq!(s.species()[1].element, Element::Na);
    }

    #[test]
    fn test_cif_coordinate_edge_cases() {
        // Uncertainties in coordinates: 0.1234(5) → 0.1234
        let unc = "data_u\n_cell_length_a 5.123(4)\n_cell_length_b 5.123(4)\n_cell_length_c 5.123(4)\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nNa 0.1234(5) 0.5 0.5";
        let s = parse_cif_str(unc, Path::new("u.cif")).unwrap();
        assert!((s.frac_coords[0].x - 0.1234).abs() < 1e-4);
        assert!((s.lattice.lengths().x - 5.123).abs() < 0.01);

        // Negative coordinates
        let s2 = parse_cif_str(&make_cif("Fe -0.1 0 0\nFe 0 -0.2 0"), Path::new("n.cif")).unwrap();
        assert_eq!(s2.num_sites(), 2);
        assert!(s2.frac_coords[0].x.is_finite());
    }

    #[test]
    fn test_cif_lattice_types() {
        // Triclinic (all angles different)
        let tri = "data_t\n_cell_length_a 4.5\n_cell_length_b 5.5\n_cell_length_c 6.5\n_cell_angle_alpha 75\n_cell_angle_beta 85\n_cell_angle_gamma 95\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nFe 0 0 0";
        let s = parse_cif_str(tri, Path::new("t.cif")).unwrap();
        assert!((s.lattice.angles().x - 75.0).abs() < 1e-6);

        // Hexagonal (γ = 120°)
        let hex = "data_h\n_cell_length_a 3\n_cell_length_b 3\n_cell_length_c 5\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 120\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nMg 0 0 0";
        let s2 = parse_cif_str(hex, Path::new("h.cif")).unwrap();
        assert!((s2.lattice.angles().z - 120.0).abs() < 1e-6);

        // Near-flat (PR4133 fix) - shouldn't hang
        let flat = "data_f\n_cell_length_a 10\n_cell_length_b 10\n_cell_length_c 0.1\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nFe 0.5 0.5 0.5";
        let s3 = parse_cif_str(flat, Path::new("f.cif")).unwrap();
        assert!(s3.lattice.volume().abs() > 0.0 && s3.lattice.volume().abs() < 20.0);
    }

    // =========================================================================
    // CIF Writer Tests
    // =========================================================================

    use crate::lattice::Lattice;
    use crate::species::Species;
    use nalgebra::Vector3;

    #[test]
    fn test_structure_to_cif_roundtrip() {
        // NaCl structure - tests basic format and roundtrip
        let lattice = Lattice::cubic(5.64);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let s1 = Structure::try_new(lattice, species, coords).unwrap();

        let cif = structure_to_cif(&s1, Some("NaCl_test"));

        // Verify format
        assert!(cif.starts_with("data_NaCl_test\n"));
        assert!(cif.contains("_symmetry_space_group_name_H-M   'P 1'"));

        // Roundtrip parse and compare
        let s2 = parse_cif_str(&cif, Path::new("test.cif")).unwrap();
        assert_eq!(s1.num_sites(), s2.num_sites());
        assert!((s1.lattice.volume() - s2.lattice.volume()).abs() < 1e-6);

        // Verify lattice lengths (catches a↔b swaps in cubic systems)
        let (len1, len2) = (s1.lattice.lengths(), s2.lattice.lengths());
        assert!((len1.x - len2.x).abs() < 1e-6);
        assert!((len1.y - len2.y).abs() < 1e-6);
        assert!((len1.z - len2.z).abs() < 1e-6);

        assert_eq!(s1.species()[0].element, s2.species()[0].element);
        assert_eq!(s1.species()[1].element, s2.species()[1].element);
    }

    #[test]
    fn test_structure_to_cif_oxidation_states() {
        let s = Structure::try_new(
            Lattice::cubic(5.0),
            vec![
                Species::new(Element::Fe, Some(3)),
                Species::new(Element::O, Some(-2)),
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        )
        .unwrap();

        let cif = structure_to_cif(&s, None);
        assert!(cif.contains("Fe3+"));
        assert!(cif.contains("O2-"));
    }

    #[test]
    fn test_structure_to_cif_hexagonal() {
        // Hexagonal lattice (gamma = 120) - catches angle ordering bugs
        let s1 = Structure::try_new(
            Lattice::from_parameters(4.0, 4.0, 5.0, 90.0, 90.0, 120.0),
            vec![Species::neutral(Element::Mg)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        )
        .unwrap();

        let cif = structure_to_cif(&s1, None);
        let s2 = parse_cif_str(&cif, Path::new("hex.cif")).unwrap();

        let (a1, a2) = (s1.lattice.angles(), s2.lattice.angles());
        assert!((a1.x - a2.x).abs() < 1e-4);
        assert!((a1.y - a2.y).abs() < 1e-4);
        assert!((a1.z - a2.z).abs() < 1e-4);
    }
}
