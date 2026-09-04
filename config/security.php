<?php
/**
 * config/security.php
 *
 * Central security bootstrap:
 *   - Loads secrets from .env (no hardcoded credentials)
 *   - Hardens session cookies (Secure, HttpOnly, SameSite=Strict)
 *   - Sends security headers on every response
 *   - Provides CSRF token issuance + verification
 *   - Provides host authentication (single-password, bcrypt)
 *   - Provides per-IP rate limiter (file-backed)
 *
 * Require this file at the top of every PHP entry point.
 */

declare(strict_types=1);

// --- Fail closed on any error during bootstrap ---
error_reporting(E_ALL);
ini_set('display_errors', '0'); // overridden below if APP_DEBUG=true

// --- Load .env ---
$envPath = __DIR__ . '/../.env';
if (!is_readable($envPath)) {
    http_response_code(500);
    header('Content-Type: text/plain');
    exit('Server misconfigured: .env not readable.');
}

$env = [];
foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $line = trim($line);
    if ($line === '' || $line[0] === '#') continue;
    if (!str_contains($line, '=')) continue;
    [$k, $v] = explode('=', $line, 2);
    $env[trim($k)] = trim($v, " \t\"'");
}

// DB_PASS may be legitimately empty (local Laragon default = root with no password).
// So check it separately and only require the rest to be non-empty.
foreach (['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'APP_SECRET', 'RATE_LIMIT_SAVE', 'APP_ENV', 'DISPLAY_ERRORS'] as $req) {
    if (!isset($env[$req]) || $env[$req] === '') {
        http_response_code(500);
        header('Content-Type: text/plain');
        exit("Server misconfigured: missing .env key $req");
    }
}
if (!array_key_exists('DB_PASS', $env)) $env['DB_PASS'] = '';

if (filter_var($env['DISPLAY_ERRORS'], FILTER_VALIDATE_BOOLEAN)) {
    ini_set('display_errors', '1');
}

date_default_timezone_set('UTC');

// --- Detect HTTPS correctly (works behind reverse proxies) ---
function sl_is_https(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') return true;
    return false;
}

// --- Session hardening ---
function sl_session_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $secure = sl_is_https();
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'domain'   => '',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_name('SL_SESSID');
    @session_start();
    // Rotate session id periodically to limit fixation window
    if (!isset($_SESSION['_sl_created'])) {
        $_SESSION['_sl_created'] = time();
        session_regenerate_id(true);
    } elseif (time() - $_SESSION['_sl_created'] > 1800) {
        $_SESSION['_sl_created'] = time();
        session_regenerate_id(true);
    }
}

// --- CSRF token ---
function sl_csrf_token(): string {
    sl_session_start();
    if (empty($_SESSION['_sl_csrf'])) {
        $_SESSION['_sl_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['_sl_csrf'];
}

function sl_csrf_check(): void {
    sl_session_start();
    $headerToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $bodyToken   = $_POST['csrf_token'] ?? '';
    $token = $headerToken !== '' ? $headerToken : $bodyToken;
    if (empty($_SESSION['_sl_csrf']) || !hash_equals($_SESSION['_sl_csrf'], $token)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'CSRF token invalid']);
        exit;
    }
}

// --- Host authentication ---
function sl_is_host(): bool {
    sl_session_start();
    return !empty($_SESSION['_sl_host']);
}

function sl_require_host(): void {
    if (!sl_is_host()) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'Host authentication required']);
        exit;
    }
}

function sl_login(string $password): bool {
    global $env;
    $hash = $env['HOST_PASSWORD_HASH'];
    if (!password_verify($password, $hash)) return false;
    sl_session_start();
    session_regenerate_id(true);
    $_SESSION['_sl_host'] = true;
    $_SESSION['_sl_login_at'] = time();
    return true;
}

function sl_logout(): void {
    sl_session_start();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    @session_destroy();
}

// --- Rate limiter (file-backed, per IP, per endpoint slug) ---
function sl_rate_limit(string $slug, int $maxPerMinute): bool {
    $dir = __DIR__ . '/../sessions/ratelimit';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    // Salt with APP_SECRET so attacker can't pre-compute file names
    $salt = substr(hash('sha256', $GLOBALS['env']['APP_SECRET']), 0, 16);
    $file = $dir . '/' . $slug . '_' . hash('sha256', $salt . $ip) . '.json';
    $now = time();
    $window = [$now - 60, $now];
    $hits = [];
    if (is_file($file)) {
        $raw = @file_get_contents($file);
        $hits = json_decode($raw, true) ?: [];
    }
    $hits = array_values(array_filter($hits, fn($t) => $t >= $window[0]));
    if (count($hits) >= $maxPerMinute) {
        return false;
    }
    $hits[] = $now;
    @file_put_contents($file, json_encode($hits), LOCK_EX);
    @chmod($file, 0600);
    return true;
}

// --- JSON helpers ---
function sl_json_input(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function sl_json_out(array $payload, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function sl_origin(): string {
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '');
}

// --- Security headers (send on every response, even on errors) ---
function sl_send_security_headers(): void {
    if (headers_sent()) return;
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    header('Cross-Origin-Opener-Policy: same-origin');
    if (sl_is_https()) {
        header('Strict-Transport-Security: max-age=63072000; includeSubDomains; preload');
    }
}
sl_send_security_headers();