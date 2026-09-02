-- ============================================
-- Snakes & Ladders — Laragon Database Schema
-- Run this in phpMyAdmin → SQL tab
-- ============================================

CREATE DATABASE IF NOT EXISTS snakes_and_ladders
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE snakes_and_ladders;

-- --------------------------------------------
-- Teams (persistent leaderboard identities)
-- --------------------------------------------
CREATE TABLE teams (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uuid        CHAR(36) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(7) NOT NULL DEFAULT '#d44a3e',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------
-- Matches (individual game sessions)
-- --------------------------------------------
CREATE TABLE matches (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mode            ENUM('classic', 'shadow', 'draft', 'gravity') NOT NULL DEFAULT 'classic',
    winner_team_id  INT UNSIGNED NULL,
    status          ENUM('live', 'finished', 'reset') NOT NULL DEFAULT 'live',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at     TIMESTAMP NULL,
    FOREIGN KEY (winner_team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------
-- Match State (JSON blob for all dynamic data)
-- --------------------------------------------
CREATE TABLE match_state (
    match_id            INT UNSIGNED PRIMARY KEY,
    current_turn_index  INT UNSIGNED NOT NULL DEFAULT 0,
    state_json          JSON NOT NULL,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------
-- Leaderboard (aggregated stats per team)
-- --------------------------------------------
CREATE TABLE leaderboard (
    team_id       INT UNSIGNED PRIMARY KEY,
    wins          INT UNSIGNED NOT NULL DEFAULT 0,
    losses        INT UNSIGNED NOT NULL DEFAULT 0,
    total_matches INT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------
-- Seed demo data (optional — remove if not needed)
-- --------------------------------------------
INSERT INTO teams (uuid, name, color) VALUES
  (UUID(), 'Team Red',    '#d44a3e'),
  (UUID(), 'Team Blue',   '#3a8bc4'),
  (UUID(), 'Team Gold',   '#e8a93a'),
  (UUID(), 'Team Green',  '#5a9e6f')
ON DUPLICATE KEY UPDATE name=name;

INSERT INTO leaderboard (team_id, wins, losses, total_matches) VALUES
  (1, 3, 1, 4),
  (2, 1, 2, 3),
  (3, 0, 1, 1),
  (4, 2, 2, 4)
ON DUPLICATE KEY UPDATE wins=wins, losses=losses, total_matches=total_matches;
