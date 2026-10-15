import unittest
from unittest.mock import MagicMock, patch

from scrape_monitoring import (
    sma_generate_pkce,
    sma_parse_form_action,
    sma_password_login,
    sma_check_auth,
    normalize_sma_stations,
    normalize_sma_overview,
    normalize_sma_devices,
)


class SmaAuthAndNormalizationTests(unittest.TestCase):
    def test_sma_generate_pkce_returns_verifier_and_challenge(self):
        verifier, challenge = sma_generate_pkce()
        self.assertTrue(len(verifier) >= 43)
        self.assertTrue(len(challenge) >= 43)
        self.assertNotEqual(verifier, challenge)

    def test_sma_parse_form_action(self):
        html = '<html><body><form action="/auth/realms/SMA/login-actions/authenticate?session_code=123&amp;execution=456" method="post"></form></body></html>'
        action = sma_parse_form_action(html)
        self.assertEqual(
            action,
            "/auth/realms/SMA/login-actions/authenticate?session_code=123&execution=456",
        )

    def test_sma_password_login_successful_flow(self):
        session = MagicMock()
        site = {
            "auth_base": "https://login.sma.energy/auth/realms/SMA",
            "client_id": "SPpbeOS",
            "redirect_uri": "https://ennexos.sunnyportal.com/dashboard/initialize",
        }

        # Mock GET auth page
        res_auth_page = MagicMock()
        res_auth_page.ok = True
        res_auth_page.text = '<form action="/auth/login-action"></form>'

        # Mock POST login form (302 redirect with Location)
        res_login_post = MagicMock()
        res_login_post.headers = {
            "Location": "https://ennexos.sunnyportal.com/dashboard/initialize?code=mock_auth_code_123&state=abc"
        }

        # Mock POST token exchange
        res_token = MagicMock()
        res_token.ok = True
        res_token.json.return_value = {
            "access_token": "mock_jwt_access_token_xyz",
            "token_type": "Bearer",
            "expires_in": 3600,
        }

        session.get.return_value = res_auth_page
        session.post.side_effect = [res_login_post, res_token]
        session.headers = {}

        result = sma_password_login(session, site, "user@example.com", "secretpass", timeout=10)

        self.assertTrue(result["success"])
        self.assertEqual(session.headers.get("Authorization"), "Bearer mock_jwt_access_token_xyz")

    def test_normalize_sma_stations_and_overview(self):
        grouped = {
            "navigation": [{
                "success": True,
                "response_body": [
                    {
                        "componentType": "Plant",
                        "componentId": "plant_101",
                        "name": "SMA Rooftop Plant",
                    }
                ],
            }],
            "sma_plant_detail_plant_101": [{
                "success": True,
                "response_body": {
                    "name": "SMA Rooftop Plant",
                    "peakPower": 25.5,
                },
            }],
            "sma_plant_power_plant_101": [{
                "success": True,
                "response_body": {
                    "value": 14800,
                },
            }],
            "sma_plant_daily_energy_plant_101": [{
                "success": True,
                "response_body": [
                    {
                        "channelId": "Measurement.Metering.TotWhOut.Pv",
                        "values": [
                            {"time": "2026-10-15T00:00:00Z", "value": 78500}
                        ],
                    }
                ],
            }],
        }

        stations = normalize_sma_stations(grouped)
        self.assertEqual(len(stations), 1)
        st = stations[0]
        self.assertEqual(st["station_id"], "plant_101")
        self.assertEqual(st["name"], "SMA Rooftop Plant")
        self.assertEqual(st["platform"], "sma")
        self.assertEqual(st["source"], "sma")
        self.assertEqual(st["grid_status"], "online")
        self.assertEqual(st["capacity_kwp"], 25.5)
        self.assertEqual(st["current_power_kw"], 14.8)
        self.assertEqual(st["daily_energy_kwh"], 78.5)
        self.assertEqual(st["income_currency"], "IDR")
        self.assertEqual(st["daily_income"], round(78.5 * 900.0, 2))

        overview = normalize_sma_overview(grouped, stations)
        self.assertEqual(overview["station_count"], 1)
        self.assertEqual(overview["connected_station_count"], 1)
        self.assertEqual(overview["capacity_kwp"], 25.5)
        self.assertEqual(overview["current_power_kw"], 14.8)
        self.assertEqual(overview["daily_energy_kwh"], 78.5)

        devices = normalize_sma_devices(grouped, stations)
        self.assertEqual(devices["device_count"], 1)
        self.assertEqual(devices["devices"][0]["vendor"], "sma")


if __name__ == "__main__":
    unittest.main()
