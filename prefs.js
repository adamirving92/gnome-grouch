import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GrouchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._grouchSettings = settings;
        window.set_default_size(520, 540);
        const page = new Adw.PreferencesPage({title: 'Oscar', icon_name: 'user-trash-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'The Grouch',
            description: 'A little Macintosh nostalgia for your Linux desktop.',
        });
        page.add(group);
        window.add(page);

        const preview = new Adw.ActionRow({
            title: 'Say hello to Oscar',
            subtitle: 'Preview the animation without deleting anything.',
        });
        const button = new Gtk.Button({label: 'Preview', valign: Gtk.Align.CENTER});
        button.connect('clicked', () => {
            const token = settings.get_int('preview-token');
            settings.set_int('preview-token', token === 2147483647 ? 0 : token + 1);
        });
        preview.add_suffix(button);
        preview.activatable_widget = button;
        group.add(preview);

        const sound = new Adw.SwitchRow({title: 'Play Oscar’s voice'});
        settings.bind('sound-enabled', sound, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(sound);

        const volume = new Adw.SpinRow({
            title: 'Voice volume',
            subtitle: 'Percent',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 5, page_increment: 10}),
        });
        settings.bind('volume', volume, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('sound-enabled', volume, 'sensitive', Gio.SettingsBindFlags.GET);
        group.add(volume);

        const alternate = new Adw.SwitchRow({
            title: 'Alternate voice clips',
            subtitle: 'Oscar has two things to say about trash.',
        });
        settings.bind('alternate-quotes', alternate, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(alternate);

        const fallback = new Adw.PreferencesGroup({
            title: 'When the Trash icon is hidden',
            description: 'Oscar uses a small trash can in the corner of your main display.',
        });
        page.add(fallback);
        const size = new Adw.SpinRow({
            title: 'Oscar’s size',
            subtitle: 'Width in pixels',
            adjustment: new Gtk.Adjustment({lower: 48, upper: 320, step_increment: 8, page_increment: 16}),
        });
        settings.bind('animation-size', size, 'value', Gio.SettingsBindFlags.DEFAULT);
        fallback.add(size);
    }
}
