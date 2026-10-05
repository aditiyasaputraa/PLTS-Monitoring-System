import os
import sys
from pathlib import Path

# Add backend directory to sys.path so modules like supabase_store, site_rollups, etc. are importable
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# On Vercel serverless, background threads are disabled for instant cold starts
os.environ["AUTO_SCRAPE"] = "false"
os.environ["SCRAPE_ON_STARTUP"] = "false"

from api import app
