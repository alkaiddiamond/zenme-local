#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS icon generation must run on macOS." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/../.." && pwd)"
source_icon="${project_root}/public/brand/zenme-logo-cropped.png"
build_dir="${project_root}/build"
iconset_dir="${build_dir}/icon.iconset"
rounded_icon="${build_dir}/icon-source-rounded.png"
output_icon="${build_dir}/icon.icns"

if [[ ! -f "${source_icon}" ]]; then
  echo "Missing source icon: ${source_icon}" >&2
  exit 1
fi

rm -rf "${iconset_dir:?}"
mkdir -p "${iconset_dir}"

node "${script_dir}/render-macos-icon.cjs"

sips -z 16 16 "${rounded_icon}" --out "${iconset_dir}/icon_16x16.png" >/dev/null
sips -z 32 32 "${rounded_icon}" --out "${iconset_dir}/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "${rounded_icon}" --out "${iconset_dir}/icon_32x32.png" >/dev/null
sips -z 64 64 "${rounded_icon}" --out "${iconset_dir}/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "${rounded_icon}" --out "${iconset_dir}/icon_128x128.png" >/dev/null
sips -z 256 256 "${rounded_icon}" --out "${iconset_dir}/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "${rounded_icon}" --out "${iconset_dir}/icon_256x256.png" >/dev/null
sips -z 512 512 "${rounded_icon}" --out "${iconset_dir}/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "${rounded_icon}" --out "${iconset_dir}/icon_512x512.png" >/dev/null
cp "${rounded_icon}" "${iconset_dir}/icon_512x512@2x.png"

iconutil -c icns "${iconset_dir}" -o "${output_icon}"
rm -rf "${iconset_dir:?}"

echo "Generated ${output_icon}"
