"""Loading PNG/SVG image bytes: format detection and intrinsic pixel size."""
from __future__ import annotations

import io
import re

_EXTENSION_FORMATS = {
    ".png": "png",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".svg": "svg+xml",
}


def detect_image_format(filename: str) -> str:
    for ext, fmt in _EXTENSION_FORMATS.items():
        if filename.lower().endswith(ext):
            return fmt
    raise ValueError(f"unsupported image file: {filename!r} (expected .png, .jpg, or .svg)")


def image_pixel_size(data: bytes, image_format: str) -> tuple[float, float]:
    """Return the (width, height) of the image in pixels (SVG user units for SVG)."""
    if image_format == "svg+xml":
        return _svg_pixel_size(data)
    from PIL import Image

    with Image.open(io.BytesIO(data)) as img:
        return float(img.width), float(img.height)


def _svg_pixel_size(data: bytes) -> tuple[float, float]:
    text = data.decode("utf-8", errors="ignore")
    tag_match = re.search(r"<svg\b[^>]*>", text)
    header = tag_match.group(0) if tag_match else text

    def _dim(attr: str) -> float | None:
        m = re.search(rf'{attr}\s*=\s*"([0-9.]+)', header)
        return float(m.group(1)) if m else None

    width, height = _dim("width"), _dim("height")
    if width is not None and height is not None:
        return width, height

    view_box = re.search(r'viewBox\s*=\s*"([-0-9.\s]+)"', header)
    if view_box:
        parts = [float(p) for p in view_box.group(1).split()]
        if len(parts) == 4:
            return parts[2], parts[3]

    raise ValueError("could not determine SVG dimensions (no width/height or viewBox)")
