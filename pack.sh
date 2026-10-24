#!/usr/bin/env bash
# Builds the zip to upload to extensions.gnome.org.
#   ./pack.sh        # writes dist/textsnip@devl34n.github.io.shell-extension.zip
set -euo pipefail
cd "$(dirname "$0")"

UUID=textsnip@devl34n.github.io
ZIP=dist/$UUID.shell-extension.zip

# Reviewers reject unused files; everything in icons/ gets packed.
for icon in icons/*; do
    name=$(basename "$icon")
    if ! grep -q "$name" ./*.js; then
        echo "error: $icon is not used by the code; delete it before packing" >&2
        exit 1
    fi
done

mkdir -p dist
gnome-extensions pack --force --out-dir dist \
    --extra-source=ocr.js \
    --extra-source=resultDialog.js \
    --extra-source=icons \
    --extra-source=LICENSE \
    --schema=schemas/org.gnome.shell.extensions.textsnip.gschema.xml \
    .

# GNOME 44+ compiles schemas itself; EGO asks not to ship the compiled file.
if unzip -l "$ZIP" | grep -q 'schemas/gschemas.compiled'; then
    zip -qd "$ZIP" schemas/gschemas.compiled
fi

unzip -l "$ZIP"
echo
echo "Upload $ZIP at https://extensions.gnome.org/upload/"
