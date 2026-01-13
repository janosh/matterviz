"""Tests for typed wrapper classes and the MatterViz component."""

from __future__ import annotations

import matterviz_dash_components as mvc
import pytest
from matterviz_dash_components import MatterViz

# Note: We don't import typed wrappers (Structure, PeriodicTable, Trajectory) directly
# in tests because they have @_explicitize_args decorator conflicts. Instead, we test
# using the base MatterViz component which is the recommended approach anyway.


class TestMatterVizBase:
    """Tests for the base MatterViz component."""

    def test_instantiation_with_component_name(self) -> None:
        """MatterViz can be instantiated with a component name."""
        comp = MatterViz(id="test", component="Structure")
        assert comp.id == "test"
        assert comp.component == "Structure"

    def test_mv_props_forwarded(self) -> None:
        """mv_props dict is forwarded correctly."""
        comp = MatterViz(
            id="test-mv-props",
            component="Structure",
            mv_props={"structure": {"sites": []}, "show_controls": True},
        )
        assert comp.mv_props == {"structure": {"sites": []}, "show_controls": True}

    def test_set_props_and_float32_props(self) -> None:
        """set_props and float32_props lists are stored."""
        comp = MatterViz(
            id="test-set-float",
            component="Structure",
            set_props=["hidden_elements"],
            float32_props=["positions"],
        )
        assert comp.set_props == ["hidden_elements"]
        assert comp.float32_props == ["positions"]

    def test_event_props(self) -> None:
        """event_props list is stored."""
        comp = MatterViz(
            id="test-events",
            component="Structure",
            event_props=["on_file_load", "on_error"],
        )
        assert comp.event_props == ["on_file_load", "on_error"]


class TestComponentInstantiation:
    """Parametrized tests for various MatterViz component types."""

    @pytest.mark.parametrize(
        "component,mv_props",
        [
            ("structure/Structure", {"structure": {"sites": []}, "height": 500}),
            ("periodic-table/PeriodicTable", {"show_color_bar": True}),
            ("trajectory/Trajectory", {"fps": 30}),
            ("brillouin/BrillouinZone", {"structure": {"sites": []}}),
            ("convex-hull/ConvexHull2D", {"entries": []}),
        ],
    )
    def test_component_with_props(self, component: str, mv_props: dict) -> None:
        """Components can be instantiated with their specific props."""
        comp = MatterViz(id="test", component=component, mv_props=mv_props)
        assert comp.component == component
        assert comp.mv_props == mv_props


class TestModuleExports:
    """Tests for module-level exports."""

    def test_version_defined(self) -> None:
        """Package has a __version__ attribute."""
        assert hasattr(mvc, "__version__")
        assert isinstance(mvc.__version__, str)

    def test_js_dist_defined(self) -> None:
        """Package has _js_dist for Dash asset loading."""
        assert hasattr(mvc, "_js_dist")
        assert isinstance(mvc._js_dist, list)
        assert len(mvc._js_dist) > 0

    def test_css_dist_defined(self) -> None:
        """Package has _css_dist for Dash CSS loading."""
        assert hasattr(mvc, "_css_dist")
        assert isinstance(mvc._css_dist, list)


class TestEdgeCases:
    """Test edge cases and error handling."""

    @pytest.mark.parametrize("mv_props", [{}, None])
    def test_empty_or_none_mv_props(self, mv_props) -> None:
        """Component with empty or None mv_props should work."""
        comp = MatterViz(id="test", component="Structure", mv_props=mv_props)
        assert comp.mv_props == mv_props

    def test_deeply_nested_props(self) -> None:
        """Deeply nested mv_props should be preserved."""
        deep = {"a": {"b": {"c": {"d": {"e": 1}}}}}
        comp = MatterViz(id="test", component="Structure", mv_props=deep)
        assert comp.mv_props["a"]["b"]["c"]["d"]["e"] == 1

    @pytest.mark.parametrize(
        "mv_props",
        [
            {"key-with-dash": 1, "key_with_underscore": 2, "key.with.dot": 3},
            {"label": "H₂O", "symbol": "α-Fe", "description": "日本語"},
        ],
        ids=["special-chars", "unicode"],
    )
    def test_special_and_unicode_props(self, mv_props: dict) -> None:
        """Props with special characters and unicode should work."""
        comp = MatterViz(id="test", component="Structure", mv_props=mv_props)
        assert comp.mv_props == mv_props

    @pytest.mark.parametrize(
        "prop_name,prop_value",
        [
            ("set_props", []),
            ("set_props", ["a", "b", "c"]),
            ("float32_props", []),
            ("float32_props", ["x", "y", "z"]),
            ("event_props", []),
            ("event_props", ["on_click", "on_hover"]),
        ],
    )
    def test_list_props_stored(self, prop_name: str, prop_value: list) -> None:
        """List props (empty or populated) should be stored correctly."""
        comp = MatterViz(id="test", component="Structure", **{prop_name: prop_value})
        assert getattr(comp, prop_name) == prop_value

    def test_last_event_can_be_set(self) -> None:
        """last_event prop should be settable."""
        event = {"prop": "on_click", "data": {"x": 1}, "timestamp": 12345}
        comp = MatterViz(id="test", component="Structure", last_event=event)
        assert comp.last_event == event

    def test_component_with_path_prefix(self) -> None:
        """Component with full path should work."""
        comp = MatterViz(id="test", component="structure/Structure")
        assert comp.component == "structure/Structure"

    def test_minimal_instantiation(self) -> None:
        """Components with minimal args (just id) should work."""
        comp = MatterViz(component="Test", id="test-id")
        assert comp.component == "Test"


class TestPropValidation:
    """Test prop handling."""

    @pytest.mark.parametrize(
        "prop_name,prop_value",
        [
            ("style", {"height": "100%", "width": 500}),
            ("className", "my-class other"),
        ],
    )
    def test_style_and_classname_preserved(self, prop_name: str, prop_value) -> None:
        """Style dict and className should be preserved exactly."""
        comp = MatterViz(id="test", component="Test", **{prop_name: prop_value})
        assert getattr(comp, prop_name) == prop_value
