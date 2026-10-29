#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlparse

import socket
import requests
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

_DNS_FALLBACKS = {
    "sg5.fusionsolar.huawei.com": "119.8.160.213",
    "energy.kehua.com": "47.242.3.236",
    "hurtfiwuefjxfosvwbsj.supabase.co": "104.18.38.10",
}
_orig_getaddrinfo = socket.getaddrinfo

def _safe_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    try:
        return _orig_getaddrinfo(host, port, family, type, proto, flags)
    except socket.gaierror:
        if isinstance(host, str) and host in _DNS_FALLBACKS:
            return _orig_getaddrinfo(_DNS_FALLBACKS[host], port, family, type, proto, flags)
        raise

socket.getaddrinfo = _safe_getaddrinfo

try:
    from env_loader import load_env_file
    load_env_file(Path(__file__).resolve().parent / ".env")
except Exception:
    pass


DROP_REQUEST_HEADERS = {
    "content-length",
    "host",
    "connection",
    "accept-encoding",
    ":authority",
    ":method",
    ":path",
    ":scheme",
}

SENSITIVE_HEADERS = {
    "cookie",
    "authorization",
    "token",
    "x-token",
    "set-cookie",
}

AUTH_ERROR_CODES = {"900", "901", "902", "903", "999", "111005", 900, 901, 902, 903, 999, 111005}

KEHUA_PASSWORD_KEY = "clxslychxyl11988"
KEHUA_SIGN_KEY = "%vSBtRMV4F8mr#dYofsG3lJOBv5vw*fZ"
KEHUA_TARIFF_PER_KWH = float(os.getenv("KEHUA_TARIFF_PER_KWH", "900.0"))
SMA_TARIFF_PER_KWH = float(os.getenv("SMA_TARIFF_PER_KWH", "900.0"))


def now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def safe_filename(value: str) -> str:
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-"
    cleaned = "".join(ch if ch in allowed else "_" for ch in value)
    return cleaned[:180] if cleaned else "unknown"


def try_parse_json(text: str | None) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return text


def parse_form_payload(text: str) -> dict[str, str]:
    if not text:
        return {}
    try:
        parsed = parse_qs(text, keep_blank_values=True)
        return {key: values[-1] if values else "" for key, values in parsed.items()}
    except Exception:
        return {}


def extract_cookie_list(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and isinstance(raw.get("cookies"), list):
        return raw["cookies"]
    return []


def cookie_domain_allowed(cookie_domain: str, allowed_domains: list[str]) -> bool:
    normalized = cookie_domain.lstrip(".")
    return any(normalized == item.lstrip(".") or normalized.endswith("." + item.lstrip(".")) for item in allowed_domains)


def load_cookies_into_session(session: requests.Session, cookies_file: Path | None, site: dict[str, Any]) -> dict[str, Any]:
    if not cookies_file or not cookies_file.exists():
        return {"loaded": 0, "token_found": False, "reason": "missing"}

    cookies = extract_cookie_list(load_json(cookies_file))
    allowed_domains = site.get("cookie_domains") or [site["base_domain"]]
    loaded = 0
    token_value = None
    token_cookie_name = None

    for cookie in cookies:
        name = cookie.get("name")
        value = cookie.get("value")
        if not name or value is None:
            continue
        domain = str(cookie.get("domain") or site["base_domain"])
        if not cookie_domain_allowed(domain, allowed_domains):
            continue
        session.cookies.set(
            name=str(name),
            value=str(value),
            domain=domain,
            path=str(cookie.get("path") or "/"),
            secure=bool(cookie.get("secure", True)),
        )
        loaded += 1
        if str(name).lower() in {"token", "authorization", "auth", "access_token", "access-token"}:
            token_value = str(value)
            token_cookie_name = str(name)

    if token_value:
        session.headers.update({"Authorization": token_value, "token": token_value})

    return {"loaded": loaded, "token_found": bool(token_value), "token_cookie_name": token_cookie_name, "reason": "ok"}


def build_base_headers(site: dict[str, Any]) -> dict[str, str]:
    return {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.8",
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        "Origin": site["base_url"],
        "Pragma": "no-cache",
        "Referer": site.get("dashboard_url") or site["base_url"],
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
    }


def huawei_password_login(session: requests.Session, site: dict[str, Any], username: str, password: str, timeout: int) -> dict[str, Any]:
    base_url = site["base_url"]
    session.get(f"{base_url}/rest/dp/pvms/pvmswebservice/v1/configcenter/oem", timeout=timeout)
    response = session.post(
        f"{base_url}/rest/dp/uidm/unisso/v1/validate-user?service=%2Frest%2Fdp%2Fuidm%2Fauth%2Fv1%2Fon-sso-credential-ready",
        json={"username": username, "password": password, "verifycode": ""},
        timeout=timeout,
    )
    body = response.json()
    redirect_url = (body.get("payload") or {}).get("redirectURL")
    if not redirect_url:
        return {"success": False, "status_code": response.status_code, "body": body, "reason": "missing_redirect"}

    redirection_address = quote(f"{base_url}/rest/pvms/web/login/v1/redirecturl?isFirst=false", safe="")
    final = session.get(f"{base_url}{redirect_url}&redirectionAddress={redirection_address}", timeout=timeout, allow_redirects=True)
    if final.url:
        session.headers["X-Huawei-Referer"] = final.url.split("#")[0]
    return {"success": response.ok and final.ok, "status_code": final.status_code, "final_url": final.url}


def aes_ecb_base64(value: str, key: str) -> str:
    cipher = AES.new(key.encode("utf-8"), AES.MODE_ECB)
    encrypted = cipher.encrypt(pad(value.encode("utf-8"), AES.block_size))
    return base64.b64encode(encrypted).decode("ascii")


def kehua_password_cipher(password: str) -> str:
    return aes_ecb_base64(password, KEHUA_PASSWORD_KEY)


def kehua_request_sign(payload: dict[str, str], timestamp_ms: int | None = None) -> str:
    values = [f"{key}={payload[key]}" for key in sorted(payload) if payload[key] != ""]
    timestamp = timestamp_ms if timestamp_ms is not None else int(time.time() * 1000)
    if values:
        digest = hashlib.md5(",".join(values).encode("utf-8")).hexdigest()
        plaintext = f"{digest},{timestamp}"
    else:
        plaintext = str(timestamp)
    return aes_ecb_base64(plaintext, KEHUA_SIGN_KEY)


def kehua_form_headers(site: dict[str, Any], payload: dict[str, str]) -> dict[str, str]:
    return {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": site["base_url"],
        "Referer": site.get("login_url") or site["base_url"],
        "clientType": "web",
        "locale": "en",
        "web_version": str(site.get("web_version") or "3.0.4"),
        "sign": kehua_request_sign(payload),
    }


def kehua_check_auth(session: requests.Session, site: dict[str, Any], timeout: int) -> dict[str, Any]:
    url = site.get("auth_check")
    if not url:
        return {"checked": False, "success": None, "reason": "not_configured"}
    response = session.post(
        url,
        data="",
        headers=kehua_form_headers(site, {}),
        timeout=timeout,
        allow_redirects=False,
    )
    body = try_parse_json(response.text)
    app_code = body.get("code") if isinstance(body, dict) else None
    return {
        "checked": True,
        "success": response.ok and app_code in (0, "0"),
        "status_code": response.status_code,
        "app_code": app_code,
    }


def response_authorization(response: requests.Response, body: Any) -> str | None:
    for name, value in response.headers.items():
        if name.lower() == "authorization" and value:
            return str(value)
    if isinstance(body, dict):
        data = body.get("data")
        if isinstance(data, dict) and data.get("authorization"):
            return str(data["authorization"])
    return None


def kehua_password_login(session: requests.Session, site: dict[str, Any], username: str, password: str, timeout: int) -> dict[str, Any]:
    payload = {"username": username, "password": kehua_password_cipher(password)}
    response = session.post(
        site.get("password_login") or f"{site['base_url']}/necp/server-user/auth/web/login",
        data=urlencode(payload),
        headers=kehua_form_headers(site, payload),
        timeout=timeout,
        allow_redirects=False,
    )
    body = try_parse_json(response.text)
    app_code = body.get("code") if isinstance(body, dict) else None
    authorization = response_authorization(response, body)
    if authorization:
        session.headers.update({"Authorization": authorization})
        session.cookies.set("token", authorization, domain=site["base_domain"], path="/", secure=True)
    return {
        "success": response.ok and app_code in (0, "0") and bool(authorization),
        "status_code": response.status_code,
        "app_code": app_code,
        "authorization_found": bool(authorization),
    }


def refresh_huawei_roarand(session: requests.Session, site: dict[str, Any], timeout: int) -> dict[str, Any]:
    keep_alive = site.get("keep_alive")
    if not keep_alive:
        return {"success": False, "reason": "not_configured"}
    response = session.get(keep_alive, timeout=timeout, allow_redirects=False)
    body = try_parse_json(response.text)
    roarand = None
    if isinstance(body, dict):
        payload = body.get("payload")
        if isinstance(payload, str) and payload:
            roarand = payload
    if roarand:
        session.headers.update({"roarand": roarand})
    return {"success": bool(roarand), "status_code": response.status_code, "roarand_found": bool(roarand), "body": body}


def sma_generate_pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii").rstrip("=")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


def sma_parse_form_action(html: str) -> str | None:
    match = re.search(r'<form[^>]+action=["\']([^"\']+)["\']', html, re.IGNORECASE)
    return match.group(1).replace("&amp;", "&") if match else None


def sma_password_login(
    session: requests.Session,
    site: dict[str, Any],
    username: str,
    password: str,
    timeout: int,
) -> dict[str, Any]:
    auth_base = site.get("auth_base", "https://login.sma.energy/auth/realms/SMA")
    auth_url = f"{auth_base}/protocol/openid-connect/auth"
    token_url = f"{auth_base}/protocol/openid-connect/token"
    client_id = site.get("client_id", "SPpbeOS")
    redirect_uri = site.get("redirect_uri", "https://ennexos.sunnyportal.com/dashboard/initialize")

    code_verifier, code_challenge = sma_generate_pkce()
    state = secrets.token_urlsafe(16)
    nonce = secrets.token_urlsafe(16)

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": "openid profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "nonce": nonce,
    }

    try:
        r1 = session.get(
            auth_url,
            params=params,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
            },
            timeout=timeout,
        )
        if not r1.ok:
            return {"success": False, "status_code": r1.status_code, "reason": "auth_page_error"}

        form_action = sma_parse_form_action(r1.text)
        if not form_action:
            return {"success": False, "reason": "login_form_not_found"}

        form_url = urljoin(auth_url, form_action)
        r2 = session.post(
            form_url,
            data={"username": username, "password": password, "credentialId": ""},
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
            },
            allow_redirects=False,
            timeout=timeout,
        )

        location = r2.headers.get("Location")
        if not location:
            return {"success": False, "status_code": r2.status_code, "reason": "invalid_credentials_or_no_redirect"}

        parsed_loc = urlparse(location)
        query_params = parse_qs(parsed_loc.query)
        auth_code = query_params.get("code", [None])[0]
        if not auth_code:
            return {"success": False, "reason": "missing_auth_code_in_redirect", "location": location}

        r3 = session.post(
            token_url,
            data={
                "grant_type": "authorization_code",
                "code": auth_code,
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
                "client_id": client_id,
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            timeout=timeout,
        )
        if not r3.ok:
            return {"success": False, "status_code": r3.status_code, "reason": "token_exchange_failed"}

        token_data = r3.json()
        access_token = token_data.get("access_token")
        if not access_token:
            return {"success": False, "reason": "no_access_token_returned"}

        session.headers["Authorization"] = f"Bearer {access_token}"
        return {
            "success": True,
            "status_code": r3.status_code,
            "token_type": token_data.get("token_type"),
            "expires_in": token_data.get("expires_in"),
        }
    except Exception as exc:
        return {"success": False, "reason": repr(exc)}


def sma_check_auth(session: requests.Session, site: dict[str, Any], timeout: int) -> dict[str, Any]:
    url = f"{site.get('api_base', 'https://uiapi.sunnyportal.com/api/v1')}/navigation"
    try:
        response = session.get(
            url,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            timeout=timeout,
            allow_redirects=False,
        )
        return {
            "checked": True,
            "success": response.ok and response.status_code == 200,
            "status_code": response.status_code,
        }
    except Exception as exc:
        return {"checked": True, "success": False, "error": repr(exc)}


def check_auth(session: requests.Session, site: dict[str, Any], timeout: int) -> dict[str, Any]:
    url = site.get("auth_check")
    if not url:
        return {"checked": False, "success": None}
    response = session.get(url, timeout=timeout, allow_redirects=False)
    body = try_parse_json(response.text)
    success = False
    if isinstance(body, dict):
        success = body.get("code") in (0, "0") and body.get("payload") is True
    return {"checked": True, "success": success, "status_code": response.status_code, "body": body}


def prepare_session(
    site_name: str,
    site: dict[str, Any],
    cookies_file: Path | None,
    timeout: int,
    credentials: dict[str, Any] | None = None,
) -> tuple[requests.Session, dict[str, Any]]:
    session = requests.Session()
    session.headers.update(build_base_headers(site))
    meta: dict[str, Any] = {"cookies": load_cookies_into_session(session, cookies_file, site)}

    if site.get("auth_type") == "huawei_fusionsolar":
        use_shared = not credentials or credentials.get("use_shared_cookies", True)
        auth = check_auth(session, site, timeout) if use_shared else {"success": False}
        meta["auth_check_before_login"] = auth
        username = credentials.get("username") if credentials else os.getenv("HUAWEI_USERNAME")
        password = credentials.get("password") if credentials else os.getenv("HUAWEI_PASSWORD")
        if not auth.get("success") and username and password:
            meta["password_login"] = huawei_password_login(session, site, username, password, timeout)
            meta["auth_check_after_login"] = check_auth(session, site, timeout)
        meta["keep_alive"] = refresh_huawei_roarand(session, site, timeout)

    if site.get("auth_type") == "kehua_energy":
        use_shared = not credentials or credentials.get("use_shared_cookies", True)
        auth = kehua_check_auth(session, site, timeout) if use_shared else {"success": False}
        meta["auth_check_before_login"] = auth
        if not auth.get("success"):
            username = credentials.get("username") if credentials else os.getenv("KEHUA_USERNAME")
            password = credentials.get("password") if credentials else os.getenv("KEHUA_PASSWORD")
            if username and password:
                meta["password_login"] = kehua_password_login(session, site, username, password, timeout)
                meta["auth_check_after_login"] = kehua_check_auth(session, site, timeout)
            else:
                meta["password_login"] = {"success": False, "reason": "credentials_not_configured"}

    if site.get("auth_type") == "sma_ennexos":
        use_shared = not credentials or credentials.get("use_shared_cookies", True)
        auth = sma_check_auth(session, site, timeout) if use_shared else {"success": False}
        meta["auth_check_before_login"] = auth
        if not auth.get("success"):
            username = credentials.get("username") if credentials else os.getenv("SMA_USERNAME")
            password = credentials.get("password") if credentials else os.getenv("SMA_PASSWORD")
            if username and password:
                meta["password_login"] = sma_password_login(session, site, username, password, timeout)
                meta["auth_check_after_login"] = sma_check_auth(session, site, timeout)
            else:
                meta["password_login"] = {"success": False, "reason": "credentials_not_configured"}

    return session, meta


def load_kehua_accounts_from_env() -> list[dict[str, Any]]:
    accounts: list[dict[str, Any]] = []
    legacy_username = os.getenv("KEHUA_USERNAME", "").strip()
    legacy_password = os.getenv("KEHUA_PASSWORD", "").strip()
    legacy_region = os.getenv("KEHUA_REGION", "").strip() or "Jakarta Utara"
    if legacy_username and legacy_password:
        accounts.append({
            "name": "primary",
            "username": legacy_username,
            "password": legacy_password,
            "use_shared_cookies": True,
            "region": legacy_region,
        })

    for index in range(2, 50):
        second_username = os.getenv(f"KEHUA_USERNAME_{index}", "").strip()
        second_password = os.getenv(f"KEHUA_PASSWORD_{index}", "").strip()
        if second_username and second_password:
            default_region = (
                "Jakarta Utara" if index == 2
                else ("Jakarta Barat" if index in (3, 4)
                else ("Jakarta Pusat" if index in (5, 6)
                else ("Jakarta Selatan" if index in (7, 8) else None)))
            )
            explicit_region = os.getenv(f"KEHUA_REGION_{index}", "").strip()
            accounts.append({
                "name": "secondary" if index == 2 else f"account_{index}",
                "username": second_username,
                "password": second_password,
                "use_shared_cookies": False,
                "region": explicit_region or default_region,
            })

    raw = os.getenv("KEHUA_ACCOUNTS_JSON", "").strip()
    if raw:
        try:
            configured = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"KEHUA_ACCOUNTS_JSON is not valid JSON: {exc.msg}") from exc
        if not isinstance(configured, list):
            raise RuntimeError("KEHUA_ACCOUNTS_JSON must be a JSON list")
        for index, item in enumerate(configured, start=1):
            if not isinstance(item, dict):
                raise RuntimeError(f"KEHUA_ACCOUNTS_JSON item {index} must be an object")
            username = str(item.get("username") or "").strip()
            password = str(item.get("password") or "").strip()
            if not username or not password:
                raise RuntimeError(f"KEHUA_ACCOUNTS_JSON item {index} requires username and password")
            account = {
                "name": str(item.get("name") or f"additional_{index}"),
                "username": username,
                "password": password,
            }
            if item.get("region"):
                account["region"] = str(item["region"]).strip()
            for key in ("company_id", "station_id", "area_code", "company_name"):
                if item.get(key) not in (None, ""):
                    account[key] = str(item[key])
            accounts.append(account)

    unique: list[dict[str, Any]] = []
    seen_usernames: set[str] = set()
    for account in accounts:
        if account["username"] not in seen_usernames:
            unique.append(account)
            seen_usernames.add(account["username"])
    return unique


def load_huawei_accounts_from_env() -> list[dict[str, Any]]:
    accounts: list[dict[str, Any]] = []
    legacy_username = os.getenv("HUAWEI_USERNAME", "").strip()
    legacy_password = os.getenv("HUAWEI_PASSWORD", "").strip()
    legacy_region = os.getenv("HUAWEI_REGION", "").strip() or "Jakarta Utara"
    if legacy_username and legacy_password:
        accounts.append({
            "name": "primary",
            "username": legacy_username,
            "password": legacy_password,
            "use_shared_cookies": True,
            "region": legacy_region,
        })

    for index in range(2, 50):
        second_username = os.getenv(f"HUAWEI_USERNAME_{index}", "").strip()
        second_password = os.getenv(f"HUAWEI_PASSWORD_{index}", "").strip()
        if second_username and second_password:
            default_region = (
                "Jakarta Barat" if index in (2, 3)
                else ("Jakarta Pusat" if index == 4 else None)
            )
            explicit_region = os.getenv(f"HUAWEI_REGION_{index}", "").strip()
            accounts.append({
                "name": f"account_{index}",
                "username": second_username,
                "password": second_password,
                "use_shared_cookies": False,
                "region": explicit_region or default_region,
            })

    raw = os.getenv("HUAWEI_ACCOUNTS_JSON", "").strip()
    if raw:
        try:
            configured = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"HUAWEI_ACCOUNTS_JSON is not valid JSON: {exc.msg}") from exc
        if not isinstance(configured, list):
            raise RuntimeError("HUAWEI_ACCOUNTS_JSON must be a JSON list")
        for index, item in enumerate(configured, start=1):
            if not isinstance(item, dict):
                raise RuntimeError(f"HUAWEI_ACCOUNTS_JSON item {index} must be an object")
            username = str(item.get("username") or "").strip()
            password = str(item.get("password") or "").strip()
            if not username or not password:
                raise RuntimeError(f"HUAWEI_ACCOUNTS_JSON item {index} requires username and password")
            accounts.append({
                "name": str(item.get("name") or f"additional_{index}"),
                "username": username,
                "password": password,
                "use_shared_cookies": False,
                "region": str(item.get("region") or "").strip() or None,
            })

    unique: list[dict[str, Any]] = []
    seen_usernames: set[str] = set()
    for account in accounts:
        if account["username"] not in seen_usernames:
            unique.append(account)
            seen_usernames.add(account["username"])
    return unique


def load_sma_accounts_from_env() -> list[dict[str, Any]]:
    accounts: list[dict[str, Any]] = []
    legacy_username = os.getenv("SMA_USERNAME", "").strip()
    legacy_password = os.getenv("SMA_PASSWORD", "").strip()
    legacy_region = os.getenv("SMA_REGION", "").strip() or "Jakarta Timur"
    if legacy_username and legacy_password:
        accounts.append({
            "name": "primary",
            "username": legacy_username,
            "password": legacy_password,
            "use_shared_cookies": True,
            "region": legacy_region,
        })

    for index in range(2, 50):
        second_username = os.getenv(f"SMA_USERNAME_{index}", "").strip()
        second_password = os.getenv(f"SMA_PASSWORD_{index}", "").strip()
        if second_username and second_password:
            default_region = (
                "Jakarta Barat" if index == 2
                else ("Jakarta Pusat" if index == 3
                else ("Jakarta Selatan" if index == 4 else None))
            )
            explicit_region = os.getenv(f"SMA_REGION_{index}", "").strip()
            acc = {
                "name": f"account_{index}",
                "username": second_username,
                "password": second_password,
                "use_shared_cookies": False,
                "region": explicit_region or default_region,
            }
            accounts.append(acc)

    raw = os.getenv("SMA_ACCOUNTS_JSON", "").strip()
    if raw:
        try:
            configured = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"SMA_ACCOUNTS_JSON is not valid JSON: {exc.msg}") from exc
        if not isinstance(configured, list):
            raise RuntimeError("SMA_ACCOUNTS_JSON must be a JSON list")
        for index, item in enumerate(configured, start=1):
            if not isinstance(item, dict):
                raise RuntimeError(f"SMA_ACCOUNTS_JSON item {index} must be an object")
            username = str(item.get("username") or "").strip()
            password = str(item.get("password") or "").strip()
            if not username or not password:
                raise RuntimeError(f"SMA_ACCOUNTS_JSON item {index} requires username and password")
            acc = {
                "name": str(item.get("name") or f"additional_{index}"),
                "username": username,
                "password": password,
                "use_shared_cookies": False,
            }
            if item.get("region"):
                acc["region"] = str(item["region"]).strip()
            accounts.append(acc)

    unique: list[dict[str, Any]] = []
    seen_usernames: set[str] = set()
    for account in accounts:
        if account["username"] not in seen_usernames:
            unique.append(account)
            seen_usernames.add(account["username"])
    return unique


def discover_kehua_account_identifiers(session: requests.Session, account: dict[str, Any], timeout: int = 15) -> dict[str, Any]:
    if account.get("name") in ("primary", "master"):
        return account
    if account.get("company_id") and account.get("station_id") and account.get("area_code"):
        return account

    discovered = dict(account)
    try:
        r1 = session.post(
            "https://energy.kehua.com/necp/server-maintenance/report/deviceData/listStationByName",
            data="",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=timeout,
        )
        items = (r1.json() if r1.ok else {}).get("data") or []
        if items:
            cid = items[0].get("companyId")
            sid = items[0].get("stationId")
            if cid and not discovered.get("company_id"):
                discovered["company_id"] = str(cid)
            if sid and not discovered.get("station_id"):
                discovered["station_id"] = str(sid)
            if items[0].get("stationName") and not discovered.get("company_name"):
                discovered["company_name"] = str(items[0].get("stationName"))

            if cid:
                r2 = session.post(
                    "https://energy.kehua.com/necp/server-maintenance/monitor/listStationCardInfoByCondition",
                    data=f"companyId={cid}&stationName=&stationStatus=&pageNumber=1&pageSize=12",
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=timeout,
                )
                cards = (r2.json() if r2.ok else {}).get("data", {}).get("result", [])
                if cards and cards[0].get("areaCode") and not discovered.get("area_code"):
                    discovered["area_code"] = str(cards[0].get("areaCode"))
    except Exception as exc:
        print(f"Warning: Kehua account identifier discovery skipped: {exc}")

    return discovered


def prepare_kehua_account_call(call: dict[str, Any], account: dict[str, Any]) -> dict[str, Any]:
    prepared = dict(call)
    prepared["headers"] = dict(call.get("headers", {}) or {})
    payload = parse_form_payload(str(call.get("payload_raw") or ""))
    replacements = {
        "companyId": account.get("company_id"),
        "stationId": account.get("station_id"),
        "areaCode": account.get("area_code"),
        "companyName": account.get("company_name"),
    }
    for field, value in replacements.items():
        if field in payload and value not in (None, ""):
            payload[field] = str(value)
    prepared["payload_raw"] = urlencode(payload)
    return prepared


def build_request_headers(session: requests.Session, call: dict[str, Any]) -> dict[str, str]:
    headers = dict(call.get("headers", {}) or {})
    for key in list(headers):
        lower = key.lower()
        if lower in DROP_REQUEST_HEADERS or lower in SENSITIVE_HEADERS:
            headers.pop(key, None)
    # Dynamic Huawei session nonce must come from keep-alive, not stale HAR.
    if "roarand" in session.headers:
        headers["roarand"] = session.headers["roarand"]
    if "X-Huawei-Referer" in session.headers and "Referer" in headers:
        headers["Referer"] = session.headers["X-Huawei-Referer"]
    return headers


def prepare_replay_call(
    call: dict[str, Any],
    current_time: datetime | None = None,
    *,
    sign_timestamp_ms: int | None = None,
) -> dict[str, Any]:
    """Refresh captured period fields and request signatures before replay."""
    prepared = dict(call)
    prepared["headers"] = dict(call.get("headers", {}) or {})
    now = current_time or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    jakarta_now = now.astimezone(timezone(timedelta(hours=7)))

    if call.get("site") == "huawei" and call.get("name") == "home-station-kpi-chart":
        payload = try_parse_json(call.get("payload_raw") or "")
        if isinstance(payload, dict):
            stat_dim = str(payload.get("statDim") or "")
            if stat_dim == "4":
                target = jakarta_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            elif stat_dim in {"5", "6"}:
                target = jakarta_now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            else:
                target = None
            if target is not None:
                payload["statTimeStr"] = target.strftime("%Y-%m-%d")
                payload["statTime"] = int(target.timestamp() * 1000)
                prepared["payload_raw"] = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)

    if call.get("site") == "kehua":
        payload = parse_form_payload(str(prepared.get("payload_raw") or ""))
        if "targetTime" in payload and not call.get("preserve_target_time"):
            dimension = str(payload.get("dimension") or "")
            if dimension == "2":
                payload["targetTime"] = jakarta_now.strftime("%Y-%m")
            elif dimension == "3":
                payload["targetTime"] = jakarta_now.strftime("%Y")
            elif dimension == "4":
                payload["targetTime"] = ""
            else:
                payload["targetTime"] = jakarta_now.strftime("%Y-%m-%d")
        prepared["payload_raw"] = urlencode(payload)
        prepared["headers"]["sign"] = kehua_request_sign(payload, sign_timestamp_ms)

    return prepared


def summarize_response(response_body: Any) -> dict[str, Any]:
    app_code = None
    app_message = None
    data_present = False
    payload_present = False
    auth_error = False

    if isinstance(response_body, dict):
        app_code = response_body.get("code", response_body.get("resultCode"))
        app_message = response_body.get("message", response_body.get("resultMsg"))
        data_present = "data" in response_body
        payload_present = "payload" in response_body
        auth_error = app_code in AUTH_ERROR_CODES or "auth" in str(app_message).lower()

    return {
        "app_code": app_code,
        "app_message": app_message,
        "data_present": data_present,
        "payload_present": payload_present,
        "auth_error": auth_error,
    }


def replay_call(session: requests.Session, call: dict[str, Any], timeout: int) -> dict[str, Any]:
    call = prepare_replay_call(call)
    method = str(call.get("method", "GET")).upper()
    payload_raw = call.get("payload_raw") or ""
    request_kwargs: dict[str, Any] = {
        "url": call["url"],
        "headers": build_request_headers(session, call),
        "timeout": timeout,
        "allow_redirects": False,
    }
    if method in {"POST", "PUT", "PATCH", "DELETE"}:
        request_kwargs["data"] = payload_raw.encode("utf-8") if payload_raw else b""

    try:
        response = session.request(method, **request_kwargs)
        if response.status_code in {429, 503}:
            time.sleep(1.0)
            response = session.request(method, **request_kwargs)
        body = try_parse_json(response.text)
        summary = summarize_response(body)
        redirected_to_login = response.status_code in {301, 302, 303, 307, 308} and "login" in response.headers.get("location", "")
        html_login = isinstance(body, str) and "login" in body[:1000].lower() and "<!doctype html" in body[:100].lower()
        success = response.ok and not redirected_to_login and not html_login and not summary["auth_error"]

        return {
            "id": call.get("id"),
            "name": call.get("name"),
            "method": method,
            "url": call.get("url"),
            "path": urlparse(call.get("url", "")).path,
            "payload_raw": payload_raw,
            "success": success,
            "http_status": response.status_code,
            "location": response.headers.get("location"),
            "content_type": response.headers.get("content-type"),
            "auth_error": bool(summary["auth_error"] or redirected_to_login or html_login),
            "app_code": summary["app_code"],
            "app_message": summary["app_message"],
            "data_present": summary["data_present"],
            "payload_present": summary["payload_present"],
            "response_body": body,
            "response_text_preview": response.text[:1000] if not isinstance(body, (dict, list)) else None,
            "error": None,
        }
    except Exception as exc:
        return {
            "id": call.get("id"),
            "name": call.get("name"),
            "method": method,
            "url": call.get("url"),
            "payload_raw": payload_raw,
            "success": False,
            "http_status": None,
            "auth_error": False,
            "response_body": None,
            "error": repr(exc),
        }


def huawei_energy_balance_calls(
    site: dict[str, Any],
    station_list_call: dict[str, Any],
    current_time: datetime | None = None,
) -> list[dict[str, Any]]:
    data = response_data(station_list_call)
    items = data.get("list") if isinstance(data, dict) else []
    if not isinstance(items, list):
        return []

    jakarta = timezone(timedelta(hours=7))
    now = current_time or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    today = now.astimezone(jakarta).replace(hour=0, minute=0, second=0, microsecond=0)
    periods = (
        ("daily", "2", today),
        ("monthly", "4", today.replace(day=1)),
        ("yearly", "5", today.replace(month=1, day=1)),
        ("lifetime", "6", today),
    )

    calls = []
    for item in items:
        if not isinstance(item, dict) or not item.get("dn"):
            continue
        station_dn = str(item["dn"])
        for period_name, time_dim, target in periods:
            station_query = {
                "stationDn": station_dn,
                "timeDim": time_dim,
                "timeZone": "7.0",
                "timeZoneStr": "Asia/Jakarta",
                "queryTime": str(int(target.timestamp() * 1000)),
                "dateStr": target.strftime("%Y-%m-%d 00:00:00"),
                "_": str(int(time.time() * 1000)),
            }
            calls.append({
                "id": f"{period_name}_energy_balance_{station_dn.replace('=', '_')}",
                "site": "huawei",
                "name": f"energy-balance-{period_name}",
                "method": "GET",
                "url": f"{site['base_url']}/rest/pvms/web/station/v3/overview/energy-balance?{urlencode(station_query)}",
                "headers": {
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "Accept-Language": "en-US,en;q=0.8",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "Referer": site.get("dashboard_url") or site["base_url"],
                    "X-Requested-With": "XMLHttpRequest",
                    "x-timezone-offset": "420",
                },
                "payload_raw": "",
            })
    return calls


def kehua_extra_station_calls(
    site: dict[str, Any],
    card_call: dict[str, Any],
) -> list[dict[str, Any]]:
    data = response_data(card_call)
    cards = data.get("result") if isinstance(data, dict) else []
    if not isinstance(cards, list):
        return []

    calls = []
    base_url = site.get("base_url", "https://energy.kehua.com")
    for item in cards:
        if not isinstance(item, dict):
            continue
        station_id = item.get("stationId")
        company_id = item.get("companyId")
        area_code = item.get("areaCode")
        if not station_id or str(station_id) in ("38722", "50483", "50639"):
            continue
        calls.append({
            "id": f"get_station_info_{station_id}",
            "site": "kehua",
            "name": "getStationInfo",
            "method": "POST",
            "url": f"{base_url}/necp/server-maintenance/monitor/getStationInfo",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/x-www-form-urlencoded",
                "clientType": "web",
                "web_version": "3.0.4",
            },
            "payload_raw": f"companyId={company_id or ''}&areaCode={area_code or ''}&stationId={station_id}",
        })
        calls.append({
            "id": f"get_topology_info_{station_id}",
            "site": "kehua",
            "name": "getTopologyInfo",
            "method": "POST",
            "url": f"{base_url}/necp/server-maintenance/monitor/getTopologyInfo",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/x-www-form-urlencoded",
                "clientType": "web",
                "web_version": "3.0.4",
            },
            "payload_raw": f"stationId={station_id}",
        })
        if company_id:
            calls.append({
                "id": f"get_key_data_{station_id}",
                "site": "kehua",
                "name": "getKeyData",
                "method": "POST",
                "url": f"{base_url}/necp/server-monitor/monitor/getKeyData",
                "headers": {
                    "Accept": "application/json, text/plain, */*",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "clientType": "web",
                    "web_version": "3.0.4",
                },
                "payload_raw": f"displayRank=0&companyId={company_id}&stationId={station_id}",
            })
        calls.append({
            "id": f"get_energy_trend_{station_id}",
            "site": "kehua",
            "name": "getEnergyTrendChartOfStation",
            "method": "POST",
            "url": f"{base_url}/necp/server-monitor/monitor/getEnergyTrendChartOfStation",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/x-www-form-urlencoded",
                "clientType": "web",
                "locale": "en",
                "web_version": "3.0.4",
            },
            "payload_raw": f"stationId={station_id}&dimension=3&targetTime={datetime.now().year}&chartType=1",
        })
        calls.append({
            "id": f"get_energy_trend_month_{station_id}",
            "site": "kehua",
            "name": "getEnergyTrendChartOfStation",
            "method": "POST",
            "url": f"{base_url}/necp/server-monitor/monitor/getEnergyTrendChartOfStation",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/x-www-form-urlencoded",
                "clientType": "web",
                "locale": "en",
                "web_version": "3.0.4",
            },
            "payload_raw": f"stationId={station_id}&dimension=2&targetTime={datetime.now().strftime('%Y-%m')}&chartType=1",
        })
        calls.append({
            "id": f"get_energy_trend_week_{station_id}",
            "site": "kehua",
            "name": "getEnergyTrendChartOfStation",
            "method": "POST",
            "url": f"{base_url}/necp/server-monitor/monitor/getEnergyTrendChartOfStation",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/x-www-form-urlencoded",
                "clientType": "web",
                "locale": "en",
                "web_version": "3.0.4",
            },
            "payload_raw": f"stationId={station_id}&dimension=5&targetTime={datetime.now().strftime('%Y-%m-%d')}&chartType=1",
        })
        calls.append({
            "id": f"get_energy_trend_total_{station_id}",
            "site": "kehua",
            "name": "getEnergyTrendChartOfStation",
            "method": "POST",
            "url": f"{base_url}/necp/server-monitor/monitor/getEnergyTrendChartOfStation",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/x-www-form-urlencoded",
                "clientType": "web",
                "locale": "en",
                "web_version": "3.0.4",
            },
            "payload_raw": f"stationId={station_id}&dimension=4&targetTime=&chartType=1",
        })
        current_year = datetime.now().year
        for past_yr in (current_year - 1, current_year - 2, current_year - 3, current_year - 4):
            calls.append({
                "id": f"get_energy_trend_{past_yr}_{station_id}",
                "site": "kehua",
                "name": "getEnergyTrendChartOfStation",
                "method": "POST",
                "url": f"{base_url}/necp/server-monitor/monitor/getEnergyTrendChartOfStation",
                "headers": {
                    "Accept": "application/json, text/plain, */*",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "clientType": "web",
                    "locale": "en",
                    "web_version": "3.0.4",
                },
                "preserve_target_time": True,
                "payload_raw": f"stationId={station_id}&dimension=3&targetTime={past_yr}&chartType=1",
            })
    return calls


def sma_extra_plant_calls(site: dict[str, Any], navigation_call: dict[str, Any]) -> list[dict[str, Any]]:
    body = response_data(navigation_call) or navigation_call.get("response_body")
    items = body if isinstance(body, list) else ([body] if isinstance(body, dict) else [])
    api_base = site.get("api_base") or f"{site.get('base_url', 'https://ennexos.sunnyportal.com')}/api/v1"
    calls: list[dict[str, Any]] = []

    jakarta_now = datetime.now(timezone(timedelta(hours=7)))
    jakarta_today_start = datetime(jakarta_now.year, jakarta_now.month, jakarta_now.day, 0, 0, 0, tzinfo=timezone(timedelta(hours=7)))
    jakarta_today_end = jakarta_today_start + timedelta(days=1) - timedelta(seconds=1)

    today_begin_utc = jakarta_today_start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    today_end_utc = jakarta_today_end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    # Query current year daily readings (from Jan 1) for current month daily curve and 12-month annual curve
    year_start_begin = f"{jakarta_now.year:04d}-01-01T00:00:00.000Z"
    now_end = jakarta_now.strftime("%Y-%m-%dT23:59:59.000Z")

    # Query last 7 days for latest Lifetime Total Counter
    recent_begin = (jakarta_now - timedelta(days=7)).strftime("%Y-%m-%dT00:00:00.000Z")

    # Query start of current year for YTD calculation
    year_start_meter_begin = f"{jakarta_now.year - 1:04d}-12-31T00:00:00.000Z"
    year_start_meter_end = f"{jakarta_now.year:04d}-01-03T23:59:59.000Z"

    seen_ids: set[str] = set()

    for item in items:
        if not isinstance(item, dict) or item.get("componentType") == "PlantGroup":
            continue
        component_id = str(item.get("componentId") or item.get("plantId") or "")
        if not component_id or component_id in seen_ids:
            continue
        is_plant = item.get("componentType") == "Plant" or "plantId" in item
        has_id_only = "componentType" not in item and "componentId" in item
        if not (is_plant or has_id_only):
            continue
        seen_ids.add(component_id)

        calls.append({
            "id": f"sma_plant_detail_{component_id}",
            "site": "sma",
            "name": f"sma_plant_detail_{component_id}",
            "method": "GET",
            "url": f"{api_base}/plants/{component_id}",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            "payload_raw": "",
        })
        calls.append({
            "id": f"sma_plant_power_{component_id}",
            "site": "sma",
            "name": f"sma_plant_power_{component_id}",
            "method": "GET",
            "url": f"{api_base}/widgets/gauge/power?componentId={component_id}&type=PvProduction",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            "payload_raw": "",
        })
        calls.append({
            "id": f"sma_plant_today_hourly_{component_id}",
            "site": "sma",
            "name": f"sma_plant_today_hourly_{component_id}",
            "method": "POST",
            "url": f"{api_base}/measurements/search",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            "payload_raw": json.dumps({
                "queryItems": [{
                    "componentId": component_id,
                    "channelId": "Measurement.Metering.TotWhOut.Pv",
                    "resolution": "OneHour",
                    "aggregate": "Dif",
                    "multiAggregate": "Sum",
                    "timezone": "Asia/Jakarta",
                }],
                "dateTimeBegin": today_begin_utc,
                "dateTimeEnd": today_end_utc,
            }),
        })
        calls.append({
            "id": f"sma_plant_daily_energy_{component_id}",
            "site": "sma",
            "name": f"sma_plant_daily_energy_{component_id}",
            "method": "POST",
            "url": f"{api_base}/measurements/search",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            "payload_raw": json.dumps({
                "queryItems": [{
                    "componentId": component_id,
                    "channelId": "Measurement.Metering.TotWhOut.Pv",
                    "resolution": "OneDay",
                    "aggregate": "Dif",
                    "multiAggregate": "Sum",
                    "timezone": "Asia/Jakarta",
                }],
                "dateTimeBegin": year_start_begin,
                "dateTimeEnd": now_end,
            }),
        })
        calls.append({
            "id": f"sma_plant_lifetime_energy_{component_id}",
            "site": "sma",
            "name": f"sma_plant_lifetime_energy_{component_id}",
            "method": "POST",
            "url": f"{api_base}/measurements/search",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            "payload_raw": json.dumps({
                "queryItems": [{
                    "componentId": component_id,
                    "channelId": "Measurement.Metering.TotWhOut",
                    "resolution": "OneDay",
                    "aggregate": "Max",
                    "multiAggregate": "Max",
                    "timezone": "Asia/Jakarta",
                }],
                "dateTimeBegin": recent_begin,
                "dateTimeEnd": now_end,
            }),
        })
        calls.append({
            "id": f"sma_plant_year_start_energy_{component_id}",
            "site": "sma",
            "name": f"sma_plant_year_start_energy_{component_id}",
            "method": "POST",
            "url": f"{api_base}/measurements/search",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            "payload_raw": json.dumps({
                "queryItems": [{
                    "componentId": component_id,
                    "channelId": "Measurement.Metering.TotWhOut",
                    "resolution": "OneDay",
                    "aggregate": "Max",
                    "multiAggregate": "Max",
                    "timezone": "Asia/Jakarta",
                }],
                "dateTimeBegin": year_start_meter_begin,
                "dateTimeEnd": year_start_meter_end,
            }),
        })
        calls.append({
            "id": f"sma_plant_historical_years_{component_id}",
            "site": "sma",
            "name": f"sma_plant_historical_years_{component_id}",
            "method": "POST",
            "url": f"{api_base}/measurements/search",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            "payload_raw": json.dumps({
                "queryItems": [{
                    "componentId": component_id,
                    "channelId": "Measurement.Metering.TotWhOut.Pv",
                    "resolution": "OneYear",
                    "aggregate": "Dif",
                    "multiAggregate": "Sum",
                    "timezone": "Asia/Jakarta",
                }],
                "dateTimeBegin": "2019-12-31T17:00:00Z",
                "dateTimeEnd": f"{jakarta_now.year - 1:04d}-12-31T17:00:00Z",
            }),
        })
        calls.append({
            "id": f"sma_plant_monthly_history_{component_id}",
            "site": "sma",
            "name": f"sma_plant_monthly_history_{component_id}",
            "method": "POST",
            "url": f"{api_base}/measurements/search",
            "headers": {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": "https://ennexos.sunnyportal.com",
                "Referer": "https://ennexos.sunnyportal.com/",
            },
            "payload_raw": json.dumps({
                "queryItems": [{
                    "componentId": component_id,
                    "channelId": "Measurement.Metering.TotWhOut.Pv",
                    "resolution": "OneMonth",
                    "aggregate": "Dif",
                    "multiAggregate": "Sum",
                    "timezone": "Asia/Jakarta",
                }],
                "dateTimeBegin": "2019-12-31T17:00:00.000Z",
                "dateTimeEnd": now_end,
            }),
        })
    return calls


def normalize_latest(results: list[dict[str, Any]]) -> dict[str, Any]:
    latest: dict[str, Any] = {"schema": "monitoring_current.v2", "by_site": {}, "updated_at": now_iso()}
    for site_result in results:
        site_name = site_result["site"]
        account_results = site_result.get("account_results")
        if isinstance(account_results, list) and account_results:
            normalized_accounts = [build_normalized_site(item) for item in account_results]
            latest["by_site"][site_name] = merge_normalized_sites(normalized_accounts)
        else:
            latest["by_site"][site_name] = build_normalized_site(site_result)
    return latest


def merge_normalized_sites(sites: list[dict[str, Any]]) -> dict[str, Any]:
    if len(sites) == 1:
        site = sites[0]
        for station in site.get("stations", []):
            station.setdefault("charts", site.get("charts", {}))
        return site

    stations_by_id: dict[str, dict[str, Any]] = {}
    for site in sites:
        for station in site.get("stations", []):
            key = str(station.get("station_id") or station.get("name") or "")
            if not key:
                continue
            current = stations_by_id.setdefault(key, {})
            current.update({field: value for field, value in station.items() if value not in (None, "")})
            current.setdefault("charts", site.get("charts", {}))

    sum_fields = {
        "station_count", "connected_station_count", "disconnected_station_count",
        "trouble_station_count", "no_device_station_count", "capacity_kwp",
        "current_power_kw", "daily_energy_kwh", "monthly_energy_kwh",
        "yearly_energy_kwh", "cumulative_energy_kwh", "monthly_income",
        "cumulative_income", "inverter_count", "monthly_alarm_count",
        "today_alarm_count", "last_month_alarm_count",
    }
    overview: dict[str, Any] = {}
    for field in sum_fields:
        values = [site.get("overview", {}).get(field) for site in sites]
        numbers = [value for value in values if isinstance(value, (int, float))]
        if numbers:
            overview[field] = sum(numbers)
    overview["station_count"] = len(stations_by_id)
    for site in sites:
        currency = site.get("overview", {}).get("income_currency")
        if currency:
            overview.setdefault("income_currency", currency)

    scrape_status = {
        field: sum(int(site.get("scrape_status", {}).get(field) or 0) for site in sites)
        for field in ("success_count", "failed_count", "auth_error_count")
    }

    devices: dict[str, Any] = {}
    for list_name, identity_fields in (
        ("devices", ("device_id", "sn")),
        ("collectors", ("collector_id", "sn")),
    ):
        unique_items: dict[str, dict[str, Any]] = {}
        for site in sites:
            for item in site.get("devices", {}).get(list_name, []):
                key = next((str(item.get(field)) for field in identity_fields if item.get(field) not in (None, "")), "")
                if key:
                    unique_items[key] = item
        if unique_items:
            devices[list_name] = list(unique_items.values())
    for field in ("device_count", "normal_count", "abnormal_count", "online_count", "offline_count"):
        values = [site.get("devices", {}).get(field) for site in sites]
        numbers = [value for value in values if isinstance(value, (int, float))]
        if numbers:
            devices[field] = sum(numbers)

    events = [
        event
        for site in sites
        for event in site.get("alarms", {}).get("events", [])
        if isinstance(event, dict)
    ]
    alarms = {
        "unsolved_count": sum(int(site.get("alarms", {}).get("unsolved_count") or 0) for site in sites),
        "event_total": sum(int(site.get("alarms", {}).get("event_total") or 0) for site in sites),
        "events": events,
    }

    return {
        "platform": sites[0].get("platform", "kehua") if sites else "kehua",
        "updated_at": max(str(site.get("updated_at") or "") for site in sites),
        "scrape_status": scrape_status,
        "overview": overview,
        "stations": list(stations_by_id.values()),
        "alarms": alarms,
        "devices": devices,
        "charts": sites[0].get("charts", {}),
    }


def response_data(call: dict[str, Any]) -> Any:
    body = call.get("response_body")
    if isinstance(body, dict) and "data" in body:
        return body.get("data")
    return body


def calls_by_name(calls: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for call in calls:
        grouped.setdefault(str(call.get("name")), []).append(call)
    return grouped


def first_data(grouped: dict[str, list[dict[str, Any]]], name: str) -> Any:
    calls = grouped.get(name) or []
    return response_data(calls[0]) if calls else None


def to_float(value: Any) -> float | None:
    if value is None or value == "" or value == "null":
        return None
    try:
        return float(str(value).replace(",", ""))
    except Exception:
        return None


def to_int(value: Any) -> int | None:
    number = to_float(value)
    return int(number) if number is not None else None


def energy_to_kwh(value: Any, unit: Any = None) -> float | None:
    number = to_float(value)
    if number is None:
        return None
    unit_text = str(unit or "kWh").lower()
    if unit_text == "mwh":
        return round(number * 1000, 4)
    if unit_text == "gwh":
        return round(number * 1000000, 4)
    return number


def power_to_kw(value: Any, unit: Any = None) -> float | None:
    number = to_float(value)
    if number is None:
        return None
    unit_text = str(unit or "kW").lower()
    if unit_text == "mw":
        return round(number * 1000, 4)
    if unit_text == "w":
        return round(number / 1000, 4)
    return number


def compact_non_null(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def build_normalized_site(site_result: dict[str, Any]) -> dict[str, Any]:
    site_name = site_result["site"]
    calls = site_result["calls"]
    account = site_result.get("account") or {}
    account_name = str(account.get("name") or "").lower()
    grouped = calls_by_name(calls)
    if site_name == "huawei":
        stations = normalize_huawei_stations(grouped)
        account_region = account.get("region")
        if account_region:
            for st in stations:
                st["region"] = account_region
        elif account_name in ("account_4", "jakpus") or "jakpus" in account_name:
            for st in stations:
                st["region"] = "Jakarta Pusat"
        elif account_name in ("secondary", "account_2", "account_3", "jakbar") or "jakbar" in account_name:
            for st in stations:
                st["region"] = "Jakarta Barat"
        elif account_name in ("primary", "account_1", "jakut") or "jakut" in account_name:
            for st in stations:
                st["region"] = "Jakarta Utara"

        for st in stations:
            st_name_l = str(st.get("name") or "").lower()
            addr_l = str(st.get("address") or "").lower()
            s_text = f"{st_name_l} {addr_l}"
            matched_region = None
            if any(k in st_name_l for k in ["cengkareng", "tambora", "smpn 205", "sman 85", "smpn 204", "sukabumi utara", "kalideres"]):
                matched_region = "Jakarta Barat"
            elif any(k in st_name_l for k in ["sawah besar", "gambir", "cempaka baru", "smpn 39", "kampung rawa", "smpn 08", "smpn 8 ", "perpustakaan arsip", "dppap", "paseban"]):
                matched_region = "Jakarta Pusat"
            elif any(k in st_name_l for k in ["pmptsp", "ragunan", "setiabudi", "jagakarsa", "pasar minggu", "smpn 175", "pejaten timur", "petukangan", "smkn 29", "grogol utara", "kalibata", "cilandak", "kebayoran"]):
                matched_region = "Jakarta Selatan"
            elif any(k in st_name_l for k in ["makassar", "pasar rebo", "ciracas", "rawamangun", "klender", "duren sawit", "pulogadung", "pulo gadung", "matraman", "knpi", "smpn 172", "cakung"]):
                matched_region = "Jakarta Timur"
            elif any(k in st_name_l for k in ["koja", "tanjung priok", "cilincing", "penjaringan", "islamic center", "tugu utara", "smpn 112", "bahtera jaya", "rawa badak", "pademangan", "smpn 244", "semper barat", "sekda saefullah", "sman 75", "sukapura"]):
                matched_region = "Jakarta Utara"
            elif "jakarta pusat" in s_text or "jkt pusat" in s_text or "jakpus" in s_text or "central jakarta" in s_text:
                matched_region = "Jakarta Pusat"
            elif "jakarta selatan" in s_text or "jkt selatan" in s_text or "jaksel" in s_text or "south jakarta" in s_text:
                matched_region = "Jakarta Selatan"
            elif "jakarta barat" in s_text or "jkt barat" in s_text or "jakbar" in s_text or "west jakarta" in s_text:
                matched_region = "Jakarta Barat"
            elif "jakarta timur" in s_text or "jkt timur" in s_text or "jaktim" in s_text or "east jakarta" in s_text:
                matched_region = "Jakarta Timur"
            elif "jakarta utara" in s_text or "jkt utara" in s_text or "jakut" in s_text or "north jakarta" in s_text:
                matched_region = "Jakarta Utara"

            if matched_region:
                st["region"] = matched_region
            elif not st.get("region") and account_region:
                st["region"] = account_region
        overview = normalize_huawei_overview(grouped, stations)
        alarms = normalize_huawei_alarms(grouped)
        charts = normalize_huawei_charts(grouped)
        devices = normalize_huawei_devices(grouped, stations)
    elif site_name == "kehua":
        stations = normalize_kehua_stations(grouped)
        account_region = account.get("region")
        if account_region and account_name not in ("primary", "master"):
            for st in stations:
                st["region"] = account_region
        elif account_name in ("account_7", "account_8", "jaksel") or "jaksel" in account_name:
            for st in stations:
                st["region"] = "Jakarta Selatan"
        elif account_name in ("account_5", "account_6", "jakpus") or "jakpus" in account_name:
            for st in stations:
                st["region"] = "Jakarta Pusat"
        elif account_name in ("account_3", "account_4", "jakbar") or "jakbar" in account_name:
            for st in stations:
                st["region"] = "Jakarta Barat"
        elif "jakut" in account_name:
            for st in stations:
                st["region"] = "Jakarta Utara"

        for st in stations:
            s_text = f"{st.get('name', '')} {st.get('address', '')}".lower()
            if any(k in s_text for k in ["tidung", "seribu", "pramuka"]):
                st["region"] = "Kepulauan Seribu"
            elif any(k in s_text for k in ["jakbar", "jakarta barat", "kalideres", "kembangan", "cengkareng", "taman sari", "pinangsia", "ppkd"]):
                st["region"] = "Jakarta Barat"
            elif any(k in s_text for k in ["jakpus", "jakarta pusat", "gambir", "kemayoran", "petojo", "petamburan", "cempaka putih", "tanah abang"]):
                st["region"] = "Jakarta Pusat"
            elif any(k in s_text for k in ["jaksel", "jakarta selatan", "cilandak", "pesanggrahan", "kebayoran"]):
                st["region"] = "Jakarta Selatan"
            elif any(k in s_text for k in ["jaktim", "jakarta timur", "duren sawit", "kramat jati", "pulo gadung", "rawamangun", "jatinegara", "klender"]):
                st["region"] = "Jakarta Timur"
            elif any(k in s_text for k in ["jakut", "jakarta utara", "koja", "tanjung priok", "priok", "sunter", "cilincing", "semper"]):
                st["region"] = "Jakarta Utara"
            elif not st.get("region"):
                st["region"] = "Jakarta Pusat"
        overview = normalize_kehua_overview(grouped, stations)
        alarms = normalize_kehua_alarms(grouped)
        charts = normalize_kehua_charts(grouped)
        devices = normalize_kehua_devices(grouped)
    elif site_name == "sma":
        stations = normalize_sma_stations(grouped)
        account_region = account.get("region")
        if account_region:
            for st in stations:
                st["region"] = account_region
        elif account_name in ("account_4", "jaksel") or "jaksel" in account_name:
            for st in stations:
                st["region"] = "Jakarta Selatan"
        elif account_name in ("account_3", "jakpus") or "jakpus" in account_name:
            for st in stations:
                st["region"] = "Jakarta Pusat"
        elif account_name in ("secondary", "account_2", "jakbar") or "jakbar" in account_name:
            for st in stations:
                st["region"] = "Jakarta Barat"
        elif account_name in ("primary", "account_1", "jaktim") or "jaktim" in account_name:
            for st in stations:
                st["region"] = "Jakarta Timur"

        for st in stations:
            if not st.get("region"):
                s_text = f"{st.get('name', '')} {st.get('address', '')}".lower()
                if "jakarta pusat" in s_text or "jkt pusat" in s_text or "jakpus" in s_text:
                    st["region"] = "Jakarta Pusat"
                elif "jakarta selatan" in s_text or "jkt selatan" in s_text or "jaksel" in s_text:
                    st["region"] = "Jakarta Selatan"
                elif "jakarta barat" in s_text or "jkt barat" in s_text or "jakbar" in s_text:
                    st["region"] = "Jakarta Barat"
                elif "jakarta timur" in s_text or "jkt timur" in s_text or "jaktim" in s_text:
                    st["region"] = "Jakarta Timur"
                elif "jakarta utara" in s_text or "jkt utara" in s_text or "jakut" in s_text:
                    st["region"] = "Jakarta Utara"
        overview = normalize_sma_overview(grouped, stations)
        alarms = normalize_sma_alarms(grouped)
        charts = normalize_sma_charts(grouped)
        devices = normalize_sma_devices(grouped, stations)
    else:
        stations = []
        overview = {}
        alarms = {}
        charts = {}
        devices = {}

    return {
        "platform": site_name,
        "updated_at": site_result["scraped_at"],
        "scrape_status": {
            "success_count": site_result["summary"]["success_count"],
            "failed_count": site_result["summary"]["failed_count"],
            "auth_error_count": site_result["summary"]["auth_error_count"],
        },
        "overview": overview,
        "stations": stations,
        "alarms": alarms,
        "devices": devices,
        "charts": charts,
    }


def normalize_huawei_stations(grouped: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    station_list = first_data(grouped, "station-list")
    kpi_by_station = huawei_kpi_by_station(grouped)
    energy_balance_by_station = huawei_energy_balance_by_station(grouped)
    items = []
    if isinstance(station_list, dict):
        items = station_list.get("list") or []

    stations = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        station = compact_non_null({
            "platform": "huawei",
            "station_id": str(item.get("dn") or item.get("dnId")),
            "station_dn": item.get("dn"),
            "station_numeric_id": item.get("dnId"),
            "name": item.get("name"),
            "status": normalize_status(item.get("plantStatus")),
            "status_raw": item.get("plantStatus"),
            "capacity_kwp": power_to_kw(item.get("installedCapacity"), "kW"),
            "current_power_kw": power_to_kw(item.get("currentPower"), "kW"),
            "inverter_power_kw": power_to_kw(item.get("inverterPower"), "kW"),
            "daily_energy_kwh": energy_to_kwh(item.get("dailyEnergy"), "kWh"),
            "monthly_energy_kwh": energy_to_kwh(item.get("monthEnergy"), "kWh"),
            "yearly_energy_kwh": energy_to_kwh(item.get("yearEnergy"), "kWh"),
            "cumulative_energy_kwh": energy_to_kwh(item.get("cumulativeEnergy"), "kWh"),
            "full_power_hours": to_float(item.get("eqPowerHours")),
            "self_use_energy_kwh": energy_to_kwh(item.get("dailySelfUseEnergy"), "kWh"),
            "grid_connected_at": item.get("gridConnectedTime"),
            "running_start_at": item.get("runningStartTime"),
            "timezone": item.get("timeZone"),
            "latitude": to_float(item.get("latitude")),
            "longitude": to_float(item.get("longitude")),
            "address": item.get("plantAddress"),
            "has_backup_box": item.get("existBackupBox"),
            "has_meter": None,
            "has_energy_storage": item.get("energyStore") not in (None, "UnAvailable", "null"),
        })
        station.update(kpi_by_station.get(str(item.get("dn") or ""), {}))
        station.update(energy_balance_by_station.get(str(item.get("dn") or ""), {}))

        st_name_l = str(station.get("name") or "").lower()
        if "204" in st_name_l:
            station["latitude"] = -6.13980
            station["longitude"] = 106.70133
            station["address"] = "SMP Negeri 204 Jakarta, Jl. Peta Utara III, Pegadungan, Kalideres, Jakarta Barat 11830"
            station["region"] = "Jakarta Barat"
        elif "sukabumi utara" in st_name_l:
            station["latitude"] = -6.20849
            station["longitude"] = 106.77832
            station["address"] = "SD Negeri Sukabumi Utara 01, Jl. Adam No. 1 / Jl. Saleh, Sukabumi Utara, Kebon Jeruk, Jakarta Barat 11540"
            station["region"] = "Jakarta Barat"
        elif "paseban 01" in st_name_l:
            station["latitude"] = -6.18915
            station["longitude"] = 106.85259
            station["address"] = "SD Negeri Paseban 01 Pagi, Jl. Salemba Tengah No. 28, Paseban, Senen, Jakarta Pusat 10440"
            station["region"] = "Jakarta Pusat"
        elif "paseban 07" in st_name_l:
            station["latitude"] = -6.19336
            station["longitude"] = 106.85542
            station["address"] = "SD Negeri Paseban 07 Pagi, Jl. Paseban Raya No. 4, Paseban, Senen, Jakarta Pusat 10440"
            station["region"] = "Jakarta Pusat"
        elif "sekda saefullah" in st_name_l:
            station["latitude"] = -6.136909
            station["longitude"] = 106.965655
            station["address"] = "GOR Sekda Saefullah, Jl. Sungai Kendal No. 17, Rorotan, Cilincing, Jakarta Utara 14140"
            station["region"] = "Jakarta Utara"
        elif "rawa badak" in st_name_l and ("03" in st_name_l or "selatan 03" in st_name_l):
            station["latitude"] = -6.124710
            station["longitude"] = 106.902798
            station["address"] = "SDN Rawa Badak Selatan 03 Pagi, Jl. Mayangsari I No. 58, Rawa Badak Selatan, Koja, Jakarta Utara 14230"
            station["region"] = "Jakarta Utara"
        elif "sman 75" in st_name_l or "sma 75" in st_name_l or "sma negeri 75" in st_name_l:
            station["latitude"] = -6.134575
            station["longitude"] = 106.924123
            station["address"] = "SMA Negeri 75 Jakarta, Jl. Sungai Kampar X No. 20, Semper Barat, Cilincing, Jakarta Utara 14130"
            station["region"] = "Jakarta Utara"
        elif "sukapura" in st_name_l:
            station["latitude"] = -6.146032
            station["longitude"] = 106.921632
            station["address"] = "SDN Sukapura 02 Pagi, Jl. Komp. KBN No. 2, Sukapura, Cilincing, Jakarta Utara 14140"
            station["region"] = "Jakarta Utara"

        stations.append(station)
    return stations


def huawei_energy_balance_by_station(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    by_station: dict[str, dict[str, Any]] = {}
    for call in grouped.get("energy-balance-daily") or []:
        parsed = urlparse(call.get("url") or "")
        query = parse_qs(parsed.query)
        station_dn = (query.get("stationDn") or [None])[0]
        data = response_data(call)
        if not station_dn or not isinstance(data, dict):
            continue
        station = by_station.setdefault(str(station_dn), {"energy_charts": {}})
        station["daily_power_5min"] = compact_non_null({
                "unit": "kW",
                "time_dim": "day_5min",
                "date": (query.get("dateStr") or [None])[0],
                "x": data.get("xAxis"),
                "generation_power_kw": numeric_series(data.get("productPower")),
                "use_power_kw": numeric_series(data.get("usePower")),
                "grid_power_kw": numeric_series(data.get("gridPower")),
                "buy_power_kw": numeric_series(data.get("buyPower")),
                "feed_in_power_kw": numeric_series(data.get("ongridPower") or data.get("onGridPower")),
                "charge_power_kw": numeric_series(data.get("chargePower")),
                "discharge_power_kw": numeric_series(data.get("dischargePower")),
            })

    for call_name, chart_key in (
        ("energy-balance-monthly", "daily"),
        ("energy-balance-yearly", "monthly"),
        ("energy-balance-lifetime", "yearly"),
    ):
        for call in grouped.get(call_name) or []:
            parsed = urlparse(call.get("url") or "")
            query = parse_qs(parsed.query)
            station_dn = (query.get("stationDn") or [None])[0]
            data = response_data(call)
            if not station_dn or not isinstance(data, dict):
                continue
            labels = data.get("xAxis")
            values = numeric_series(data.get("productPower"))
            if not isinstance(labels, list) or not values or len(labels) != len(values):
                continue
            if not any(value is not None for value in values):
                continue
            station = by_station.setdefault(str(station_dn), {"energy_charts": {}})
            station.setdefault("energy_charts", {})[chart_key] = {
                "labels": [str(label) for label in labels],
                "values": values,
            }
    return by_station


def huawei_kpi_by_station(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    by_station: dict[str, dict[str, Any]] = {}
    current_year = datetime.now().year
    current_month = datetime.now().month

    for call in grouped.get("home-station-kpi-chart") or []:
        payload = try_parse_json(call.get("payload_raw"))
        if not isinstance(payload, dict):
            continue
        mo_list = payload.get("moList")
        station_dn = None
        if isinstance(mo_list, list) and mo_list and isinstance(mo_list[0], dict):
            station_dn = mo_list[0].get("moString")
        if not station_dn:
            continue

        data = response_data(call)
        if not isinstance(data, dict):
            continue

        stat_dim = str(payload.get("statDim") or "")
        stat_time = str(payload.get("statTimeStr") or "")
        year = to_int(stat_time[:4]) if len(stat_time) >= 4 else None
        month = to_int(stat_time[5:7]) if len(stat_time) >= 7 else None
        station = by_station.setdefault(str(station_dn), {"revenue_charts": {}, "energy_charts": {}})

        station["currency_code"] = data.get("currency")
        station["is_price_configured"] = data.get("isPriceConfigured")
        station["has_meter"] = data.get("hasMeter")

        chart = data.get("data") if isinstance(data.get("data"), dict) else None
        revenue_chart = huawei_chart_from_axis(chart, "y2Axis")
        energy_chart = huawei_energy_chart(chart)

        if stat_dim == "4":
            if year == current_year and month == current_month:
                station["monthly_income"] = to_float(data.get("curmonthIncome") or data.get("totalIncome"))
                daily_income = huawei_current_day_value(revenue_chart, stat_time)
                if daily_income is not None:
                    station["daily_income"] = daily_income
                if revenue_chart:
                    station["revenue_charts"]["daily"] = revenue_chart
                if energy_chart:
                    station["energy_charts"]["daily"] = energy_chart
        elif stat_dim == "5":
            if year == current_year or "yearly_income" not in station:
                station["yearly_income"] = to_float(data.get("curyearIncome") or data.get("totalIncome"))
                if revenue_chart:
                    station["revenue_charts"]["monthly"] = revenue_chart
                if energy_chart:
                    station["energy_charts"]["monthly"] = energy_chart
        elif stat_dim == "6":
            cumulative = to_float(data.get("totalIncome"))
            current = station.get("cumulative_income")
            if cumulative is not None and (current is None or cumulative > current):
                station["cumulative_income"] = cumulative
                if revenue_chart:
                    station["revenue_charts"]["yearly"] = revenue_chart
                if energy_chart:
                    station["energy_charts"]["yearly"] = energy_chart

    return {key: compact_non_null(value) for key, value in by_station.items()}


def huawei_chart_from_axis(chart: dict[str, Any] | None, axis_key: str) -> dict[str, Any] | None:
    if not isinstance(chart, dict):
        return None
    labels = chart.get("xAxis")
    values = chart.get(axis_key)
    if not isinstance(labels, list) or not isinstance(values, list):
        return None
    numeric = [to_float(item) for item in values]
    if not any(value is not None for value in numeric):
        return None
    return {"labels": labels, "values": numeric}


def huawei_energy_chart(chart: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(chart, dict):
        return None
    labels = chart.get("xAxis")
    y_axis = chart.get("yAxis")
    if not isinstance(labels, list) or not isinstance(y_axis, list):
        return None
    series = y_axis if y_axis and isinstance(y_axis[0], list) else [y_axis]
    for item in series:
        if not isinstance(item, list):
            continue
        numeric = [to_float(value) for value in item]
        if any(value is not None for value in numeric):
            return {"labels": labels, "values": numeric}
    return None


def huawei_current_day_value(chart: dict[str, Any] | None, stat_time: str) -> float | None:
    if not isinstance(chart, dict):
        return None
    labels = chart.get("labels")
    values = chart.get("values")
    if not isinstance(labels, list) or not isinstance(values, list):
        return None
    today = datetime.now()
    if stat_time.startswith(f"{today.year:04d}-{today.month:02d}"):
        day_label = f"{today.day:02d}"
        if day_label in labels:
            value = values[labels.index(day_label)]
            if value is not None:
                return value
    for value in reversed(values):
        if value is not None:
            return value
    return None


def normalize_huawei_overview(grouped: dict[str, list[dict[str, Any]]], stations: list[dict[str, Any]]) -> dict[str, Any]:
    total = first_data(grouped, "total-real-kpi")
    total_data = total if isinstance(total, dict) else {}
    status = first_data(grouped, "station-status-count")
    status_data = status if isinstance(status, dict) else {}
    return compact_non_null({
        "station_count": len(stations),
        "connected_station_count": to_int(status_data.get("connected") if isinstance(status_data, dict) else None),
        "disconnected_station_count": to_int(status_data.get("disconnected") if isinstance(status_data, dict) else None),
        "trouble_station_count": to_int(status_data.get("trouble") if isinstance(status_data, dict) else None),
        "capacity_kwp": sum_numbers(stations, "capacity_kwp"),
        "inverter_power_kw": power_to_kw(total_data.get("inverterPower"), "kW") if isinstance(total_data, dict) else None,
        "current_power_kw": power_to_kw(total_data.get("currentPower"), "kW") if isinstance(total_data, dict) else None,
        "daily_energy_kwh": energy_to_kwh(total_data.get("dailyEnergy"), "kWh") if isinstance(total_data, dict) else None,
        "monthly_energy_kwh": sum_numbers(stations, "monthly_energy_kwh"),
        "yearly_energy_kwh": sum_numbers(stations, "yearly_energy_kwh"),
        "cumulative_energy_kwh": energy_to_kwh(total_data.get("cumulativeEnergy"), "kWh") if isinstance(total_data, dict) else None,
        "daily_income": to_float(total_data.get("dailyIncome")) if isinstance(total_data, dict) else None,
        "monthly_income": sum_numbers(stations, "monthly_income"),
        "yearly_income": sum_numbers(stations, "yearly_income"),
        "cumulative_income": sum_numbers(stations, "cumulative_income"),
        "currency_code": total_data.get("currency") if isinstance(total_data, dict) else None,
    })


def normalize_huawei_alarms(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    alarm = first_data(grouped, "statistic")
    data = alarm.get("data") if isinstance(alarm, dict) else alarm
    return {"raw_summary": data} if data is not None else {}


def normalize_huawei_devices(grouped: dict[str, list[dict[str, Any]]], stations: list[dict[str, Any]]) -> dict[str, Any]:
    return compact_non_null({
        "inverter_count": None,
        "station_count": len(stations),
        "has_energy_flow": bool(grouped.get("energy-flow")),
        "has_energy_balance": bool(grouped.get("energy-balance")),
    })


def normalize_huawei_charts(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    balance = first_data(grouped, "energy-balance")
    balance_data = balance if isinstance(balance, dict) else None
    chart = first_data(grouped, "home-station-kpi-chart")
    chart_data = chart if isinstance(chart, dict) else None
    return compact_non_null({
        "generation_power_series": extract_huawei_series(balance_data, "productPower"),
        "use_power_series": extract_huawei_series(balance_data, "usePower"),
        "x_axis": balance_data.get("xAxis") if isinstance(balance_data, dict) else None,
        "kpi_chart": chart_data,
    })


def normalize_kehua_stations(grouped: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}

    def merge(station_id: Any, values: dict[str, Any]) -> None:
        key = str(station_id or values.get("station_id") or values.get("name") or "")
        if not key:
            return
        current = by_id.setdefault(key, {"platform": "kehua", "station_id": key})
        for field, value in values.items():
            if value not in (None, ""):
                current[field] = value

    for call in grouped.get("listStationLike", []):
        for item in list_from_data(response_data(call)):
            merge(item.get("stationId"), {
                "station_id": str(item.get("stationId")),
                "name": item.get("stationName"),
                "area_code": item.get("areaCode"),
            })

    for call in grouped.get("listStationCardInfoByCondition", []):
        card = response_data(call)
        card_result = card.get("result") if isinstance(card, dict) else []
        for item in card_result if isinstance(card_result, list) else []:
            merge(item.get("stationId"), {
                "station_id": str(item.get("stationId")),
                "name": item.get("stationName"),
                "company_id": item.get("companyId"),
                "area_code": item.get("areaCode"),
                "status": normalize_status(item.get("stationStatus"), platform="kehua"),
                "status_raw": item.get("stationStatus"),
                "capacity_kwp": power_to_kw(item.get("capacity"), "kW"),
                "daily_energy_kwh": energy_to_kwh(item.get("dayElec"), "kWh"),
                "monthly_energy_kwh": energy_to_kwh(item.get("monthElec"), "kWh"),
                "yesterday_energy_kwh": energy_to_kwh(item.get("yesterdayElec"), "kWh"),
                "address": item.get("address"),
                "grid_type": item.get("gridType"),
                "station_type": item.get("stationTypeName") or item.get("stationType"),
                "alarm_count": to_int(item.get("alarmNumber")),
                "soc_percent": to_float(item.get("soc")),
                "battery_power_kw": power_to_kw(item.get("batteryPower"), "kW"),
                "has_meter": bool(item.get("haveMeter")),
                "has_pv": item.get("havePv") == 0 or bool(item.get("havePv")),
            })

    for call in grouped.get("listStationInfoByCondition", []):
        info = response_data(call)
        result = info.get("result") if isinstance(info, dict) else []
        for item in result if isinstance(result, list) else []:
            merge(item.get("stationId"), {
                "station_id": str(item.get("stationId")),
                "name": item.get("stationName"),
                "company_id": item.get("companyId"),
                "area_code": item.get("areaCode"),
                "status": normalize_status(item.get("stationStatus"), platform="kehua"),
                "status_raw": item.get("stationStatus"),
                "capacity_kwp": power_to_kw(item.get("capacity"), "kW"),
                "current_power_kw": power_to_kw(item.get("activePower"), "kW"),
                "daily_energy_kwh": energy_to_kwh(item.get("dayElec"), "kWh"),
                "monthly_energy_kwh": energy_to_kwh(item.get("monthElec"), "kWh"),
                "yearly_energy_kwh": energy_to_kwh(item.get("yearElec"), "kWh"),
                "full_power_hours": to_float(item.get("fullHours")),
                "station_type": item.get("stationTypeName") or item.get("stationType"),
                "soc_percent": to_float(item.get("soc")),
                "battery_power_kw": power_to_kw(item.get("batteryPower"), "kW"),
                "has_meter": bool(item.get("haveMeter")),
                "has_pv": item.get("havePv") == 0 or bool(item.get("havePv")),
            })

    for call in grouped.get("stationFullCapacityRanking", []):
        for item in list_from_data(response_data(call)):
            merge(item.get("stationId"), {
                "station_id": str(item.get("stationId")),
                "name": item.get("stationName"),
                "status": normalize_status(item.get("stationStatus"), platform="kehua"),
                "status_raw": item.get("stationStatus"),
                "avg_daily_full_hours": to_float(item.get("avgDailyFullHours")),
                "total_full_hours": to_float(item.get("totalFullHours")),
            })

    for call in grouped.get("getStationInfo", []):
        station_info = response_data(call)
        info = station_info.get("stationInfo") if isinstance(station_info, dict) else None
        if isinstance(info, dict):
            call_payload = parse_form_payload(str(call.get("payload_raw") or ""))
            target_station_id = str(call_payload.get("stationId") or info.get("stationId") or "")
            target_station_name = str(info.get("stationName") or "")
            matched_id = target_station_id if target_station_id in by_id else None
            if not matched_id:
                for sid, sdata in by_id.items():
                    if sdata.get("name") == target_station_name:
                        matched_id = sid
                        break
            key_to_merge = matched_id or target_station_id or only_station_key(by_id)
            merge(key_to_merge, {
                "name": info.get("stationName"),
                "area_code": info.get("areaCode"),
                "station_type": info.get("stationType"),
                "grid_type": info.get("gridType"),
                "capacity_kwp": power_to_kw(info.get("capacity"), "kW"),
                "latitude": to_float(info.get("latitude")),
                "longitude": to_float(info.get("longitude")),
                "address": info.get("address"),
                "account_name": info.get("accountName"),
                "email": info.get("email"),
                "company_name": info.get("companyName"),
                "timezone": info.get("timeZone") or info.get("offset"),
                "created_at": info.get("createTime"),
            })

    for call in grouped.get("getTopologyInfo", []):
        topology = response_data(call)
        if isinstance(topology, dict):
            call_payload = parse_form_payload(str(call.get("payload_raw") or ""))
            target_station_id = str(call_payload.get("stationId") or "")
            key_to_merge = target_station_id if target_station_id in by_id else only_station_key(by_id)
            if key_to_merge:
                active_power = power_to_kw(topology.get("outputPower"), topology.get("outputPowerUnit"))
                pv_power = power_to_kw(topology.get("pvPower"), topology.get("pvPowerUnit"))
                merge(key_to_merge, {
                    "current_power_kw": active_power if active_power is not None else pv_power,
                    "pv_power_kw": pv_power,
                    "grid_power_kw": power_to_kw(topology.get("gridPower"), topology.get("gridPowerUnit")),
                    "load_power_kw": power_to_kw(topology.get("loadPower"), topology.get("loadPowerUnit")),
                    "battery_power_kw": power_to_kw(topology.get("batteryPower"), topology.get("batteryPowerUnit")),
                    "output_power_kw": active_power,
                    "soc_percent": to_float(topology.get("soc")),
                    "energy_flow": compact_non_null({
                        "pv_power_kw": pv_power,
                        "grid_power_kw": power_to_kw(topology.get("gridPower"), topology.get("gridPowerUnit")),
                        "load_power_kw": power_to_kw(topology.get("loadPower"), topology.get("loadPowerUnit")),
                        "battery_power_kw": power_to_kw(topology.get("batteryPower"), topology.get("batteryPowerUnit")),
                        "diesel_generator_power_kw": power_to_kw(topology.get("dieselGeneratorPower"), topology.get("dieselGeneratorPowerUnit")),
                        "output_power_kw": active_power,
                        "soc_percent": to_float(topology.get("soc")),
                    }),
                })

    for call in grouped.get("getPowerTrendChartOfStation", []):
        chart_res = response_data(call)
        if isinstance(chart_res, dict):
            call_payload = parse_form_payload(str(call.get("payload_raw") or ""))
            target_station_id = str(call_payload.get("stationId") or "")
            key_to_merge = target_station_id if target_station_id in by_id else only_station_key(by_id)
            if key_to_merge:
                inner_data = chart_res.get("data")
                if isinstance(inner_data, dict):
                    for _, date_val in inner_data.items():
                        if isinstance(date_val, dict):
                            y_elec = date_val.get("y_data_elec") or date_val.get("y_data_grid") or []
                            if isinstance(y_elec, list):
                                valid_floats = []
                                for item_val in y_elec:
                                    try:
                                        fv = float(item_val) if item_val is not None else None
                                        if fv is not None and fv >= 0:
                                            valid_floats.append(fv)
                                    except (ValueError, TypeError):
                                        pass
                                if valid_floats:
                                    last_power = valid_floats[-1]
                                    if last_power > 0:
                                        target_st = by_id.get(key_to_merge, {})
                                        if not target_st.get("current_power_kw"):
                                            merge(key_to_merge, {
                                                "current_power_kw": round(last_power, 2),
                                                "output_power_kw": round(last_power, 2),
                                            })

    for call in grouped.get("getEnergyTrendChartOfStation", []):
        chart_res = response_data(call)
        if isinstance(chart_res, dict):
            call_payload = parse_form_payload(str(call.get("payload_raw") or ""))
            target_station_id = str(call_payload.get("stationId") or "")
            dimension = str(call_payload.get("dimension") or "")
            key_to_merge = target_station_id if target_station_id in by_id else only_station_key(by_id)
            if key_to_merge and dimension in ("2", "3", "4", "5"):
                chart_data = normalize_nested_chart(chart_res)
                if chart_data:
                    target_st = by_id.setdefault(key_to_merge, {"platform": "kehua", "station_id": key_to_merge})
                    st_charts = target_st.setdefault("charts", {})
                    trends = st_charts.setdefault("company_power_trends", {})
                    if dimension == "3":
                        existing = trends.get("year_monthly")
                        if existing and isinstance(existing.get("series"), dict):
                            existing["series"].update(chart_data.get("series", {}))
                        else:
                            trends["year_monthly"] = chart_data
                        st_charts["station_energy_trend"] = trends["year_monthly"]
                    elif dimension == "2":
                        trends["month_daily"] = chart_data
                        st_charts["station_energy_trend_month"] = chart_data
                    elif dimension == "4":
                        trends["all_yearly"] = chart_data
                        st_charts["station_energy_trend_total"] = chart_data
                    elif dimension == "5":
                        trends["week_daily"] = chart_data
                        st_charts["station_energy_trend_week"] = chart_data

    device_status = first_data(grouped, "getDeviceStatus")
    if isinstance(device_status, dict):
        normal_devices = to_int(device_status.get("normal")) or 0
        exception_devices = to_int(device_status.get("exception")) or 0
        offline_devices = to_int(device_status.get("offLine") or device_status.get("offline")) or 0
        status = None
        if normal_devices > 0:
            status = "normal"
        elif exception_devices > 0:
            status = "abnormal"
        elif offline_devices > 0:
            status = "offline"
        if status:
            merge(only_station_key(by_id), {
                "status": status,
                "status_source": "getDeviceStatus",
                "device_status_raw": device_status,
            })

    for call in grouped.get("getKeyData", []):
        kd_items = response_data(call)
        if not isinstance(kd_items, list):
            continue
        call_payload = parse_form_payload(str(call.get("payload_raw") or ""))
        sid = str(call_payload.get("stationId") or "")
        cid = str(call_payload.get("companyId") or "")
        target_id = None
        if sid and sid in by_id:
            target_id = sid
        elif cid:
            for s_id, s_data in by_id.items():
                if str(s_data.get("company_id") or "") == cid:
                    target_id = s_id
                    break
        target_id = target_id or only_station_key(by_id)
        if target_id and target_id in by_id:
            kd_map = {item["name"]: item["val"] for item in kd_items if isinstance(item, dict) and item.get("name") and isinstance(item.get("val"), dict)}
            annual = kd_map.get("Annual Gen.")
            cumulative = kd_map.get("Cumulative Generation")
            monthly = kd_map.get("Monthly Gen.")
            daily = kd_map.get("Daily Generation")
            capacity = kd_map.get("Installed capacity")
            full_load = kd_map.get("Full-Load Hours (Today)")

            updates = {}
            if annual:
                updates["yearly_energy_kwh"] = energy_to_kwh(annual.get("value"), annual.get("unit"))
            if cumulative:
                updates["cumulative_energy_kwh"] = energy_to_kwh(cumulative.get("value"), cumulative.get("unit"))
            if monthly and by_id[target_id].get("monthly_energy_kwh") is None:
                updates["monthly_energy_kwh"] = energy_to_kwh(monthly.get("value"), monthly.get("unit"))
            if daily and by_id[target_id].get("daily_energy_kwh") is None:
                updates["daily_energy_kwh"] = energy_to_kwh(daily.get("value"), daily.get("unit"))
            if capacity and by_id[target_id].get("capacity_kwp") is None:
                updates["capacity_kwp"] = power_to_kw(capacity.get("value"), capacity.get("unit"))
            if full_load and by_id[target_id].get("full_power_hours") is None:
                updates["full_power_hours"] = to_float(full_load.get("value"))
            merge(target_id, updates)

    weather = first_data(grouped, "getWeatherForecast")
    if isinstance(weather, list):
        merge(only_station_key(by_id), {"weather_forecast": [normalize_weather_item(item) for item in weather if isinstance(item, dict)]})

    # Filter out dummy/unbound stations without active devices or foreign demo stations
    by_id.pop("38722", None)
    by_id.pop("50483", None)
    by_id.pop("50639", None)

    station_coordinate_fallbacks = {
        "17483": (-6.12775, 106.858751, "Jl. Cemp. 1 No.Rt 09/03, no 69, RT.10/RW.6, Sunter Agung, Kec. Tj. Priok, Kota Jkt Utara, Daerah Khusus Ibukota Jakarta 14350, Indonesia"),
        "SDN 09 JAKUT": (-6.12775, 106.858751, "Jl. Cemp. 1 No.Rt 09/03, no 69, RT.10/RW.6, Sunter Agung, Kec. Tj. Priok, Kota Jkt Utara, Daerah Khusus Ibukota Jakarta 14350, Indonesia"),
        "17478": (-6.134519, 106.870706, "7, Jl. Nusantara Selatan No.7, RT.7/RW.15, Sunter Agung, Kec. Tj. Priok, Kota Jkt Utara, Daerah Khusus Ibukota Jakarta 14350, Indonesia"),
        "SMPN 282 JAKUT": (-6.134519, 106.870706, "7, Jl. Nusantara Selatan No.7, RT.7/RW.15, Sunter Agung, Kec. Tj. Priok, Kota Jkt Utara, Daerah Khusus Ibukota Jakarta 14350, Indonesia"),
        # Jakarta Pusat (Google Maps verified)
        "34142": (-6.16870, 106.81708, "SMP Negeri 72 Jakarta, Jl. Petojo Binatu 2 No. 2, Petojo Selatan, Gambir, Jakarta Pusat 10160"),
        "SMPN 72 Jakpus": (-6.16870, 106.81708, "SMP Negeri 72 Jakarta, Jl. Petojo Binatu 2 No. 2, Petojo Selatan, Gambir, Jakarta Pusat 10160"),
        "16721": (-6.17970, 106.81455, "SMP Negeri 94 Jakarta, Jl. Tanah Abang 5 No. 29, Petojo Selatan, Gambir, Jakarta Pusat 10160"),
        "SMPN 94 Jakpus": (-6.17970, 106.81455, "SMP Negeri 94 Jakarta, Jl. Tanah Abang 5 No. 29, Petojo Selatan, Gambir, Jakarta Pusat 10160"),
        # Jakarta Selatan
        "17409": (-6.24459, 106.768813, "SMP Negeri 31 Jakarta, Jl. Peninggaran Barat III No. 85, Kebayoran Lama Utara, Jakarta Selatan 12240"),
        "SMPN 31 Jaksel": (-6.24459, 106.768813, "SMP Negeri 31 Jakarta, Jl. Peninggaran Barat III No. 85, Kebayoran Lama Utara, Jakarta Selatan 12240"),
        "17420": (-6.290358, 106.790662, "GOR Cilandak, Jl. KH. Muhasyim VII No. 8, Cilandak Barat, Jakarta Selatan 12430"),
        "GOR Cilandak": (-6.290358, 106.790662, "GOR Cilandak, Jl. KH. Muhasyim VII No. 8, Cilandak Barat, Jakarta Selatan 12430"),
    }
    for station in by_id.values():
        sid = str(station.get("station_id") or "")
        sname = str(station.get("name") or "")
        fallback = station_coordinate_fallbacks.get(sid) or station_coordinate_fallbacks.get(sname)
        if fallback:
            lat, lon, addr = fallback
            station["latitude"] = lat
            station["longitude"] = lon
            station["address"] = addr

        # Calculate Kehua revenue automatically using tariff Rp 900/kWh when not provided by vendor
        daily_kwh = to_float(station.get("daily_energy_kwh"))
        monthly_kwh = to_float(station.get("monthly_energy_kwh"))
        yearly_kwh = to_float(station.get("yearly_energy_kwh"))
        cum_kwh = to_float(station.get("cumulative_energy_kwh"))

        if station.get("daily_income") is None and daily_kwh is not None:
            station["daily_income"] = round(daily_kwh * KEHUA_TARIFF_PER_KWH, 2)
        if station.get("monthly_income") is None and monthly_kwh is not None:
            station["monthly_income"] = round(monthly_kwh * KEHUA_TARIFF_PER_KWH, 2)
        if station.get("yearly_income") is None and yearly_kwh is not None:
            station["yearly_income"] = round(yearly_kwh * KEHUA_TARIFF_PER_KWH, 2)
        if station.get("cumulative_income") is None and cum_kwh is not None:
            station["cumulative_income"] = round(cum_kwh * KEHUA_TARIFF_PER_KWH, 2)
        station.setdefault("income_currency", "IDR")

        if station.get("inverter_power_kw") is None:
            station["inverter_power_kw"] = station.get("capacity_kwp") or 15.0
            station["inverter_model"] = "SPI15K-B"
            station["inverter_count"] = 1

    return list(by_id.values())


def normalize_kehua_overview(grouped: dict[str, list[dict[str, Any]]], stations: list[dict[str, Any]]) -> dict[str, Any]:
    power = first_data(grouped, "overviewOfPowerGeneration")
    key_data = key_data_map(first_data(grouped, "getKeyData"))
    status = first_data(grouped, "getStationStatusCount")
    status_company = first_data(grouped, "ListStationStatusCount")

    daily_energy = energy_to_kwh(get_value_unit(key_data, "Daily Generation", "value"), get_value_unit(key_data, "Daily Generation", "unit")) or sum_numbers(stations, "daily_energy_kwh")
    monthly_energy = energy_to_kwh(get_value_unit(key_data, "Monthly Gen.", "value"), get_value_unit(key_data, "Monthly Gen.", "unit")) or sum_numbers(stations, "monthly_energy_kwh")
    yearly_energy = energy_to_kwh(get_value_unit(key_data, "Annual Gen.", "value"), get_value_unit(key_data, "Annual Gen.", "unit")) or sum_numbers(stations, "yearly_energy_kwh")
    cumulative_energy = energy_to_kwh(get_value_unit(key_data, "Cumulative Generation", "value"), get_value_unit(key_data, "Cumulative Generation", "unit")) or sum_numbers(stations, "cumulative_energy_kwh")

    monthly_income = to_float(nested_value(power, ["income", "monthElectricity", "value"])) or sum_numbers(stations, "monthly_income")
    if monthly_income is None and monthly_energy is not None:
        monthly_income = round(monthly_energy * KEHUA_TARIFF_PER_KWH, 2)

    cumulative_income = to_float(nested_value(power, ["income", "totalElectricity", "value"])) or sum_numbers(stations, "cumulative_income")
    if cumulative_income is None and cumulative_energy is not None:
        cumulative_income = round(cumulative_energy * KEHUA_TARIFF_PER_KWH, 2)

    daily_income = sum_numbers(stations, "daily_income")
    if daily_income is None and daily_energy is not None:
        daily_income = round(daily_energy * KEHUA_TARIFF_PER_KWH, 2)

    yearly_income = sum_numbers(stations, "yearly_income")
    if yearly_income is None and yearly_energy is not None:
        yearly_income = round(yearly_energy * KEHUA_TARIFF_PER_KWH, 2)

    return compact_non_null({
        "station_count": to_int(get_value_unit(key_data, "Plants", "value")) or len(stations),
        "connected_station_count": to_int(status.get("normal") if isinstance(status, dict) else None),
        "disconnected_station_count": to_int(status.get("offline") if isinstance(status, dict) else None),
        "trouble_station_count": to_int(status.get("abnormal") if isinstance(status, dict) else None),
        "no_device_station_count": to_int(status.get("nodevice") if isinstance(status, dict) else None),
        "capacity_kwp": power_to_kw(nested_value(power, ["installedCapacity", "value"]), nested_value(power, ["installedCapacity", "unit"])),
        "current_power_kw": sum_numbers(stations, "current_power_kw"),
        "daily_energy_kwh": daily_energy,
        "monthly_energy_kwh": monthly_energy,
        "yearly_energy_kwh": yearly_energy,
        "cumulative_energy_kwh": cumulative_energy,
        "daily_income": daily_income,
        "monthly_income": monthly_income,
        "yearly_income": yearly_income,
        "cumulative_income": cumulative_income,
        "income_currency": "IDR",
        "inverter_count": to_int(get_value_unit(key_data, "Inverters", "value")),
        "monthly_alarm_count": to_int(get_value_unit(key_data, "Monthly Alarms", "value")),
        "today_alarm_count": to_int(get_value_unit(key_data, "Today's Alarms", "value")),
        "last_month_alarm_count": to_int(get_value_unit(key_data, "Last Month Alarms", "value")),
        "station_status_raw": status,
        "company_station_status_raw": status_company,
    })


def normalize_kehua_alarms(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    stats = statistics_map(first_data(grouped, "getStatisticsData"))
    unsolved = first_data(grouped, "getUnsolvedEventNum")
    event_list = first_data(grouped, "listUnsolvedEventLog")
    return compact_non_null({
        "unsolved_count": to_int(unsolved),
        "by_level": stats.get("alarmLevel"),
        "events": event_list.get("result") if isinstance(event_list, dict) else None,
        "event_total": event_list.get("total") if isinstance(event_list, dict) else None,
    })


def normalize_kehua_devices(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    overview = first_data(grouped, "getDeviceOverview")
    device_list = list_from_data(first_data(grouped, "listDeviceBySn"))
    card = first_data(grouped, "listDeviceCardInfoByCondition")
    card_devices = card.get("result") if isinstance(card, dict) and isinstance(card.get("result"), list) else []
    collector_card = first_data(grouped, "listCollectorIconInfoByCondition")
    collectors = collector_card.get("result") if isinstance(collector_card, dict) and isinstance(collector_card.get("result"), list) else []
    device_status = first_data(grouped, "getDeviceStatus")
    collector_status = first_data(grouped, "getCollectorSattus")
    stats = statistics_map(first_data(grouped, "getStatisticsData"))
    return compact_non_null({
        "device_count": len(card_devices) or len(device_list) or to_int(overview.get("total") if isinstance(overview, dict) else None),
        "normal_count": to_int(overview.get("normal") if isinstance(overview, dict) else None),
        "abnormal_count": to_int(overview.get("abnormal") if isinstance(overview, dict) else None),
        "online_count": to_int(overview.get("online") if isinstance(overview, dict) else None),
        "offline_count": to_int(overview.get("offline") if isinstance(overview, dict) else None),
        "station_device_status": device_status,
        "collector_status": collector_status,
        "run_state": stats.get("deviceRunState"),
        "devices": [compact_non_null({
            "device_id": item.get("deviceId"),
            "station_id": item.get("stationId"),
            "company_id": item.get("companyId"),
            "sn": item.get("sn"),
            "device_type": item.get("deviceType"),
            "device_type_name": item.get("devType"),
            "device_model": item.get("deviceModel"),
            "device_state": item.get("deviceState"),
            "collector_id": item.get("collectorId"),
            "collector_sn": item.get("collectorSn"),
            "company_name": item.get("companyName"),
        }) for item in merge_device_lists(device_list, card_devices)],
        "collectors": [compact_non_null({
            "collector_id": item.get("collectorId"),
            "station_id": item.get("stationId"),
            "name": item.get("collectorName"),
            "sn": item.get("sn"),
            "online": bool(item.get("online")),
            "signal_intensity": to_float(item.get("signalIntensity")),
            "collector_type": item.get("collectorType"),
            "collector_model": item.get("collectorModel"),
            "hardware_version": item.get("hardwareVersion"),
            "software_version": item.get("softwareVersion"),
            "communication_type": item.get("communicationType"),
        }) for item in collectors],
    })


def normalize_kehua_charts(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    daily = first_data(grouped, "getCurrentDayElecData")
    monthly = first_data(grouped, "getCurrentMonthElecData")
    power = first_data(grouped, "getCompanyPowerChartData")
    station_energy = first_data(grouped, "getEnergyTrendChartOfStation")
    station_power = first_data(grouped, "getPowerTrendChartOfStation")
    return compact_non_null({
        "daily_generation": normalize_xy_chart(daily, "kWh"),
        "monthly_generation": normalize_xy_chart(monthly, "kWh"),
        "company_power": power.get("data") if isinstance(power, dict) else power,
        "company_power_trends": normalize_kehua_company_power_charts(grouped.get("getCompanyPowerChartData") or []),
        "station_energy_trend": normalize_nested_chart(station_energy),
        "station_power_trend": normalize_nested_chart(station_power),
    })


def normalize_kehua_company_power_charts(calls: list[dict[str, Any]]) -> dict[str, Any] | None:
    by_dimension: dict[str, Any] = {}
    labels = {"2": "month_daily", "3": "year_monthly", "4": "all_yearly", "5": "week_daily"}
    for call in calls:
        payload = parse_form_payload(call.get("payload_raw") or "")
        dimension = str(payload.get("dimension") or "unknown")
        data = response_data(call)
        chart = normalize_nested_chart(data)
        if chart:
            by_dimension[labels.get(dimension, dimension)] = chart
    return by_dimension or None


def normalize_sma_stations(grouped: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    plant_items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for call in grouped.get("navigation", []):
        nav_body = response_data(call)
        cand_list = nav_body if isinstance(nav_body, list) else ([nav_body] if isinstance(nav_body, dict) else [])
        for item in cand_list:
            if not isinstance(item, dict) or item.get("componentType") == "PlantGroup":
                continue
            cid = str(item.get("componentId") or item.get("plantId") or "")
            if cid and cid not in seen_ids:
                seen_ids.add(cid)
                plant_items.append(item)

    for call in grouped.get("plants", []):
        plants_body = response_data(call)
        cand_list = plants_body if isinstance(plants_body, list) else ([plants_body] if isinstance(plants_body, dict) else [])
        for item in cand_list:
            if not isinstance(item, dict) or item.get("componentType") == "PlantGroup":
                continue
            cid = str(item.get("componentId") or item.get("plantId") or "")
            if cid and cid not in seen_ids:
                seen_ids.add(cid)
                plant_items.append(item)

    stations: list[dict[str, Any]] = []

    for item in plant_items:
        component_id = str(item.get("componentId") or item.get("plantId") or "")
        if not component_id:
            continue

        plant_name = str(item.get("name") or f"SMA Plant {component_id}")

        detail_call = grouped.get(f"sma_plant_detail_{component_id}") or []
        detail = response_data(detail_call[0]) if detail_call else {}
        if isinstance(detail, list) and detail:
            detail = detail[0]
        if isinstance(detail, dict):
            plant_name = str(detail.get("name") or item.get("name") or plant_name)
            capacity_kwp = to_float(detail.get("peakPower")) or to_float(detail.get("nominalPower")) or to_float(item.get("peakPower"))
        else:
            capacity_kwp = to_float(item.get("peakPower")) if isinstance(item, dict) else None

        power_call = grouped.get(f"sma_plant_power_{component_id}") or grouped.get("gauge_power") or []
        power_body = response_data(power_call[0]) if power_call else {}
        power_val = to_float(power_body.get("value")) if isinstance(power_body, dict) else None
        max_val = to_float(power_body.get("max")) if isinstance(power_body, dict) else None
        # SMA gauge power is in Watts (W), convert to kW
        current_power_kw = round(power_val / 1000.0, 3) if power_val is not None else 0.0
        capacity_from_max = round(max_val / 1000.0, 2) if max_val else None
        capacity_kwp = capacity_kwp or capacity_from_max or 15.0
        if capacity_kwp and capacity_kwp > 500:
            capacity_kwp = round(capacity_kwp / 1000.0, 2)

        # 1. Hourly curve for today (24 hours)
        today_call = grouped.get(f"sma_plant_today_hourly_{component_id}") or []
        today_body = response_data(today_call[0]) if today_call else []
        today_hourly_labels = [f"{h:02d}:00" for h in range(24)]
        today_hourly_values = [0.0] * 24
        if isinstance(today_body, list):
            for channel in today_body:
                if isinstance(channel, dict) and "values" in channel:
                    for v in channel.get("values", []):
                        if isinstance(v, dict) and v.get("value") is not None:
                            val = to_float(v["value"])
                            time_str = str(v.get("time") or "")
                            try:
                                t_utc = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
                                t_jkt = t_utc.astimezone(timezone(timedelta(hours=7)))
                                if 0 <= t_jkt.hour < 24:
                                    today_hourly_values[t_jkt.hour] = round((val or 0.0) / 1000.0, 3)
                            except Exception:
                                pass

        # 2. Daily energy points across the current year (Jan 1 to now)
        energy_call = grouped.get(f"sma_plant_daily_energy_{component_id}") or grouped.get("daily_energy") or []
        energy_body = response_data(energy_call[0]) if energy_call else []
        daily_kwh = 0.0
        month_daily_labels = []
        month_daily_values = []
        daily_by_month: dict[str, dict[str, list]] = {}
        year_monthly_labels = [f"{m:02d}" for m in range(1, 13)]
        year_monthly_values = [0.0] * 12

        jakarta_now = datetime.now(timezone(timedelta(hours=7)))
        current_month_prefix = f"{jakarta_now.year:04d}-{jakarta_now.month:02d}"

        if isinstance(energy_body, list):
            for channel in energy_body:
                if isinstance(channel, dict) and "values" in channel:
                    for v in channel.get("values", []):
                        if isinstance(v, dict) and v.get("value") is not None:
                            val = to_float(v["value"])
                            if val is not None:
                                kwh = round(val / 1000.0, 4)
                                time_str = str(v.get("time") or "")
                                date_part = time_str[:10]
                                if len(date_part) == 10:
                                    try:
                                        m_idx = int(date_part[5:7]) - 1
                                        if 0 <= m_idx < 12:
                                            year_monthly_values[m_idx] = round(year_monthly_values[m_idx] + kwh, 2)
                                    except Exception:
                                        pass
                                    m_prefix = date_part[:7]
                                    day_str = date_part[8:10]
                                    if m_prefix not in daily_by_month:
                                        daily_by_month[m_prefix] = {"labels": [], "values": []}
                                    daily_by_month[m_prefix]["labels"].append(day_str)
                                    daily_by_month[m_prefix]["values"].append(round(kwh, 3))
                                    if date_part.startswith(current_month_prefix):
                                        month_daily_labels.append(day_str)
                                        month_daily_values.append(kwh)
                                        daily_kwh = kwh

        if sum(today_hourly_values) > 0:
            daily_kwh = round(sum(today_hourly_values), 3)

        monthly_kwh = round(sum(month_daily_values), 2) if month_daily_values else daily_kwh

        # Cumulative / Lifetime Energy Counter
        lifetime_call = grouped.get(f"sma_plant_lifetime_energy_{component_id}") or []
        lifetime_body = response_data(lifetime_call[0]) if lifetime_call else []
        total_lifetime_wh = None
        if isinstance(lifetime_body, list):
            for channel in lifetime_body:
                if isinstance(channel, dict) and "values" in channel:
                    for v in channel.get("values", []):
                        if isinstance(v, dict) and v.get("value") is not None:
                            total_lifetime_wh = to_float(v["value"])

        # Year Start Energy Counter (for 2026 YTD)
        year_start_call = grouped.get(f"sma_plant_year_start_energy_{component_id}") or []
        year_start_body = response_data(year_start_call[0]) if year_start_call else []
        year_start_wh = None
        if isinstance(year_start_body, list):
            for channel in year_start_body:
                if isinstance(channel, dict) and "values" in channel:
                    for v in channel.get("values", []):
                        if isinstance(v, dict) and v.get("value") is not None:
                            year_start_wh = to_float(v["value"])
                            break

        if total_lifetime_wh is not None:
            cumulative_energy_kwh = round(total_lifetime_wh / 1000.0, 2)
        else:
            cumulative_energy_kwh = monthly_kwh

        if total_lifetime_wh is not None and year_start_wh is not None and total_lifetime_wh >= year_start_wh:
            yearly_energy_kwh = round((total_lifetime_wh - year_start_wh) / 1000.0, 2)
        else:
            yearly_energy_kwh = monthly_kwh

        # Historical years energy history across all operating years (for Lifetime yearly chart)
        hist_years_call = grouped.get(f"sma_plant_historical_years_{component_id}") or []
        hist_years_body = response_data(hist_years_call[0]) if hist_years_call else []
        yearly_by_year: dict[str, float] = {}
        if isinstance(hist_years_body, list):
            for channel in hist_years_body:
                if isinstance(channel, dict) and "values" in channel:
                    for v in channel.get("values", []):
                        if isinstance(v, dict) and v.get("value") is not None:
                            val = to_float(v["value"])
                            time_str = str(v.get("time") or "")
                            try:
                                t_utc = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
                                t_jkt = t_utc.astimezone(timezone(timedelta(hours=7)))
                                y_str = str((t_jkt - timedelta(minutes=1)).year)
                                yearly_by_year[y_str] = round((val or 0.0) / 1000.0, 2)
                            except Exception:
                                pass

        # Monthly history across all years (resolution: OneMonth)
        monthly_hist_call = grouped.get(f"sma_plant_monthly_history_{component_id}") or []
        monthly_hist_body = response_data(monthly_hist_call[0]) if monthly_hist_call else []
        monthly_by_year: dict[str, list[float]] = {}
        if isinstance(monthly_hist_body, list):
            for channel in monthly_hist_body:
                if isinstance(channel, dict) and "values" in channel:
                    for v in channel.get("values", []):
                        if isinstance(v, dict) and v.get("value") is not None:
                            val = to_float(v["value"])
                            if val is not None:
                                kwh = round(val / 1000.0, 2)
                                time_str = str(v.get("time") or "")
                                if len(time_str) >= 7:
                                    y_str = time_str[:4]
                                    try:
                                        m_idx = int(time_str[5:7]) - 1
                                        if 0 <= m_idx < 12:
                                            if y_str not in monthly_by_year:
                                                monthly_by_year[y_str] = [0.0] * 12
                                            monthly_by_year[y_str][m_idx] = kwh
                                    except Exception:
                                        pass

        curr_year_str = str(jakarta_now.year)
        if curr_year_str in monthly_by_year:
            year_monthly_values = monthly_by_year[curr_year_str]
        yearly_by_year[curr_year_str] = yearly_energy_kwh

        if yearly_by_year:
            min_year = min(int(y) for y in yearly_by_year.keys())
            max_year = int(curr_year_str)
            yearly_chart_labels = [str(y) for y in range(min_year, max_year + 1)]
            yearly_chart_values = [yearly_by_year.get(str(y), 0.0) for y in range(min_year, max_year + 1)]
        else:
            yearly_chart_labels = [curr_year_str]
            yearly_chart_values = [yearly_energy_kwh]

        daily_income = round(daily_kwh * SMA_TARIFF_PER_KWH, 2)
        monthly_income = round(monthly_kwh * SMA_TARIFF_PER_KWH, 2)
        yearly_income = round(yearly_energy_kwh * SMA_TARIFF_PER_KWH, 2)
        cumulative_income = round(cumulative_energy_kwh * SMA_TARIFF_PER_KWH, 2)

        weather_call = grouped.get(f"sma_plant_weather_{component_id}") or grouped.get("weather") or []
        weather_body = response_data(weather_call[0]) if weather_call else {}

        lat = to_float(detail.get("latitude"))
        lng = to_float(detail.get("longitude"))
        street = f"{detail.get('street') or ''} {detail.get('streetNo') or ''}".strip()
        city_parts = [p for p in [street, detail.get('city'), detail.get('federalState'), detail.get('zipCode')] if p]
        address = ", ".join(city_parts) if city_parts else None

        sma_coordinate_fallbacks = {
            # Jakarta Timur (SMPN 51, SMPN 213, SMPN 255, SMAN 105)
            "2565257": (-6.23900, 106.90316, "SMP Negeri 51 Jakarta, Jl. Kejaksaan / Cendana Raya No. 1, Pondok Bambu, Duren Sawit, Jakarta Timur 13430"),
            "JAKTIM SMPN 51": (-6.23900, 106.90316, "SMP Negeri 51 Jakarta, Jl. Kejaksaan / Cendana Raya No. 1, Pondok Bambu, Duren Sawit, Jakarta Timur 13430"),
            "2565474": (-6.22337, 106.92937, "SMP Negeri 213 Jakarta, Jl. Delima V / Malaka I No. 2, Malaka Sari, Duren Sawit, Jakarta Timur 13450"),
            "JAKTIM SMPN 213": (-6.22337, 106.92937, "SMP Negeri 213 Jakarta, Jl. Delima V / Malaka I No. 2, Malaka Sari, Duren Sawit, Jakarta Timur 13450"),
            "2565583": (-6.22290, 106.92270, "SMP Negeri 255 Jakarta, Jl. Raden Inten II No. 9 / Madrasah II, Duren Sawit, Jakarta Timur 13440"),
            "JAKTIM SMPN 255": (-6.22290, 106.92270, "SMP Negeri 255 Jakarta, Jl. Raden Inten II No. 9 / Madrasah II, Duren Sawit, Jakarta Timur 13440"),
            "2628410": (-6.33175, 106.88423, "SMA Negeri 105 Jakarta, Jl. Usman No. 40, Kelapa Dua Wetan, Ciracas, Jakarta Timur 13730"),
            "JAKTIM SMAN 105": (-6.33175, 106.88423, "SMA Negeri 105 Jakarta, Jl. Usman No. 40, Kelapa Dua Wetan, Ciracas, Jakarta Timur 13730"),

            # Jakarta Barat (SMPN 190, SMPN 54, SMPN 88, SMPN 201)
            "2576004": (-6.10850, 106.70265, "SMP Negeri 190 Jakarta, Jl. Prepedan Raya, Kamal, Kalideres, Jakarta Barat 11810"),
            "SMPN 190 JAKBAR": (-6.10850, 106.70265, "SMP Negeri 190 Jakarta, Jl. Prepedan Raya, Kamal, Kalideres, Jakarta Barat 11810"),
            "2620780": (-6.14239, 106.81054, "SMP Negeri 54 Jakarta, Jl. Blandongan No. 37, Tambora, Glodok, Jakarta Barat 11120"),
            "SMPN 54 JAKBAR": (-6.14239, 106.81054, "SMP Negeri 54 Jakarta, Jl. Blandongan No. 37, Tambora, Glodok, Jakarta Barat 11120"),
            "2768874": (-6.19304, 106.79509, "SMP Negeri 88 Jakarta, Jl. Anggrek Garuda Blok G4 No. 40, Kemanggisan, Palmerah, Jakarta Barat 11480"),
            "SMPN 88 JAKBAR": (-6.19304, 106.79509, "SMP Negeri 88 Jakarta, Jl. Anggrek Garuda Blok G4 No. 40, Kemanggisan, Palmerah, Jakarta Barat 11480"),
            "3538228": (-6.12711, 106.73428, "SMP Negeri 201 Jakarta, Jl. Kayu Besar Dalam No. 2, Cengkareng Timur, Jakarta Barat 11730"),
            "SMPN 201 JAKBAR": (-6.12711, 106.73428, "SMP Negeri 201 Jakarta, Jl. Kayu Besar Dalam No. 2, Cengkareng Timur, Jakarta Barat 11730"),

            # Jakarta Pusat (DPE DKI Jakarta, SMPN 2, SMKN 2, SMKN 38, SMAN 27)
            "784146": (-6.18047, 106.81104, "Dinas Perindustrian dan Energi DKI Jakarta, Jl. Taman Jatibaru No. 1, Gambir, Jakarta Pusat 10150"),
            "DPE DKI Jakarta": (-6.18047, 106.81104, "Dinas Perindustrian dan Energi DKI Jakarta, Jl. Taman Jatibaru No. 1, Gambir, Jakarta Pusat 10150"),
            "2576179": (-6.18156, 106.86147, "SMP Negeri 2 Jakarta, Jl. Mardani Raya No. 2, Johar Baru, Jakarta Pusat 10560"),
            "SMPN 2 JKT PUSAT": (-6.18156, 106.86147, "SMP Negeri 2 Jakarta, Jl. Mardani Raya No. 2, Johar Baru, Jakarta Pusat 10560"),
            "2583874": (-6.17816, 106.83434, "SMK Negeri 2 Jakarta, Jl. Batu No. 3, Gambir, Jakarta Pusat 10110"),
            "SMKN 2 JKT PUSAT": (-6.17816, 106.83434, "SMK Negeri 2 Jakarta, Jl. Batu No. 3, Gambir, Jakarta Pusat 10110"),
            "2585338": (-6.20392, 106.81771, "SMK Negeri 38 Jakarta, Jl. Karet Pasar Baru Timur II No. 17, Tanah Abang, Jakarta Pusat 10250"),
            "SMKN 38 JKT PUSAT": (-6.20392, 106.81771, "SMK Negeri 38 Jakarta, Jl. Karet Pasar Baru Timur II No. 17, Tanah Abang, Jakarta Pusat 10250"),
            "2606153": (-6.18203, 106.86136, "SMA Negeri 27 Jakarta, Jl. Mardani Raya No. 39, Johar Baru, Jakarta Pusat 10560"),
            "SMAN 27 JKT PUSAT": (-6.18203, 106.86136, "SMA Negeri 27 Jakarta, Jl. Mardani Raya No. 39, Johar Baru, Jakarta Pusat 10560"),

            # Jakarta Selatan (SMKN 63, SMPN 267, SMPN 182, SMAN 8 - Google Maps verified)
            "2562591": (-6.35251, 106.79630, "SMK Negeri 63 Jakarta, Jl. Aselih No. 47, Cipedak, Jagakarsa, Jakarta Selatan 12630"),
            "JAKSEL SMKN 63": (-6.35251, 106.79630, "SMK Negeri 63 Jakarta, Jl. Aselih No. 47, Cipedak, Jagakarsa, Jakarta Selatan 12630"),
            "2571313": (-6.23199, 106.76443, "SMP Negeri 267 Jakarta, Jl. Swadarma Raya / Mairin No. 3, Ulujami, Pesanggrahan, Jakarta Selatan 12250"),
            "JAKSEL SMPN 267": (-6.23199, 106.76443, "SMP Negeri 267 Jakarta, Jl. Swadarma Raya / Mairin No. 3, Ulujami, Pesanggrahan, Jakarta Selatan 12250"),
            "2574654": (-6.25935, 106.84724, "SMP Negeri 182 Jakarta, Jl. Kalibata Timur I No. 1, Kalibata, Pancoran, Jakarta Selatan 12740"),
            "JAKSEL SMPN 182": (-6.25935, 106.84724, "SMP Negeri 182 Jakarta, Jl. Kalibata Timur I No. 1, Kalibata, Pancoran, Jakarta Selatan 12740"),
            "2604251": (-6.21811, 106.85954, "SMA Negeri 8 Jakarta, Jl. Taman Bukit Duri No. 14, Bukit Duri, Tebet, Jakarta Selatan 12840"),
            "JAKSEL SMAN 8": (-6.21811, 106.85954, "SMA Negeri 8 Jakarta, Jl. Taman Bukit Duri No. 14, Bukit Duri, Tebet, Jakarta Selatan 12840"),
        }
        fallback = sma_coordinate_fallbacks.get(component_id) or sma_coordinate_fallbacks.get(plant_name)
        if fallback:
            f_lat, f_lng, f_addr = fallback
            lat = f_lat
            lng = f_lng
            address = f_addr

        now = now_stamp()
        today_label = now[:8]
        month_label = now[:6]
        year_label = now[:4]

        station_record = {
            "station_id": component_id,
            "name": plant_name,
            "platform": "sma",
            "source": "sma",
            "status": "normal" if current_power_kw > 0 else "offline",
            "capacity_kwp": capacity_kwp,
            "current_power_kw": current_power_kw,
            "daily_energy_kwh": daily_kwh,
            "monthly_energy_kwh": monthly_kwh,
            "yearly_energy_kwh": yearly_energy_kwh,
            "cumulative_energy_kwh": cumulative_energy_kwh,
            "daily_income": daily_income,
            "monthly_income": monthly_income,
            "yearly_income": yearly_income,
            "cumulative_income": cumulative_income,
            "income_currency": "IDR",
            "grid_status": "online" if current_power_kw > 0 else "offline",
            "latitude": lat,
            "longitude": lng,
            "address": address,
            "updated_at": now_iso(),
            "energy_charts": {
                "today": {
                    "labels": today_hourly_labels,
                    "values": today_hourly_values,
                },
                "hourly": {
                    "labels": today_hourly_labels,
                    "values": today_hourly_values,
                },
                "daily": {
                    "labels": month_daily_labels if month_daily_labels else [today_label],
                    "values": month_daily_values if month_daily_values else [daily_kwh],
                },
                "monthly": {
                    "labels": year_monthly_labels,
                    "values": year_monthly_values,
                },
                "monthly_by_year": monthly_by_year,
                "daily_by_month": daily_by_month,
                "yearly": {
                    "labels": yearly_chart_labels,
                    "values": yearly_chart_values,
                },
                "lifetime": {
                    "labels": yearly_chart_labels,
                    "values": yearly_chart_values,
                },
            },
            "revenue_charts": {
                "today": {
                    "labels": today_hourly_labels,
                    "values": [round(val * SMA_TARIFF_PER_KWH, 2) for val in today_hourly_values],
                },
                "hourly": {
                    "labels": today_hourly_labels,
                    "values": [round(val * SMA_TARIFF_PER_KWH, 2) for val in today_hourly_values],
                },
                "daily": {
                    "labels": month_daily_labels if month_daily_labels else [today_label],
                    "values": [round(val * SMA_TARIFF_PER_KWH, 2) for val in (month_daily_values if month_daily_values else [daily_kwh])],
                },
                "monthly": {
                    "labels": year_monthly_labels,
                    "values": [round(val * SMA_TARIFF_PER_KWH, 2) for val in year_monthly_values],
                },
                "monthly_by_year": {y: [round(v * SMA_TARIFF_PER_KWH, 2) for v in vals] for y, vals in monthly_by_year.items()},
                "yearly": {
                    "labels": yearly_chart_labels,
                    "values": [round(val * SMA_TARIFF_PER_KWH, 2) for val in yearly_chart_values],
                },
                "lifetime": {
                    "labels": yearly_chart_labels,
                    "values": [round(val * SMA_TARIFF_PER_KWH, 2) for val in yearly_chart_values],
                },
            },
            "charts": {
                "company_power_trends": {
                    "year_monthly": {
                        "unit": "kWh",
                        "series": {
                            y_key: {
                                "x": [str(m) for m in range(1, 13)],
                                "y": m_vals,
                            }
                            for y_key, m_vals in monthly_by_year.items()
                        },
                    },
                    "month_daily": {
                        "unit": "kWh",
                        "series": {
                            m_key: {
                                "x": d_obj["labels"],
                                "y": d_obj["values"],
                            }
                            for m_key, d_obj in daily_by_month.items()
                        },
                    },
                    "all_yearly": {
                        "unit": "kWh",
                        "series": {
                            "all": {
                                "x": yearly_chart_labels,
                                "y": yearly_chart_values,
                            }
                        },
                    },
                },
            },
        }
        if isinstance(weather_body, dict) and weather_body:
            station_record["weather"] = weather_body

        stations.append(station_record)

    return stations


def normalize_sma_overview(grouped: dict[str, list[dict[str, Any]]], stations: list[dict[str, Any]]) -> dict[str, Any]:
    station_count = len(stations)
    connected = sum(1 for s in stations if s.get("grid_status") == "online")
    disconnected = sum(1 for s in stations if s.get("grid_status") != "online")
    total_capacity = sum(to_float(s.get("capacity_kwp")) or 0.0 for s in stations)
    total_power = sum(to_float(s.get("current_power_kw")) or 0.0 for s in stations)
    daily_energy = sum(to_float(s.get("daily_energy_kwh")) or 0.0 for s in stations)
    monthly_energy = sum(to_float(s.get("monthly_energy_kwh")) or 0.0 for s in stations)
    yearly_energy = sum(to_float(s.get("yearly_energy_kwh")) or 0.0 for s in stations)
    total_energy = sum(to_float(s.get("cumulative_energy_kwh")) or 0.0 for s in stations)
    daily_income = sum(to_float(s.get("daily_income")) or 0.0 for s in stations)
    monthly_income = sum(to_float(s.get("monthly_income")) or 0.0 for s in stations)
    yearly_income = sum(to_float(s.get("yearly_income")) or 0.0 for s in stations)
    total_income = sum(to_float(s.get("cumulative_income")) or 0.0 for s in stations)

    return compact_non_null({
        "station_count": station_count,
        "connected_station_count": connected,
        "disconnected_station_count": disconnected,
        "trouble_station_count": 0,
        "no_device_station_count": 0,
        "capacity_kwp": round(total_capacity, 2),
        "current_power_kw": round(total_power, 2),
        "daily_energy_kwh": round(daily_energy, 4),
        "monthly_energy_kwh": round(monthly_energy, 4),
        "yearly_energy_kwh": round(yearly_energy, 4),
        "cumulative_energy_kwh": round(total_energy, 4),
        "daily_income": round(daily_income, 2),
        "monthly_income": round(monthly_income, 2),
        "yearly_income": round(yearly_income, 2),
        "cumulative_income": round(total_income, 2),
        "income_currency": "IDR",
        "inverter_count": station_count,
    })


def normalize_sma_alarms(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    return {"events": [], "count": 0}


def normalize_sma_charts(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    return {}


def normalize_sma_devices(grouped: dict[str, list[dict[str, Any]]], stations: list[dict[str, Any]]) -> dict[str, Any]:
    devices = []
    for s in stations:
        devices.append({
            "device_id": f"sma_inv_{s.get('station_id')}",
            "name": f"SMA Inverter {s.get('name')}",
            "station_id": s.get("station_id"),
            "station_name": s.get("name"),
            "status": s.get("grid_status"),
            "power_kw": s.get("current_power_kw"),
            "capacity_kwp": s.get("capacity_kwp"),
            "type": "inverter",
            "vendor": "sma",
        })
    return {
        "devices": devices,
        "device_count": len(devices),
        "online_count": sum(1 for d in devices if d.get("status") == "online"),
        "offline_count": sum(1 for d in devices if d.get("status") != "online"),
    }


def normalize_status(value: Any, platform: str | None = None) -> str | None:
    text = str(value).lower() if value is not None else ""
    if platform == "kehua":
        mapping = {"1": "normal", "2": "abnormal", "3": "vacant", "4": "offline"}
        return mapping.get(str(value), str(value) if value is not None else None)
    if text in {"connected", "normal", "online"}:
        return "normal"
    if text in {"disconnected", "offline"}:
        return "offline"
    if text in {"trouble", "abnormal", "fault"}:
        return "abnormal"
    return str(value) if value is not None else None


def list_from_data(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def key_data_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, list):
        return {}
    return {str(item.get("name")): item.get("val") for item in value if isinstance(item, dict) and item.get("name")}


def statistics_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, list):
        return {}
    return {str(item.get("code") or item.get("name")): item.get("data") for item in value if isinstance(item, dict)}


def get_value_unit(mapping: dict[str, Any], key: str, field: str) -> Any:
    value = mapping.get(key)
    if isinstance(value, dict):
        return value.get(field)
    return None


def nested_value(value: Any, keys: list[str]) -> Any:
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def sum_numbers(items: list[dict[str, Any]], field: str) -> float | None:
    numbers = [to_float(item.get(field)) for item in items]
    numbers = [number for number in numbers if number is not None]
    return round(sum(numbers), 4) if numbers else None


def numeric_series(value: Any) -> list[float | None] | None:
    if not isinstance(value, list):
        return None
    return [to_float(item) for item in value]


def extract_huawei_series(data: Any, key: str) -> list[float] | None:
    if not isinstance(data, dict) or not isinstance(data.get(key), list):
        return None
    values = []
    for item in data[key]:
        number = to_float(item)
        values.append(number if number is not None else 0.0)
    return values


def normalize_xy_chart(data: Any, default_unit: str) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        return None
    x_values = data.get("x_data") or data.get("xAxis")
    y_values = data.get("y_data") or data.get("yAxis")
    unit = data.get("unit") or default_unit
    if not isinstance(y_values, list):
        return compact_non_null({"unit": unit, "x": x_values, "y": y_values})
    return compact_non_null({
        "unit": unit,
        "x": x_values,
        "y": [to_float(item) for item in y_values],
    })


def only_station_key(stations_by_key: dict[str, dict[str, Any]]) -> str | None:
    if len(stations_by_key) == 1:
        return next(iter(stations_by_key))
    return None


def station_key_data_map(calls: list[dict[str, Any]]) -> dict[str, Any]:
    for call in calls:
        data = response_data(call)
        mapping = key_data_map(data)
        if "Installed capacity" in mapping or "Full-Load Hours (Today)" in mapping:
            return mapping
    return {}


def normalize_weather_item(item: dict[str, Any]) -> dict[str, Any]:
    return compact_non_null({
        "date": item.get("time"),
        "day_weather": item.get("dayWeather"),
        "night_weather": item.get("nightWeather"),
        "temp_max_c": to_float(item.get("tempMax")),
        "temp_min_c": to_float(item.get("tempMin")),
        "day_wind": item.get("dayWind"),
        "night_wind": item.get("nightWind"),
        "day_weather_code": item.get("dayWeatherCode"),
    })


def merge_device_lists(simple: list[dict[str, Any]], detailed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for item in simple + detailed:
        key = str(item.get("deviceId") or item.get("sn") or len(by_key))
        current = by_key.setdefault(key, {})
        for field, value in item.items():
            if value not in (None, ""):
                current[field] = value
    return list(by_key.values())


def normalize_nested_chart(data: Any) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        return None
    inner = data.get("data") if isinstance(data.get("data"), dict) else data
    if isinstance(inner, dict) and isinstance(inner.get("data"), dict):
        inner = inner["data"]
    unit = None
    unit_data = inner.get("unit") if isinstance(inner, dict) else None
    if isinstance(unit_data, dict) and isinstance(unit_data.get("unit"), list) and unit_data.get("unit"):
        unit = unit_data["unit"][0]
    series = {}
    for key, value in inner.items() if isinstance(inner, dict) else []:
        if key == "unit" or not isinstance(value, dict):
            continue
        series_key = str(key) if key else "all"
        series[series_key] = {
            "x": value.get("x_data"),
            "y": {
                child_key: [to_float(item) for item in child_value]
                for child_key, child_value in value.items()
                if child_key.startswith("y_") and isinstance(child_value, list)
            },
        }
    return compact_non_null({"unit": unit, "series": series})


def extract_station_summary(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stations_by_key: dict[str, dict[str, Any]] = {}

    for call in calls:
        if call.get("name") not in {"station-list", "listStationInfoByCondition", "listStationLike"}:
            continue
        body = call.get("response_body")
        if not isinstance(body, dict):
            continue
        data = body.get("data")
        items = None
        if isinstance(data, dict):
            items = data.get("list") or data.get("result") or data.get("data") or data.get("records")
        elif isinstance(data, list):
            items = data
        if not isinstance(items, list):
            continue

        for item in items:
            if not isinstance(item, dict):
                continue
            dn = item.get("dn") or item.get("stationDn") or item.get("plantDn") or item.get("stationCode")
            station_id = item.get("stationId")
            key = str(dn or station_id or item.get("stationName") or item.get("name"))
            if not key:
                continue
            record = {
                "dn": dn,
                "dn_id": item.get("dnId"),
                "station_id": station_id,
                "company_id": item.get("companyId"),
                "name": item.get("name") or item.get("stationName") or item.get("plantName"),
                "status": item.get("plantStatus") or item.get("stationStatus") or item.get("status"),
                "status_text": item.get("plantStatus") or item.get("stationStatusName"),
                "current_power": item.get("currentPower") or item.get("activePower"),
                "installed_capacity": item.get("installedCapacity") or item.get("capacity"),
                "daily_energy": item.get("dailyEnergy") or item.get("dayElec"),
                "month_energy": item.get("monthEnergy") or item.get("monthElec"),
                "year_energy": item.get("yearEnergy"),
                "cumulative_energy": item.get("cumulativeEnergy"),
                "inverter_power": item.get("inverterPower"),
                "full_hours": item.get("fullHours"),
                "station_type": item.get("stationTypeName") or item.get("stationType"),
                "latitude": item.get("latitude"),
                "longitude": item.get("longitude"),
                "address": item.get("plantAddress"),
                "timezone": item.get("timeZone"),
                "raw": item,
            }
            existing = stations_by_key.get(key)
            if not existing:
                stations_by_key[key] = record
                continue
            for field, value in record.items():
                if field == "raw":
                    existing_raw = existing.get("raw") if isinstance(existing.get("raw"), dict) else {}
                    existing["raw"] = {**existing_raw, **item}
                elif value not in (None, ""):
                    existing[field] = value

    return list(stations_by_key.values())


def extract_site_metrics(calls: list[dict[str, Any]]) -> dict[str, Any]:
    metrics: dict[str, Any] = {}

    for call in calls:
        body = call.get("response_body")
        if not isinstance(body, dict):
            continue
        name = call.get("name")
        data = body.get("data")

        if name in {"total-real-kpi", "station-status-count", "station-real-kpi"}:
            metrics[name] = data

        if name == "overviewOfPowerGeneration" and isinstance(data, dict):
            metrics["power_generation"] = data

        if name == "getKeyData" and isinstance(data, list):
            metrics["key_data"] = {
                str(item.get("name")): item.get("val")
                for item in data
                if isinstance(item, dict) and item.get("name")
            }

        if name == "getStatisticsData" and isinstance(data, list):
            metrics["statistics"] = {
                str(item.get("code") or item.get("name")): item.get("data")
                for item in data
                if isinstance(item, dict) and (item.get("code") or item.get("name"))
            }

        if name in {"getStationStatusCount", "ListStationStatusCount", "getUnsolvedEventNum"}:
            metrics[name] = data

    return metrics


def scrape_site(
    site_name: str,
    site: dict[str, Any],
    blueprint_file: Path,
    cookies_file: Path | None,
    timeout: int,
    delay: float,
    account: dict[str, Any] | None = None,
) -> dict[str, Any]:
    blueprint = load_json(blueprint_file)
    session, session_meta = prepare_session(site_name, site, cookies_file, timeout, credentials=account)
    if site_name == "kehua" and account:
        account = discover_kehua_account_identifiers(session, account, timeout)
    calls = []
    for call in blueprint.get("calls", []):
        prepared_call = prepare_kehua_account_call(call, account) if site_name == "kehua" and account else call
        result = replay_call(session, prepared_call, timeout)
        if site_name == "kehua" and result.get("auth_error") and account and account.get("username") and account.get("password"):
            re_meta = kehua_password_login(session, site, account["username"], account["password"], timeout)
            if re_meta.get("success"):
                result = replay_call(session, prepared_call, timeout)
        if site_name == "huawei" and result.get("auth_error") and account and account.get("username") and account.get("password"):
            re_meta = huawei_password_login(session, site, account["username"], account["password"], timeout)
            if re_meta.get("success"):
                result = replay_call(session, prepared_call, timeout)
        if site_name == "sma" and result.get("auth_error") and account and account.get("username") and account.get("password"):
            re_meta = sma_password_login(session, site, account["username"], account["password"], timeout)
            if re_meta.get("success"):
                result = replay_call(session, prepared_call, timeout)
        calls.append(result)
        if site_name == "huawei" and call.get("name") == "station-list" and result.get("success"):
            for extra_call in huawei_energy_balance_calls(site, result):
                extra_result = replay_call(session, extra_call, timeout)
                calls.append(extra_result)
                if delay:
                    time.sleep(delay)
        if site_name == "kehua" and call.get("name") == "listStationCardInfoByCondition" and result.get("success"):
            for extra_call in kehua_extra_station_calls(site, result):
                extra_result = replay_call(session, extra_call, timeout)
                calls.append(extra_result)
                if delay:
                    time.sleep(delay)
        if site_name == "sma" and call.get("name") in ("navigation", "plants") and result.get("success"):
            for extra_call in sma_extra_plant_calls(site, result):
                extra_result = replay_call(session, extra_call, timeout)
                calls.append(extra_result)
                if delay:
                    time.sleep(delay)
        if delay:
            time.sleep(delay)

    return {
        "site": site_name,
        "scraped_at": now_iso(),
        "blueprint": str(blueprint_file),
        "session": session_meta,
        "account": account,
        "summary": {
            "total": len(calls),
            "success_count": sum(1 for item in calls if item["success"]),
            "failed_count": sum(1 for item in calls if not item["success"]),
            "auth_error_count": sum(1 for item in calls if item.get("auth_error")),
        },
        "calls": calls,
    }


def combine_account_results(site_name: str, account_results: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "site": site_name,
        "scraped_at": max(str(item.get("scraped_at") or "") for item in account_results),
        "blueprint": account_results[0].get("blueprint"),
        "session": {"accounts": [item.get("session", {}) for item in account_results]},
        "summary": {
            field: sum(int(item.get("summary", {}).get(field) or 0) for item in account_results)
            for field in ("total", "success_count", "failed_count", "auth_error_count")
        },
        "calls": [call for item in account_results for call in item.get("calls", [])],
        "account_results": account_results,
    }


def parse_site_args(values: list[str]) -> dict[str, dict[str, Path | None]]:
    parsed: dict[str, dict[str, Path | None]] = {}
    for value in values:
        site_name, sep, remainder = value.partition(":")
        if not sep or not remainder:
            raise SystemExit(f"Invalid --site value: {value}. Use name:blueprint.json[:Cookies.json]")

        bp_str, has_cookie, ck_str = remainder.partition(".json:")
        blueprint_file = Path(bp_str + ".json") if has_cookie else Path(remainder)
        cookies_file = Path(ck_str) if has_cookie and ck_str else None

        parsed[site_name] = {"blueprint": blueprint_file, "cookies": cookies_file}
    return parsed


def run_once(args: argparse.Namespace) -> dict[str, Any]:
    sites_config = load_json(Path(args.sites_config))
    requested_sites = parse_site_args(args.site)
    run_id = now_stamp()
    out_dir = Path(args.out_dir)
    results = []

    def scrape_single_site(site_name: str, paths: dict[str, Path | None]) -> dict[str, Any]:
        if site_name not in sites_config:
            raise SystemExit(f"Unknown site {site_name}. Available: {', '.join(sites_config)}")
        cookies_file = Path(paths["cookies"]) if paths["cookies"] else None
        if site_name == "kehua":
            accounts = load_kehua_accounts_from_env()
        elif site_name == "huawei":
            accounts = load_huawei_accounts_from_env()
        elif site_name == "sma":
            accounts = load_sma_accounts_from_env()
        else:
            accounts = []
        if accounts:
            with ThreadPoolExecutor(max_workers=max(1, len(accounts))) as acc_exec:
                acc_futures = [
                    acc_exec.submit(
                        scrape_site,
                        site_name,
                        sites_config[site_name],
                        Path(paths["blueprint"]),
                        cookies_file if account.get("use_shared_cookies") else None,
                        args.timeout,
                        args.delay,
                        account=account,
                    )
                    for account in accounts
                ]
                account_results = [f.result() for f in acc_futures]
            return combine_account_results(site_name, account_results)
        else:
            return scrape_site(
                site_name,
                sites_config[site_name],
                Path(paths["blueprint"]),
                cookies_file,
                args.timeout,
                args.delay,
            )

    # Scrape all platforms concurrently in parallel for maximum speed
    with ThreadPoolExecutor(max_workers=max(1, len(requested_sites))) as site_exec:
        futures = {
            site_exec.submit(scrape_single_site, site_name, paths): site_name
            for site_name, paths in requested_sites.items()
        }
        site_results_map = {futures[f]: f.result() for f in futures}

    results = [site_results_map[s_name] for s_name in requested_sites.keys() if s_name in site_results_map]

    for result in results:
        site_name = result["site"]
        site_latest = out_dir / "latest" / site_name
        site_history = out_dir / "history" / run_id / site_name
        write_json(site_latest / "all_responses.json", result)
        write_json(site_history / "all_responses.json", result)
        write_json(site_latest / "summary.json", result["summary"])
        write_json(site_history / "summary.json", result["summary"])
        for call in result["calls"]:
            filename = f"{call['id']}_{safe_filename(call['name'])}.json"
            write_json(site_latest / "by_endpoint" / filename, call)
            write_json(site_history / "by_endpoint" / filename, call)
            if args.jsonl:
                append_jsonl(out_dir / "history" / f"{site_name}.jsonl", {"run_id": run_id, **call})

    combined = {"run_id": run_id, "scraped_at": now_iso(), "sites": results}
    current = normalize_latest(results)
    write_json(out_dir / "latest" / "all_sites.json", combined)
    write_json(out_dir / "latest" / "current.json", current)
    write_json(out_dir / "history" / run_id / "all_sites.json", combined)
    write_json(out_dir / "history" / run_id / "current.json", current)
    return {**combined, "current": current}


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape Huawei and Kehua monitoring APIs from reusable blueprints.")
    parser.add_argument("--sites-config", default="sites.json")
    parser.add_argument(
        "--site",
        action="append",
        required=True,
        help="Site binding: name:blueprint.json[:Cookies.json]. Repeat for huawei and kehua.",
    )
    parser.add_argument("--out-dir", default="monitoring_output")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--delay", type=float, default=0.3)
    parser.add_argument("--watch", type=int, default=0, help="Repeat every N seconds. 0 means run once.")
    parser.add_argument("--jsonl", action="store_true")
    args = parser.parse_args()

    while True:
        result = run_once(args)
        for site in result["sites"]:
            summary = site["summary"]
            print(
                f"[{result['run_id']}] {site['site']}: "
                f"success={summary['success_count']} failed={summary['failed_count']} auth_errors={summary['auth_error_count']}"
            )
        print(f"latest: {Path(args.out_dir) / 'latest' / 'current.json'}")
        if not args.watch:
            break
        time.sleep(args.watch)


if __name__ == "__main__":
    main()
