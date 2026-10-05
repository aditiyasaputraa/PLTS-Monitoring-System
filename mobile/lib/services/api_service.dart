import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/monitoring_data.dart';
import 'auth_service.dart';

class MonitoringResult {
  final List<StationModel> stations;
  final FleetSummary? summary;
  final bool isFallback;
  final bool hasError;
  final String? message;

  MonitoringResult({
    required this.stations,
    this.summary,
    this.isFallback = false,
    this.hasError = false,
    this.message,
  });
}

class ApiService {
  static String get defaultBaseUrl {
    if (kIsWeb) return "http://localhost:8000";
    try {
      if (Platform.isWindows || Platform.isMacOS || Platform.isLinux) {
        return "http://127.0.0.1:8000";
      }
      if (Platform.isAndroid) {
        return "http://10.0.2.2:8000";
      }
    } catch (_) {}
    return "http://127.0.0.1:8000";
  }

  static const String cloudflareTunnelUrl = "https://shaped-twin-forth-said.trycloudflare.com";
  static String activeBaseUrl = cloudflareTunnelUrl;

  static MonitoringResult _parsePayload(Map<String, dynamic> data) {
    final List<StationModel> stations = [];

    final bySite = data['by_site'];
    if (bySite is Map<String, dynamic>) {
      bySite.forEach((siteKey, siteVal) {
        if (siteVal is Map<String, dynamic>) {
          final list = siteVal['stations'];
          if (list is List) {
            for (var item in list) {
              if (item is Map<String, dynamic>) {
                stations.add(StationModel.fromJson(item, siteKey));
              }
            }
          }
        }
      });
    }

    DateTime? updated;
    if (data['updated_at'] != null) {
      updated = DateTime.tryParse(data['updated_at'].toString());
    }

    final summary = FleetSummary.fromStations(stations, updated ?? DateTime.now());
    return MonitoringResult(
      stations: stations,
      summary: summary,
      isFallback: false,
      hasError: false,
    );
  }

  /// Mengambil data pemantauan real-time langsung dari Supabase Cloud (24/7 dari GitHub Actions)
  /// dengan fallback ke server backend lokal jika diperlukan.
  static Future<MonitoringResult> fetchMonitoringData({String? customUrl}) async {
    final token = AuthService.currentUser?.token;
    final isRealJwt = token != null && token.startsWith('eyJ');
    final sbAuth = isRealJwt ? 'Bearer $token' : 'Bearer ${AuthService.supabaseAnonKey}';

    String lastError = "";

    // 1. Prioritas Utama: Ambil langsung dari Supabase Cloud (24/7 Serverless dari GitHub Actions)
    try {
      final supabaseUri = Uri.parse('${AuthService.supabaseUrl}/rest/v1/monitoring_current?select=payload&limit=1');
      final supabaseRes = await http.get(
        supabaseUri,
        headers: {
          'apikey': AuthService.supabaseAnonKey,
          'Authorization': sbAuth,
          'Accept': 'application/json',
        },
      ).timeout(const Duration(seconds: 4));

      if (supabaseRes.statusCode == 200) {
        final decoded = json.decode(utf8.decode(supabaseRes.bodyBytes));
        if (decoded is List && decoded.isNotEmpty) {
          final first = decoded.first;
          if (first is Map<String, dynamic> && first['payload'] is Map<String, dynamic>) {
            return _parsePayload(Map<String, dynamic>.from(first['payload']));
          }
        }
      } else {
        lastError = "Supabase Cloud: status ${supabaseRes.statusCode}";
      }
    } catch (e) {
      lastError = "Koneksi Supabase Cloud: $e";
    }

    // 2. Fallback: Coba koneksi ke backend lokal atau tunnel jika ada
    final primary = (customUrl ?? activeBaseUrl).replaceAll(RegExp(r'/+$'), '');
    final Set<String> candidatesSet = {
      primary,
      cloudflareTunnelUrl,
      if (kIsWeb) ...[
        'http://localhost:8000',
        'http://127.0.0.1:8000',
      ] else ...[
        'http://10.20.107.91:8000',
        'http://10.0.2.2:8000',
        'http://127.0.0.1:8000',
      ],
    };
    final candidates = candidatesSet.where((u) => u.isNotEmpty).toList();
    final authHeader = 'Bearer ${token != null && token.isNotEmpty ? token : "local_mobile"}';

    for (final url in candidates) {
      try {
        final uri = Uri.parse('$url/api/current?ts=${DateTime.now().millisecondsSinceEpoch}');
        final response = await http.get(
          uri,
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
          },
        ).timeout(const Duration(seconds: 3));

        if (response.statusCode == 200) {
          activeBaseUrl = url;
          final Map<String, dynamic> data = json.decode(utf8.decode(response.bodyBytes));
          return _parsePayload(data);
        }
      } catch (_) {}
    }

    return MonitoringResult(
      stations: [],
      summary: null,
      hasError: true,
      message: "Gagal memuat data monitoring dari Supabase Cloud maupun server lokal. ($lastError)",
    );
  }
}
