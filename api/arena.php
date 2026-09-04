<?php
/**
 * api/arena.php
 * Public read-only top 50 rankings per (mode + player_count).
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/security.php';

if (!sl_rate_limit('arena', 120)) {
    sl_json_out(['success' => false, 'error' => 'Too many requests'], 429);
}

require_once __DIR__ . '/../config/db.php';

$mode = isset($_GET['mode']) ? $_GET['mode'] : 'classic';
$playerCount = isset($_GET['player_count']) ? (int)$_GET['player_count'] : 2;
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;

if (!in_array($mode, ['classic', 'shadow', 'draft', 'gravity'], true)) {
    $mode = 'classic';
}
if ($playerCount < 1 || $playerCount > 4) {
    $playerCount = 2;
}
if ($limit < 1 || $limit > 50) {
    $limit = 50;
}

try {
    $stmt = $pdo->prepare("
        SELECT t.name, a.rank_score, a.turns_to_win, a.created_at
        FROM arena_entries a
        JOIN teams t ON t.id = a.team_id
        WHERE a.mode = :mode AND a.player_count = :pc
        ORDER BY a.rank_score DESC, a.turns_to_win ASC, a.created_at ASC
        LIMIT :limit
    ");
    $stmt->bindValue(':mode', $mode, PDO::PARAM_STR);
    $stmt->bindValue(':pc', $playerCount, PDO::PARAM_INT);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $out = [];
    foreach ($rows as $r) {
        $out[] = [
            'name' => (string)$r['name'],
            'rank_score' => (int)$r['rank_score'],
            'turns_to_win' => (int)$r['turns_to_win']
        ];
    }

    sl_json_out(['success' => true, 'rows' => $out]);
} catch (Throwable $e) {
    error_log('arena: ' . $e->getMessage());
    sl_json_out(['success' => false, 'error' => 'Internal error'], 500);
}
