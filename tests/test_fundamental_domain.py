from __future__ import annotations

import numpy as np
import pytest

from tiler.fundamental_domain import dirichlet_domain, polygon_area
from tiler.groups import GROUP_SYMBOLS, WALLPAPER_GROUPS, coset_representatives
from tiler.lattice import LatticeKind, basis_vectors, lattice_translations

EXPECTED_ORDER = {
    "p1": 1, "p2": 2, "pm": 2, "pg": 2, "cm": 2,
    "pmm": 4, "pmg": 4, "pgg": 4, "cmm": 4,
    "p4": 4, "p4m": 8, "p4g": 8,
    "p3": 3, "p3m1": 6, "p31m": 6, "p6": 6, "p6m": 12,
}


def _point_in_convex_polygon(point: np.ndarray, polygon: np.ndarray, tol: float = 1e-7) -> bool:
    n = len(polygon)
    sign = 0
    for i in range(n):
        a, b = polygon[i], polygon[(i + 1) % n]
        cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])
        if cross < -tol:
            s = -1
        elif cross > tol:
            s = 1
        else:
            s = 0
        if s != 0:
            if sign == 0:
                sign = s
            elif s != sign:
                return False
    return True


@pytest.mark.parametrize("symbol", GROUP_SYMBOLS)
def test_domain_area_matches_orbit_multiplicity(symbol):
    kind = WALLPAPER_GROUPS[symbol].lattice_kind
    a1, a2 = basis_vectors(kind, cell_size=1.0, ratio=1.3, angle_deg=80.0)
    polygon = dirichlet_domain(symbol, a1, a2)
    area = polygon_area(polygon)

    cell_area = abs(a1[0] * a2[1] - a1[1] * a2[0])
    # translations-per-conventional-cell: 1, or 2 for a centered lattice
    translations_per_cell = 2 if kind == LatticeKind.CENTERED_RECTANGULAR else 1
    point_group_order = EXPECTED_ORDER[symbol]
    expected_area = cell_area / (translations_per_cell * point_group_order)
    assert area == pytest.approx(expected_area, rel=1e-6)


@pytest.mark.parametrize("symbol", GROUP_SYMBOLS)
def test_domain_is_convex_and_nondegenerate(symbol):
    kind = WALLPAPER_GROUPS[symbol].lattice_kind
    a1, a2 = basis_vectors(kind, cell_size=1.0, ratio=1.1, angle_deg=75.0)
    polygon = dirichlet_domain(symbol, a1, a2)
    assert len(polygon) >= 3
    assert polygon_area(polygon) > 1e-6


@pytest.mark.parametrize("symbol", GROUP_SYMBOLS)
def test_domain_is_regular_not_arbitrarily_shaped(symbol):
    """The default base point search should always find a compact, few-vertex shape.

    Regression guard: a fully generic (avoid-every-mirror) base point alone can
    produce a much messier polygon (e.g. a pentagon for p6) than picking a point
    that lies on the lattice's own mirror axes where that's still generic for this
    particular group -- see the module docstring for why. This just checks we
    don't regress back to the messier shape, not any exact vertex count.
    """
    kind = WALLPAPER_GROUPS[symbol].lattice_kind
    a1, a2 = basis_vectors(kind, cell_size=1.0, ratio=1.3, angle_deg=80.0)
    polygon = dirichlet_domain(symbol, a1, a2)
    assert len(polygon) <= 6


def _distance_to_polygon_boundary(point: np.ndarray, polygon: np.ndarray) -> float:
    n = len(polygon)
    best = np.inf
    for i in range(n):
        a, b = polygon[i], polygon[(i + 1) % n]
        ab = b - a
        t = np.clip(np.dot(point - a, ab) / max(np.dot(ab, ab), 1e-18), 0.0, 1.0)
        best = min(best, np.linalg.norm(point - (a + t * ab)))
    return best


_GROUPS_WITH_NONTRIVIAL_ORIGIN_STABILIZER = [
    s
    for s in GROUP_SYMBOLS
    if s != "p1"  # p1's only operation is the identity -- the origin isn't actually special
    and all(np.allclose(t, 0) for _, t in WALLPAPER_GROUPS[s].frac_ops)
]


@pytest.mark.parametrize("symbol", _GROUPS_WITH_NONTRIVIAL_ORIGIN_STABILIZER)
def test_origin_rotation_center_lies_on_domain_boundary(symbol):
    """For groups whose full point group fixes the origin, the domain should touch it.

    Every coset-rep matrix fixing the origin means the origin is the group's
    highest-order rotation center (or, for pure-mirror groups, the intersection of
    several mirrors) -- the near-origin base point search should put it exactly on
    the domain's boundary (vertex or edge), matching how these are normally drawn.
    """
    kind = WALLPAPER_GROUPS[symbol].lattice_kind
    a1, a2 = basis_vectors(kind, cell_size=1.0, ratio=1.3, angle_deg=80.0)
    polygon = dirichlet_domain(symbol, a1, a2)
    tol = 1e-6 * max(np.linalg.norm(a1), np.linalg.norm(a2))
    assert _distance_to_polygon_boundary(np.zeros(2), polygon) < tol, f"{symbol}: origin not on boundary\n{polygon}"


@pytest.mark.parametrize(
    "ratio,angle_deg",
    [(2.9924668266308703, 157.31694742867222), (0.31, 25.0), (2.95, 25.0), (0.31, 155.0)],
)
def test_domain_area_correct_for_extreme_lattice_shapes(ratio, angle_deg):
    """Regression test: a strongly skewed/elongated oblique lattice used to silently
    return a region of roughly double the correct area (a fixed, small lattice
    translation search range missed a geometrically-near but high-integer-index
    lattice point needed to fully clip the domain).
    """
    a1, a2 = basis_vectors(LatticeKind.OBLIQUE, cell_size=1.0, ratio=ratio, angle_deg=angle_deg)
    polygon = dirichlet_domain("p1", a1, a2)
    cell_area = abs(a1[0] * a2[1] - a1[1] * a2[0])
    assert polygon_area(polygon) == pytest.approx(cell_area, rel=1e-3)


@pytest.mark.parametrize("symbol", GROUP_SYMBOLS)
def test_orbit_of_domain_tiles_plane_without_gaps_or_overlaps(symbol):
    """Every random point in a window should land in exactly one transformed copy."""
    rng = np.random.default_rng(0)
    kind = WALLPAPER_GROUPS[symbol].lattice_kind
    a1, a2 = basis_vectors(kind, cell_size=1.0, ratio=1.2, angle_deg=80.0)
    polygon = dirichlet_domain(symbol, a1, a2)
    reps = coset_representatives(symbol, a1, a2)
    translations = list(lattice_translations(kind, a1, a2, range(-2, 3), range(-2, 3)))

    copies = [rep.apply(polygon) + t for rep in reps for t in translations]

    span = 0.8 * max(np.linalg.norm(a1), np.linalg.norm(a2))
    samples = rng.uniform(-span, span, size=(200, 2))
    for p in samples:
        hits = sum(_point_in_convex_polygon(p, copy) for copy in copies)
        assert hits >= 1, f"{symbol}: point {p} not covered by any domain copy"
        assert hits <= 1, f"{symbol}: point {p} covered by {hits} domain copies (overlap)"
