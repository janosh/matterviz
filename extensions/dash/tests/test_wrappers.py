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
            (
                "periodic-table/PeriodicTable",
                {"show_color_bar": True, "heatmap_values": [1, 2]},
            ),
            (
                "trajectory/Trajectory",
                {"fps": 30, "ELEM_PROPERTY_LABELS": {"energy": "E"}},
            ),
            ("brillouin/BrillouinZone", {"structure": {"sites": []}}),
            ("convex-hull/ConvexHull2D", {"entries": [], "height": 320}),
        ],
    )
    def test_component_with_props(self, component: str, mv_props: dict) -> None:
        """Components can be instantiated with their specific props."""
        comp = MatterViz(id="test", component=component, mv_props=mv_props)
        assert comp.component == component
        assert comp.mv_props == mv_props

    def test_set_props_forwarded(self) -> None:
        """set_props list is forwarded correctly."""
        comp = MatterViz(
            id="test",
            component="structure/Structure",
            set_props=["hidden_elements", "hidden_prop_vals"],
        )
        assert comp.set_props == ["hidden_elements", "hidden_prop_vals"]


class TestDynamicFactory:
    """Tests for the __getattr__ dynamic factory."""

    def test_dynamic_factory_creates_component(self) -> None:
        """Dynamic factory creates a MatterViz component."""
        comp = mvc.SomeNewComponent(id="dyn-1", foo="bar", baz=123)
        assert isinstance(comp, MatterViz)
        assert comp.component == "SomeNewComponent"
        assert comp.mv_props == {"foo": "bar", "baz": 123}

    def test_dynamic_factory_supports_id(self) -> None:
        """Dynamic factory supports id parameter."""
        comp = mvc.AnotherComponent(id="my-id", value=42)
        assert comp.id == "my-id"
        assert comp.mv_props == {"value": 42}

    def test_dynamic_factory_supports_style(self) -> None:
        """Dynamic factory supports style and className."""
        comp = mvc.StyledComponent(
            id="styled-1",
            className="my-class",
            style={"height": "100%"},
            prop1="value",
        )
        assert comp.className == "my-class"
        assert comp.style == {"height": "100%"}
        assert comp.mv_props == {"prop1": "value"}

    def test_dynamic_factory_supports_event_props(self) -> None:
        """Dynamic factory supports event_props."""
        comp = mvc.EventComponent(
            id="event-1",
            event_props=["on_click"],
            data={"key": "value"},
        )
        assert comp.event_props == ["on_click"]

    def test_lowercase_attribute_raises(self) -> None:
        """Lowercase attributes raise AttributeError."""
        with pytest.raises(AttributeError):
            _ = mvc.lowercase_thing


class TestComponentHelper:
    """Tests for the component() helper function."""

    def test_component_helper(self) -> None:
        """component() helper creates MatterViz with given name."""
        comp = mvc.component("MyComponent", id="helper-1", foo=1, bar=2)
        assert isinstance(comp, MatterViz)
        assert comp.id == "helper-1"
        assert comp.component == "MyComponent"
        assert comp.mv_props["foo"] == 1
        assert comp.mv_props["bar"] == 2


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

    def test_empty_mv_props(self) -> None:
        """Component with empty mv_props should work."""
        comp = MatterViz(id="test", component="Structure", mv_props={})
        assert comp.mv_props == {}

    def test_none_mv_props(self) -> None:
        """Component with None mv_props should work."""
        comp = MatterViz(id="test", component="Structure", mv_props=None)
        assert comp.mv_props is None

    def test_deeply_nested_props(self) -> None:
        """Deeply nested mv_props should be preserved."""
        deep = {"a": {"b": {"c": {"d": {"e": 1}}}}}
        comp = MatterViz(id="test", component="Structure", mv_props=deep)
        assert comp.mv_props["a"]["b"]["c"]["d"]["e"] == 1

    def test_special_characters_in_props(self) -> None:
        """Props with special characters should work."""
        props = {"key-with-dash": 1, "key_with_underscore": 2, "key.with.dot": 3}
        comp = MatterViz(id="test", component="Structure", mv_props=props)
        assert comp.mv_props == props

    def test_unicode_in_props(self) -> None:
        """Unicode characters in props should work."""
        props = {"label": "H₂O", "symbol": "α-Fe", "description": "日本語"}
        comp = MatterViz(id="test", component="Structure", mv_props=props)
        assert comp.mv_props["label"] == "H₂O"
        assert comp.mv_props["symbol"] == "α-Fe"

    def test_empty_set_props_list(self) -> None:
        """Empty set_props list should work."""
        comp = MatterViz(id="test", component="Structure", set_props=[])
        assert comp.set_props == []

    def test_empty_float32_props_list(self) -> None:
        """Empty float32_props list should work."""
        comp = MatterViz(id="test", component="Structure", float32_props=[])
        assert comp.float32_props == []

    def test_multiple_event_props(self) -> None:
        """Multiple event_props should all be stored."""
        events = ["on_click", "on_hover", "on_load", "on_error"]
        comp = MatterViz(id="test", component="Structure", event_props=events)
        assert comp.event_props == events

    def test_last_event_can_be_set(self) -> None:
        """last_event prop should be settable."""
        event = {"prop": "on_click", "data": {"x": 1}, "timestamp": 12345}
        comp = MatterViz(id="test", component="Structure", last_event=event)
        assert comp.last_event == event

    def test_component_with_path_prefix(self) -> None:
        """Component with full path should work."""
        comp = MatterViz(id="test", component="structure/Structure")
        assert comp.component == "structure/Structure"

    def test_component_helper_with_no_extra_props(self) -> None:
        """component() helper with just name and id should work."""
        comp = mvc.component("Test", id="test-id")
        assert comp.component == "Test"
        assert comp.id == "test-id"
        assert comp.mv_props == {}

    def test_dynamic_factory_with_empty_kwargs(self) -> None:
        """Dynamic factory with only id should work."""
        comp = mvc.EmptyComponent(id="empty")
        assert comp.component == "EmptyComponent"
        assert comp.mv_props == {}


class TestPropValidation:
    """Test that invalid props are handled correctly."""

    @pytest.mark.parametrize(
        "prop_name,prop_value",
        [
            ("set_props", ["a", "b", "c"]),
            ("float32_props", ["x", "y", "z"]),
            ("event_props", ["on_a", "on_b"]),
        ],
    )
    def test_list_props_accept_lists(self, prop_name: str, prop_value: list) -> None:
        """List props should accept list values."""
        kwargs = {"id": "test", "component": "Test", prop_name: prop_value}
        comp = MatterViz(**kwargs)
        assert getattr(comp, prop_name) == prop_value

    def test_style_dict_preserved(self) -> None:
        """Style dict should be preserved exactly."""
        style = {"height": "100%", "width": 500, "margin": "10px 20px"}
        comp = MatterViz(id="test", component="Test", style=style)
        assert comp.style == style

    def test_classname_preserved(self) -> None:
        """className should be preserved."""
        comp = MatterViz(id="test", component="Test", className="my-class other")
        assert comp.className == "my-class other"
