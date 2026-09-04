<?php
require_once 'C:\laragon\www\S-L\config\security.php';
require_once 'C:\laragon\www\S-L\config\db.php';
echo "CONNECT OK\n";
echo "DB: " . $pdo->query('SELECT DATABASE()')->fetchColumn() . "\n";
echo "Teams: " . $pdo->query('SELECT COUNT(*) FROM teams')->fetchColumn() . "\n";
