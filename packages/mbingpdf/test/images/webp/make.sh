#!/bin/bash
# Makes the WebP test files with ImageMagick and libwebp, and writes what libwebp decodes them
# to (SHA-256 of the RGBA pixels) into expected.json. Every source is synthetic or the
# repository's own photo.jpg. Run from anywhere; needs ImageMagick built with libwebp.
set -euo pipefail
cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

photo=../photo.jpg
magick -seed 3 -size 97x61 plasma:fractal "$work/plasma.png"
magick -seed 9 -size 17x33 plasma: "$work/odd.png"
magick -seed 5 -size 33x1 plasma: "$work/line.png"
magick -size 1x1 xc:'#33aa77' "$work/dot.png"
for n in 2 4 16 200; do magick "$work/plasma.png" -dither None -colors $n "$work/colors$n.png"; done
# Transparency: a gradient, a radial mask, a mask the same on every row, a rotated ramp.
magick -size 50x37 gradient:red-blue \( -size 50x37 gradient:white-none \) -compose CopyOpacity -composite "$work/fade.png"
magick -size 120x80 radial-gradient:white-black "$work/radial.png"
magick "$photo" "$work/radial.png" -alpha off -compose CopyOpacity -composite "$work/photo-radial.png"
magick -seed 2 -size 120x1 plasma:grey-grey -colorspace gray -scale 120x80! "$work/columns.png"
magick "$photo" "$work/columns.png" -alpha off -compose CopyOpacity -composite "$work/photo-columns.png"
magick -size 64x64 gradient:white-black -rotate 30 -resize 64x64! "$work/ramp.png"
magick "$work/plasma.png" -resize 64x64! "$work/ramp.png" -alpha off -compose CopyOpacity -composite "$work/plasma-ramp.png"

make() { # name source options...
  local name=$1 source=$2
  shift 2
  magick "$source" "$@" "$name.webp"
}
rm -f ./*.webp
# Lossy: quality, both loop filters, no filter, segments, token partitions, sharp YUV, edges.
make lossy-photo "$photo" -quality 75
make lossy-photo-q5 "$photo" -quality 5
make lossy-photo-q100 "$photo" -quality 100
make lossy-simple-filter "$work/plasma.png" -quality 60 -define webp:filter-type=0
make lossy-strong-filter "$work/plasma.png" -quality 60 -define webp:filter-type=1 -define webp:filter-sharpness=5
make lossy-no-filter "$work/plasma.png" -quality 60 -define webp:filter-strength=0
make lossy-one-segment "$work/odd.png" -quality 70 -define webp:segments=1 -define webp:sns-strength=0
make lossy-partitions "$photo" -quality 70 -define webp:partitions=3 -define webp:method=6
make lossy-sharp-yuv "$work/plasma.png" -quality 80 -define webp:use-sharp-yuv=true -define webp:filter-sharpness=7
make lossy-line "$work/line.png" -quality 70
make lossy-dot "$work/dot.png" -quality 70
# Lossless: palettes of 2, 4, 16 and 200 colours (pixel packing), methods, near-lossless.
make lossless-photo "$photo" -define webp:lossless=true
make lossless-fast "$work/plasma.png" -define webp:lossless=true -define webp:method=0 -quality 0
make lossless-best "$work/plasma.png" -define webp:lossless=true -define webp:method=6 -quality 100
make lossless-near "$work/odd.png" -define webp:lossless=true -define webp:near-lossless=60
make lossless-dot "$work/dot.png" -define webp:lossless=true
for n in 2 4 16 200; do make "lossless-colors$n" "$work/colors$n.png" -define webp:lossless=true; done
make lossless-alpha "$work/fade.png" -define webp:lossless=true
# Lossy with alpha: raw and compressed alpha, each of the three prediction filters.
make alpha-raw "$work/fade.png" -quality 70 -define webp:alpha-compression=0
make alpha-compressed "$work/fade.png" -quality 70 -define webp:alpha-compression=1
make alpha-horizontal "$work/photo-radial.png" -quality 70 -define webp:alpha-filtering=1
make alpha-vertical "$work/photo-columns.png" -quality 70 -define webp:alpha-filtering=1
make alpha-gradient "$work/plasma-ramp.png" -quality 70 -define webp:alpha-filtering=1
# Not readable: an animation.
magick -delay 10 "$work/dot.png" "$work/odd.png" -resize 17x33! -loop 0 animated.webp

for file in $(ls ./*.webp | sort); do
  name=$(basename "$file" .webp)
  [ "$name" = animated ] && continue
  size=$(magick identify -format '%wx%h' "$file")
  sum=$(magick "$file" -depth 8 rgba:- | sha256sum | cut -d' ' -f1)
  echo "$name $size $sum"
done | node -e '
  const entries = require("fs").readFileSync(0, "utf8").trim().split("\n").map((line) => line.split(" "));
  const json = Object.fromEntries(entries.map(([name, size, rgba]) => [name, { size, rgba }]));
  process.stdout.write(JSON.stringify(json, null, 2) + "\n");
' > expected.json
magick -version | head -1
du -ch ./*.webp | tail -1
