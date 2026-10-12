"""
OneSignal Push Notification Dispatcher for PLTS Monitoring.
Supports mobile push alerts to Android/iOS subscribers even when app is closed.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

ONESIGNAL_APP_ID = os.getenv("ONESIGNAL_APP_ID", "4dfb6c2d-99e0-4f50-aef6-847a8331303b")
ONESIGNAL_REST_API_KEY = os.getenv("ONESIGNAL_REST_API_KEY", "os_v2_app_jx5wylmz4bhvblxwqr5igmjqhpzbhf2r3tvuwpup5cijxzkc4wfnybx7ffxlwidhgq3vfjnn3nsjqddq4o4zu2sleys3l2b3zcjvify")


def send_push_notification(
    title: str,
    message: str,
    data: dict[str, Any] | None = None,
    headings: dict[str, str] | None = None,
) -> bool:
    """Send push notification to all subscribed mobile devices."""
    app_id = os.getenv("ONESIGNAL_APP_ID", ONESIGNAL_APP_ID).strip()
    api_key = os.getenv("ONESIGNAL_REST_API_KEY", ONESIGNAL_REST_API_KEY).strip()

    if not app_id or not api_key:
        print("[OneSignal] Skipping notification: ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY is not set.")
        return False

    url = "https://onesignal.com/api/v1/notifications"
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Key {api_key}",
    }

    payload = {
        "app_id": app_id,
        "included_segments": ["Total Subscriptions"],
        "headings": headings or {"en": title, "id": title},
        "contents": {"en": message, "id": message},
        "data": data or {},
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_body = resp.read().decode("utf-8")
            print(f"[OneSignal] Notification sent: {resp_body}")
            return True
    except urllib.error.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="replace")
        print(f"[OneSignal] HTTP {exc.code} error: {err_msg}")
        return False
    except Exception as exc:
        print(f"[OneSignal] Unexpected error sending notification: {exc}")
        return False


if __name__ == "__main__":
    print("[OneSignal] Testing notification module...")
    ok = send_push_notification(
        title="Uji Notifikasi PLTS",
        message="Sistem monitoring PLTS Jakarta Utara siap mengirimkan notifikasi.",
    )
    print(f"Result: {ok}")
