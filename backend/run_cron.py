import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from env_loader import load_env_file
load_env_file(ROOT / ".env")

import api

WIB = timezone(timedelta(hours=7))

def is_nighttime() -> bool:
    if "--force" in sys.argv or os.getenv("FORCE_SCRAPE", "").lower() in ("true", "1", "yes"):
        return False
    now_wib = datetime.now(WIB)
    total_minutes = now_wib.hour * 60 + now_wib.minute
    # Solar window in Jakarta: 05:45 WIB (345 min) to 18:30 WIB (1110 min)
    return total_minutes < 345 or total_minutes > 1110

def main():
    if is_nighttime():
        now_wib_str = datetime.now(WIB).strftime("%H:%M WIB")
        print(f"[CRON] Saat ini malam hari ({now_wib_str}). Inverter PLTS tidak beroperasi.")
        print("[CRON] Scraping dilewati agar data akumulasi energi terakhir jam 18:00 tetap tersimpan utuh di Supabase.")
        print("[CRON] Gunakan 'python run_cron.py --force' jika ingin tetap memaksa scraping.")
        return

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
