# Field Day 100 — Snakes & Ladders (Laragon)

Public game board for a physical-field-day Snakes & Ladders event.
PHP backend, MySQL persistence, single-page JS frontend.

## Setup (Laragon)

1. Run `database.sql` in phpMyAdmin to create the schema.
2. Create a least-privilege MySQL user:
   ```sql
   CREATE USER 'snl_app'@'localhost' IDENTIFIED BY 'your-strong-password';
   GRANT SELECT, INSERT, UPDATE, DELETE ON snakes_and_ladders.* TO 'snl_app'@'localhost';
   FLUSH PRIVILEGES;
   ```
3. Edit `.env`:
   - `DB_PASS` = the password you just set
   - `APP_SECRET` = regenerate with `php -r "echo bin2hex(random_bytes(32));"`
4. Enable Apache `mod_rewrite` and `mod_headers` (already on in Laragon default).
5. Enable SSL in Laragon → the `.htaccess` will force HTTPS automatically.

## Security posture

- Rate-limited: save 120/min, load 240/min, leaderboard 120/min
- CSRF removed for public access; state mutations rely on rate limiting + input validation
- `Content-Security-Policy`, `Strict-Transport-Security` (2 years, preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
- `.env`, `.git`, `*.md`, `*.sql` are denied at the webserver level
- DB errors are logged, never echoed to clients
- API responses are `no-store` cached

## First-run checklist

- [ ] Apache mod_rewrite + mod_headers enabled
- [ ] HTTPS cert installed (Laragon → SSL → generate)
- [ ] `.env` filled in (real DB creds, real APP_SECRET)
- [ ] `.env` is in `.gitignore` (already is)
- [ ] Visit `https://your-host/` — should see the game board immediately
- [ ] Add 2+ teams, Start match, roll dice
- [ ] Confirm leaderboard updates after a match finishes

## Going public

1. Buy a real domain and point it at the host
2. Use Let's Encrypt or a commercial cert (not Laragon self-signed)
3. Submit `https://your-host` to https://hstspreload.org once stable
4. Audit any third-party scripts you add (CSP only allows `'self'`)