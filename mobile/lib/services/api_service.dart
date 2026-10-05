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

  static String activeBaseUrl = defaultBaseUrl;

  /// Mengambil data pemantauan real-time dari backend FastAPI.
  static Future<MonitoringResult> fetchMonitoringData({String? customUrl}) async {
    final primary = (customUrl ?? activeBaseUrl).replaceAll(RegExp(r'/+$'), '');
    
    final List<String> candidates;
    if (kIsWeb) {
      candidates = [
        primary,
        if (primary != 'http://localhost:8000') 'http://localhost:8000',
        if (primary != 'http://127.0.0.1:8000') 'http://127.0.0.1:8000',
      ];
    } else {
      candidates = [
        primary,
        if (primary != 'http://127.0.0.1:8000') 'http://127.0.0.1:8000',
        if (primary != 'http://10.0.2.2:8000') 'http://10.0.2.2:8000',
        if (primary != 'http://10.20.107.91:8000') 'http://10.20.107.91:8000',
      ];
    }

    final token = AuthService.currentUser?.token;
    final authHeader = 'Bearer ${token != null && token.isNotEmpty ? token : "local_mobile"}';

    String lastError = "";

    for (final url in candidates) {
      try {
        final uri = Uri.parse('$url/api/current?ts=${DateTime.now().millisecondsSinceEpoch}');
        final response = await http.get(
          uri,
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
          },
        ).timeout(const Duration(seconds: 5));

        if (response.statusCode == 200) {
          activeBaseUrl = url;
          final Map<String, dynamic> data = json.decode(utf8.decode(response.bodyBytes));
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
        } else if (response.statusCode == 401) {
          return MonitoringResult(
            stations: [],
            summary: null,
            hasError: true,
            message: "Sesi login tidak valid atau telah berakhir. Silakan keluar dan login kembali.",
          );
        } else {
          lastError = "Server $url merespons status ${response.statusCode}";
        }
      } catch (e) {
        lastError = "Koneksi ke $url: ${e.toString()}";
      }
    }

    return MonitoringResult(
      stations: [],
      summary: null,
      hasError: true,
      message: "Gagal terhubung ke backend API ($activeBaseUrl). Pastikan backend FastAPI aktif. ($lastError)",
    );
  }
}
