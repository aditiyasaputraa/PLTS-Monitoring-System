#!/usr/bin/env python3
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from env_loader import load_env_file
load_env_file(ROOT / ".env")

import api

def main():
    print("[CRON] Starting PLTS monitoring scraper...")
    api.scrape_now()
    state = api.get_state()
    print(f"[CRON] Scrape result: success={state.get('last_success')}, run_id={state.get('last_run_id')}")
    if state.get("last_site_summary"):
        print(f"[CRON] Site summaries: {state.get('last_site_summary')}")
    if state.get("last_error"):
        print(f"[CRON] Error details: {state.get('last_error')}")
        sys.exit(1)
    if not state.get("last_success"):
        print("[CRON] Scrape was not completely successful. Check vendor credentials or cookies.")
        sys.exit(1)
    print("[CRON] Completed successfully and saved to Supabase.")

if __name__ == "__main__":
    main()
