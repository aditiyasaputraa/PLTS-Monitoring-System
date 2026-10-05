import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/monitoring_data.dart';

class SummaryCard extends StatelessWidget {
  final FleetSummary summary;
  final bool isFallback;

  const SummaryCard({
    super.key,
    required this.summary,
    this.isFallback = false,
  });

  String _formatCurrency(double amount) {
    final formatter = NumberFormat.currency(
      locale: 'id_ID',
      symbol: 'Rp ',
      decimalDigits: 0,
    );
    if (amount >= 1000000000) {
      return "Rp ${(amount / 1000000000).toStringAsFixed(1)} Miliar";
    } else if (amount >= 1000000) {
      return "Rp ${(amount / 1000000).toStringAsFixed(1)} Juta";
    }
    return formatter.format(amount);
  }

  @override
  Widget build(BuildContext context) {
    final currencyFormatter = NumberFormat("#,##0.0", "en_US");

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF0F172A), // Slate 900
            Color(0xFF1E293B), // Slate 800
            Color(0xFF0D9488), // Teal 600
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0D9488).withValues(alpha: 0.25),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.12),
          width: 1,
        ),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFF10B981).withValues(alpha: 0.2),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.solar_power_rounded,
                      color: Color(0xFF10B981),
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "RINGKASAN ARMADA",
                        style: TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1.2,
                        ),
                      ),
                      Text(
                        "PLTS Jakarta Utara",
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: isFallback
                      ? Colors.amber.withValues(alpha: 0.2)
                      : const Color(0xFF10B981).withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: isFallback
                        ? Colors.amber.withValues(alpha: 0.5)
                        : const Color(0xFF10B981).withValues(alpha: 0.5),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: isFallback ? Colors.amber : const Color(0xFF10B981),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      isFallback ? "Cache" : "Live Realtime",
                      style: TextStyle(
                        color: isFallback ? Colors.amber : const Color(0xFF10B981),
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          const Divider(color: Colors.white12, height: 1),
          const SizedBox(height: 16),
          // 2x2 Grid Metrics
          Row(
            children: [
              Expanded(
                child: _buildMetricTile(
                  icon: Icons.flash_on_rounded,
                  iconColor: const Color(0xFFF59E0B),
                  label: "Daya Realtime",
                  value: currencyFormatter.format(summary.totalCurrentPowerKw),
                  unit: "kW",
                ),
              ),
              Container(width: 1, height: 44, color: Colors.white12),
              Expanded(
                child: _buildMetricTile(
                  icon: Icons.speed_rounded,
                  iconColor: const Color(0xFF38BDF8),
                  label: "Total Kapasitas",
                  value: currencyFormatter.format(summary.totalCapacityKwp),
                  unit: "kWp",
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _buildMetricTile(
                  icon: Icons.calendar_today_rounded,
                  iconColor: const Color(0xFFA78BFA),
                  label: "Energi Bulan Ini",
                  value: summary.totalMonthlyEnergyKwh >= 1000
                      ? (summary.totalMonthlyEnergyKwh / 1000).toStringAsFixed(2)
                      : currencyFormatter.format(summary.totalMonthlyEnergyKwh),
                  unit: summary.totalMonthlyEnergyKwh >= 1000 ? "MWh" : "kWh",
                ),
              ),
              Container(width: 1, height: 44, color: Colors.white12),
              Expanded(
                child: _buildMetricTile(
                  icon: Icons.account_balance_wallet_rounded,
                  iconColor: const Color(0xFF34D399),
                  label: "Estimasi Hemat",
                  value: _formatCurrency(summary.totalCumulativeIncome),
                  unit: "",
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Bottom Status Badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.25),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.check_circle_outline, color: Color(0xFF10B981), size: 16),
                    const SizedBox(width: 6),
                    Text(
                      "${summary.totalStations} Stasiun Aktif (${summary.onlineStations} Online)",
                      style: const TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ],
                ),
                Text(
                  summary.lastUpdated != null
                      ? DateFormat('HH:mm').format(summary.lastUpdated!.toLocal())
                      : "-",
                  style: const TextStyle(color: Colors.white38, fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMetricTile({
    required IconData icon,
    required Color iconColor,
    required String label,
    required String value,
    required String unit,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: iconColor, size: 15),
              const SizedBox(width: 5),
              Text(
                label,
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                value,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              if (unit.isNotEmpty) ...[
                const SizedBox(width: 4),
                Text(
                  unit,
                  style: const TextStyle(color: Colors.white60, fontSize: 12),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
