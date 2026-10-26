"""Resize the extension logo for Chrome's manifest icon sizes."""

from pathlib import Path

from PIL import Image


assets = Path(__file__).resolve().parents[1] / "assets"
with Image.open(assets / "logo.png") as source:
    image = source.convert("RGBA")

for size in (16, 32, 48, 128):
    image.resize((size, size), Image.Resampling.LANCZOS).save(assets / f"icon-{size}.png")
