#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client, create_client

from site_rollups import extract_site_daily_rollups, extract_site_hourly_rollups


def merge_payload_preserve_history(existing: dict[str, Any] | None, incoming: dict[str, Any]) -> dict[str, Any]:
    """Preserve historical chart series (e.g. multi-year month_daily, daily_by_month) across scrape snapshots."""
    if not isinstance(existing, dict) or not isinstance(incoming, dict):
        return incoming

    existing_by_site = existing.get("by_site")
    incoming_by_site = incoming.get("by_site")
    if not isinstance(existing_by_site, dict) or not isinstance(incoming_by_site, dict):
        return incoming

    for plat, incoming_site in incoming_by_site.items():
        if not isinstance(incoming_site, dict):
            continue
        existing_site = existing_by_site.get(plat)
        if not isinstance(existing_site, dict):
            continue

        existing_stations = existing_site.get("stations")
        incoming_stations = incoming_site.get("stations")
        if not isinstance(existing_stations, list) or not isinstance(incoming_stations, list):
            continue

        old_by_key: dict[str, dict[str, Any]] = {}
        for st in existing_stations:
            if not isinstance(st, dict):
                continue
            st_id = str(st.get("station_id") or st.get("id") or "")
            st_name = str(st.get("name") or "")
            if st_id:
                old_by_key[st_id] = st
            if st_name:
                old_by_key[st_name] = st

        for new_st in incoming_stations:
            if not isinstance(new_st, dict):
                continue
            new_id = str(new_st.get("station_id") or new_st.get("id") or "")
            new_name = str(new_st.get("name") or "")
            old_st = old_by_key.get(new_id) or old_by_key.get(new_name)
            if not old_st or not isinstance(old_st, dict):
                continue

            # 1. Merge charts.company_power_trends
            old_charts = old_st.get("charts")
            if isinstance(old_charts, dict):
                new_charts = new_st.setdefault("charts", {})
                old_cpt = old_charts.get("company_power_trends")
                if isinstance(old_cpt, dict):
                    new_cpt = new_charts.setdefault("company_power_trends", {})
                    for trend_key in ("month_daily", "year_monthly", "all_yearly", "week_daily"):
                        old_group = old_cpt.get(trend_key)
                        if isinstance(old_group, dict):
                            new_group = new_cpt.setdefault(trend_key, {"unit": old_group.get("unit", "kWh"), "series": {}})
                            old_series = old_group.get("series")
                            if isinstance(old_series, dict):
                                new_series = new_group.setdefault("series", {})
                                for k, v in old_series.items():
                                    if k not in new_series or not new_series[k]:
                                        new_series[k] = v

                    if "month_daily" in new_cpt:
                        new_charts["station_energy_trend_month"] = new_cpt["month_daily"]
                    if "year_monthly" in new_cpt:
                        new_charts["station_energy_trend"] = new_cpt["year_monthly"]
                    if "all_yearly" in new_cpt:
                        new_charts["station_energy_trend_total"] = new_cpt["all_yearly"]
                    if "week_daily" in new_cpt:
                        new_charts["station_energy_trend_week"] = new_cpt["week_daily"]

            # 2. Merge energy_charts
            old_echarts = old_st.get("energy_charts")
            if isinstance(old_echarts, dict):
                new_echarts = new_st.setdefault("energy_charts", {})
                for ekey in ("daily_by_month", "monthly_by_year", "hourly_by_date"):
                    old_sub = old_echarts.get(ekey)
                    if isinstance(old_sub, dict):
                        new_sub = new_echarts.setdefault(ekey, {})
                        for k, v in old_sub.items():
                            if k not in new_sub or not new_sub[k]:
                                new_sub[k] = v

    return incoming


def server_key_error(secret_key: str) -> str | None:
    if secret_key.startswith("sb_publishable_"):
        return "SUPABASE_SECRET_KEY contains a publishable browser key; use a server secret key"

    if secret_key.startswith("eyJ"):
        try:
            payload_segment = secret_key.split(".", 2)[1]
            padding = "=" * (-len(payload_segment) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_segment + padding))
        except (IndexError, ValueError, json.JSONDecodeError):
            return None
        if payload.get("role") == "anon":
            return "SUPABASE_SECRET_KEY contains a legacy anonymous JWT; use a server secret or service_role key"
    return None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_iso(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat(timespec="seconds")


def parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


@dataclass(frozen=True)
class StoreConfig:
    url: str
    secret_key: str
    current_table: str = "monitoring_current"
    history_table: str = "monitoring_snapshots"
    daily_table: str = "monitoring_site_daily"
    hourly_table: str = "monitoring_site_hourly"
    history_interval_seconds: int = 3600
    history_retention_days: int = 30


class SupabaseStore:
    """Synchronous storage adapter for persisting monitoring snapshots and rollups to Supabase."""

    def __init__(self, config: StoreConfig | None, config_error: str | None = None):
        self.config = config
        self.config_error = config_error
        self._client: Client | None = None
        self._lock = threading.RLock()

        if config and not config_error:
            try:
                self._client = create_client(config.url, config.secret_key)
            except Exception as exc:  # Keep /health alive so deployment errors remain visible.
                self.config_error = f"{type(exc).__name__}: {exc}"

    @classmethod
    def from_env(cls) -> "SupabaseStore":
        url = os.getenv("SUPABASE_URL", "").strip()
        secret_key = (
            os.getenv("SUPABASE_SECRET_KEY", "").strip()
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        )

        missing = [name for name, value in (("SUPABASE_URL", url), ("SUPABASE_SECRET_KEY", secret_key)) if not value]
        if missing:
            return cls(None, f"Missing environment variable(s): {', '.join(missing)}")

        key_error = server_key_error(secret_key)
        if key_error:
            return cls(None, key_error)

        try:
            history_interval = max(0, int(os.getenv("HISTORY_INTERVAL_SECONDS", "3600")))
            retention_days = max(0, int(os.getenv("HISTORY_RETENTION_DAYS", "30")))
        except ValueError as exc:
            return cls(None, f"Invalid history retention configuration: {exc}")

        config = StoreConfig(
            url=url.rstrip("/"),
            secret_key=secret_key,
            current_table=os.getenv("SUPABASE_CURRENT_TABLE", "monitoring_current").strip() or "monitoring_current",
            history_table=os.getenv("SUPABASE_HISTORY_TABLE", "monitoring_snapshots").strip() or "monitoring_snapshots",
            daily_table=os.getenv("SUPABASE_DAILY_TABLE", "monitoring_site_daily").strip() or "monitoring_site_daily",
            hourly_table=os.getenv("SUPABASE_HOURLY_TABLE", "monitoring_site_hourly").strip() or "monitoring_site_hourly",
            history_interval_seconds=history_interval,
            history_retention_days=retention_days,
        )
        return cls(config)

    @property
    def configured(self) -> bool:
        return self._client is not None and self.config is not None and not self.config_error

    def public_status(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "current_table": self.config.current_table if self.config else None,
            "history_table": self.config.history_table if self.config else None,
            "daily_table": self.config.daily_table if self.config else None,
            "hourly_table": self.config.hourly_table if self.config else None,
            "history_interval_seconds": self.config.history_interval_seconds if self.config else None,
            "history_retention_days": self.config.history_retention_days if self.config else None,
            "config_error": self.config_error,
        }

    def _require(self) -> tuple[Client, StoreConfig]:
        if not self.configured or self._client is None or self.config is None:
            raise RuntimeError(self.config_error or "Supabase storage is not configured")
        return self._client, self.config

    def ping(self) -> dict[str, Any]:
        client, config = self._require()
        with self._lock:
            response = client.table(config.current_table).select("id").limit(1).execute()
        return {"ok": True, "rows": len(response.data or [])}

    def verify_access_token(self, access_token: str) -> dict[str, Any]:
        """Validate a Supabase Auth access token and return safe user identity fields."""
        client, _ = self._require()
        with self._lock:
            response = client.auth.get_user(access_token)

        user = getattr(response, "user", None)
        if user is None:
            raise RuntimeError("Supabase Auth did not return a user")

        return {
            "id": str(getattr(user, "id", "") or ""),
            "email": getattr(user, "email", None),
            "role": getattr(user, "role", None),
        }

    def save_snapshot(
        self,
        *,
        run_id: str,
        scraped_at: str,
        payload: dict[str, Any],
        summary: dict[str, Any],
    ) -> dict[str, Any]:
        client, config = self._require()
        updated_at = utc_iso()

        with self._lock:
            try:
                current_query = client.table(config.current_table).select("payload").eq("id", 1).limit(1).execute()
                if current_query.data and isinstance(current_query.data, list) and len(current_query.data) > 0:
                    existing_payload = current_query.data[0].get("payload")
                    if isinstance(existing_payload, dict):
                        payload = merge_payload_preserve_history(existing_payload, payload)
            except Exception:
                pass

            current_row = {
                "id": 1,
                "run_id": run_id,
                "scraped_at": scraped_at,
                "payload": payload,
                "summary": summary,
                "updated_at": updated_at,
            }
            client.table(config.current_table).upsert(current_row, on_conflict="id").execute()
            history_saved = self._save_history_if_due(
                client=client,
                config=config,
                run_id=run_id,
                scraped_at=scraped_at,
                payload=payload,
                summary=summary,
            )

            daily_rollups_saved = 0
            daily_rollups_error = None
            try:
                daily_rows = extract_site_daily_rollups(payload, scraped_at)
                if daily_rows:
                    client.table(config.daily_table).upsert(
                        daily_rows,
                        on_conflict="platform,station_id,bucket_date",
                    ).execute()
                    daily_rollups_saved = len(daily_rows)
            except Exception as exc:
                # Rollups are additive. A missing migration must not discard the
                # current snapshot or turn a successful scrape into an outage.
                daily_rollups_error = f"{type(exc).__name__}: {exc}"

            hourly_rollups_saved = 0
            hourly_rollups_error = None
            try:
                hourly_rows = extract_site_hourly_rollups(payload, scraped_at)
                if hourly_rows:
                    client.table(config.hourly_table).upsert(
                        hourly_rows,
                        on_conflict="platform,station_id,bucket_hour",
                    ).execute()
                    hourly_rollups_saved = len(hourly_rows)
            except Exception as exc:
                # Hourly history is additive and must never make current monitoring fail.
                hourly_rollups_error = f"{type(exc).__name__}: {exc}"

        return {
            "current_saved": True,
            "history_saved": history_saved,
            "daily_rollups_saved": daily_rollups_saved,
            "daily_rollups_error": daily_rollups_error,
            "hourly_rollups_saved": hourly_rollups_saved,
            "hourly_rollups_error": hourly_rollups_error,
            "updated_at": updated_at,
        }

    def _save_history_if_due(
        self,
        *,
        client: Client,
        config: StoreConfig,
        run_id: str,
        scraped_at: str,
        payload: dict[str, Any],
        summary: dict[str, Any],
    ) -> bool:
        should_save = config.history_interval_seconds == 0

        if not should_save:
            latest = (
                client.table(config.history_table)
                .select("scraped_at")
                .order("scraped_at", desc=True)
                .limit(1)
                .execute()
            )
            latest_rows = latest.data or []
            latest_at = parse_timestamp(latest_rows[0].get("scraped_at")) if latest_rows else None
            current_at = parse_timestamp(scraped_at) or utc_now()
            should_save = latest_at is None or (current_at - latest_at).total_seconds() >= config.history_interval_seconds

        if not should_save:
            return False

        history_row = {
            "run_id": run_id,
            "scraped_at": scraped_at,
            "payload": payload,
            "summary": summary,
        }
        client.table(config.history_table).upsert(history_row, on_conflict="run_id").execute()

        if config.history_retention_days > 0:
            cutoff = utc_iso(utc_now() - timedelta(days=config.history_retention_days))
            client.table(config.history_table).delete().lt("scraped_at", cutoff).execute()

        return True

    def get_current_row(self) -> dict[str, Any] | None:
        client, config = self._require()
        try:
            with self._lock:
                response = (
                    client.table(config.current_table)
                    .select("id,run_id,scraped_at,payload,summary,updated_at")
                    .eq("id", 1)
                    .limit(1)
                    .execute()
                )
            rows = response.data or []
            return rows[0] if rows else None
        except Exception as exc:
            try:
                import requests
                url = f"{config.url.rstrip('/')}/rest/v1/{config.current_table}?id=eq.1&select=id,run_id,scraped_at,payload,summary,updated_at"
                res = requests.get(
                    url,
                    headers={
                        "apikey": config.secret_key,
                        "Authorization": f"Bearer {config.secret_key}",
                        "Accept": "application/json",
                    },
                    timeout=8,
                )
                if res.ok:
                    data = res.json()
                    if isinstance(data, list) and len(data) > 0:
                        return data[0]
            except Exception:
                pass
            raise exc

    def get_history(self, limit: int = 24, include_payload: bool = False) -> list[dict[str, Any]]:
        client, config = self._require()
        columns = "id,run_id,scraped_at,summary,created_at"
        if include_payload:
            columns += ",payload"
        safe_limit = min(max(1, limit), 168)
        with self._lock:
            response = (
                client.table(config.history_table)
                .select(columns)
                .order("scraped_at", desc=True)
                .limit(safe_limit)
                .execute()
            )
        return list(response.data or [])
