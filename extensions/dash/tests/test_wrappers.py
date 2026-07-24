"""Tests for typed wrapper classes and the MatterViz component."""

from __future__ import annotations

import inspect
from pathlib import Path
from typing import Any, cast

import matterviz_dash_components as mvc
import pytest
from matterviz_dash_components import MatterViz
from scripts.sync_typed_wrappers import (
    _py_type_hint,
    add_extra_props,
    generate_wrappers,
    parse_svelte_dts_with_includes,
)

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

BRILLOUIN_ZONE_V043_PARAMETERS = """
id allow_file_drop bz_data bz_order camera_projection controls_open data_url dragover edge_color
edge_width error_msg fullscreen fullscreen_toggle height hovered hovered_k_point
hovered_qpoint_index ibz_color ibz_data ibz_opacity info_pane_open k_path_points loading png_dpi
show_controls show_ibz show_vectors spinner_props structure structure_string surface_color
surface_opacity tooltip_config vector_scale width mv_props set_props float32_props event_props
last_event className style
""".split()

PERIODIC_TABLE_V043_PARAMETERS = """
id active_category active_element active_elements color_bar_props color_overrides color_scale_range
disabled gap heatmap_values inner_transition_metal_offset labels lanth_act_style links log missing
show_color_bar show_photo split_layout tile_props mv_props set_props float32_props event_props
last_event className style
""".split()


def test_matterviz_forwards_props() -> None:
    """MatterViz forwards custom props and omits absent IDs."""
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
    assert "id" not in MatterViz(component="Structure").to_plotly_json()["props"]


def test_prop_kind_detection(tmp_path: Path) -> None:
    """Aliases, unions, and parenthesized callbacks classify correctly."""
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
        "interface IncludedProps { onReady?: OnReady; "
        "colorScale?: string | ((num: number) => string); "
        "onNullable?: (() => void) | null; "
        "onOverloaded?: ((data: string) => void) | ((data: number) => void); }\n",
        encoding="utf-8",
    )
    props = parse_svelte_dts_with_includes(
        f"{dist_dir}/Component.svelte.d.ts",
        str(dist_dir),
        ["included.d.ts:IncludedProps"],
    )
    add_extra_props(props, {"onOptional": "((data: string) => void)?"})
    assert {prop.js_name: prop.kind for prop in props} == {
        "onReady": "callback",
        "colorScale": "value",
        "onNullable": "callback",
        "onOverloaded": "callback",
        "onOptional": "callback",
    }


@pytest.mark.parametrize(
    ("ts_type", "expected"),
    [
        ("Set<string>", "list"),
        ("ReadonlySet<number>", "list"),
        ("IsosurfaceSettings", "Any"),
    ],
)
def test_set_type_hints_require_set_generics(ts_type: str, expected: str) -> None:
    """Set type inference excludes class names that merely contain 'Set'."""
    assert _py_type_hint(ts_type) == expected


def test_trailing_props_use_python_names(tmp_path: Path) -> None:
    """Trailing props accept Python names when aliases are explicitly null."""
    dist_dir = tmp_path / "dist"
    dist_dir.mkdir()
    (dist_dir / "Test.svelte.d.ts").write_text(
        "type $$ComponentProps = { someProp?: string; other_prop?: number; }; "
        'declare const Test: import("svelte").Component<$$ComponentProps>;',
        encoding="utf-8",
    )
    generated = generate_wrappers(
        {
            "components": {
                "Test": {
                    "key": "Test",
                    "aliases": None,
                    "trailing_props": ["some_prop"],
                }
            }
        },
        str(dist_dir),
    )
    assert (
        "style: dict | None = None,\n"
        "        some_prop: str | None = None,\n"
        "        **kwargs" in generated
    )
    assert 'mv_props["someProp"] = some_prop' in generated


def test_structure_preserves_legacy_positional_bindings() -> None:
    """Structure documents file drops without shifting legacy arguments."""
    structure_docs = inspect.getdoc(mvc.Structure) or ""
    assert "on_file_drop" in structure_docs
    assert "on_display_mode_change" in structure_docs
    assert "on_active_volume_idx_change" in structure_docs
    assert "on_slice_settings_change" in structure_docs
    parameter_names = list(inspect.signature(mvc.Structure.__init__).parameters)[1:]
    assert parameter_names == [
        *STRUCTURE_V043_PARAMETERS,
        "multi_view_gap",
        "multi_view_active",
        "multi_view_min_pane_height",
        "multi_view_min_pane_width",
        "display_mode",
        "slice_settings",
        "kwargs",
    ]

    legacy_args: list[Any] = [None] * STRUCTURE_V043_PARAMETERS.index(
        "performance_mode"
    )
    component = cast(Any, mvc.Structure)(
        *legacy_args,
        "speed",
        144,
        multi_view_active=True,
        multi_view_min_pane_height=201,
        multi_view_min_pane_width=301,
        multi_view_gap=12,
        display_mode="slice",
        slice_settings={"plane_mode": "hkl", "miller_indices": [1, 1, 0]},
    )
    assert component.mv_props == {
        "performance_mode": "speed",
        "png_dpi": 144,
        "multi_view_active": True,
        "multi_view_min_pane_height": 201,
        "multi_view_min_pane_width": 301,
        "multi_view_gap": 12,
        "display_mode": "slice",
        "slice_settings": {"plane_mode": "hkl", "miller_indices": [1, 1, 0]},
    }


def test_brillouin_zone_preserves_legacy_positional_bindings() -> None:
    """BrillouinZone documents file drops without shifting legacy arguments."""
    assert "on_file_drop" in (inspect.getdoc(mvc.BrillouinZone) or "")
    parameter_names = list(inspect.signature(mvc.BrillouinZone.__init__).parameters)[1:]
    assert parameter_names == [*BRILLOUIN_ZONE_V043_PARAMETERS, "kwargs"]

    legacy_args: list[Any] = [None] * BRILLOUIN_ZONE_V043_PARAMETERS.index("png_dpi")
    component = cast(Any, mvc.BrillouinZone)(*legacy_args, 144)
    assert component.mv_props == {"png_dpi": 144}


def test_periodic_table_preserves_legacy_positional_bindings() -> None:
    """PeriodicTable appends callable color scales after legacy arguments."""
    parameter_names = list(inspect.signature(mvc.PeriodicTable.__init__).parameters)[1:]
    assert parameter_names == [
        *PERIODIC_TABLE_V043_PARAMETERS,
        "color_scale",
        "kwargs",
    ]

    legacy_args: list[Any] = [None] * PERIODIC_TABLE_V043_PARAMETERS.index("style")
    component = cast(Any, mvc.PeriodicTable)(
        *legacy_args,
        {"width": "100%"},
        "interpolateViridis",
    )
    assert component.style == {"width": "100%"}
    assert component.mv_props == {"color_scale": "interpolateViridis"}


@pytest.mark.parametrize(
    "wrapper",
    [mvc.ConvexHull2D, mvc.ConvexHull3D, mvc.ConvexHull4D],
)
def test_convex_hull_category_props_forwarded(wrapper: type) -> None:
    """Typed convex hull wrappers forward category props."""
    omitted = wrapper(entries=[])
    assert "entry_category" not in omitted.mv_props
    assert "hidden_categories" not in omitted.mv_props

    configured = wrapper(entries=[], entry_category=None)
    assert configured.mv_props["entry_category"] is None

    empty_hidden = wrapper(entries=[], hidden_categories=[])
    assert empty_hidden.mv_props["hidden_categories"] == []
