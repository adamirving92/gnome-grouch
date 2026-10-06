import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const FRAME_COUNT = 33;
const FRAME_INTERVAL_MS = 80;
const TRASH_SETTLE_MS = 400;
const TRASH_ATTRIBUTE = 'trash::item-count';
const DOCK_UUIDS = ['dash-to-dock@micxgx.gmail.com', 'ubuntu-dock@ubuntu.com'];

/** A read-only trash watcher and a recreation of the original Grouch animation. */
export default class GrouchExtension extends Extension {
    enable() {
        this._enabled = true;
        this._generation = (this._generation ?? 0) + 1;
        this._lastCount = null;
        this._quoteIndex = 0;
        this._settings = this.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._dockModules = new Map();
        this._dockImports = new Set();
        this._frameIcons = Array.from({length: FRAME_COUNT}, (_, index) =>
            new Gio.FileIcon({file: this.dir.get_child(
                `assets/frames/${String(index).padStart(2, '0')}.png`)}));

        this._createIndicator();
        this._settingsSignals = [
            this._settings.connect('changed::preview-token', () => this._play('preview')),
            this._settings.connect('changed::sound-enabled', () => {
                const enabled = this._settings.get_boolean('sound-enabled');
                this._soundItem.setToggleState(enabled);
                if (!enabled)
                    this._stopSound();
            }),
        ];
        this._extensionSignal = Main.extensionManager.connect(
            'extension-state-changed', () => this._loadDockModules());
        this._sessionSignal = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.isLocked)
                this._stopAnimation(true);
        });
        this._loadDockModules();

        this._trash = Gio.File.new_for_uri('trash:///');
        try {
            this._monitor = this._trash.monitor_directory(
                Gio.FileMonitorFlags.NONE, this._cancellable);
            this._monitorSignal = this._monitor.connect('changed', () =>
                this._scheduleCount());
        } catch (error) {
            console.warn(`[Grouch] Trash monitor unavailable: ${error.message}`);
        }
        // Also recover from missed events and changes to mounted trash locations.
        this._pollSource = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 15, () => {
            this._refreshCount();
            return GLib.SOURCE_CONTINUE;
        });
        this._refreshCount();
        console.log('[Grouch] Enabled; watching trash without changing its contents');
    }

    _createIndicator() {
        this._indicator = new PanelMenu.Button(0, 'Grouch', false);
        this._indicator.add_child(new St.Icon({
            icon_name: 'user-trash-symbolic',
            style_class: 'system-status-icon',
        }));
        this._indicator.menu.addAction('Preview Oscar', () => this._play('preview'));
        this._soundItem = new PopupMenu.PopupSwitchMenuItem(
            'Sound', this._settings.get_boolean('sound-enabled'));
        this._soundItem.connect('toggled', (_item, state) =>
            this._settings.set_boolean('sound-enabled', state));
        this._indicator.menu.addMenuItem(this._soundItem);
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._indicator.menu.addAction('Preferences', () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    async _loadDockModules() {
        const generation = this._generation;
        for (const uuid of DOCK_UUIDS) {
            if (!this._enabled || this._generation !== generation)
                return;
            if (this._dockModules.has(uuid) || this._dockImports.has(uuid))
                continue;
            const extension = Main.extensionManager.lookup(uuid);
            // Import only an already loaded extension: its ESM module is cached.
            if (!extension?.isImported)
                continue;
            this._dockImports.add(uuid);
            try {
                const module = await import(extension.dir.get_child('extension.js').get_uri());
                if (this._enabled && this._generation === generation)
                    this._dockModules.set(uuid, module);
            } catch (error) {
                console.warn(`[Grouch] Cannot access ${uuid}: ${error.message}`);
            } finally {
                if (this._generation === generation)
                    this._dockImports.delete(uuid);
            }
        }
    }

    _scheduleCount() {
        if (this._countSource)
            GLib.source_remove(this._countSource);
        this._countSource = GLib.timeout_add(GLib.PRIORITY_LOW, TRASH_SETTLE_MS, () => {
            this._countSource = 0;
            this._refreshCount();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _readCount(cancellable) {
        const trash = this._trash;
        const info = await new Promise((resolve, reject) => {
            trash.query_info_async(TRASH_ATTRIBUTE, Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_LOW, cancellable, (file, result) => {
                    try {
                        resolve(file.query_info_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
        if (info.has_attribute(TRASH_ATTRIBUTE))
            return info.get_attribute_uint32(TRASH_ATTRIBUTE);

        // Some GVfs backends omit item-count. One asynchronous entry suffices
        // to determine the transition; never scan a large trash in the Shell.
        const enumerator = await new Promise((resolve, reject) => {
            trash.enumerate_children_async('standard::name',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, cancellable,
                (file, result) => {
                    try {
                        resolve(file.enumerate_children_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
        try {
            const entries = await new Promise((resolve, reject) => {
                enumerator.next_files_async(1, GLib.PRIORITY_LOW, cancellable,
                    (fileEnumerator, result) => {
                        try {
                            resolve(fileEnumerator.next_files_finish(result));
                        } catch (error) {
                            reject(error);
                        }
                    });
            });
            return entries.length;
        } finally {
            enumerator.close_async(GLib.PRIORITY_LOW, null, (fileEnumerator, result) => {
                try {
                    fileEnumerator.close_finish(result);
                } catch (error) {
                    console.warn(`[Grouch] Closing trash query: ${error.message}`);
                }
            });
        }
    }

    async _refreshCount() {
        if (!this._enabled)
            return;
        this._countQuery?.cancel();
        const cancellable = new Gio.Cancellable();
        this._countQuery = cancellable;
        try {
            const count = await this._readCount(cancellable);
            if (!this._enabled || this._countQuery !== cancellable)
                return;
            const wasFull = this._lastCount !== null && this._lastCount > 0;
            if (count !== this._lastCount)
                console.log(`[Grouch] Trash item count: ${count}`);
            this._lastCount = count;
            if (wasFull && count === 0)
                this._play('trash-emptied');
        } catch (error) {
            if (!cancellable.is_cancelled())
                console.warn(`[Grouch] Cannot read trash: ${error.message}`);
        } finally {
            if (this._countQuery === cancellable)
                this._countQuery = null;
        }
    }

    _trashAnchor() {
        for (const [uuid, module] of this._dockModules) {
            if (Main.extensionManager.lookup(uuid)?.state !== ExtensionState.ACTIVE)
                continue;
            const manager = module.dockManager;
            if (!manager)
                continue;
            const docks = manager.constructor.allDocks ?? [manager.mainDock];
            for (const dock of docks) {
                // Autohide keeps actors mapped after sliding them out of view.
                if (dock?.getDockState?.() === 0)
                    continue;
                const icon = dock?.dash.getAppIcons().find(appIcon => appIcon.app?.isTrash);
                if (!icon || !icon.get_paint_visibility() || icon.get_paint_opacity() === 0)
                    continue;
                const actor = icon.icon?.icon ?? icon;
                const [x, y] = actor.get_transformed_position();
                const [width, height] = actor.get_transformed_size();
                const monitor = Main.layoutManager.findMonitorForActor(actor);
                if (width <= 0 || height <= 0 || !monitor)
                    continue;
                if (x < monitor.x - 1 || y < monitor.y - 1 ||
                    x + width > monitor.x + monitor.width + 1 ||
                    y + height > monitor.y + monitor.height + 1 ||
                    !this._insideAncestorClips(actor, x, y, width, height))
                    continue;
                // Exact positioning from the original Mac v2 implementation.
                const ratio = width / 256;
                const anchor = {
                    x: x + 6 * ratio,
                    y: y - 260 * ratio + 118 * ratio,
                    width,
                    height: 260 * ratio,
                    fallback: false,
                };
                // A top dock can leave insufficient room for Oscar above it,
                // particularly on a secondary display without a panel.
                if (anchor.x < monitor.x || anchor.y < monitor.y ||
                    anchor.x + anchor.width > monitor.x + monitor.width ||
                    anchor.y + anchor.height > monitor.y + monitor.height)
                    continue;
                return anchor;
            }
        }

        const monitor = Main.layoutManager.primaryMonitor;
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const size = this._settings.get_int('animation-size');
        const height = 260 / 256 * size;
        const corner = this._settings.get_string('fallback-corner');
        return {
            x: corner.includes('left') ? area.x + 16 : area.x + area.width - size - 16,
            y: corner.includes('top') ? area.y + 16 : area.y + area.height - height - 16,
            width: size,
            height,
            fallback: true,
        };
    }

    _insideAncestorClips(actor, x, y, width, height) {
        for (let parent = actor.get_parent(); parent; parent = parent.get_parent()) {
            let clip = null;
            if (parent.has_clip)
                clip = parent.get_clip();
            else if (parent.get_clip_to_allocation())
                clip = [0, 0, parent.width, parent.height];
            if (!clip)
                continue;
            const [leftOK, left, top] = parent.transform_stage_point(x, y);
            const [rightOK, right, bottom] = parent.transform_stage_point(x + width, y + height);
            if (!leftOK || !rightOK || left < clip[0] - 1 || top < clip[1] - 1 ||
                right > clip[0] + clip[2] + 1 || bottom > clip[1] + clip[3] + 1)
                return false;
        }
        return true;
    }

    _play(reason) {
        if (!this._enabled || Main.sessionMode.isLocked)
            return;
        this._stopAnimation(true);
        const anchor = this._trashAnchor();
        this._actor = new St.Widget({
            width: anchor.width,
            height: anchor.height,
            reactive: false,
            can_focus: false,
        });
        if (anchor.fallback) {
            const binSize = anchor.width * 0.38;
            const bin = new St.Icon({
                icon_name: 'user-trash',
                icon_size: Math.round(binSize),
                width: binSize,
                height: binSize,
                reactive: false,
            });
            bin.set_position(anchor.width * 0.30, anchor.height * 0.63);
            this._actor.add_child(bin);
        }
        this._sprite = new St.Icon({
            gicon: this._frameIcons[0],
            icon_size: Math.round(anchor.width),
            width: anchor.width,
            height: anchor.height,
            reactive: false,
        });
        this._actor.add_child(this._sprite);
        this._actor.set_position(anchor.x, anchor.y);
        Main.layoutManager.addTopChrome(this._actor, {
            affectsStruts: false,
            trackFullscreen: true,
        });
        const quote = this._settings.get_boolean('alternate-quotes')
            ? this._quoteIndex++ % 2 : 0;
        this._playSound(quote);
        let frame = 0;
        this._animationSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, FRAME_INTERVAL_MS, () => {
                frame++;
                if (frame === FRAME_COUNT) {
                    this._animationSource = 0;
                    this._stopAnimation(false);
                    return GLib.SOURCE_REMOVE;
                }
                this._sprite.gicon = this._frameIcons[frame];
                return GLib.SOURCE_CONTINUE;
            });
        console.log(`[Grouch] Playing ${reason}, ${anchor.fallback ? 'corner' : 'dock'} ` +
            `at ${Math.round(anchor.x)},${Math.round(anchor.y)} (${Math.round(anchor.width)}px)`);
    }

    _playSound(quote) {
        if (!this._settings.get_boolean('sound-enabled'))
            return;
        const executable = GLib.find_program_in_path('pw-play');
        if (!executable) {
            console.warn('[Grouch] Install PipeWire pw-play for sound playback');
            return;
        }
        const filename = quote === 0 ? 'i-love-trash.wav' : 'because-trash.wav';
        const audioFile = this.dir.get_child(`assets/audio/${filename}`).get_path();
        try {
            const player = Gio.Subprocess.new([
                executable,
                `--volume=${this._settings.get_int('volume') / 100}`,
                '--media-role=Notification',
                audioFile,
            ], Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            this._audioProcess = player;
            player.wait_async(null, (process, result) => {
                try {
                    process.wait_finish(result);
                } catch (error) {
                    console.warn(`[Grouch] Audio playback: ${error.message}`);
                }
                if (this._audioProcess === process)
                    this._audioProcess = null;
            });
        } catch (error) {
            console.warn(`[Grouch] Cannot start audio: ${error.message}`);
        }
    }

    _stopSound() {
        this._audioProcess?.force_exit();
        this._audioProcess = null;
    }

    _stopAnimation(stopSound) {
        if (this._animationSource)
            GLib.source_remove(this._animationSource);
        this._animationSource = 0;
        if (this._actor) {
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
        }
        this._actor = null;
        this._sprite = null;
        if (stopSound)
            this._stopSound();
    }

    disable() {
        this._enabled = false;
        this._generation = (this._generation ?? 0) + 1;
        this._stopAnimation(true);
        for (const source of ['_countSource', '_pollSource']) {
            if (this[source])
                GLib.source_remove(this[source]);
            this[source] = 0;
        }
        this._countQuery?.cancel();
        this._countQuery = null;
        if (this._monitorSignal)
            this._monitor.disconnect(this._monitorSignal);
        this._monitorSignal = 0;
        this._monitor?.cancel();
        this._monitor = null;
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._extensionSignal)
            Main.extensionManager.disconnect(this._extensionSignal);
        this._extensionSignal = 0;
        if (this._sessionSignal)
            Main.sessionMode.disconnect(this._sessionSignal);
        this._sessionSignal = 0;
        for (const signal of this._settingsSignals ?? [])
            this._settings.disconnect(signal);
        this._settingsSignals = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._soundItem = null;
        this._dockModules = null;
        this._dockImports = null;
        this._frameIcons = null;
        this._trash = null;
        this._settings = null;
        this._lastCount = null;
        console.log('[Grouch] Disabled; monitors and animation cleaned up');
    }
}
