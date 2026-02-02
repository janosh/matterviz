//! Error types for the ferrox crate.

use thiserror::Error;

/// Main error type for ferrox operations.
#[derive(Debug, Error)]
#[allow(missing_docs)] // Error variant fields are self-documenting via #[error] attribute
pub enum FerroxError {
    /// Invalid structure data at a specific index.
    #[error("Invalid structure at index {index}: {reason}")]
    InvalidStructure { index: usize, reason: String },

    /// moyo symmetry analysis failed.
    #[error("moyo failed for structure at index {index}: {reason}")]
    MoyoError { index: usize, reason: String },

    /// JSON parsing error.
    #[error("JSON parse error in {path}: {reason}")]
    JsonError { path: String, reason: String },

    /// File I/O error.
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    /// Lattice reduction failed to converge.
    #[error("Lattice reduction failed to converge after {iterations} iterations")]
    ReductionNotConverged { iterations: usize },

    /// Invalid lattice parameters.
    #[error("Invalid lattice: {reason}")]
    InvalidLattice { reason: String },

    /// Structure matching failed.
    #[error("Matching failed: {reason}")]
    MatchingError { reason: String },

    /// File format parsing error.
    #[error("Parse error in {path}: {reason}")]
    ParseError { path: String, reason: String },

    /// Unknown file format.
    #[error("Unknown file format: {path}")]
    UnknownFormat { path: String },

    /// Missing lattice in structure file.
    #[error("Missing lattice in {path}: crystal structures require lattice information")]
    MissingLattice { path: String },

    /// Empty file or no frames.
    #[error("Empty file or no valid frames in {path}")]
    EmptyFile { path: String },

    /// Composition operation error.
    #[error("Composition error: {reason}")]
    CompositionError { reason: String },

    /// Transformation error.
    #[error("Transform error: {reason}")]
    TransformError { reason: String },
}

/// Result type alias for ferrox operations.
pub type Result<T> = std::result::Result<T, FerroxError>;

// === Validation Helpers ===

/// Check that a site index is within bounds of a structure.
///
/// # Arguments
/// * `site_idx` - The site index to validate
/// * `n_sites` - Total number of sites in the structure
/// * `name` - Name of the parameter for error messages (e.g., "site_idx", "center_site_idx")
///
/// # Returns
/// Ok(()) if valid, Err(FerroxError::InvalidStructure) if out of bounds.
#[inline]
pub fn check_site_bounds(site_idx: usize, n_sites: usize, name: &str) -> Result<()> {
    if site_idx >= n_sites {
        return Err(FerroxError::InvalidStructure {
            index: site_idx,
            reason: format!("{name} {site_idx} out of bounds (structure has {n_sites} sites)"),
        });
    }
    Ok(())
}

/// Check that two site indices are different.
#[inline]
pub fn check_sites_different(site_a: usize, site_b: usize) -> Result<()> {
    if site_a == site_b {
        return Err(FerroxError::InvalidStructure {
            index: site_a,
            reason: "site indices must be different".to_string(),
        });
    }
    Ok(())
}

/// Check that a value is positive.
#[inline]
pub fn check_positive(value: f64, name: &str) -> Result<()> {
    if value <= 0.0 {
        return Err(FerroxError::InvalidStructure {
            index: 0,
            reason: format!("{name} must be positive, got {value}"),
        });
    }
    Ok(())
}

/// Check that a value is non-negative.
#[inline]
pub fn check_non_negative(value: f64, name: &str) -> Result<()> {
    if value < 0.0 {
        return Err(FerroxError::InvalidStructure {
            index: 0,
            reason: format!("{name} must be non-negative, got {value}"),
        });
    }
    Ok(())
}

/// Behavior when encountering errors in batch processing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OnError {
    /// Fail immediately on first error.
    Fail,
    /// Skip problematic structures with a warning, continue processing.
    #[default]
    Skip,
}

impl OnError {
    /// Returns true if errors should cause immediate failure.
    pub fn should_fail(&self) -> bool {
        matches!(self, OnError::Fail)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_variants_display() {
        // Test all error variants have meaningful display messages
        let test_cases: Vec<(FerroxError, &[&str])> = vec![
            (
                FerroxError::InvalidStructure {
                    index: 5,
                    reason: "negative volume".to_string(),
                },
                &["index 5", "negative volume"],
            ),
            (
                FerroxError::MoyoError {
                    index: 3,
                    reason: "symmetry detection failed".to_string(),
                },
                &["index 3", "symmetry detection failed", "moyo"],
            ),
            (
                FerroxError::JsonError {
                    path: "test.json".to_string(),
                    reason: "missing field".to_string(),
                },
                &["test.json", "missing field", "JSON"],
            ),
            (
                FerroxError::ReductionNotConverged { iterations: 100 },
                &["100", "converge"],
            ),
            (
                FerroxError::InvalidLattice {
                    reason: "zero volume".to_string(),
                },
                &["zero volume", "lattice"],
            ),
            (
                FerroxError::MatchingError {
                    reason: "no valid mapping".to_string(),
                },
                &["no valid mapping", "Matching"],
            ),
            (
                FerroxError::ParseError {
                    path: "structure.cif".to_string(),
                    reason: "invalid cell parameter".to_string(),
                },
                &["structure.cif", "invalid cell parameter", "Parse"],
            ),
            (
                FerroxError::UnknownFormat {
                    path: "data.xyz123".to_string(),
                },
                &["data.xyz123", "Unknown", "format"],
            ),
            (
                FerroxError::MissingLattice {
                    path: "molecule.xyz".to_string(),
                },
                &["molecule.xyz", "lattice", "crystal"],
            ),
            (
                FerroxError::EmptyFile {
                    path: "empty.cif".to_string(),
                },
                &["empty.cif", "Empty", "frames"],
            ),
            (
                FerroxError::CompositionError {
                    reason: "invalid formula".to_string(),
                },
                &["Composition error", "invalid formula"],
            ),
            (
                FerroxError::TransformError {
                    reason: "zero-length axis".to_string(),
                },
                &["Transform error", "zero-length axis"],
            ),
        ];

        for (err, expected_substrings) in test_cases {
            let msg = err.to_string();
            for substring in expected_substrings {
                assert!(
                    msg.to_lowercase().contains(&substring.to_lowercase()),
                    "Error message '{}' should contain '{}'",
                    msg,
                    substring
                );
            }
        }
    }

    #[test]
    fn test_on_error_behavior() {
        // Default is Skip
        assert_eq!(OnError::default(), OnError::Skip);

        // should_fail() returns correct values
        assert!(!OnError::Skip.should_fail(), "Skip should not fail");
        assert!(OnError::Fail.should_fail(), "Fail should fail");
    }

    #[test]
    fn test_io_error_conversion() {
        // IoError can be created from std::io::Error
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let ferrox_err: FerroxError = io_err.into();

        let msg = ferrox_err.to_string();
        assert!(msg.contains("file not found"), "IoError message: {msg}");
    }
}
