"""Tests for the GoPlayAlong sync-sidecar parser (goplayalong.py).

Uses the real sample a user hit the "not a valid EOF xml" error with
("Would?" — Alice in Chains) so the parser is verified against actual data.
"""

import math

import pytest

import goplayalong as gpa

# The exact <sync> payload from the reported file: leading count (73) then
# 73 `audioMs;bar;beat;msPerBeat` points (bars 3–51 and 60–83).
SYNC = (
    "73#8147;3;0;622.97#10638;4;0;606.13#13063;5;0;611.72#15510;6;0;611.73#"
    "17957;7;0;617.35#20426;8;0;611.75#22873;9;0;611.72#25320;10;0;600.5#"
    "27722;11;0;611.75#30169;12;0;606.12#32594;13;0;606.13#35018;14;0;606.1#"
    "37442;15;0;589.3#39800;16;0;600.5#42202;17;0;594.9#44581;18;0;639.8#"
    "47140;19;0;589.3#49498;20;0;583.65#51832;21;0;544.4#54010;22;0;578.05#"
    "56322;23;0;572.45#58612;24;0;572.45#60902;25;0;527.55#63012;26;0;566.85#"
    "65279;27;0;600.5#67681;28;0;594.9#70061;29;0;589.3#72418;30;0;606.1#"
    "74842;31;0;606.13#77267;32;0;589.3#79624;33;0;594.9#82004;34;0;611.72#"
    "84451;35;0;589.28#86808;36;0;606.13#89232;37;0;594.9#91612;38;0;611.75#"
    "94059;39;0;600.5#96461;40;0;583.67#98796;41;0;600.62#101198;42;0;600.5#"
    "103600;43;0;583.5#105934;44;0;578.25#108247;45;0;583.5#110581;46;0;578#"
    "112893;47;0;606.25#115318;48;0;566.75#117585;49;0;572.5#119875;50;0;533.25#"
    "122008;51;0;584.28#143042;60;0;578.25#145355;61;0;578#147667;62;0;578#"
    "149979;63;0;572.5#152269;64;0;572.5#154559;65;0;572.5#156849;66;0;572.25#"
    "159138;67;0;572.5#161428;68;0;583.75#163763;69;0;583.75#166098;70;0;572.25#"
    "168387;71;0;572.5#170677;72;0;561.25#172922;73;0;572.5#175212;74;0;578#"
    "177524;75;0;566.75#179791;76;0;561.25#182036;77;0;567#184304;78;0;578#"
    "186616;79;0;566.75#188883;80;0;561.25#191128;81;0;499.5#193126;82;0;572.5#"
    "195416;83;0;572.5"
)

SAMPLE = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<track id="1" title="Would?" artist="Alice in Chains">\n'
    "  <scoreUrl>1. Would.gp</scoreUrl>\n"
    "  <audioUrl>1. Would.mp3</audioUrl>\n"
    f"  <sync>{SYNC}</sync>\n"
    "</track>\n"
)


def test_detects_goplayalong_and_rejects_others():
    assert gpa.is_goplayalong_xml(SAMPLE) is True
    # EOF/RS arrangement XML has a <song> root — must NOT be treated as GoPlayAlong.
    assert gpa.is_goplayalong_xml("<song><track/></song>") is False
    # MusicXML / garbage / empty.
    assert gpa.is_goplayalong_xml("<score-partwise/>") is False
    assert gpa.is_goplayalong_xml("not xml at all <") is False
    assert gpa.is_goplayalong_xml("") is False


def test_parses_metadata_and_referenced_files():
    proj = gpa.parse_goplayalong(SAMPLE)
    assert proj.title == "Would?"
    assert proj.artist == "Alice in Chains"
    assert proj.score_url == "1. Would.gp"
    assert proj.audio_url == "1. Would.mp3"


def test_sync_point_count_matches_declared_header():
    proj = gpa.parse_goplayalong(SAMPLE)
    assert proj.declared_count == 73
    assert len(proj.sync_points) == 73


def test_first_and_last_points_map_audio_ms_bar_and_tempo():
    proj = gpa.parse_goplayalong(SAMPLE)
    first, last = proj.sync_points[0], proj.sync_points[-1]

    # first: audioMs 8147 -> 8.147 s at bar 3, msPerBeat 622.97 -> ~96.31 bpm
    assert first.bar == 3
    assert math.isclose(first.time_secs, 8.147, abs_tol=1e-6)
    assert math.isclose(first.modified_bpm, 60000.0 / 622.97, abs_tol=0.01)

    # last: audioMs 195416 -> 195.416 s at bar 83, msPerBeat 572.5 -> ~104.80 bpm
    assert last.bar == 83
    assert math.isclose(last.time_secs, 195.416, abs_tol=1e-6)
    assert math.isclose(last.modified_bpm, 60000.0 / 572.5, abs_tol=0.01)


def test_points_are_time_ordered():
    proj = gpa.parse_goplayalong(SAMPLE)
    times = [sp.time_secs for sp in proj.sync_points]
    assert times == sorted(times)


def test_audio_offset_extrapolates_back_to_bar_one():
    proj = gpa.parse_goplayalong(SAMPLE)
    # bar 3 @ 8.147 s, bar 4 @ 10.638 s -> 2.491 s/bar -> bar 1 ~= 3.165 s.
    assert math.isclose(proj.audio_offset, 3.165, abs_tol=1e-3)


def test_tolerates_stray_delimiters_and_blank_fields():
    xml = (
        '<track title="T" artist="A"><scoreUrl>s.gp</scoreUrl>'
        "<sync>2#1000;1;0;500##2000;2;0;500#</sync></track>"
    )
    proj = gpa.parse_goplayalong(xml)
    assert [sp.bar for sp in proj.sync_points] == [1, 2]
    assert math.isclose(proj.sync_points[0].time_secs, 1.0, abs_tol=1e-6)


def test_missing_leading_count_still_parses_points():
    # A file without the count header: every token is a point.
    xml = (
        "<track><sync>1000;1;0;500#2000;2;0;500</sync></track>"
    )
    proj = gpa.parse_goplayalong(xml)
    assert len(proj.sync_points) == 2
    assert proj.declared_count == 0


def test_non_track_root_raises():
    with pytest.raises(ValueError):
        gpa.parse_goplayalong("<song><arrangement/></song>")


def test_track_without_sync_points_raises():
    with pytest.raises(ValueError):
        gpa.parse_goplayalong('<track title="T"><scoreUrl>s.gp</scoreUrl></track>')
