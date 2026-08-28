"""The true fundamental domain polygon for a wallpaper group (not just the unit cell).

Constructed as a Dirichlet domain (Voronoi cell): pick a generic point p, take its
orbit under the group (coset representatives x nearby lattice translations), and
intersect the half-planes "closer to p than to q" for every other orbit point q.
This is a standard, general construction that is guaranteed to produce a valid
fundamental domain for any of the 17 wallpaper groups without needing a hand-derived
polygon per group -- see ``tests/test_fundamental_domain.py`` for verification
(polygon area matches cell_area / point_group_order, and the transformed copies
tile the plane without gaps or overlaps under random sampling).
"""
from __future__ import annotations

import numpy as np

from .groups import WALLPAPER_GROUPS, coset_representatives
from .lattice import lattice_translations

# A generic fractional point (in units of a1, a2), chosen to avoid lying on any
# rotation center, mirror line, or glide line of any of the 17 groups.
_DEFAULT_BASE_POINT_FRAC = (0.5313, 0.2897)


def default_base_point(a1: np.ndarray, a2: np.ndarray) -> np.ndarray:
    u, v = _DEFAULT_BASE_POINT_FRAC
    return u * a1 + v * a2


def _clip_by_halfplane(polygon: list[np.ndarray], midpoint: np.ndarray, normal: np.ndarray) -> list[np.ndarray]:
    """Keep the part of a convex polygon on the base-point side of a bisector line."""
    out: list[np.ndarray] = []
    n = len(polygon)
    for i in range(n):
        cur, nxt = polygon[i], polygon[(i + 1) % n]
        cur_in = np.dot(cur - midpoint, normal) <= 1e-9
        nxt_in = np.dot(nxt - midpoint, normal) <= 1e-9
        if cur_in:
            out.append(cur)
        if cur_in != nxt_in:
            denom = np.dot(nxt - cur, normal)
            t = np.dot(midpoint - cur, normal) / denom
            out.append(cur + t * (nxt - cur))
    return out


def dirichlet_domain(
    symbol: str,
    a1: np.ndarray,
    a2: np.ndarray,
    base_point: np.ndarray | None = None,
    neighbor_range: int = 2,
) -> np.ndarray:
    """Return the fundamental domain polygon as an (N, 2) array of Cartesian vertices."""
    if base_point is None:
        base_point = default_base_point(a1, a2)
    base_point = np.asarray(base_point, dtype=float)

    reps = coset_representatives(symbol, a1, a2)
    kind = WALLPAPER_GROUPS[symbol].lattice_kind
    translations = list(
        lattice_translations(kind, a1, a2, range(-neighbor_range, neighbor_range + 1), range(-neighbor_range, neighbor_range + 1))
    )

    orbit = []
    for rep in reps:
        pt = rep.apply(base_point.reshape(1, 2))[0]
        for t in translations:
            orbit.append(pt + t)
    orbit = np.array(orbit)
    orbit = orbit[np.linalg.norm(orbit - base_point, axis=1) > 1e-9]
    orbit = orbit[np.argsort(np.linalg.norm(orbit - base_point, axis=1))]

    span = 6 * max(np.linalg.norm(a1), np.linalg.norm(a2))
    polygon = [
        base_point + np.array([-span, -span]),
        base_point + np.array([span, -span]),
        base_point + np.array([span, span]),
        base_point + np.array([-span, span]),
    ]
    for q in orbit:
        midpoint = (base_point + q) / 2
        normal = q - base_point
        polygon = _clip_by_halfplane(polygon, midpoint, normal)
        if len(polygon) < 3:
            raise RuntimeError(f"degenerate fundamental domain for {symbol!r}")
    return np.array(polygon)


def polygon_area(polygon: np.ndarray) -> float:
    x, y = polygon[:, 0], polygon[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def polygon_centroid(polygon: np.ndarray) -> np.ndarray:
    return polygon.mean(axis=0)
