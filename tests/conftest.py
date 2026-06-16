"""pytest setup: put routes.py on sys.path so the test can import it standalone.

routes.py imports several third-party runtime deps at module load
(fastapi, PyYAML, etc.); the helpers we test
(`_build_arrangement_xml`, `_arr_dict_to_wire`, `_compute_anchors`, …)
are themselves pure — stdlib + a module-level regex. We expect pytest
to run in an env where the plugin's runtime deps are installed, since
the plugin already runs there.
"""
import sys
from pathlib import Path

_PLUGIN_DIR = Path(__file__).resolve().parent.parent
if str(_PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_DIR))
