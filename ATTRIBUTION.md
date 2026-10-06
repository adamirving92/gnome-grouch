# Attribution

The original Macintosh Grouch was created by Eric Shapiro and Ken Hornak.
Charlie Robin's [Oscar the Grouch version 2](https://github.com/charlierobin/oscar-the-grouch-version-2)
recreation credits them in its About window and dedicates the work to Jim Henson.

This Linux implementation recreates the observed behavior of that Mac version:
33 frames at 80 milliseconds per frame, two alternating phrases, and animation
positioned relative to the actual dock Trash icon. It uses GNOME's asynchronous
trash monitoring and Ubuntu Dock / Dash to Dock integration. The Mac executable
and its Xojo source code are not included or executed.

The optional local asset importer expects the [version 2 source tree at commit
0d588d7f37fd7a58a2bd972d9ad2c68f97036858](https://github.com/charlierobin/oscar-the-grouch-version-2/tree/0d588d7f37fd7a58a2bd972d9ad2c68f97036858).
It copies the supplied PNG files without changing them and uses FFmpeg to mix
the supplied vocal and music MP3 stems into WAV files. Provenance and hashes
are saved with the imported assets, which Git ignores.

The pinned source tree has no separate LICENSE or COPYING file. Its About
window includes a copying and giveaway statement and says not to charge for
it. This repository does not treat that statement as an MIT license for the
upstream project or as permission from the owners of the original character,
artwork, or recordings.

Oscar the Grouch and the original Sesame Street artwork and recordings remain
the material of their respective rights holders. No original asset files,
audio, sprite sheet, or Mac binary are included in this repository.

The silent demo GIF illustrates this GNOME implementation running with locally
supplied artwork. The original character and artwork visible in that screen
recording are excluded from the MIT license. The preferences screenshot shows
the newly written Linux interface.

The MIT license here covers only the newly written Linux code, tools,
configuration, and documentation, excluding the original material described
above. This is an unofficial nostalgia project.
