<?php
/**
 * api/leaderboard.php
 * Public read-only aggregate stats.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/security.php';

if (!sl_rate_limit('leaderboard', 120)) {
    sl_json_out(['success' => false, 'error' => 'Too many requests'], 429);
}

require_once __DIR__ . '/../config/db.php';

try {
    $stmt = $pdo->query("
        SELECT t.name, t.color, l.wins, l.losses, l.total_matches
        FROM leaderboard l
        JOIN teams t ON t.id = l.team_id
        WHERE l.total_matches > 0
        ORDER BY l.wins DESC, l.total_matches DESC, t.name ASC
        LIMIT 100
    ");
    $rows = $stmt->fetchAll();

    // Sanitize color strings before exposing
    foreach ($rows as &$r) {
        if (!preg_match('/^#[0-9a-f]{6}$/i', $r['color'] ?? '')) {
            $r['color'] = '#888888';
        }
    }
    unset($r);

    sl_json_out(['success' => true, 'leaderboard' => $rows]);
} catch (Throwable $e) {
    error_log('leaderboard: ' . $e->getMessage());
    sl_json_out(['success' => false, 'error' => 'Internal error'], 500);
}