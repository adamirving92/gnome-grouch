#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
extension_uuid='grouch@local'
extension_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/gnome-shell/extensions/${extension_uuid}"

missing_assets=()
for frame in {00..32}; do
    [[ -f "${source_dir}/assets/frames/${frame}.png" ]] || missing_assets+=("frames/${frame}.png")
done
for audio in i-love-trash.wav because-trash.wav; do
    [[ -f "${source_dir}/assets/audio/${audio}" ]] || missing_assets+=("audio/${audio}")
done
if (( ${#missing_assets[@]} )); then
    printf '%s\n' 'Original Grouch assets are missing. Import your local v2 source first:' >&2
    printf '%s\n' '  python3 tools/import-assets.py /path/to/oscar-the-grouch-version-2' >&2
    printf 'Missing: %s\n' "${missing_assets[@]}" >&2
    exit 1
fi

shell_version="$(gnome-shell --version)"
if [[ "${shell_version}" != 'GNOME Shell 50.'* ]]; then
    printf '%s\n' 'This version of The Grouch supports GNOME Shell 50.' >&2
    exit 1
fi

glib-compile-schemas --strict "${source_dir}/schemas"
mkdir -p -- "${extension_dir}"
cp -- "${source_dir}/metadata.json" "${source_dir}/extension.js" "${source_dir}/prefs.js" "${extension_dir}/"
cp -a -- "${source_dir}/assets" "${source_dir}/schemas" "${extension_dir}/"

# Keep the user's existing enabled extensions and queue this one for next login.
gjs -c 'const Gio = imports.gi.Gio; const s = new Gio.Settings({schema_id: "org.gnome.shell"}); const uuid = "grouch@local"; const enabled = s.get_strv("enabled-extensions"); if (!enabled.includes(uuid)) s.set_strv("enabled-extensions", [...enabled, uuid]); const disabled = s.get_strv("disabled-extensions"); if (disabled.includes(uuid)) s.set_strv("disabled-extensions", disabled.filter(x => x !== uuid)); Gio.Settings.sync();'

# GNOME's master switch can otherwise leave the UUID enabled but inactive.
gsettings set org.gnome.shell disable-user-extensions false
gnome-extensions enable "${extension_uuid}" 2>/dev/null || true
extension_info="$(LC_ALL=C gnome-extensions info "${extension_uuid}" 2>/dev/null || true)"
case "${extension_info}" in
    *'State: ACTIVE'*)
        printf '%s\n' 'The Grouch is installed and active.'
        ;;
    *'State: ERROR'*)
        printf '%s\n' "${extension_info}" >&2
        exit 1
        ;;
    *)
        printf '%s\n' 'The Grouch is installed and will load when you next log out and log in.'
        ;;
esac
