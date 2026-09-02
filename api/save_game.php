<?php
/**
 * api/save_game.php
 * Saves or updates the current match state
 * Expects POST JSON: { match_id?, mode, state: {...}, status? }
 */

declare(strict_types=1);
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/../config/db.php';

$input = json_decode(file_get_contents('php://input'), true);

if (!$input || !isset($input['state']) || !isset($input['mode'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing required fields: mode, state']);
    exit;
}

$matchId   = isset($input['match_id']) ? (int)$input['match_id'] : null;
$mode      = $input['mode'];
$state     = $input['state'];
$status    = isset($input['status']) ? $input['status'] : 'live';
$turnIndex = isset($state['turnIndex']) ? (int)$state['turnIndex'] : 0;

try {
    $pdo->beginTransaction();

    if (!$matchId) {
        // Create new match
        $stmt = $pdo->prepare("
            INSERT INTO matches (mode, status)
            VALUES (:mode, :status)
        ");
        $stmt->execute([':mode' => $mode, ':status' => $status]);
        $matchId = (int)$pdo->lastInsertId();

        // Ensure all teams exist in leaderboard table
        if (isset($state['teams']) && is_array($state['teams'])) {
            foreach ($state['teams'] as $team) {
                if (isset($team['id'])) {
                    $stmt = $pdo->prepare("
                        INSERT IGNORE INTO teams (uuid, name, color)
                        VALUES (:uuid, :name, :color)
                    ");
                    $stmt->execute([
                        ':uuid'  => $team['id'],
                        ':name'  => $team['name'],
                        ':color' => $team['color'] ?? '#d44a3e'
                    ]);

                    // Ensure leaderboard entry exists
                    $stmt = $pdo->prepare("
                        INSERT IGNORE INTO leaderboard (team_id, wins, losses, total_matches)
                        VALUES (LAST_INSERT_ID(), 0, 0, 0)
                    ");
                    $stmt->execute();
                }
            }
        }
    } else {
        // Update existing match status
        $stmt = $pdo->prepare("
            UPDATE matches
            SET status = :status,
                finished_at = CASE WHEN :status = 'finished' THEN NOW() ELSE finished_at END
            WHERE id = :id
        ");
        $stmt->execute([':status' => $status, ':id' => $matchId]);
    }

    // Upsert match_state
    $stateJson = json_encode($state, JSON_UNESCAPED_UNICODE);
    $stmt = $pdo->prepare("
        INSERT INTO match_state (match_id, current_turn_index, state_json)
        VALUES (:match_id, :turn_index, :state_json)
        ON DUPLICATE KEY UPDATE
            current_turn_index = VALUES(current_turn_index),
            state_json = VALUES(state_json),
            updated_at = NOW()
    ");
    $stmt->execute([
        ':match_id'    => $matchId,
        ':turn_index'  => $turnIndex,
        ':state_json'  => $stateJson
    ]);

    // If match finished, update leaderboard
    if ($status === 'finished' && isset($state['teams'])) {
        foreach ($state['teams'] as $team) {
            if (!isset($team['id'])) continue;

            // Get team DB id from uuid
            $stmt = $pdo->prepare("SELECT id FROM teams WHERE uuid = :uuid");
            $stmt->execute([':uuid' => $team['id']]);
            $dbTeam = $stmt->fetch();

            if ($dbTeam) {
                $teamId = (int)$dbTeam['id'];
                $stmt = $pdo->prepare("
                    UPDATE leaderboard
                    SET total_matches = total_matches + 1,
                        wins = wins + :win,
                        losses = losses + :loss
                    WHERE team_id = :team_id
                ");
                $isWin = ($team['pos'] === 100) ? 1 : 0;
                $isLoss = ($isWin === 0 && $team['active']) ? 1 : 0;
                $stmt->execute([
                    ':win'     => $isWin,
                    ':loss'    => $isLoss,
                    ':team_id' => $teamId
                ]);
            }
        }
    }

    $pdo->commit();

    echo json_encode([
        'success'  => true,
        'match_id' => $matchId,
        'message'  => 'Game state saved successfully'
    ]);

} catch (PDOException $e) {
    $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
