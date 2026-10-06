"""Test-wide settings, applied before any app module reads configuration.

Environment variables take precedence over backend/.env, so tests never touch the
real database, Supabase project or OpenRouter key configured for local development.
"""

import json
import os
import tempfile
from pathlib import Path

_TEST_DB = Path(tempfile.gettempdir()) / "safebill-pytest.db"

os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
os.environ["AUTH_TOKENS"] = json.dumps(
    {
        "safebill-admin-token": "admin",
        "safebill-analyst-token": "analyst",
        "safebill-auditor-token": "auditor",
        "safebill-viewer-token": "viewer",
    }
)
for key in (
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_GEMINI_API_KEY",
    "OPENROUTER_VISION_MODEL",
    "OPENROUTER_BACKUP_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_VISION_API_KEY",
    "GOOGLE_MAPS_API_KEY",
):
    os.environ[key] = ""
os.environ["AWS_ONLY_MODE"] = "false"
os.environ["AUTH_PROVIDER"] = "supabase"
os.environ["STORAGE_PROVIDER"] = "local"
os.environ["EMAIL_NOTIFICATIONS_ENABLED"] = "false"
