// Dialog that shows the recognized text.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {recognize} from './ocr.js';

export const ResultDialog = GObject.registerClass(
class ResultDialog extends ModalDialog.ModalDialog {
    _init({pixbuf, languages, settings, onNewCapture}) {
        super._init({styleClass: 'textsnip-result-dialog', destroyOnClose: true});

        this._pixbuf = pixbuf;
        this._languages = languages;
        this._settings = settings;
        this._languageIndex = Math.max(0, languages.indexOf(settings.get_string('language')));
        // Bumped per OCR run so a slow, outdated run can't overwrite a newer result.
        this._generation = 0;
        this._cancellable = new Gio.Cancellable();
        this._copiedId = 0;

        this._message = new Dialog.MessageDialogContent({title: 'Text Snip'});
        this.contentLayout.add_child(this._message);

        this._entry = new St.Entry({
            style_class: 'textsnip-result-text',
            x_expand: true,
            can_focus: true,
        });
        const text = this._entry.clutter_text;
        text.single_line_mode = false;
        text.activatable = false;
        text.line_wrap = true;
        text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        box.add_child(this._entry);
        this._scroll = new St.ScrollView({
            style_class: 'textsnip-result-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            visible: false,
        });
        this._scroll.child = box;
        this.contentLayout.add_child(this._scroll);

        this._languageButton = this.addButton({
            label: this._languageLabel(),
            action: () => this._cycleLanguage(),
        });
        this._languageButton.reactive = languages.length > 1;
        this.addButton({
            label: 'New Capture',
            action: () => {
                onNewCapture();
                this.close();
            },
        });
        this._copyButton = this.addButton({
            label: 'Copy',
            action: () => this._copy(),
        });
        this.addButton({
            label: 'Close',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
        this.setInitialKeyFocus(text);

        this.connect('destroy', () => {
            this._generation++;
            this._cancellable.cancel();
            if (this._copiedId)
                GLib.source_remove(this._copiedId);
            this._copiedId = 0;
            this._pixbuf = null;
        });

        this._run();
    }

    _languageLabel() {
        return `Language: ${this._languages[this._languageIndex]}`;
    }

    _cycleLanguage() {
        this._languageIndex = (this._languageIndex + 1) % this._languages.length;
        this._languageButton.label = this._languageLabel();
        this._settings.set_string('language', this._languages[this._languageIndex]);
        this._run();
    }

    async _run() {
        const generation = ++this._generation;
        const language = this._languages[this._languageIndex];
        this._message.description = `Recognizing (${language})…`;
        this._scroll.hide();

        let text;
        try {
            text = await recognize(this._pixbuf, language, this._cancellable);
        } catch (e) {
            if (generation === this._generation)
                this._message.description = `Recognition failed: ${e.message}`;
            return;
        }
        if (generation !== this._generation)
            return;

        if (!text) {
            this._message.description =
                'No text found. Try a bigger selection or a different language.';
            return;
        }
        this._message.description = '';
        this._entry.text = text;
        this._scroll.show();
        if (this._settings.get_boolean('autocopy'))
            this._copy();
    }

    _copy() {
        const text = this._entry.get_text();
        if (!text)
            return;
        // The shell owns the clipboard, so this works without window focus.
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);

        this._copyButton.label = 'Copied';
        if (this._copiedId)
            GLib.source_remove(this._copiedId);
        this._copiedId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._copiedId = 0;
            this._copyButton.label = 'Copy';
            return GLib.SOURCE_REMOVE;
        });
    }
});
