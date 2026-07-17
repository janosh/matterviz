"""
Generate typed Python wrapper classes for selected MatterViz components.

This shim exposes a single generic Dash component (MatterViz) which forwards an arbitrary
JSON-serializable `mv_props` dict to a selected MatterViz Svelte component.

This script adds *typed* Python wrappers (subclasses of MatterViz) for IDE discoverability.

How props are discovered
------------------------
MatterViz ships TypeScript declaration files next to its compiled Svelte components:

  <matterviz-dist>/**/<Component>.svelte.d.ts

These contain a `type $$ComponentProps = ...` (often) or a `type Props = ...` plus a Svelte
component declaration like:

  declare const Foo: import("svelte").Component<$$ComponentProps, ...>;

We extract the first type argument of `import("svelte").Component<...>` and collect property
names from any object literals in that expression, recursively following simple `type X = {...}`
aliases used in the same file (e.g. EventHandlers).

A small TOML manifest (component_manifest.toml) curates which components to expose and allows
overrides.

Usage
-----
  python scripts/sync_typed_wrappers.py \
      --manifest component_manifest.toml \
      --matterviz-dist ../../dist \
      --out matterviz_dash_components/typed.py
"""

from __future__ import annotations

import argparse
import keyword
import os
import re
import tomllib
from dataclasses import dataclass
from glob import glob
from typing import Any


@dataclass(frozen=True)
class Prop:
    js_name: str
    py_name: str
    ts_type: str
    kind: str  # "value" | "callback" | "snippet" | "dom"


class BracketTracker:
    """Track nesting depth for (), [], {}, <> and string quotes."""

    __slots__ = ("par", "brk", "brc", "ang", "in_bt", "in_sq", "in_dq")

    def __init__(self) -> None:
        self.par = self.brk = self.brc = self.ang = 0
        self.in_bt = self.in_sq = self.in_dq = False

    def update(self, src: str, idx: int) -> bool:
        """Update state for character at src[idx]. Returns True if inside a string.

        Handles escaped quotes by counting preceding backslashes (odd = escaped).
        """
        ch = src[idx]
        prev = src[idx - 1] if idx > 0 else ""

        # Count consecutive backslashes before this character
        bs_count, pos = 0, idx - 1
        while pos >= 0 and src[pos] == "\\":
            bs_count += 1
            pos -= 1
        is_escaped = bs_count % 2 == 1

        if ch == "`" and not self.in_sq and not self.in_dq and not is_escaped:
            self.in_bt = not self.in_bt
            return True
        if ch == "'" and not self.in_bt and not self.in_dq and not is_escaped:
            self.in_sq = not self.in_sq
            return True
        if ch == '"' and not self.in_bt and not self.in_sq and not is_escaped:
            self.in_dq = not self.in_dq
            return True
        if self.in_string:
            return True

        if ch == "(":
            self.par += 1
        elif ch == ")":
            self.par = max(0, self.par - 1)
        elif ch == "[":
            self.brk += 1
        elif ch == "]":
            self.brk = max(0, self.brk - 1)
        elif ch == "{":
            self.brc += 1
        elif ch == "}":
            self.brc = max(0, self.brc - 1)
        elif ch == "<":
            self.ang += 1
        elif ch == ">" and prev != "=":  # Ignore '=>' arrows
            self.ang = max(0, self.ang - 1)
        return False

    @property
    def in_string(self) -> bool:
        return self.in_bt or self.in_sq or self.in_dq

    @property
    def at_top_level(self) -> bool:
        return self.par == self.brk == self.brc == self.ang == 0


def _to_snake(name: str) -> str:
    """Convert a TS prop name to a Python-friendly snake_case identifier."""
    out = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    out = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", out).lower()

    out = out.replace("-", "_") or "prop"
    if out[0].isdigit():
        out = f"p_{out}"
    if keyword.iskeyword(out):
        out += "_"
    return out


def _split_top_level(expr: str, sep: str) -> list[str]:
    """Split expr on sep only when not nested in (), [], {}, <> or quotes."""
    parts: list[str] = []
    start = 0
    tracker = BracketTracker()

    for idx, ch in enumerate(expr):
        if tracker.update(expr, idx):
            continue
        if ch == sep and tracker.at_top_level:
            parts.append(expr[start:idx].strip())
            start = idx + 1

    if tail := expr[start:].strip():
        parts.append(tail)
    return parts


def _find_matching_angle(src: str, open_idx: int) -> int:
    """Find matching '>' for '<' at open_idx, respecting nested generics."""
    assert src[open_idx] == "<"
    tracker = BracketTracker()

    for idx in range(open_idx, len(src)):
        tracker.update(src, idx)
        if tracker.ang == 0:
            return idx

    raise ValueError("Unmatched '<' while scanning generic type arguments")


def _extract_type_aliases(src: str) -> dict[str, str]:
    """Extract simple `type Name = ...;` aliases from a .d.ts file."""
    aliases: dict[str, str] = {}

    for match in re.finditer(r"\btype\s+([A-Za-z0-9_]+)\s*=", src):
        name = match.group(1)
        if expression := _read_until_top_level_semicolon(src, match.end()):
            aliases[name] = expression

    return aliases


def _read_until_top_level_semicolon(src: str, start: int) -> str | None:
    """Read a type expression through its first top-level semicolon."""
    tracker = BracketTracker()
    for idx in range(start, len(src)):
        if tracker.update(src, idx):
            continue
        if src[idx] == ";" and tracker.at_top_level:
            return src[start:idx].strip()
    return None


def _extract_props_root_expr(src: str) -> str:
    """Extract the component props type expression from supported declaration formats."""
    # Strategy 1: type $$ComponentProps = ...
    if match := re.search(r"type\s+\$\$ComponentProps\s*=", src):
        if expression := _read_until_top_level_semicolon(src, match.end()):
            return expression

    # Strategy 2: $$render function format (generic components)
    if match := re.search(r"declare\s+function\s+\$\$render[^{]*\{\s*props\s*:", src):
        props_start = match.end()
        if expression := _read_until_top_level_semicolon(src, props_start):
            return expression
        # Fallback
        return src[props_start:].split(";")[0].strip()

    # Strategy 3: parse Component<...> generic
    if not (match := re.search(r'import\("svelte"\)\.Component<', src)):
        raise ValueError(
            "Could not extract props: no $$ComponentProps, $$render, or Component<...> found"
        )

    open_idx = match.end() - 1
    close_idx = _find_matching_angle(src, open_idx)
    inside = src[match.end() : close_idx]
    args = _split_top_level(inside, ",")

    if not args:
        raise ValueError("Could not parse Component<...> type arguments")

    return args[0].strip()


def _parse_object_literal(obj: str) -> dict[str, str]:
    """Parse `{ foo?: string; bar: number }` into prop types."""
    obj = obj.strip()
    if not (obj.startswith("{") and obj.endswith("}")):
        raise ValueError("Expected {...} object literal")

    inner = obj[1:-1].strip()
    props: dict[str, str] = {}
    for item in _split_top_level(inner, ";"):
        if item.startswith("[") or item.startswith("..."):  # index sig or spread
            continue
        if match := re.match(r"^([A-Za-z0-9_]+)\s*(?:\?)?\s*:\s*(.+)$", item):
            props[match.group(1)] = match.group(2).strip()

    return props


def _resolve_component_props_ref(
    term: str, src: str, dist_dir: str | None, visited: set[str]
) -> dict[str, str]:
    """Resolve ComponentProps<typeof X> to the props of component X."""
    match = re.match(r"ComponentProps\s*<\s*typeof\s+(\w+)\s*>", term)
    if not match or not dist_dir:
        return {}

    component_name = match.group(1)
    if component_name in visited:
        return {}
    visited.add(component_name)

    # Find the import path
    import_match = re.search(
        rf"import\s+{component_name}\s+from\s+['\"]([^'\"]+)['\"]", src
    )
    if not import_match:
        return {}

    import_path = import_match.group(1)
    component_file = import_path.split("/")[-1].replace(".svelte", ".svelte.d.ts")
    subdir = import_path.split("/")[-2] if "/" in import_path else ""

    candidates = glob(f"{dist_dir}/**/{component_file}", recursive=True)
    if subdir:
        candidates = [path for path in candidates if subdir in path] or candidates
    if not candidates:
        return {}

    with open(candidates[0], encoding="utf-8") as file:
        ref_src = file.read()
    try:
        ref_expr = _extract_props_root_expr(ref_src)
        return _collect_props(
            ref_expr, _extract_type_aliases(ref_src), dist_dir, visited, ref_src
        )
    except ValueError:
        return {}


def _collect_props(
    expr: str,
    aliases: dict[str, str],
    dist_dir: str | None = None,
    visited: set[str] | None = None,
    src: str = "",
) -> dict[str, str]:
    """Collect props from an intersection type expression."""
    if visited is None:
        visited = set()
    out: dict[str, str] = {}

    for term in _split_top_level(expr, "&"):
        term = term.strip()
        if not term:
            continue

        if term.startswith("{"):
            # Find matching brace
            tracker = BracketTracker()
            for idx, ch in enumerate(term):
                if tracker.update(term, idx):
                    continue
                if ch == "}" and tracker.brc == 0:
                    out.update(_parse_object_literal(term[: idx + 1]))
                    break
            continue

        if term.startswith("ComponentProps<"):
            out.update(_resolve_component_props_ref(term, src, dist_dir, visited))
            continue

        # Follow type aliases
        if (
            re.fullmatch(r"[A-Za-z0-9_]+", term)
            and term in aliases
            and term not in visited
        ):
            visited.add(term)
            out.update(_collect_props(aliases[term], aliases, dist_dir, visited, src))

    return out


def _parse_interface_props(src: str, interface_name: str) -> dict[str, str]:
    """Extract props from an interface definition in a .d.ts file."""
    pattern = rf"\binterface\s+{re.escape(interface_name)}(?:<[^>]*>)?(?:\s+extends\s+[^{{]+)?\s*\{{"
    if not (match := re.search(pattern, src)):
        return {}

    brace_start = match.end() - 1
    depth = 1
    idx = brace_start + 1
    while idx < len(src) and depth > 0:
        if src[idx] == "{":
            depth += 1
        elif src[idx] == "}":
            depth -= 1
        idx += 1

    return _parse_object_literal(src[brace_start:idx])


def _parse_external_type_with_aliases(
    dist_dir: str, include_spec: str
) -> tuple[dict[str, str], dict[str, str]]:
    """Parse an external type/interface and return same-file aliases.

    include_spec format: "path/to/file.d.ts:TypeName"
    """
    if ":" not in include_spec:
        return {}, {}

    file_path, type_name = include_spec.rsplit(":", 1)
    dts_path = f"{dist_dir}/{file_path}"
    if not os.path.isfile(dts_path):
        print(f"Warning: External type file not found: {dts_path}")
        return {}, {}

    with open(dts_path, encoding="utf-8") as fh:
        src = fh.read()

    aliases = _extract_type_aliases(src)
    # Try interface first, then type alias
    if props := _parse_interface_props(src, type_name):
        return props, aliases

    if type_name in aliases:
        return _collect_props(aliases[type_name], aliases, dist_dir, src=src), aliases

    return {}, aliases


def _strip_outer_parentheses(expr: str) -> str:
    """Strip optional markers and parentheses enclosing the complete expression."""
    stripped = expr.strip().removesuffix("?").strip()
    while stripped.startswith("(") and stripped.endswith(")"):
        tracker = BracketTracker()
        for idx in range(len(stripped)):
            tracker.update(stripped, idx)
            if tracker.par == 0:
                if idx != len(stripped) - 1:
                    return stripped
                stripped = stripped[1:-1].strip()
                break
    return stripped


def _has_top_level_arrow(expr: str) -> bool:
    """Return whether a TypeScript expression contains a top-level function arrow."""
    tracker = BracketTracker()
    for idx in range(len(expr) - 1):
        if tracker.update(expr, idx):
            continue
        if expr.startswith("=>", idx) and tracker.at_top_level:
            return True
    return False


def _detect_prop_kind(ts_type: str, aliases: dict[str, str] | None = None) -> str:
    """Determine prop kind based on TypeScript type signature."""
    resolved = ts_type
    seen_aliases: set[str] = set()
    while aliases and resolved in aliases and resolved not in seen_aliases:
        seen_aliases.add(resolved)
        resolved = aliases[resolved]
    resolved = _strip_outer_parentheses(resolved)
    if _has_top_level_arrow(resolved):
        return "callback"
    union_terms = [
        _strip_outer_parentheses(term)
        for term in _split_top_level(resolved, "|")
        if term.strip() not in {"null", "undefined"}
    ]
    if union_terms and all(_has_top_level_arrow(term) for term in union_terms):
        return "callback"
    if "Snippet" in resolved:
        return "snippet"
    if "HTMLElement" in resolved or "HTMLDivElement" in resolved:
        return "dom"
    return "value"


def _make_prop(
    js_name: str, ts_type: str, aliases: dict[str, str] | None = None
) -> Prop:
    """Create normalized prop metadata from a TypeScript declaration."""
    return Prop(
        js_name, _to_snake(js_name), ts_type, _detect_prop_kind(ts_type, aliases)
    )


def parse_svelte_dts(
    dts_path: str,
    dist_dir: str | None = None,
) -> list[Prop]:
    """Parse a *.svelte.d.ts file into prop metadata."""
    with open(dts_path, encoding="utf-8") as fh:
        src = fh.read()
    aliases = _extract_type_aliases(src)
    root_expr = _extract_props_root_expr(src)
    js_props = _collect_props(root_expr, aliases, dist_dir, src=src)
    return [
        _make_prop(js_name, ts_type, aliases)
        for js_name, ts_type in sorted(js_props.items())
    ]


def parse_svelte_dts_with_includes(
    dts_path: str, dist_dir: str, include_from: list[str]
) -> list[Prop]:
    """Parse a *.svelte.d.ts file with additional external type includes."""
    props = parse_svelte_dts(dts_path, dist_dir)
    existing = {prop.js_name for prop in props}

    for include_spec in include_from:
        include_props, aliases = _parse_external_type_with_aliases(
            dist_dir, include_spec
        )
        for js_name, ts_type in include_props.items():
            if js_name in existing:
                continue

            props.append(_make_prop(js_name, ts_type, aliases))
            existing.add(js_name)

    return props


def add_extra_props(props: list[Prop], extra_props: dict[str, str]) -> None:
    """Add manually-specified extra props to the props list."""
    existing = {prop.js_name for prop in props}
    props.extend(
        (
            _make_prop(js_name, ts_type)
            for js_name, ts_type in extra_props.items()
            if js_name not in existing
        )
    )


def find_component_dts(dist_dir: str, key: str) -> str:
    """Resolve a manifest key to a *.svelte.d.ts file."""
    if "/" in key:
        path = f"{dist_dir}/{key}.svelte.d.ts"
        if not os.path.isfile(path):
            raise FileNotFoundError(path)
        return path

    matches = glob(f"{dist_dir}/**/{key}.svelte.d.ts", recursive=True)
    if not matches:
        raise FileNotFoundError(f"No match for {key!r} under {dist_dir}")
    if len(matches) > 1:
        rel = ", ".join(match.replace(f"{dist_dir}/", "") for match in matches)
        raise RuntimeError(f"Ambiguous key={key!r}. Matches: {rel}. Use a path key.")
    return matches[0]


# Heuristic keywords for inferring int type from TS number type.
# Override in manifest via [components.Name.type_hints] if this fails.
_INT_KEYWORDS = ("_idx", "_index", "_count", "n_bins", "n_ticks", "num_", "sites")
_SET_TYPE_PATTERN = re.compile(r"\b(?:Readonly)?Set\s*<")


def _py_type_hint(
    ts_type: str, prop_name: str = "", type_hints: dict[str, str] | None = None
) -> str:
    """Conservative TS->Python type hint mapper.

    Type Inference:
        - number -> float (or int if prop_name contains _idx, _index, etc.)
        - Override via manifest [components.Name.type_hints]
    """
    if type_hints and prop_name in type_hints:
        return type_hints[prop_name]

    type_str = ts_type.strip()

    if type_str == "string":
        return "str"
    if type_str == "number":
        return "int" if any(kw in prop_name for kw in _INT_KEYWORDS) else "float"
    if type_str == "boolean":
        return "bool"
    if type_str.endswith("[]"):
        inner = _py_type_hint(type_str[:-2].strip(), prop_name, type_hints)
        return f"list[{inner}]" if inner != "Any" else "list"
    if "Record" in type_str or "Partial" in type_str or "ComponentProps" in type_str:
        return "dict"
    if _SET_TYPE_PATTERN.search(type_str):
        return "list"
    if "Float32Array" in type_str:
        return "list[float]"
    if re.fullmatch(
        r"Vec\d+", type_str
    ):  # matterviz numeric tuple aliases (Vec2/Vec3/...)
        return "list[float]"
    if type_str.startswith("[") and type_str.endswith("]"):
        return "list"
    if "|" in type_str:
        parts = [
            part.strip()
            for part in type_str.split("|")
            if part.strip() not in ("null", "undefined")
        ]
        if parts:
            return _py_type_hint(parts[0], prop_name, type_hints)
    return "Any"


def generate_wrappers(manifest: dict[str, Any], dist_dir: str) -> str:
    """Generate typed Python wrapper classes from manifest and return as string."""
    components = manifest.get("components", {})
    if not components:
        raise SystemExit("Manifest has no [components.*] sections")

    lines = [
        "# AUTO-GENERATED by scripts/sync_typed_wrappers.py - DO NOT EDIT",
        "#",
        "# Type Inference: number -> float (int if prop contains _idx/_index/_count/etc.)",
        "# Override via manifest [components.Name.type_hints] = { prop = 'int' }",
        "",
        "from __future__ import annotations",
        "",
        "from typing import Any",
        "",
        "from .MatterViz import MatterViz",
        "",
        "_UNSET = object()",
        "",
    ]

    for class_name, spec in components.items():
        key = spec.get("key")
        if not key:
            raise SystemExit(f"[components.{class_name}] missing 'key'")

        dts_path = find_component_dts(dist_dir, key)
        props = parse_svelte_dts_with_includes(
            dts_path, dist_dir, spec.get("include_from", [])
        )

        if extra := spec.get("extra_props", {}):
            add_extra_props(props, extra)
        callback_props = [prop.js_name for prop in props if prop.kind == "callback"]
        snippet_props = [prop.js_name for prop in props if prop.kind == "snippet"]

        # Filter to JSON-serializable value props
        # These are handled by the base MatterViz wrapper args and must not be
        # re-emitted as component-specific params.
        reserved_base_args = {"id", "className", "style", "children"}
        value_props = [
            prop
            for prop in props
            if prop.kind == "value" and prop.js_name not in reserved_base_args
        ]

        # Auto-detect conversion defaults
        auto_set = [
            prop.js_name
            for prop in value_props
            if _SET_TYPE_PATTERN.search(prop.ts_type)
        ]
        auto_float32 = [
            prop.js_name for prop in value_props if "Float32Array" in prop.ts_type
        ]

        default_set_props = spec.get("set_props", auto_set)
        default_float32_props = spec.get("float32_props", auto_float32)
        alias_overrides = spec.get("aliases") or {}
        type_hints = spec.get("type_hints", {})
        forward_none_props = set(spec.get("forward_none_props", []))
        trailing_props: list[str] = spec.get("trailing_props", [])
        if len(trailing_props) != len(set(trailing_props)):
            raise ValueError(f"[{class_name}] trailing props must be unique")
        js_to_prop = {prop.js_name: prop for prop in value_props}

        # Build python->js mapping with unique identifiers
        py_to_js: dict[str, str] = {}
        for prop in value_props:
            py, js = prop.py_name, alias_overrides.get(prop.py_name, prop.js_name)
            base = py
            suffix = 2
            while py in py_to_js:
                py = f"{base}_{suffix}"
                suffix += 1
            py_to_js[py] = js

        if invalid_trailing_props := [
            prop for prop in trailing_props if prop not in py_to_js
        ]:
            raise ValueError(
                f"[{class_name}] unknown trailing Python props: "
                f"{invalid_trailing_props}"
            )

        # Generate class
        doc = (spec.get("doc") or "").strip() or f"Typed wrapper for '{key}'."
        lines.append(f"class {class_name}(MatterViz):")
        lines.append(f'    """{doc}')
        lines.append("")
        lines.append(f"    Component key: ``{key}``")
        if callback_props:
            lines.append(f"\n    Events: {', '.join(callback_props)}")
        if snippet_props:
            lines.append(f"\n    Unsupported snippets: {', '.join(snippet_props)}")
        if forward_none_props:
            lines.append(
                f"\n    Explicit None for {', '.join(sorted(forward_none_props))} is "
                "forwarded as JS null (omit the kwarg to keep the JS-side default)"
            )
        lines.append('    """')
        lines.append("")

        # Build signature
        sig = ["self", "id=None"]
        trailing_params: dict[str, str] = {}
        for py, js in py_to_js.items():
            prop = js_to_prop.get(js)
            if prop is None:
                raise ValueError(
                    f"[{class_name}] alias '{py}' maps to unknown JS prop '{js}'. "
                    f"Valid props: {list(js_to_prop.keys())}"
                )
            py_type = _py_type_hint(prop.ts_type, py, type_hints)
            # Avoid duplicate None when type hint already includes it
            if "None" not in py_type:
                py_type += " | None"
            default = "_UNSET" if js in forward_none_props else "None"
            param = f"{py}: {py_type} = {default}"
            if py in trailing_props:
                trailing_params[py] = param
            else:
                sig.append(param)
        sig += [
            "mv_props: dict | None = None",
            "set_props: list[str] | None = None",
            "float32_props: list[str] | None = None",
            "event_props: list[str] | None = None",
            "last_event: dict | None = None",
            "className: str | None = None",
            "style: dict | None = None",
        ]
        sig += [trailing_params[prop] for prop in trailing_props] + ["**kwargs"]

        params = ",\n        ".join(sig)
        lines.append(f"    def __init__(\n        {params},\n    ):")
        lines.append("        if mv_props is None:")
        lines.append("            mv_props = {}")
        for py, js in py_to_js.items():
            sentinel = "_UNSET" if js in forward_none_props else "None"
            lines.append(f"        if {py} is not {sentinel}:")
            lines.append(f'            mv_props["{js}"] = {py}')
        for arg_name, default_props in {
            "set_props": default_set_props,
            "float32_props": default_float32_props,
        }.items():
            if default_props:
                lines.append(f"        if {arg_name} is None:")
                formatted = "[" + ", ".join(f'"{name}"' for name in default_props) + "]"
                lines.append(f"            {arg_name} = {formatted}")
        lines.append("")
        lines.append("        super().__init__(")
        lines.append("            id=id,")
        lines.append(f'            component="{key}",')
        lines.append("            mv_props=mv_props,")
        lines.append("            set_props=set_props,")
        lines.append("            float32_props=float32_props,")
        lines.append("            event_props=event_props,")
        lines.append("            last_event=last_event,")
        lines.append("            className=className,")
        lines.append("            style=style,")
        lines.append("            **kwargs,")
        lines.append("        )")
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    """CLI entry point for generating typed wrappers."""
    # Path to extensions/dash/ directory (parent of scripts/). abspath keeps the derived
    # defaults cwd-independent even where __file__ is relative (e.g. some import modes).
    dash_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=f"{dash_root}/component_manifest.toml")
    # Default to the repo's own build output (what CI uses), NOT the copy under
    # extensions/dash/node_modules: pnpm snapshots the `file:../..` dependency at
    # install time, so that copy silently goes stale as repo components evolve.
    repo_root = os.path.dirname(os.path.dirname(dash_root))
    ap.add_argument("--matterviz-dist", default=f"{repo_root}/dist")
    ap.add_argument("--out", default=f"{dash_root}/matterviz_dash_components/typed.py")
    ap.add_argument(
        "--check",
        action="store_true",
        help="Check if typed.py is up-to-date without writing. Exit 1 if outdated.",
    )
    args = ap.parse_args()

    manifest_path = args.manifest
    dist_dir = args.matterviz_dist
    out_path = args.out

    if not os.path.isfile(manifest_path):
        raise SystemExit(f"Manifest not found: {manifest_path}")
    if not os.path.isdir(dist_dir):
        raise SystemExit(
            f"MatterViz dist not found: {dist_dir}\n"
            "Build it with `pnpm package:dist` at the repo root (or pass "
            "--matterviz-dist pointing at a built matterviz dist directory)."
        )

    with open(manifest_path, encoding="utf-8") as fh:
        manifest = tomllib.loads(fh.read())

    expected = generate_wrappers(manifest, dist_dir)

    if args.check:
        # Compare generated content with existing file
        if not os.path.isfile(out_path):
            print(f"FAIL: {out_path} does not exist. Run sync_typed_wrappers.py first.")
            raise SystemExit(1)

        with open(out_path, encoding="utf-8") as fh:
            actual = fh.read()
        if actual != expected:
            print(f"FAIL: {out_path} is out of sync with component_manifest.toml")
            print("Run: python extensions/dash/scripts/sync_typed_wrappers.py")
            raise SystemExit(1)

        print(f"OK: {out_path} is up-to-date")
        raise SystemExit(0)

    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(expected)

    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
