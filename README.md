# textsnip (GNOME Shell extension)

Adds a **T** toggle to GNOME's own screenshot UI. When the toggle is on, the shot is not saved as an image. It goes to Tesseract instead, and the recognized text appears in a dialog and is copied to the clipboard. Recognition runs locally. Selection, Screen and Window modes all work.

Tested on GNOME 51 (Fedora 45). License: MIT.

## Install

```sh
sudo dnf install tesseract tesseract-langpack-eng   # plus e.g. tesseract-langpack-pol
./install.sh
```

Log out and back in. Wayland can't reload GNOME Shell inside a running session.

## Use

| Input | Action |
|---|---|
| `Super+Shift+T` | Open the screenshot UI with **T** already on |
| `Print`, then click **T** | The same, starting from the normal screenshot UI |
| Capture button / `Enter` | Recognize text |
| Result dialog, **Language** | Switch language and run recognition again (the choice is remembered) |
| Result dialog, **New Capture** | Take another text shot |

**T** is off whenever you open the screenshot UI normally. Starting a screencast turns it off.

Change the shortcut or auto-copy under Extensions → textsnip → Settings.

## How it works

GNOME's screenshot UI has no API for extensions, so this extension overrides its private `_saveScreenshot` method. When **T** is on, the override crops the selection, screen or window with `Shell.Screenshot.composite_to_stream`, using the same geometry GNOME uses. It then sends the image to Tesseract instead of saving it. With **T** off, GNOME's original method runs unchanged. If something fails, a notification shows the error.

Before recognition, the image is converted to grayscale, inverted if it is light-on-dark, upscaled and padded.

## Debugging

```sh
journalctl -f -o cat /usr/bin/gnome-shell
gnome-extensions info textsnip@devl34n.github.io
```

If a GNOME update renames the private fields this extension uses, enabling fails with `textsnip: GNOME screenshot UI ... not recognized/not found`.
