<?php
/**
 * REST API Sederhana untuk Monitoring PLTS (MySQL Lokal Laragon)
 * Melayani permintaan data lokasi & metrik dari frontend.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$db_host = '127.0.0.1';
$db_port = 3306;
$db_name = 'db_monitoring_plts';
$db_user = 'root';
$db_pass = '';

try {
    $pdo = new PDO("mysql:host={$db_host};port={$db_port};dbname={$db_name};charset=utf8mb4", $db_user, $db_pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Gagal terkoneksi ke database MySQL Laragon: ' . $e->getMessage()]);
    exit;
}

$action = $_GET['action'] ?? 'get_locations';

switch ($action) {
    case 'get_locations':
        try {
            $stmt = $pdo->query("SELECT * FROM plts_locations ORDER BY id ASC");
            $locations = $stmt->fetchAll();
            
            // Format numbers to proper floats
            foreach ($locations as &$loc) {
                $loc['capacity_kwp'] = (float)$loc['capacity_kwp'];
                $loc['current_power_kw'] = (float)$loc['current_power_kw'];
                $loc['daily_energy_kwh'] = (float)$loc['daily_energy_kwh'];
                $loc['monthly_energy_kwh'] = (float)$loc['monthly_energy_kwh'];
                $loc['yearly_energy_kwh'] = (float)$loc['yearly_energy_kwh'];
                $loc['cumulative_energy_kwh'] = (float)$loc['cumulative_energy_kwh'];
                $loc['daily_income'] = (float)$loc['daily_income'];
                $loc['monthly_income'] = (float)$loc['monthly_income'];
                $loc['yearly_income'] = (float)$loc['yearly_income'];
                $loc['cumulative_income'] = (float)$loc['cumulative_income'];
                $loc['latitude'] = $loc['latitude'] !== null ? (float)$loc['latitude'] : null;
                $loc['longitude'] = $loc['longitude'] !== null ? (float)$loc['longitude'] : null;
                $loc['is_custom'] = (bool)$loc['is_custom'];
                $loc['source'] = $loc['platform'] === 'kehua' ? 'Kehua Tech' : 'Huawei FusionSolar';
            }
            
            echo json_encode(['status' => 'success', 'data' => $locations]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => $e->getMessage()]);
        }
        break;

    case 'add_location':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => 'Method not allowed']);
            exit;
        }

        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input || empty($input['name'])) {
            http_response_code(400);
            echo json_encode(['error' => 'Field nama lokasi wajib diisi']);
            exit;
        }

        try {
            $uid = $input['uid'] ?? ('custom-' . time());
            $name = trim($input['name']);
            $platform = $input['platform'] ?? 'huawei';
            $station_id = trim($input['station_id'] ?? ('PLTS_' . substr(time(), -6)));
            $capacity_kwp = (float)($input['capacity_kwp'] ?? 0);
            $current_power_kw = (float)($input['current_power_kw'] ?? 0);
            $status = $input['status'] ?? 'normal';
            $daily_energy_kwh = (float)($input['daily_energy_kwh'] ?? ($current_power_kw * 4.2));
            $monthly_energy_kwh = (float)($input['monthly_energy_kwh'] ?? ($daily_energy_kwh * 30));
            $yearly_energy_kwh = (float)($input['yearly_energy_kwh'] ?? ($monthly_energy_kwh * 12));
            $cumulative_energy_kwh = (float)($input['cumulative_energy_kwh'] ?? ($monthly_energy_kwh * 36));
            $daily_income = (float)($input['daily_income'] ?? ($daily_energy_kwh * 1444));
            $monthly_income = (float)($input['monthly_income'] ?? ($monthly_energy_kwh * 1444));
            $yearly_income = (float)($input['yearly_income'] ?? ($yearly_energy_kwh * 1444));
            $cumulative_income = (float)($input['cumulative_income'] ?? ($cumulative_energy_kwh * 1444));
            $address = trim($input['address'] ?? '');
            $latitude = isset($input['lat']) && $input['lat'] !== '' ? (float)$input['lat'] : null;
            $longitude = isset($input['lng']) && $input['lng'] !== '' ? (float)$input['lng'] : null;
            $is_custom = 1;

            $sql = "INSERT INTO plts_locations 
                (uid, name, platform, station_id, capacity_kwp, current_power_kw, status, daily_energy_kwh, monthly_energy_kwh, yearly_energy_kwh, cumulative_energy_kwh, daily_income, monthly_income, yearly_income, cumulative_income, address, latitude, longitude, is_custom)
                VALUES 
                (:uid, :name, :platform, :station_id, :capacity_kwp, :current_power_kw, :status, :daily_energy_kwh, :monthly_energy_kwh, :yearly_energy_kwh, :cumulative_energy_kwh, :daily_income, :monthly_income, :yearly_income, :cumulative_income, :address, :latitude, :longitude, :is_custom)";

            $stmt = $pdo->prepare($sql);
            $stmt->execute([
                ':uid' => $uid,
                ':name' => $name,
                ':platform' => $platform,
                ':station_id' => $station_id,
                ':capacity_kwp' => $capacity_kwp,
                ':current_power_kw' => $current_power_kw,
                ':status' => $status,
                ':daily_energy_kwh' => $daily_energy_kwh,
                ':monthly_energy_kwh' => $monthly_energy_kwh,
                ':yearly_energy_kwh' => $yearly_energy_kwh,
                ':cumulative_energy_kwh' => $cumulative_energy_kwh,
                ':daily_income' => $daily_income,
                ':monthly_income' => $monthly_income,
                ':yearly_income' => $yearly_income,
                ':cumulative_income' => $cumulative_income,
                ':address' => $address,
                ':latitude' => $latitude,
                ':longitude' => $longitude,
                ':is_custom' => $is_custom,
            ]);

            echo json_encode([
                'status' => 'success',
                'message' => 'Lokasi PLTS baru berhasil disimpan ke database MySQL lokal',
                'uid' => $uid
            ]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => $e->getMessage()]);
        }
        break;

    case 'delete_location':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => 'Method not allowed']);
            exit;
        }

        $input = json_decode(file_get_contents('php://input'), true);
        $uid = $input['uid'] ?? '';

        if (!$uid) {
            http_response_code(400);
            echo json_encode(['error' => 'UID wajib disertakan']);
            exit;
        }

        try {
            $stmt = $pdo->prepare("DELETE FROM plts_locations WHERE uid = :uid");
            $stmt->execute([':uid' => $uid]);
            echo json_encode(['status' => 'success', 'message' => 'Lokasi berhasil dihapus dari database']);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => $e->getMessage()]);
        }
        break;

    default:
        http_response_code(404);
        echo json_encode(['error' => 'Action tidak dikenali']);
        break;
}
