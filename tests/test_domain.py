from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from tiler.domain import FundamentalDomain
from tiler.image_source import detect_image_format, image_pixel_size


def _png_bytes(width: int, height: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (200, 50, 50)).save(buf, format="PNG")
    return buf.getvalue()


def test_polygon_is_cached_and_invalidated_on_lattice_change():
    """polygon is expensive (a self-verifying search over candidate base points);
    it must be cached across repeated access and only recomputed when the group or
    lattice parameters actually change -- see the perf note in FundamentalDomain.polygon.
    """
    domain = FundamentalDomain(group="p6m", cell_size=1.0)
    first = domain.polygon
    assert domain.polygon is first  # cache hit: identical object, not just equal

    domain.cell_size = 1.5
    second = domain.polygon
    assert second is not first
    assert domain.polygon is second

    domain.set_group("p4")
    third = domain.polygon
    assert third is not second


def test_detect_image_format():
    assert detect_image_format("photo.png") == "png"
    assert detect_image_format("photo.PNG") == "png"
    assert detect_image_format("icon.svg") == "svg+xml"
    with pytest.raises(ValueError):
        detect_image_format("document.pdf")


def test_png_pixel_size():
    assert image_pixel_size(_png_bytes(120, 80), "png") == (120.0, 80.0)


def test_svg_pixel_size_from_width_height():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"></svg>'
    assert image_pixel_size(svg, "svg+xml") == (64.0, 32.0)


def test_svg_pixel_size_from_viewbox():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"></svg>'
    assert image_pixel_size(svg, "svg+xml") == (200.0, 100.0)


def test_set_image_centers_and_scales_to_fit_polygon_bounding_box():
    # Note: fitting is to the polygon's axis-aligned bounding box, not the (possibly
    # triangular, e.g. p4m) polygon itself -- true polygon-inscribed fitting is a
    # harder problem this doesn't attempt to solve.
    domain = FundamentalDomain(group="pmm", cell_size=1.0)  # rectangular domain
    domain.set_image(_png_bytes(200, 100), "photo.png")

    polygon = domain.polygon
    assert domain.image is not None
    centroid = polygon.mean(axis=0)
    assert np.allclose(domain.image.center, centroid)

    corners_px = np.array([[0, 0], [200, 0], [200, 100], [0, 100]])
    transform = domain.image.to_world_transform()
    corners_world = transform.apply(corners_px)
    bbox_min, bbox_max = polygon.min(axis=0), polygon.max(axis=0)
    assert (corners_world.min(axis=0) >= bbox_min - 1e-9).all()
    assert (corners_world.max(axis=0) <= bbox_max + 1e-9).all()


def test_set_image_scale_is_positive_for_all_groups():
    from tiler.groups import GROUP_SYMBOLS

    for symbol in GROUP_SYMBOLS:
        domain = FundamentalDomain(group=symbol, cell_size=1.0)
        domain.set_image(_png_bytes(200, 100), "photo.png")
        assert domain.image.scale > 0


def test_image_to_world_transform_roundtrip_center_pixel():
    domain = FundamentalDomain(group="p1")
    domain.set_image(_png_bytes(100, 50), "photo.png")
    transform = domain.image.to_world_transform()
    center_px = np.array([[50.0, 25.0]])  # image's own pixel center
    world = transform.apply(center_px)[0]
    assert np.allclose(world, domain.image.center)


def test_move_image_and_clear_image():
    domain = FundamentalDomain(group="p1")
    domain.set_image(_png_bytes(40, 40), "square.png")
    start = np.array(domain.image.center)
    domain.move_image(0.1, -0.2)
    assert np.allclose(domain.image.center, start + np.array([0.1, -0.2]))
    domain.clear_image()
    assert domain.image is None


def test_rotation_by_90_degrees_swaps_axes_with_flip():
    domain = FundamentalDomain(group="p1")
    domain.set_image(_png_bytes(100, 50), "photo.png")
    domain.image.center = np.zeros(2)
    domain.image.scale = 1.0
    domain.image.rotation_deg = 90.0
    transform = domain.image.to_world_transform()
    # a pixel offset (1, 0) from center (i.e. one unit right) should map to world
    # (0, 1) (one unit "up") after a 90 degree rotation, given the y-flip convention
    px = np.array([[51.0, 25.0]])
    world = transform.apply(px)[0]
    assert np.allclose(world, [0.0, 1.0], atol=1e-9)
