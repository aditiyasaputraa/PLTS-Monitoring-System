import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:fl_chart/fl_chart.dart';
import '../models/monitoring_data.dart';

class StationDetailSheet extends StatelessWidget {
  final StationModel station;

  const StationDetailSheet({super.key, required this.station});

  String _formatRupiah(double amount) {
    final format = NumberFormat.currency(locale: 'id_ID', symbol: 'Rp ', decimalDigits: 0);
    return format.format(amount);
  }

  @override
  Widget build(BuildContext context) {
    final numFormat = NumberFormat("#,##0.0", "en_US");
    final isHuawei = station.platform.toLowerCase() == 'huawei';

    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF0F172A), // Slate 900
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Container(
            margin: const EdgeInsets.only(top: 12, bottom: 8),
            width: 44,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white24,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Title & Badge
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: isHuawei
                                        ? Colors.purple.withValues(alpha: 0.2)
                                        : Colors.teal.withValues(alpha: 0.2),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    isHuawei ? "HUAWEI FUSIONSOLAR" : "KEHUA TECH",
                                    style: TextStyle(
                                      color: isHuawei ? Colors.purpleAccent : Colors.tealAccent,
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                                if (station.isKehua) ...[
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF10B981).withValues(alpha: 0.15),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: const Text(
                                      "Rp 900/kWh",
                                      style: TextStyle(
                                        color: Color(0xFF34D399),
                                        fontSize: 10,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ),
                                ],
                                const SizedBox(width: 8),
                                Text(
                                  "ID: ${station.id}",
                                  style: const TextStyle(color: Colors.white38, fontSize: 11),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              station.name,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, color: Colors.white60),
                        onPressed: () => Navigator.pop(context),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Address box
                  if (station.address.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.white10),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.location_on, color: Color(0xFF38BDF8), size: 18),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  station.address,
                                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                                ),
                                if (station.latitude != null && station.longitude != null)
                                  Text(
                                    "GPS: ${station.latitude!.toStringAsFixed(5)}, ${station.longitude!.toStringAsFixed(5)}",
                                    style: const TextStyle(color: Colors.white38, fontSize: 11),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 16),
                  // Solar Power Curve Chart
                  const Text(
                    "Kurva Daya Realtime (Hari Ini)",
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 10),
                  _buildCurveChart(station),
                  const SizedBox(height: 20),
                  // Grid of Statistics
                  const Text(
                    "Statistik Produksi & Pendapatan",
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildStatsGrid(station, numFormat),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCurveChart(StationModel station) {
    List<FlSpot> spots = [];

    if (station.curvePowers.isNotEmpty) {
      for (int i = 0; i < station.curvePowers.length; i++) {
        spots.add(FlSpot(i.toDouble(), station.curvePowers[i]));
      }
    } else {
      // Mock daily curve if no live curve in payload
      spots = const [
        FlSpot(0, 0.0),
        FlSpot(1, 0.0),
        FlSpot(2, 0.2),
        FlSpot(3, 1.8),
        FlSpot(4, 4.5),
        FlSpot(5, 7.2),
        FlSpot(6, 9.8),
        FlSpot(7, 8.5),
        FlSpot(8, 6.2),
        FlSpot(9, 3.4),
        FlSpot(10, 0.8),
        FlSpot(11, 0.0),
      ];
    }

    return Container(
      height: 180,
      padding: const EdgeInsets.fromLTRB(12, 16, 16, 10),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: LineChart(
        LineChartData(
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            getDrawingHorizontalLine: (value) => const FlLine(color: Colors.white10, strokeWidth: 1),
          ),
          titlesData: const FlTitlesData(
            topTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 22,
                interval: 3,
              ),
            ),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 32,
              ),
            ),
          ),
          borderData: FlBorderData(show: false),
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              color: const Color(0xFFF59E0B), // Solar Amber
              barWidth: 3,
              isStrokeCapRound: true,
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(
                show: true,
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    const Color(0xFFF59E0B).withValues(alpha: 0.35),
                    const Color(0xFFF59E0B).withValues(alpha: 0.0),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatsGrid(StationModel station, NumberFormat numFormat) {
    return Column(
      children: [
        Row(
          children: [
            _buildStatItem("Kapasitas Panel", "${numFormat.format(station.capacityKwp)} kWp", const Color(0xFF38BDF8)),
            const SizedBox(width: 12),
            _buildStatItem("Kapasitas Inverter", "${numFormat.format(station.inverterPowerKw)} kW", const Color(0xFFA78BFA)),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            _buildStatItem("Daya Realtime", "${numFormat.format(station.currentPowerKw)} kW", const Color(0xFFF59E0B)),
            const SizedBox(width: 12),
            _buildStatItem("Produksi Hari Ini", "${numFormat.format(station.dailyEnergyKwh)} kWh", const Color(0xFF10B981)),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            _buildStatItem("Produksi Bulan Ini", "${numFormat.format(station.monthlyEnergyKwh)} kWh", const Color(0xFF34D399)),
            const SizedBox(width: 12),
            _buildStatItem("Produksi Tahun Ini", "${numFormat.format(station.yearlyEnergyKwh)} kWh", const Color(0xFF6EE7B7)),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            _buildStatItem(
              "Total Kumulatif",
              station.cumulativeEnergyKwh >= 1000
                  ? "${(station.cumulativeEnergyKwh / 1000).toStringAsFixed(2)} MWh"
                  : "${numFormat.format(station.cumulativeEnergyKwh)} kWh",
              const Color(0xFF818CF8),
            ),
            const SizedBox(width: 12),
            _buildStatItem(
              "Total Nilai Penghematan",
              _formatRupiah(station.cumulativeIncome),
              const Color(0xFF34D399),
              subtitle: station.isKehua ? "Tarif otomatis: Rp 900/kWh" : null,
            ),
          ],
        ),
        if (station.dailyIncome > 0 || station.monthlyIncome > 0) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              _buildStatItem(
                "Hemat Hari Ini",
                _formatRupiah(station.dailyIncome),
                const Color(0xFF10B981),
                subtitle: station.isKehua ? "Rp 900/kWh" : null,
              ),
              const SizedBox(width: 12),
              _buildStatItem(
                "Hemat Bulan Ini",
                _formatRupiah(station.monthlyIncome),
                const Color(0xFF34D399),
                subtitle: station.isKehua ? "Rp 900/kWh" : null,
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildStatItem(String label, String value, Color color, {String? subtitle}) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: TextStyle(
                color: color,
                fontSize: 15,
                fontWeight: FontWeight.bold,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  color: Color(0xFF34D399),
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
