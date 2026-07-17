"""Tests for typed wrapper classes and the MatterViz component."""

from __future__ import annotations

import inspect
from pathlib import Path
from typing import Any

import matterviz_dash_components as mvc
import pytest
from matterviz_dash_components import MatterViz
from scripts.sync_typed_wrappers import parse_svelte_dts_with_includes

STRUCTURE_V043_PARAMETERS = """
id active_volume_idx allow_file_drop atom_color_config bond_edit_mode bond_edit_order bonds
cell_type data_url displayed_structure dragover element_mapping element_radius_overrides
enable_info_pane enable_measure_mode error_msg fullscreen fullscreen_toggle height hidden_elements
hidden_prop_vals highlighted_sites hovered hovered_site_idx info_pane_open isosurface_settings
loading measure_mode measured_sites multi_view performance_mode png_dpi reset_text scene_props
selected_sites show_controls site_radius_overrides spinner_props structure structure_string sym_data
symmetry_settings views volumetric_data width mv_props set_props float32_props event_props last_event
className style
""".split()


def test_matterviz_forwards_props() -> None:
    """MatterViz forwards its complete custom prop surface."""
    expected = {
        "id": "test",
        "component": "structure/Structure",
        "mv_props": {"structure": {"sites": []}, "label": "α-Fe"},
        "set_props": ["hidden_elements"],
        "float32_props": ["positions"],
        "event_props": ["on_file_load"],
        "last_event": {"prop": "on_file_load"},
        "className": "viewer",
        "style": {"height": "100%"},
    }
    component = MatterViz(**expected)
    assert {key: getattr(component, key) for key in expected} == expected


def test_matterviz_omits_absent_id() -> None:
    """MatterViz omits id rather than forwarding id=None."""
    component = MatterViz(component="Structure")
    assert "id" not in component.to_plotly_json()["props"]


def test_include_aliases_detect_event_props(tmp_path: Path) -> None:
    """External include aliases classify callback props."""
    dist_dir = tmp_path / "dist"
    dist_dir.mkdir()
    (dist_dir / "Component.svelte.d.ts").write_text(
        "type $$ComponentProps = {}; declare const Component: "
        'import("svelte").Component<$$ComponentProps>;',
        encoding="utf-8",
    )
    (dist_dir / "included.d.ts").write_text(
        "type EventHandler = (data: StructureHandlerData) => void;\n"
        "type OnReady = EventHandler;\n"
        "interface IncludedProps { onReady?: OnReady; value?: string; }\n",
        encoding="utf-8",
    )
    props, callback_props, snippet_props, dom_props = parse_svelte_dts_with_includes(
        f"{dist_dir}/Component.svelte.d.ts",
        str(dist_dir),
        ["included.d.ts:IncludedProps"],
    )
    assert (
        {prop.js_name: prop.kind for prop in props},
        callback_props,
        snippet_props,
        dom_props,
    ) == ({"onReady": "callback", "value": "value"}, ["onReady"], [], [])


def test_structure_preserves_legacy_positional_bindings() -> None:
    """New Structure props append after existing positional arguments."""
    parameter_names = list(inspect.signature(mvc.Structure.__init__).parameters)[1:]
    assert parameter_names == [
        *STRUCTURE_V043_PARAMETERS,
        "multi_view_gap",
        "multi_view_active",
        "multi_view_min_pane_height",
        "multi_view_min_pane_width",
        "kwargs",
    ]

    legacy_args: list[Any] = [None] * STRUCTURE_V043_PARAMETERS.index(
        "performance_mode"
    )
    structure_class: Any = mvc.Structure
    component = structure_class(
        *legacy_args,
        "speed",
        144,
        multi_view_active=True,
        multi_view_min_pane_height=201,
        multi_view_min_pane_width=301,
        multi_view_gap=12,
    )
    assert component.mv_props == {
        "performance_mode": "speed",
        "png_dpi": 144,
        "multi_view_active": True,
        "multi_view_min_pane_height": 201,
        "multi_view_min_pane_width": 301,
        "multi_view_gap": 12,
    }


@pytest.mark.parametrize(
    "wrapper",
    [mvc.ConvexHull2D, mvc.ConvexHull3D, mvc.ConvexHull4D],
)
def test_convex_hull_category_props_forwarded(wrapper: type) -> None:
    """Typed convex hull wrappers forward category props."""
    omitted = wrapper(entries=[])
    assert "entry_category" not in omitted.mv_props
    assert "hidden_categories" not in omitted.mv_props

    configured = wrapper(
        entries=[], entry_category=None, hidden_categories=["FM", "NM"]
    )
    assert configured.mv_props["entry_category"] is None
    assert configured.mv_props["hidden_categories"] == ["FM", "NM"]

    empty_hidden = wrapper(entries=[], hidden_categories=[])
    assert empty_hidden.mv_props["hidden_categories"] == []


def test_package_metadata() -> None:
    """Package exposes its version and Dash assets."""
    assert isinstance(mvc.__version__, str)
    assert mvc._js_dist
    assert isinstance(mvc._css_dist, list)
