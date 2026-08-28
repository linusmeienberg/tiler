"""The true fundamental domain polygon for a wallpaper group (not just the unit cell).

Constructed as a Dirichlet domain (Voronoi cell): pick a point p, take its orbit
under the group (coset representatives x nearby lattice translations), and
intersect the half-planes "closer to p than to q" for every other orbit point q.
This is a standard, general construction that is guaranteed to produce a valid
fundamental domain for any of the 17 wallpaper groups for *any* p whose stabilizer
in the group is trivial (a "generic" point) -- see ``tests/test_fundamental_domain.py``
for verification (polygon area matches cell_area / point_group_order, and the
transformed copies tile the plane without gaps or overlaps under random sampling).

The domain's *area* is the same for every generic p, but its *shape* isn't -- and
some choices give a far more recognizable ("textbook") shape than others. Every
coset-representative matrix in ``tiler.groups`` fixes the origin (or, for the
glide-heavy groups, at least the rotation subgroup does) -- i.e. the origin is
always the group's highest-order rotation center -- and two geometric facts follow:

- For a reflection/glide op q = M @ p + c, the perpendicular bisector of p and q is
  exactly that operation's mirror/glide line -- so a mirror line becomes a domain
  *edge* whenever that reflection is a near neighbour in the orbit.
- For a rotation r about a center c (|c - p| = |c - r(p)| by definition of
  "rotation about c"), c lies on the bisector of p and r(p), and of p and every
  other power of r applied to p -- so a rotation center becomes a *vertex* (where
  those bisectors meet) whenever it's the nearest such point.

So placing p close to the origin -- close to the highest-order rotation center --
tends to produce a compact domain with real rotation centers at its corners and
real mirror/glide lines along its edges, instead of an arbitrarily-shaped polygon.
The one trap: if the direction from the origin to p happens to lie exactly *on* one
of the group's own mirror/glide lines (not just the underlying lattice's, which has
more mirrors than the group may use), p stops being generic *for this group* and
the construction silently returns a region of exactly twice the correct area (two
fundamental domains' worth, glued along that line). ``_find_generic_base_point``
below tries a small set of natural near-origin directions and keeps only the ones
whose resulting area actually matches ``cell_area / point_group_order``, picking
the valid candidate with the fewest vertices (the most "regular"-looking one).
"""
from __future__ import annotations

import numpy as np

from .groups import WALLPAPER_GROUPS, coset_representatives
from .lattice import LatticeKind, lattice_translations

_EPSILON = 1e-3
# Loose enough to tolerate the small (<0.1%) area drift _simplify_polygon's dedup
# step can introduce for a coincidentally-degenerate lattice ratio (e.g. cmm at
# ratio=1.0), but tight enough to reject the "sits on this group's own mirror"
# failure mode, which is wrong by a factor of ~2 (100%), not a fraction of a percent.
_AREA_TOLERANCE = 1e-2


def _candidate_directions(kind: LatticeKind, a1: np.ndarray, a2: np.ndarray) -> list[np.ndarray]:
    """Near-origin directions worth trying, in units of a1/a2 -- see module docstring."""
    generic = 0.5313 * a1 + 0.2897 * a2  # avoids every mirror/glide line of every group
    if kind in (LatticeKind.RECTANGULAR, LatticeKind.CENTERED_RECTANGULAR):
        return [generic, a1, a2]
    if kind in (LatticeKind.SQUARE, LatticeKind.HEXAGONAL):
        return [generic, a1, a1 + a2]
    return [generic]  # oblique: no mirrors exist to be degenerate with


def _find_generic_base_point(symbol: str, a1: np.ndarray, a2: np.ndarray, neighbor_range: int) -> np.ndarray:
    kind = WALLPAPER_GROUPS[symbol].lattice_kind
    order = len(WALLPAPER_GROUPS[symbol].frac_ops)
    translations_per_cell = 2 if kind == LatticeKind.CENTERED_RECTANGULAR else 1
    cell_area = abs(a1[0] * a2[1] - a1[1] * a2[0])
    expected_area = cell_area / (translations_per_cell * order)

    best_valid_point, best_valid_vertex_count = None, None
    fallback_point, fallback_error = None, None
    for direction in _candidate_directions(kind, a1, a2):
        base_point = _EPSILON * direction
        polygon = _build_polygon(symbol, a1, a2, base_point, neighbor_range)
        rel_error = abs(polygon_area(polygon) - expected_area) / expected_area
        if fallback_error is None or rel_error < fallback_error:
            fallback_point, fallback_error = base_point, rel_error
        if rel_error > _AREA_TOLERANCE:
            continue  # base_point sits on one of *this* group's own mirror/glide lines
        if best_valid_vertex_count is None or len(polygon) < best_valid_vertex_count:
            best_valid_point, best_valid_vertex_count = base_point, len(polygon)

    # The fully generic direction is always tried and is never degenerate for any
    # group (see module docstring), so fallback_point is never actually None -- but
    # an extreme lattice ratio/angle can occasionally push every candidate's
    # simplify-step area error just over tolerance; rather than crash on a value a
    # user's slider might reach, fall back to whichever candidate was closest.
    return best_valid_point if best_valid_point is not None else fallback_point


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


def _simplify_polygon(polygon: list[np.ndarray], dedup_tol: float, collinear_tol: float = 1e-9) -> list[np.ndarray]:
    """Merge near-duplicate consecutive vertices and drop exactly-collinear ones.

    Clipping by several bisectors that meet (almost) at the same point -- which
    happens often once ``base_point`` sits near a high-order symmetry point, since
    several mirror/rotation-derived bisectors genuinely do meet there -- leaves
    floating-point sliver edges of near-zero length. This collapses them so the
    polygon's vertices are exactly the real symmetry points, not duplicated
    neighbours of them a fraction of a unit apart. ``dedup_tol`` (coarse, relative
    to lattice scale) drives that merge; a vertex removed this way contributes
    ~zero area, so it doesn't change the polygon's shape. ``collinear_tol`` (tight,
    near machine precision) separately drops vertices that are *exactly* on the
    line between their neighbours (a redundant bisector) -- kept tight so it never
    mistakes a genuine, slightly-bent corner for a straight edge.
    """
    deduped: list[np.ndarray] = []
    for p in polygon:
        if not deduped or np.linalg.norm(p - deduped[-1]) > dedup_tol:
            deduped.append(p)
    if len(deduped) > 1 and np.linalg.norm(deduped[0] - deduped[-1]) <= dedup_tol:
        deduped.pop()

    n = len(deduped)
    if n < 3:
        return deduped
    simplified: list[np.ndarray] = []
    for i in range(n):
        prev, cur, nxt = deduped[i - 1], deduped[i], deduped[(i + 1) % n]
        base = nxt - prev
        base_len = np.linalg.norm(base)
        if base_len < 1e-12:
            simplified.append(cur)  # prev and nxt coincide; not a collinearity case
            continue
        cross = base[0] * (cur[1] - prev[1]) - base[1] * (cur[0] - prev[0])
        perpendicular_distance = abs(cross) / base_len  # cur's distance from line(prev, nxt)
        if perpendicular_distance > collinear_tol:
            simplified.append(cur)
    return simplified if len(simplified) >= 3 else deduped


def _build_polygon_at_range(
    symbol: str,
    a1: np.ndarray,
    a2: np.ndarray,
    base_point: np.ndarray,
    neighbor_range: int,
) -> np.ndarray:
    """Dirichlet domain of ``base_point`` clipped against a fixed translation range."""
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

    # Near a high-symmetry point, several bisectors can meet at *almost* (but not
    # exactly) the same spot when base_point isn't perfectly aligned with the local
    # mirror/rotation axes, leaving a real but imperceptibly short sliver edge.
    # dedup_tol is well above those (~epsilon-scale) slivers and well below genuine
    # domain edges (which are >= a few % of a lattice vector).
    dedup_tol = 1e-3 * max(np.linalg.norm(a1), np.linalg.norm(a2))
    polygon = _simplify_polygon(polygon, dedup_tol)
    return np.array(polygon)


def _build_polygon(
    symbol: str,
    a1: np.ndarray,
    a2: np.ndarray,
    base_point: np.ndarray,
    neighbor_range: int,
    max_neighbor_range: int = 8,
) -> np.ndarray:
    """Dirichlet domain of ``base_point``, expanding the translation search range
    until the result stops changing.

    A fixed small range (e.g. +/-2) is enough for a well-conditioned lattice basis,
    but for a strongly skewed/elongated one (extreme ``ratio``/``angle_deg``, e.g.
    close to the oblique lattice's limits) some of the *geometrically* nearest
    lattice points only appear at larger integer coefficients -- missing them
    silently clips away too little and returns an oversized (e.g. 2x-area) region.
    Re-checking against a larger range and stopping once the area stabilizes
    catches that without needing a fixed large range (expensive) for every group.
    """
    polygon = _build_polygon_at_range(symbol, a1, a2, base_point, neighbor_range)
    area = polygon_area(polygon)
    while neighbor_range < max_neighbor_range:
        neighbor_range += 1
        wider_polygon = _build_polygon_at_range(symbol, a1, a2, base_point, neighbor_range)
        wider_area = polygon_area(wider_polygon)
        if abs(wider_area - area) <= 1e-9 * max(area, wider_area, 1e-12):
            return polygon
        polygon, area = wider_polygon, wider_area
    return polygon


def dirichlet_domain(
    symbol: str,
    a1: np.ndarray,
    a2: np.ndarray,
    base_point: np.ndarray | None = None,
    neighbor_range: int = 2,
) -> np.ndarray:
    """Return the fundamental domain polygon as an (N, 2) array of Cartesian vertices.

    If ``base_point`` is omitted, a near-origin point is chosen automatically to
    make the domain's shape as regular as possible (see module docstring) -- pass
    an explicit ``base_point`` to bypass that search (e.g. for testing, or to
    reproduce a specific, possibly less regular, Dirichlet cell).
    """
    if base_point is None:
        base_point = _find_generic_base_point(symbol, a1, a2, neighbor_range)
    else:
        base_point = np.asarray(base_point, dtype=float)
    return _build_polygon(symbol, a1, a2, base_point, neighbor_range)


def polygon_area(polygon: np.ndarray) -> float:
    x, y = polygon[:, 0], polygon[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def polygon_centroid(polygon: np.ndarray) -> np.ndarray:
    return polygon.mean(axis=0)
