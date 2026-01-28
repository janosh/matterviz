//! Comparator traits for structure matching.
//!
//! Comparators define how species are compared during structure matching.

use crate::composition::Composition;
use crate::species::Species;

/// Trait for comparing species during structure matching.
pub trait Comparator: Send + Sync {
    /// Check if two species should be considered equivalent.
    fn are_equal(&self, sp1: &Species, sp2: &Species) -> bool;

    /// Get a hash of the composition for early termination.
    ///
    /// Compositions with different hashes cannot match.
    fn get_hash(&self, composition: &Composition) -> u64;
}

/// Comparator that requires exact species match (element + oxidation state).
#[derive(Debug, Clone, Default)]
pub struct SpeciesComparator;

impl Comparator for SpeciesComparator {
    fn are_equal(&self, sp1: &Species, sp2: &Species) -> bool {
        sp1 == sp2
    }

    fn get_hash(&self, composition: &Composition) -> u64 {
        composition.hash()
    }
}

/// Comparator that only compares elements (ignores oxidation state).
#[derive(Debug, Clone, Default)]
pub struct ElementComparator;

impl Comparator for ElementComparator {
    fn are_equal(&self, sp1: &Species, sp2: &Species) -> bool {
        sp1.element == sp2.element
    }

    fn get_hash(&self, composition: &Composition) -> u64 {
        composition.hash()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;

    #[test]
    fn test_species_comparator() {
        let comp = SpeciesComparator;

        let fe2 = Species::new(Element::Fe, Some(2));
        let fe3 = Species::new(Element::Fe, Some(3));
        let fe_neutral = Species::neutral(Element::Fe);
        let cu = Species::neutral(Element::Cu);

        // Same species: equal
        assert!(comp.are_equal(&fe2, &fe2));
        assert!(comp.are_equal(&fe_neutral, &fe_neutral));

        // Same element, different oxidation: NOT equal
        assert!(!comp.are_equal(&fe2, &fe3));
        assert!(!comp.are_equal(&fe2, &fe_neutral));

        // Different elements: NOT equal
        assert!(!comp.are_equal(&fe_neutral, &cu));
    }

    #[test]
    fn test_element_comparator() {
        let comp = ElementComparator;

        let fe2 = Species::new(Element::Fe, Some(2));
        let fe3 = Species::new(Element::Fe, Some(3));
        let fe_neutral = Species::neutral(Element::Fe);
        let co = Species::neutral(Element::Co);

        // Same element (any oxidation): equal
        assert!(comp.are_equal(&fe2, &fe3));
        assert!(comp.are_equal(&fe2, &fe_neutral));

        // Different elements: NOT equal
        assert!(!comp.are_equal(&fe2, &co));
    }
}
