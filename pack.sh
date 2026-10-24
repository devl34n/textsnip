#!/usr/bin/env bash
# Builds the zip to upload to extensions.gnome.org.
#   ./pack.sh        # writes dist/textsnip@gregzky.github.io.shell-extension.zip
set -euo pipefail
cd "$(dirname "$0")"

UUID=textsnip@gregzky.github.io
ZIP=dist/$UUID.shell-extension.zip

# Reviewers reject unused files; everything in icons/ gets packed.
for icon in icons/*; do
    name=$(basename "$icon")
    if ! grep -q "$name" ./*.js; then
        echo "error: $icon is not used by the code; delete it before packing" >&2
        exit 1
    fi
done

# LICENSE sits next to this script in the repo, or one level up in the old layout.
license=LICENSE
[[ -f $license ]] || license=../LICENSE

mkdir -p dist
gnome-extensions pack --force --out-dir dist \
    --extra-source=ocr.js \
    --extra-source=resultDialog.js \
    --extra-source=icons \
    --extra-source="$license" \
    --schema=schemas/org.gnome.shell.extensions.textsnip.gschema.xml \
    .

# GNOME 44+ compiles schemas itself; EGO asks not to ship the compiled file.
if unzip -l "$ZIP" | grep -q 'schemas/gschemas.compiled'; then
    zip -qd "$ZIP" schemas/gschemas.compiled
fi

unzip -l "$ZIP"
echo
echo "Upload $ZIP at https://extensions.gnome.org/upload/"
