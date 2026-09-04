<?php
/**
 * config/db.php
 * PDO database connection — credentials from .env
 */

declare(strict_types=1);

require_once __DIR__ . '/security.php';

$dsn = sprintf(
    'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
    $env['DB_HOST'], $env['DB_PORT'], $env['DB_NAME']
);

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
    PDO::ATTR_PERSISTENT         => false,
];

try {
    $pdo = new PDO($dsn, $env['DB_USER'], $env['DB_PASS'], $options);
} catch (PDOException $e) {
    error_log('DB connect: ' . $e->getMessage());
    sl_json_out([
        'success' => false,
        'error'   => 'Database connection failed'
    ], 500);
}