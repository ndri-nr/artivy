#!/usr/bin/env python3
"""Play Console developer-profile art: the 512x512 icon and the 4096x2304 header.

Publisher-level art, so it lives here rather than in a game repo — nothing about it
belongs to one title, and nothing in it names a title either: no app icons, because the
header would then need regenerating and re-uploading every time a game ships. The mark
and wordmark already exist as SVG in ../assets, so the whole composition is SVG and the
only Python is "render it, crop it, write it".

Rendering goes through qlmanage because macOS has it and nothing else here does — no
rsvg, no cairosvg, no ImageMagick. It always writes a square, so the header is composed
at 4096x2304 inside a 4096 square and the padding is cropped off afterwards.

The wordmark is restroked white. Its own file fills the letters with the brand gradient,
which is for a white page; on this header it would sit on the same hues and disappear.

    python3 tools/dev_profile.py          # -> store/
"""

import pathlib
import random
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
OUT = ROOT / "store"

W, H = 4096, 2304
ICON_PX = 512          # the Play developer icon
MAX_BYTES = 1_000_000  # Play's ceiling on both files

# The A, lifted from assets/logo-mark.svg. Kept in step with that file by hand — see the
# comment there; two copies already exist for the same reason.
A_MASK = """
  <mask id="amask">
    <g fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M26 79 50 21l24 58"/>
      <path d="M35 62h30"/>
    </g>
  </mask>
"""

# The letters, lifted from assets/logo-wordmark.svg. viewBox there is 179x80 after the
# translate, which is what WORD_W/WORD_H below encode.
WORD = """
  <g id="word" fill="none" stroke="#fff" stroke-width="7"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M138 52a13 13 0 1 1-26 0 13 13 0 1 1 26 0"/>
    <path d="M138 35v34"/>
    <path d="M151 35v34"/>
    <path d="M151 49a13 13 0 0 1 13-13"/>
    <path d="M183 25v36a8 8 0 0 0 8 8"/>
    <path d="M173 40h20"/>
    <path d="M205 35v34"/>
    <path d="M205 19.9v.2" stroke-width="9"/>
    <path d="m217 35 12 34 12-34"/>
    <path d="m253 35 12.5 29"/>
    <path d="m277 35-19 48"/>
  </g>
"""
WORD_W, WORD_H = 179, 80


def render(svg: str, size: int) -> Image.Image:
	"""SVG text -> RGBA image, square, `size` on a side."""
	with tempfile.TemporaryDirectory() as tmp:
		src = pathlib.Path(tmp) / "art.svg"
		src.write_text(svg)
		subprocess.run(
			["qlmanage", "-t", "-s", str(size), "-o", tmp, str(src)],
			check=True, capture_output=True,
		)
		png = pathlib.Path(tmp) / "art.svg.png"
		if not png.exists():
			sys.exit("qlmanage rendered nothing — is the SVG valid?")
		return Image.open(png).convert("RGB")


# Confetti palette — the site's accents plus the mark's own hues, so the scatter reads as the
# same brand rather than as generic party colours.
CONFETTI = ["#ffd166", "#4ecdc4", "#ff6b6b", "#ffa14a", "#8ecae6", "#c77dff", "#ffffff"]


def confetti(seed: int = 7) -> str:
	"""Scattered shapes, placed deterministically so a rerun reproduces the uploaded file.

	This is the whole of the "rame" now that the app icons are gone, so the count is high and
	the sizes vary. Anything landing on the lockup is dropped rather than drawn behind it — a
	low-opacity shape under the wordmark only makes the letters muddy.
	"""
	rng = random.Random(seed)
	keepout = (1120, 760, 2980, 1580)   # the mark + wordmark lockup
	out = []
	for _ in range(330):
		x = rng.uniform(-40, W + 40)
		y = rng.uniform(-40, H + 40)
		x0, y0, x1, y1 = keepout
		if x0 < x < x1 and y0 < y < y1:
			continue
		# Pieces grow towards the edges, which is the cheap way to get depth out of flat
		# shapes: the big ones read as near, the small ones in the middle as far off.
		edge = max(abs(x - W / 2) / (W / 2), abs(y - H / 2) / (H / 2))
		size = rng.uniform(26, 78) * (0.7 + 0.9 * edge)
		fill = rng.choice(CONFETTI)
		op = rng.uniform(0.18, 0.72)
		rot = rng.uniform(0, 360)
		kind = rng.choice(["square", "circle", "triangle", "pill", "ring", "plus"])
		g = f'<g transform="translate({x:.0f} {y:.0f}) rotate({rot:.0f})" fill="{fill}" opacity="{op:.2f}">'
		if kind == "square":
			g += f'<rect x="{-size/2:.0f}" y="{-size/2:.0f}" width="{size:.0f}" height="{size:.0f}" rx="{size*0.28:.0f}"/>'
		elif kind == "circle":
			g += f'<circle r="{size/2:.0f}"/>'
		elif kind == "triangle":
			h = size * 0.87
			g += f'<path d="M0 {-h/2:.0f} {size/2:.0f} {h/2:.0f} {-size/2:.0f} {h/2:.0f}Z" stroke="{fill}" stroke-width="{size*0.2:.0f}" stroke-linejoin="round"/>'
		elif kind == "pill":
			g += f'<rect x="{-size/2:.0f}" y="{-size/5:.0f}" width="{size:.0f}" height="{size*0.4:.0f}" rx="{size*0.2:.0f}"/>'
		elif kind == "ring":
			g += f'<circle r="{size/2:.0f}" fill="none" stroke="{fill}" stroke-width="{size*0.18:.0f}"/>'
		else:
			t = size * 0.26
			g += (f'<rect x="{-size/2:.0f}" y="{-t/2:.0f}" width="{size:.0f}" height="{t:.0f}" rx="{t/2:.0f}"/>'
			      f'<rect x="{-t/2:.0f}" y="{-size/2:.0f}" width="{t:.0f}" height="{size:.0f}" rx="{t/2:.0f}"/>')
		out.append(g + "</g>")
	return "\n  ".join(out)


def header_svg() -> str:
	mark = 660
	word_h = 400
	word_w = round(word_h * WORD_W / WORD_H)
	gap = 110
	lock_w = mark + gap + word_w
	lock_x = (W - lock_w) / 2
	lock_y = (H - mark) / 2

	return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6a3cf0"/>
      <stop offset="0.45" stop-color="#ff5f8f"/>
      <stop offset="1" stop-color="#ffa14a"/>
    </linearGradient>
    <radialGradient id="glowA">
      <stop offset="0" stop-color="#4ecdc4" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#4ecdc4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB">
      <stop offset="0" stop-color="#feca57" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#feca57" stop-opacity="0"/>
    </radialGradient>
    <!-- The lockup sits on the brightest part of the gradient, and white letters on #ff5f8f
         are not far enough apart. This pool of shade under the centre buys that contrast back
         without darkening the whole header. -->
    <radialGradient id="shade">
      <stop offset="0" stop-color="#2a1150" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#2a1150" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffa14a"/>
      <stop offset="0.5" stop-color="#ff5f8f"/>
      <stop offset="1" stop-color="#7048e8"/>
    </linearGradient>
    <filter id="softdrop" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="30" flood-color="#2a1150" flood-opacity="0.45"/>
    </filter>
    {A_MASK}
    {WORD}
  </defs>

  <rect width="{W}" height="{H}" fill="url(#bg)"/>
  <circle cx="620" cy="460" r="1150" fill="url(#glowA)"/>
  <circle cx="3560" cy="1860" r="1200" fill="url(#glowB)"/>
  <ellipse cx="{W / 2}" cy="{H / 2}" rx="1750" ry="950" fill="url(#shade)"/>

  {confetti()}

  <g filter="url(#softdrop)">
    <g transform="translate({lock_x} {lock_y}) scale({mark / 88})">
      <g transform="translate(-6 -6)">
        <rect x="6" y="6" width="88" height="88" rx="26" fill="url(#tile)"/>
        <g mask="url(#amask)">
          <rect x="6" y="6" width="88" height="88" fill="#fff"/>
          <rect x="6" y="57.5" width="88" height="9" fill="#feca57"/>
        </g>
      </g>
    </g>

    <g transform="translate({lock_x + mark + gap} {lock_y + (mark - word_h) / 2})
                  scale({word_h / WORD_H}) translate(-105 -11)">
      <use href="#word"/>
    </g>
  </g>
</svg>"""


def icon_svg() -> str:
	"""Full-bleed, square corners. Play crops the developer icon to a circle, and the
	rounded tile of assets/icon-512.png loses its corners to that crop."""
	return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffa14a"/>
      <stop offset="0.5" stop-color="#ff5f8f"/>
      <stop offset="1" stop-color="#7048e8"/>
    </linearGradient>
    {A_MASK}
  </defs>
  <rect width="100" height="100" fill="url(#tile)"/>
  <g mask="url(#amask)">
    <rect width="100" height="100" fill="#fff"/>
    <rect y="57.5" width="100" height="9" fill="#feca57"/>
  </g>
</svg>"""


def save_under_limit(img: Image.Image, path: pathlib.Path) -> None:
	"""JPEG, stepping quality down until Play's 1MB ceiling is met."""
	for quality in (92, 88, 84, 78, 70):
		img.save(path, "JPEG", quality=quality, subsampling=0, optimize=True)
		if path.stat().st_size <= MAX_BYTES:
			print(f"  {path.name}  q{quality}  {path.stat().st_size / 1024:.0f} KB")
			return
	sys.exit(f"{path.name} will not fit in 1 MB")


def main() -> None:
	OUT.mkdir(exist_ok=True)

	square = render(header_svg(), W)
	top = (square.height - H) // 2
	header = square.crop((0, top, W, top + H))
	assert header.size == (W, H), header.size
	save_under_limit(header, OUT / "developer-header-4096x2304.jpg")

	icon = render(icon_svg(), ICON_PX)
	assert icon.size == (ICON_PX, ICON_PX) and icon.mode == "RGB"
	icon.save(OUT / "developer-icon-512.png", optimize=True)
	size = (OUT / "developer-icon-512.png").stat().st_size
	print(f"  developer-icon-512.png  {size / 1024:.0f} KB")
	assert size <= MAX_BYTES


if __name__ == "__main__":
	main()
