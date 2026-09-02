<?php
/**
 * api/load_game.php
 * Returns the current match state (or creates a new match if none exists)
 */

declare(strict_types=1);
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . '/../config/db.php';

try {
    // Find the most recent live match
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
        // No active match — return empty state
        echo json_encode([
            'success' => true,
            'match' => null,
            'state' => [
                'teams' => [],
                'turnIndex' => 0,
                'started' => false,
                'finished' => false,
                'history' => [],
                'log' => [],
                'mode' => 'classic',
                'revealed' => new stdClass(),
                'brokenLadders' => new stdClass(),
                'gravity' => [
                    'turnsSinceShift' => 0,
                    'invert' => false,
                    'invertTurnsLeft' => 0,
                    'quicksand' => [],
                    'quicksandTurnsLeft' => 0,
                    'bounty' => null,
                    'frozen' => new stdClass()
                ]
            ]
        ]);
        exit;
    }

    $state = json_decode($match['state_json'], true);
    if (!$state) {
        $state = [];
    }

    echo json_encode([
        'success' => true,
        'match' => [
            'id' => (int)$match['id'],
            'mode' => $match['mode'],
            'status' => $match['status'],
            'created_at' => $match['created_at'],
            'current_turn_index' => (int)$match['current_turn_index']
        ],
        'state' => $state
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
