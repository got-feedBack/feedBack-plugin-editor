"""Regression coverage for legacy Guitar Pro metadata encoding."""

from xml.etree import ElementTree as ET

from routes import _normalize_generated_xml_encoding


def test_generated_cp1252_xml_is_rewritten_as_utf8(tmp_path):
    path = tmp_path / "bass.xml"
    path.write_bytes(
        b'<?xml version="1.0" encoding="UTF-8"?>\n'
        b'<song><albumName>Chrysalis\xa91982</albumName></song>'
    )

    assert _normalize_generated_xml_encoding([path]) == [path]

    root = ET.parse(path).getroot()
    assert root.findtext("albumName") == "Chrysalis\u00a91982"
    assert b"\xc2\xa9" in path.read_bytes()


def test_generated_utf8_xml_is_left_byte_identical(tmp_path):
    path = tmp_path / "lead.xml"
    payload = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<song><albumName>J\u00f3ga</albumName></song>'
    ).encode("utf-8")
    path.write_bytes(payload)

    _normalize_generated_xml_encoding([path])
    assert path.read_bytes() == payload
