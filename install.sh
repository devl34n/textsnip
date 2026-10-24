#!/usr/bin/env bash
# Packs and installs the Text Snip GNOME Shell extension for the current user.
#   ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

UUID=textsnip@gregzky.github.io

if ! command -v tesseract >/dev/null; then
    echo "warning: tesseract not found. Install it with:" >&2
    echo "    sudo dnf install tesseract tesseract-langpack-eng" >&2
fi

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

gnome-extensions pack --force --out-dir "$out" \
    --extra-source=ocr.js \
    --extra-source=resultDialog.js \
    --extra-source=icons \
    --schema=schemas/org.gnome.shell.extensions.textsnip.gschema.xml \
    .
gnome-extensions install --force "$out/$UUID.shell-extension.zip"

# A running Wayland session only sees new extensions after logging in again, so add it
# to the enabled list directly; it starts on the next login.
enabled=$(gsettings get org.gnome.shell enabled-extensions)
if [[ $enabled != *"'$UUID'"* ]]; then
    if [[ $enabled == "@as []" || $enabled == "[]" ]]; then
        updated="['$UUID']"
    else
        updated="${enabled%]}, '$UUID']"
    fi
    gsettings set org.gnome.shell enabled-extensions "$updated"
fi

# The Flatpak version's install-shortcut.sh used the same key combination.
old=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/textsnip/
if [[ $(gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings) == *"$old"* ]]; then
    echo "note: the old Flatpak shortcut 'Text Snip (OCR)' still exists. Remove it in"
    echo "      Settings > Keyboard > Custom Shortcuts so it doesn't clash with Super+Shift+T."
fi

echo "Installed $UUID. Log out and back in to load it."
