"""Tests for _safe_wafont_name — the whitelist validator in front of the
/api/plugins/editor/wafont/{name} asset route (GM guide voices, DAW 1.2).

The route serves plugin-vendored WebAudioFont files. The validator is a
WHITELIST (player + FluidR3_GM renders only), so traversal shapes and
undocumented-provenance variants (JCLive etc.) never reach the filesystem.
"""

from routes import _safe_wafont_name


def test_player_and_fluidr3_names_pass():
    for name in (
        "WebAudioFontPlayer.js",
        "0000_FluidR3_GM_sf2_file.js",     # program 0 (grand piano)
        "0270_FluidR3_GM_sf2_file.js",     # program 27 (clean electric)
        "1270_FluidR3_GM_sf2_file.js",     # program 127
        "12835_0_FluidR3_GM_sf2_file.js",  # percussion one-shot
    ):
        assert _safe_wafont_name(name) == name


def test_traversal_and_path_shapes_rejected():
    for name in (
        "../routes.py",
        "..\\routes.py",
        "wafonts/../../routes.py",
        "/etc/passwd",
        "C:\\Windows\\system32\\x.js",
        "0270_FluidR3_GM_sf2_file.js/../x.js",
        "%2e%2e%2froutes.py",
        "0270_FluidR3_GM_sf2_file.js\x00.png",
        "0270_FluidR3_GM_sf2_file.js\n",   # $ would match before \n; \Z must not
    ):
        assert _safe_wafont_name(name) is None


def test_undocumented_provenance_variants_rejected():
    # The provenance contract (assets/wafonts/README.md) is FluidR3 only —
    # the validator must not serve other webaudiofontdata variants even if
    # someone drops them in the directory.
    for name in (
        "0270_JCLive_sf2_file.js",
        "0270_Aspirin_sf2_file.js",
        "0270_Chaos_sf2_file.js",
        "0270_GeneralUserGS_sf2_file.js",
    ):
        assert _safe_wafont_name(name) is None


def test_non_asset_shapes_rejected():
    for name in (
        "",
        "WebAudioFontPlayer.js.map",
        "webaudiofontplayer.js",           # case matters — exact file only
        "0270_FluidR3_GM_sf2_file.json",
        "270_FluidR3_GM_sf2_file.js",      # 3 digits — not the grammar
        "README.md",
        None,
        42,
        ["0270_FluidR3_GM_sf2_file.js"],
    ):
        assert _safe_wafont_name(name) is None
