// Adds a "Recognize Text" toggle to GNOME's screenshot UI. With it on, the shot is
// recognized with Tesseract instead of being saved as an image.
//
// GNOME's screenshot UI has no public API, so this relies on private members of
// Main.screenshotUI (checked against gnome-shell main, js/ui/screenshot.js). If a
// GNOME update renames them, enable() throws and the extension shows up as errored
// in the Extensions app.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Screenshot from 'resource:///org/gnome/shell/ui/screenshot.js';

import {availableLanguages} from './ocr.js';
import {ResultDialog} from './resultDialog.js';

Gio._promisify(Shell.Screenshot, 'composite_to_stream');

export default class TextSnipExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._injections = new InjectionManager();
        this._ui = Main.screenshotUI;

        this._addToggle();
        this._patchScreenshotUI();

        Main.wm.addKeybinding('snip-shortcut', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._openInTextMode());
    }

    disable() {
        Main.wm.removeKeybinding('snip-shortcut');

        this._injections?.clear();
        this._injections = null;
        if (this._showResultId) {
            GLib.source_remove(this._showResultId);
            this._showResultId = 0;
        }

        if (this._castHandlerId) {
            this._ui._castButton.disconnect(this._castHandlerId);
            this._castHandlerId = 0;
        }
        this._tooltip?.destroy();
        this._tooltip = null;
        this._toggle?.destroy();
        this._toggle = null;

        // Cleared first so the dialog's destroy handler won't start a new capture.
        this._settings = null;
        this._dialog?.destroy();
        this._dialog = null;
        this._ui = null;
    }

    _addToggle() {
        const ui = this._ui;
        const container = ui._showPointerButtonContainer ?? ui._showPointerButton?.get_parent();
        if (!container || !ui._shotButton)
            throw new Error('Text Snip: GNOME screenshot UI layout not recognized');

        this._toggle = new St.Button({
            style_class: 'screenshot-ui-show-pointer-button textsnip-ocr-button',
            accessible_name: 'Recognize Text',
            toggle_mode: true,
            child: new St.Icon({
                gicon: new Gio.FileIcon({
                    file: this.dir.get_child('icons').get_child('textsnip-ocr-symbolic.svg'),
                }),
            }),
        });
        container.insert_child_at_index(this._toggle, 0);

        // GNOME's own tooltip, as used for "Show Pointer". Added to the UI itself
        // like GNOME does, so it isn't clipped by the panel.
        if (Screenshot.Tooltip) {
            this._tooltip = new Screenshot.Tooltip(this._toggle, {
                text: 'Recognize Text',
                style_class: 'screenshot-ui-tooltip',
                visible: false,
            });
            ui.add_child(this._tooltip);
        }

        // Text mode only makes sense for screenshots, not screencasts.
        this._toggle.connect('notify::checked', () => {
            if (this._toggle.checked && ui._castButton?.checked)
                ui._shotButton.checked = true;
        });
        if (ui._castButton) {
            this._castHandlerId = ui._castButton.connect('notify::checked', button => {
                if (button.checked)
                    this._toggle.checked = false;
            });
        }
    }

    _patchScreenshotUI() {
        const ext = this;
        const proto = Object.getPrototypeOf(this._ui);
        if (typeof proto._saveScreenshot !== 'function')
            throw new Error('Text Snip: GNOME screenshot UI capture method not found');

        // Each opening starts in normal mode, except when opened by our shortcut.
        this._injections.overrideMethod(proto, 'open', original => function (...args) {
            ext._toggle.checked = !!ext._openTextModeNext;
            ext._openTextModeNext = false;
            return original.apply(this, args);
        });

        // GNOME awaits this, then closes the UI. In text mode we crop the image
        // ourselves and skip saving it.
        this._injections.overrideMethod(proto, '_saveScreenshot', original => async function (...args) {
            if (!ext._toggle?.checked || !this._shotButton.checked)
                return original.apply(this, args);

            try {
                const pixbuf = await ext._crop(this);
                if (pixbuf)
                    ext._showResultLater(pixbuf);
            } catch (e) {
                console.error(e);
                Main.notifyError('Text Snip', `Could not capture the screen: ${e.message}`);
            }
        });
    }

    /** Same geometry as GNOME's own _saveScreenshot, but without the cursor. */
    async _crop(ui) {
        let texture, geometry, scale;

        if (ui._selectionButton.checked || ui._screenButton.checked) {
            const content = ui._stageScreenshot.get_content();
            if (!content)
                return null;
            texture = content.get_texture();
            geometry = ui._getSelectedGeometry(true);
            scale = ui._scale;
        } else if (ui._windowButton.checked) {
            const window = ui._windowSelectors
                .flatMap(selector => selector.windows())
                .find(win => win.checked);
            const content = window?.windowContent;
            if (!content)
                return null;
            texture = content.get_texture();
            geometry = null;
            scale = window.bufferScale;
        } else {
            return null;
        }

        const [x, y, w, h] = geometry ?? [0, 0, -1, -1];
        const stream = Gio.MemoryOutputStream.new_resizable();
        const pixbuf = await Shell.Screenshot.composite_to_stream(
            texture, x, y, w, h, scale,
            null, 0, 0, 1,
            stream);
        stream.close(null);
        return pixbuf;
    }

    _openInTextMode() {
        this._openTextModeNext = true;
        Promise.resolve(this._ui.open()).catch(e => {
            this._openTextModeNext = false;
            console.error(e);
        });
    }

    // Wait until GNOME has closed the screenshot UI and released its grab.
    _showResultLater(pixbuf) {
        if (this._showResultId)
            GLib.source_remove(this._showResultId);
        this._showResultId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._showResultId = 0;
            this._showResult(pixbuf).catch(e => {
                console.error(e);
                Main.notifyError('Text Snip', `Could not show the result: ${e.message}`);
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    async _showResult(pixbuf) {
        const languages = await availableLanguages();
        // Disabled (e.g. screen locked) while we listed the languages.
        if (!this._settings)
            return;
        this._dialog?.destroy();

        let newCapture = false;
        const dialog = new ResultDialog({
            pixbuf,
            languages,
            settings: this._settings,
            onNewCapture: () => {
                newCapture = true;
            },
        });
        dialog.connect('destroy', () => {
            if (this._dialog === dialog)
                this._dialog = null;
            // The dialog has faded out by now, so it won't end up in the next shot.
            if (newCapture && this._settings)
                this._openInTextMode();
        });
        this._dialog = dialog;
        if (!dialog.open())
            dialog.destroy();
    }
}
