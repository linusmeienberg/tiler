"""Derive the covering of the plane from a fundamental domain, for a given viewport."""
from __future__ import annotations

import numpy as np

from .domain import FundamentalDomain
from .groups import coset_representatives
from .lattice import cell_range_for_viewport, lattice_translations
from .transforms import Affine2D


def covering_transforms(
    domain: FundamentalDomain,
    viewport_min: tuple[float, float],
    viewport_max: tuple[float, float],
    margin_cells: int = 1,
) -> list[tuple[np.ndarray, Affine2D]]:
    """Enumerate the (lattice translation, point-group rep) pairs covering a viewport.

    Each pair (t, rep) means: take content placed in the base cell (in world
    coordinates), apply ``rep``, then translate by ``t``, to get one copy of the
    covering. Used both for transforming vector paths (see ``generate_covering``)
    and for driving per-copy canvas transforms when compositing a placed image.
    """
    a1, a2 = domain.basis
    reps = coset_representatives(domain.group, a1, a2)
    m_range, n_range = cell_range_for_viewport(
        a1, a2, np.asarray(viewport_min), np.asarray(viewport_max), margin_cells=margin_cells
    )
    translations = list(
        lattice_translations(domain.lattice_kind, a1, a2, m_range, n_range)
    )
    return [(t, rep) for rep in reps for t in translations]


def generate_covering(
    domain: FundamentalDomain,
    viewport_min: tuple[float, float],
    viewport_max: tuple[float, float],
    margin_cells: int = 1,
) -> list[np.ndarray]:
    """Apply the wallpaper group's symmetry orbit to every path in the domain.

    Returns a flat list of (N, 2) point arrays covering the given viewport (plus a
    margin of ``margin_cells`` extra lattice cells on every side, so motifs that
    straddle a cell boundary still tile seamlessly at the viewport edge).
    """
    if not domain.paths:
        return []

    transforms = covering_transforms(domain, viewport_min, viewport_max, margin_cells)
    covering: list[np.ndarray] = []
    for path in domain.paths:
        for t, rep in transforms:
            covering.append(rep.apply(path) + t)
    return covering


def svg_from_paths(
    paths: list[np.ndarray],
    viewport_min: tuple[float, float],
    viewport_max: tuple[float, float],
    stroke: str = "black",
    stroke_width: float = 0.01,
    scale: float = 200.0,
) -> str:
    """Render a list of point-array paths to a standalone SVG string."""
    width = (viewport_max[0] - viewport_min[0]) * scale
    height = (viewport_max[1] - viewport_min[1]) * scale

    def to_svg_xy(p: np.ndarray) -> np.ndarray:
        x = (p[:, 0] - viewport_min[0]) * scale
        y = (viewport_max[1] - p[:, 1]) * scale  # flip y for screen coords
        return np.column_stack([x, y])

    path_elems = []
    for path in paths:
        pts = to_svg_xy(path)
        d = "M " + " L ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
        path_elems.append(
            f'<path d="{d}" fill="none" stroke="{stroke}" '
            f'stroke-width="{stroke_width * scale:.3f}" stroke-linecap="round" stroke-linejoin="round" />'
        )
    body = "\n".join(path_elems)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.1f}" height="{height:.1f}" '
        f'viewBox="0 0 {width:.1f} {height:.1f}">\n{body}\n</svg>'
    )
