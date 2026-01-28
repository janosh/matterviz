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
}

/// Result type alias for ferrox operations.
pub type Result<T> = std::result::Result<T, FerroxError>;

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
    fn test_error_display() {
        let err = FerroxError::InvalidStructure {
            index: 5,
            reason: "negative volume".to_string(),
        };
        assert!(err.to_string().contains("index 5"));
        assert!(err.to_string().contains("negative volume"));
    }

    #[test]
    fn test_on_error_default() {
        assert_eq!(OnError::default(), OnError::Skip);
    }
}
