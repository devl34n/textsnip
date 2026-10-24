import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TextSnipPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const group = new Adw.PreferencesGroup({
            title: 'Text Snip',
            description: 'Turn on the “T” button in the screenshot panel to recognize text instead of saving an image.',
        });

        const shortcut = new Adw.EntryRow({
            title: 'Shortcut, e.g. <Super><Shift>t (empty to disable)',
            show_apply_button: true,
            text: settings.get_strv('snip-shortcut')[0] ?? '',
        });
        shortcut.connect('apply', () => {
            const accel = shortcut.text.trim();
            if (accel && !Gtk.accelerator_parse(accel)[0]) {
                shortcut.add_css_class('error');
                return;
            }
            shortcut.remove_css_class('error');
            settings.set_strv('snip-shortcut', accel ? [accel] : []);
        });
        group.add(shortcut);

        const autocopy = new Adw.SwitchRow({title: 'Copy text automatically'});
        settings.bind('autocopy', autocopy, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(autocopy);

        const page = new Adw.PreferencesPage();
        page.add(group);
        window.add(page);
    }
}
