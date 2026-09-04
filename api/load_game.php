<?php
/**
 * api/load_game.php
 *
 * Returns the most recent live match. Read-only — public, but still
 * needs the session cookie so we can scope the response and apply rate limit.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/security.php';

header('Vary: Origin');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && $origin !== sl_origin()) {
    sl_json_out(['success' => false, 'error' => 'Cross-origin requests denied'], 403);
}

if (!sl_rate_limit('load', 240)) {
    sl_json_out(['success' => false, 'error' => 'Too many requests'], 429);
}

require_once __DIR__ . '/../config/db.php';

try {
    $stmt = $pdo->query("
        SELECT m.id, m.mode, m.status, m.created_at,
               ms.current_turn_index, ms.state_json
        FROM matches m
        LEFT JOIN match_state ms ON ms.match_id = m.id
        WHERE m.status = 'live'
        ORDER BY m.created_at DESC
        LIMIT 1
    ");
    $match = $stmt->fetch();

    if (!$match) {
        sl_json_out([
            'success' => true,
            'match'   => null,
            'state'   => [
                'teams' => [], 'turnIndex' => 0,
                'started' => false, 'finished' => false,
                'history' => [], 'log' => [], 'mode' => 'classic',
                'revealed' => new stdClass(),
                'brokenLadders' => new stdClass(),
                'gravity' => [
                    'turnsSinceShift' => 0, 'invert' => false,
                    'invertTurnsLeft' => 0, 'quicksand' => [],
                    'quicksandTurnsLeft' => 0, 'bounty' => null,
                    'frozen' => new stdClass()
                ]
            ]
        ]);
    }

    $state = json_decode($match['state_json'], true) ?: [];

    sl_json_out([
        'success' => true,
        'match' => [
            'id'                 => (int)$match['id'],
            'mode'               => $match['mode'],
            'status'             => $match['status'],
            'created_at'         => $match['created_at'],
            'current_turn_index' => (int)$match['current_turn_index'],
            'player_count'       => isset($match['player_count']) ? (int)$match['player_count'] : 2
        ],
        'state' => $state
    ]);
} catch (Throwable $e) {
    error_log('load_game: ' . $e->getMessage());
    sl_json_out(['success' => false, 'error' => 'Internal error'], 500);
}