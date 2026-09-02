<?php
/**
 * api/leaderboard.php
 * Returns leaderboard data sorted by wins descending
 */

declare(strict_types=1);
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once __DIR__ . '/../config/db.php';

try {
    $stmt = $pdo->query("
        SELECT t.name, t.color, l.wins, l.losses, l.total_matches
        FROM leaderboard l
        JOIN teams t ON t.id = l.team_id
        ORDER BY l.wins DESC, l.total_matches DESC
    ");

    $rows = $stmt->fetchAll();

    echo json_encode([
        'success'     => true,
        'leaderboard' => $rows
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
