"""The fundamental domain: a motif (drawn paths and/or a placed image) in one lattice cell."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .fundamental_domain import dirichlet_domain, polygon_centroid
from .groups import GROUP_SYMBOLS, default_lattice_kind
from .image_source import detect_image_format, image_pixel_size
from .lattice import basis_vectors
from .transforms import Affine2D


@dataclass
class ImagePlacement:
    """A raster or SVG image, positioned/scaled/rotated inside the fundamental domain.

    ``center``, ``scale`` and ``rotation_deg`` describe the map from image pixel
    coordinates (origin top-left, y increasing downward) to world coordinates
    (origin at the lattice/domain origin, y increasing upward, same units as the
    lattice basis vectors).
    """

    data: bytes
    format: str  # "png", "jpeg", or "svg+xml" -- matches ipywidgets.Image's `format`
    pixel_size: tuple[float, float]
    center: np.ndarray = field(default_factory=lambda: np.zeros(2))
    scale: float = 1.0
    rotation_deg: float = 0.0

    def to_world_transform(self) -> Affine2D:
        w, h = self.pixel_size
        theta = math.radians(self.rotation_deg)
        rotation = np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])
        flip_y = np.array([[1.0, 0.0], [0.0, -1.0]])  # pixel y-down -> world y-up
        matrix = self.scale * rotation @ flip_y
        translation = np.asarray(self.center, dtype=float) - matrix @ np.array([w / 2, h / 2])
        return Affine2D(matrix, translation)


@dataclass
class FundamentalDomain:
    """A motif -- freehand paths and/or a placed image -- inside one wallpaper cell.

    Coordinates of ``paths`` and of ``image.center`` are Cartesian world coordinates,
    in the same units as the lattice basis vectors (i.e. a point (1, 0) sits at the
    tip of a1 when cell_size=1). ``polygon`` gives the true fundamental-domain shape
    (a Dirichlet/Voronoi cell of the group) to guide placement.
    """

    group: str = "p1"
    cell_size: float = 1.0
    ratio: float = 1.0
    angle_deg: float = 70.0
    paths: list[np.ndarray] = field(default_factory=list)
    image: ImagePlacement | None = None

    def __post_init__(self) -> None:
        if self.group not in GROUP_SYMBOLS:
            raise ValueError(f"unknown wallpaper group: {self.group!r}")

    @property
    def lattice_kind(self):
        return default_lattice_kind(self.group)

    @property
    def basis(self) -> tuple[np.ndarray, np.ndarray]:
        return basis_vectors(
            self.lattice_kind,
            cell_size=self.cell_size,
            ratio=self.ratio,
            angle_deg=self.angle_deg,
        )

    @property
    def polygon(self) -> np.ndarray:
        """The true fundamental-domain polygon for the current group and lattice."""
        a1, a2 = self.basis
        return dirichlet_domain(self.group, a1, a2)

    def add_path(self, points: np.ndarray) -> None:
        points = np.asarray(points, dtype=float).reshape(-1, 2)
        if len(points) >= 2:
            self.paths.append(points)

    def undo(self) -> None:
        if self.paths:
            self.paths.pop()

    def clear(self) -> None:
        self.paths.clear()

    def set_group(self, symbol: str) -> None:
        if symbol not in GROUP_SYMBOLS:
            raise ValueError(f"unknown wallpaper group: {symbol!r}")
        self.group = symbol

    def set_image(self, data: bytes, filename: str) -> None:
        """Load an image and place it centered on, and scaled to fit, the domain polygon."""
        image_format = detect_image_format(filename)
        pixel_size = image_pixel_size(data, image_format)
        polygon = self.polygon
        centroid = polygon_centroid(polygon)
        bbox_min, bbox_max = polygon.min(axis=0), polygon.max(axis=0)
        extent = bbox_max - bbox_min
        w, h = pixel_size
        scale = 0.9 * min(extent[0] / w, extent[1] / h) if w > 0 and h > 0 else 1.0
        self.image = ImagePlacement(
            data=data, format=image_format, pixel_size=pixel_size,
            center=centroid, scale=scale, rotation_deg=0.0,
        )

    def move_image(self, dx: float, dy: float) -> None:
        if self.image is not None:
            self.image.center = self.image.center + np.array([dx, dy])

    def clear_image(self) -> None:
        self.image = None
