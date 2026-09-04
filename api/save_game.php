<?php
/**
 * api/save_game.php
 *
 * Save or update a match. Public endpoint with rate limiting.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/security.php';

// --- CORS: same-origin only ---
header('Vary: Origin');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && $origin !== sl_origin()) {
    sl_json_out(['success' => false, 'error' => 'Cross-origin requests denied'], 403);
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 600');
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sl_json_out(['success' => false, 'error' => 'Method not allowed'], 405);
}

// --- Rate limit ---
if (!sl_rate_limit('save', (int)$env['RATE_LIMIT_SAVE'])) {
    sl_json_out(['success' => false, 'error' => 'Too many requests'], 429);
}

require_once __DIR__ . '/../config/db.php';

$input = sl_json_input();

if (!$input || !isset($input['state']) || !isset($input['mode'])) {
    sl_json_out(['success' => false, 'error' => 'Missing required fields: mode, state'], 400);
}

// Whitelist mode against ENUM
$mode = $input['mode'];
if (!in_array($mode, ['classic', 'shadow', 'draft', 'gravity'], true)) {
    sl_json_out(['success' => false, 'error' => 'Invalid mode'], 400);
}

$status = isset($input['status']) && in_array($input['status'], ['live', 'finished', 'reset'], true)
    ? $input['status']
    : 'live';

$playerCount = isset($input['player_count']) ? (int)$input['player_count'] : 2;
if ($playerCount < 1 || $playerCount > 4) $playerCount = 2;

$state = $input['state'];
$matchId   = isset($input['match_id']) ? (int)$input['match_id'] : null;
$turnIndex = isset($state['turnIndex']) ? (int)$state['turnIndex'] : 0;

// Sanity bound on state size (prevent DoS via huge JSON)
if (strlen(json_encode($state)) > 200000) {
    sl_json_out(['success' => false, 'error' => 'State payload too large'], 413);
}

try {
    $pdo->beginTransaction();

    if (!$matchId) {
        $stmt = $pdo->prepare("INSERT INTO matches (mode, player_count, status) VALUES (:mode, :pc, :status)");
        $stmt->execute([':mode' => $mode, ':pc' => $playerCount, ':status' => $status]);
        $matchId = (int)$pdo->lastInsertId();

        if (isset($state['teams']) && is_array($state['teams'])) {
            foreach ($state['teams'] as $team) {
                if (isset($team['id']) && isset($team['name'])) {
                    $stmt = $pdo->prepare("
                        INSERT INTO teams (uuid, name, color)
                        VALUES (:uuid, :name, :color)
                        ON DUPLICATE KEY UPDATE name = VALUES(name), color = VALUES(color)
                    ");
                    $stmt->execute([
                        ':uuid'  => (string)$team['id'],
                        ':name'  => substr((string)$team['name'], 0, 100),
                        ':color' => preg_match('/^#[0-9a-f]{6}$/i', $team['color'] ?? '') ? $team['color'] : '#d44a3e'
                    ]);

                    $stmt = $pdo->prepare("SELECT id FROM teams WHERE uuid = :uuid");
                    $stmt->execute([':uuid' => (string)$team['id']]);
                    $dbId = (int)$stmt->fetchColumn();

                    if ($dbId > 0) {
                        $stmt = $pdo->prepare("
                            INSERT IGNORE INTO leaderboard (team_id, wins, losses, total_matches)
                            VALUES (:team_id, 0, 0, 0)
                        ");
                        $stmt->execute([':team_id' => $dbId]);
                    }
                }
            }
        }
    } else {
        $stmt = $pdo->prepare("
            UPDATE matches
            SET status = :status,
                finished_at = CASE WHEN :status = 'finished' THEN NOW() ELSE finished_at END
            WHERE id = :id
        ");
        $stmt->execute([':status' => $status, ':id' => $matchId]);
    }

    // Update player_count on existing match if provided and match is still live/new
    if ($matchId && $status === 'live') {
        $stmt = $pdo->prepare("UPDATE matches SET player_count = :pc WHERE id = :id AND player_count = 2");
        $stmt->execute([':pc' => $playerCount, ':id' => $matchId]);
    }

    $stateJson = json_encode($state, JSON_UNESCAPED_UNICODE);
    if ($stateJson === false) {
        throw new RuntimeException('Failed to encode state');
    }
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

    if ($status === 'finished' && isset($state['teams']) && is_array($state['teams'])) {
        foreach ($state['teams'] as $team) {
            if (!isset($team['id'])) continue;
            if (empty($team['active'])) continue;

            $stmt = $pdo->prepare("SELECT id FROM teams WHERE uuid = :uuid");
            $stmt->execute([':uuid' => (string)$team['id']]);
            $dbTeam = $stmt->fetch();
            if (!$dbTeam) continue;
            $teamId = (int)$dbTeam['id'];

            $isWin  = (isset($team['pos']) && (int)$team['pos'] === 100) ? 1 : 0;
            $isLoss = $isWin ? 0 : 1;

            $stmt = $pdo->prepare("
                UPDATE leaderboard
                SET total_matches = total_matches + 1,
                    wins = wins + :win,
                    losses = losses + :loss
                WHERE team_id = :team_id
            ");
            $stmt->execute([':win' => $isWin, ':loss' => $isLoss, ':team_id' => $teamId]);

            if ($isWin) {
                $turnsToWin = 0;
                if (isset($state['history']) && is_array($state['history'])) {
                    foreach (array_reverse($state['history']) as $hist) {
                        if (isset($hist['teamId']) && $hist['teamId'] === $team['id']) {
                            $turnsToWin = isset($hist['time']) ? (int)$hist['time'] : 0;
                            break;
                        }
                    }
                }
                $stmt = $pdo->prepare("
                    INSERT INTO arena_entries (team_id, match_id, mode, player_count, rank_score, turns_to_win)
                    VALUES (:team_id, :match_id, :mode, :pc, :rank, :turns)
                    ON DUPLICATE KEY UPDATE rank_score = VALUES(rank_score), turns_to_win = VALUES(turns_to_win)
                ");
                $stmt->execute([
                    ':team_id' => $teamId,
                    ':match_id' => $matchId,
                    ':mode' => $mode,
                    ':pc' => $playerCount,
                    ':rank' => max(0, 100 - $turnsToWin),
                    ':turns' => (int)$turnsToWin
                ]);
            }
        }
    }

    $pdo->commit();

    sl_json_out([
        'success'  => true,
        'match_id' => $matchId,
        'message'  => 'Game state saved successfully'
    ]);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('save_game: ' . $e->getMessage());
    sl_json_out(['success' => false, 'error' => 'Internal error'], 500);
}