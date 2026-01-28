//! CIF (Crystallographic Information File) parser.
//!
//! This module provides functions for parsing crystal structures from CIF format.
//!
//! # Limitations
//!
//! Currently only supports CIF files with P1 symmetry (space group 1) or files that
//! already contain all atoms in the unit cell. Files with higher symmetry that require
//! symmetry expansion are not yet supported.

use crate::element::Element;
use crate::error::{FerroxError, Result};
use crate::lattice::Lattice;
use crate::species::Species;
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
    let mut species = Vec::with_capacity(sites.len());
    let mut frac_coords = Vec::with_capacity(sites.len());

    for site in sites {
        let element =
            Element::from_symbol(&site.element).ok_or_else(|| FerroxError::ParseError {
                path: path_str.clone(),
                reason: format!("Unknown element symbol: {}", site.element),
            })?;

        // Check occupancy
        if site.occupancy < 0.99 {
            tracing::warn!(
                "Site {} has partial occupancy ({:.2}), treating as fully occupied",
                site.label.as_deref().unwrap_or(&site.element),
                site.occupancy
            );
        }

        species.push(Species::neutral(element));
        frac_coords.push(Vector3::new(site.x, site.y, site.z));
    }

    Structure::try_new(lattice, species, frac_coords)
}

/// Parsed atom site from CIF.
#[derive(Debug)]
struct AtomSite {
    element: String,
    label: Option<String>,
    x: f64,
    y: f64,
    z: f64,
    occupancy: f64,
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
            let value = rest.trim();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

/// Find space group from CIF content.
fn find_space_group(content: &str) -> Option<String> {
    // Try various space group keys
    let keys = [
        "_symmetry_space_group_name_H-M",
        "_space_group_name_H-M_alt",
        "_symmetry_Int_Tables_number",
        "_space_group_IT_number",
    ];

    for key in keys {
        if let Some(value) = find_cif_value(content, key) {
            // Remove quotes
            let value = value.trim_matches(|c| c == '\'' || c == '"');
            return Some(value.to_string());
        }
    }
    None
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
        if in_atom_site_loop && !line.starts_with('_') && !line.starts_with("loop_") {
            // Check if this looks like a data row
            if line.is_empty() {
                in_atom_site_loop = false;
                continue;
            }

            // Parse the row
            if let Some(site) = parse_atom_site_row(line, &headers, path)? {
                sites.push(site);
            }
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
    let mut map: HashMap<&str, &str> = HashMap::new();
    for (header, value) in headers.iter().zip(values.iter()) {
        map.insert(header.as_str(), *value);
    }

    // Extract element symbol
    let element = map
        .get("_atom_site_type_symbol")
        .or_else(|| map.get("_atom_site_label"))
        .ok_or_else(|| FerroxError::ParseError {
            path: path.to_string(),
            reason: "Atom site missing element symbol".to_string(),
        })?;

    // Clean element symbol (remove charge like "O2-" -> "O")
    let element = clean_element_symbol(element);

    // Extract label
    let label = map.get("_atom_site_label").map(|s| (*s).to_string());

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
        element,
        label,
        x,
        y,
        z,
        occupancy,
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

/// Try to parse a float from CIF, handling uncertainties like "1.234(5)".
fn parse_cif_float_opt(value: &str) -> Option<f64> {
    let clean = value.split_once('(').map_or(value, |(v, _)| v);
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

/// Clean element symbol by removing charge notation.
/// Examples: "O2-" -> "O", "Fe3+" -> "Fe", "Ca1" -> "Ca"
fn clean_element_symbol(symbol: &str) -> String {
    symbol.chars().take_while(|c| c.is_alphabetic()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to count elements in a structure
    fn count_element(structure: &Structure, elem: Element) -> usize {
        structure
            .species
            .iter()
            .filter(|sp| sp.element == elem)
            .count()
    }

    #[test]
    fn test_parse_cif_float() {
        // Normal value
        let content = "_cell_length_a 5.64";
        assert!((parse_cif_float(content, "_cell_length_a", "test").unwrap() - 5.64).abs() < 1e-10);

        // Value with uncertainty
        let content = "_cell_length_a 5.6432(12)";
        assert!(
            (parse_cif_float(content, "_cell_length_a", "test").unwrap() - 5.6432).abs() < 1e-10
        );
    }

    #[test]
    fn test_clean_element_symbol() {
        // Basic elements
        assert_eq!(clean_element_symbol("O"), "O");
        assert_eq!(clean_element_symbol("Na"), "Na");
        assert_eq!(clean_element_symbol("Mn"), "Mn");
        // With charge notation
        assert_eq!(clean_element_symbol("O2-"), "O");
        assert_eq!(clean_element_symbol("Fe3+"), "Fe");
        assert_eq!(clean_element_symbol("Ti4+"), "Ti");
        assert_eq!(clean_element_symbol("Fe2+"), "Fe");
        // With numbers
        assert_eq!(clean_element_symbol("Ca1"), "Ca");
        assert_eq!(clean_element_symbol("Li1"), "Li");
        assert_eq!(clean_element_symbol("O2"), "O");
        // With parentheses
        assert_eq!(clean_element_symbol("H(1)"), "H");
    }

    #[test]
    fn test_split_cif_line() {
        let line = "Na Na1 0.0 0.0 0.0 1.0";
        let parts = split_cif_line(line);
        assert_eq!(parts, vec!["Na", "Na1", "0.0", "0.0", "0.0", "1.0"]);

        // With quotes
        let line = "'Na' 'Na site 1' 0.0 0.0 0.0";
        let parts = split_cif_line(line);
        assert_eq!(parts, vec!["Na", "Na site 1", "0.0", "0.0", "0.0"]);
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
        assert_eq!(structure.species[0].element, Element::Na);
        assert_eq!(structure.species[1].element, Element::Cl);
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
        assert_eq!(structure.species[0].element, Element::Ru);
        assert_eq!(structure.species[1].element, Element::P);
        assert_eq!(structure.species[2].element, Element::S);
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
        assert_eq!(structure.species[0].element, Element::Ru);
        assert_eq!(structure.species[1].element, Element::P);
        assert_eq!(structure.species[2].element, Element::S);
        assert_eq!(structure.species[3].element, Element::N);
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
        assert_eq!(structure.species[0].element, Element::Fe);
        assert_eq!(structure.species[1].element, Element::O);
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
}
