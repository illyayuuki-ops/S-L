<?php
/**
 * index.php — Main Application Entry Point
 * Snakes & Ladders — Public Game
 *
 * No authentication required. Single-page app with screens:
 *   - main-menu  (choose player count)
 *   - mode-select (choose game mode)
 *   - name-entry  (enter player names)
 *   - game        (play the board)
 *   - arena       (top 50 leaderboard)
 */

declare(strict_types=1);
?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Field Day 100 — Giant Snakes &amp; Ladders</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/styles.css">
  <meta name="robots" content="noindex, nofollow">
</head>
<body>

<!-- SOUND TOGGLE -->
<div class="sound-toggle">
  <button class="btn icon" id="btnSound" title="Toggle sound">🔊</button>
</div>

<div class="wrap">

  <!-- ============================================================
       HEADER (shown across all screens, with nav buttons)
       ============================================================ -->
  <header class="top">
    <div class="brand" id="brandHome" role="button" tabindex="0">
      <span class="num">100</span>
      <div>
        <h1>FIELD DAY — GIANT SNAKES &amp; LADDERS</h1>
        <span class="tag">Giant Snakes &amp; Ladders — public game board</span>
      </div>
    </div>
    <div class="top-actions">
      <button class="btn" id="btnNavArena" title="View the Arena">🏟 Arena</button>
      <button class="btn" id="btnRules" title="How it works">How it works</button>
    </div>
  </header>

  <!-- ============================================================
       SCREEN: MAIN MENU — Choose player count
       ============================================================ -->
  <section class="screen" id="screen-main-menu">
    <div class="panel hero-panel">
      <div class="hero-content">
        <div class="hero-badge">FIELD DAY 100</div>
        <h2 class="hero-title">Pick Your Players</h2>
        <p class="hero-sub">Choose how many players will be on the board. Each option opens its own setup.</p>

        <div class="player-count-grid" id="playerCountGrid">
          <button class="player-card" data-count="1">
            <div class="pc-emoji">👤</div>
            <div class="pc-label">Solo vs AI</div>
            <div class="pc-detail">One human vs one bot</div>
          </button>
          <button class="player-card" data-count="2">
            <div class="pc-emoji">👥</div>
            <div class="pc-label">Duo</div>
            <div class="pc-detail">Two players head-to-head</div>
          </button>
          <button class="player-card" data-count="3">
            <div class="pc-emoji">👨‍👩‍👧</div>
            <div class="pc-label">Trio</div>
            <div class="pc-detail">Three players race to 100</div>
          </button>
          <button class="player-card" data-count="4">
            <div class="pc-emoji">🎉</div>
            <div class="pc-label">4-Player</div>
            <div class="pc-detail">Four players, maximum chaos</div>
          </button>
        </div>

        <div class="hero-cta-row">
          <button class="btn primary big" id="btnContinueFromMenu">Continue Setup ➜</button>
        </div>
      </div>
    </div>
  </section>

  <!-- ============================================================
       SCREEN: MODE SELECT — Choose game mode
       ============================================================ -->
  <section class="screen hidden" id="screen-mode-select">
    <div class="panel">
      <div class="screen-head">
        <button class="btn small" id="btnBackToMenu">◂ Back</button>
        <h2 class="screen-title">Pick Your Game Mode</h2>
        <div class="player-count-badge" id="modeCountBadge">2 Players</div>
      </div>

      <div class="mode-cards" id="modeCards">
        <!-- Populated by JS -->
      </div>

      <div class="screen-cta">
        <button class="btn primary big" id="btnContinueFromMode" disabled>Choose Mode ➜</button>
      </div>
    </div>
  </section>

  <!-- ============================================================
       SCREEN: NAME ENTRY
       ============================================================ -->
  <section class="screen hidden" id="screen-name-entry">
    <div class="panel">
      <div class="screen-head">
        <button class="btn small" id="btnBackToMode">◂ Back</button>
        <h2 class="screen-title">Name Your Players</h2>
        <div class="player-count-badge" id="nameCountBadge">2 Players</div>
      </div>

      <div class="mode-banner" id="nameModeBanner">Classic</div>

      <div class="name-entry-grid" id="nameEntryGrid">
        <!-- Populated by JS -->
      </div>

      <div class="screen-cta">
        <button class="btn primary big" id="btnStartGame">Start Game 🎲</button>
      </div>
    </div>
  </section>

  <!-- ============================================================
       SCREEN: GAME
       ============================================================ -->
  <section class="screen hidden" id="screen-game">
    <div class="panel screen-head">
      <button class="btn small" id="btnQuitToMenu">◂ Main Menu</button>
      <div class="game-meta">
        <span class="meta-pill" id="metaMode">Classic</span>
        <span class="meta-pill" id="metaPlayers">2 Players</span>
      </div>
    </div>

    <div class="layout">
      <!-- LEFT: BOARD -->
      <div>
        <div class="panel">
          <h2>Match Board <span id="boardStatus" style="font-family:'Inter';font-weight:600;font-size:12px;color:var(--chalk-muted);letter-spacing:0.5px;"></span></h2>
          <div id="boardHolder">
            <div id="board"></div>
            <svg id="overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg>
          </div>
          <div class="legend">
            <span><i class="dot" style="background:var(--ladder);"></i> Ladder — climb challenge</span>
            <span><i class="dot" style="background:var(--snake);"></i> Snake — defense challenge</span>
            <span><i class="dot" style="background:var(--amber);"></i> Finish (100)</span>
          </div>
        </div>

        <div class="panel">
          <h2>Roll &amp; Turn History</h2>
          <div id="logList"><div class="empty-note">No rolls yet — start the match to begin logging.</div></div>
        </div>
      </div>

      <!-- RIGHT: CONTROLS -->
      <div>
        <div class="panel">
          <h2>Current Turn</h2>
          <div class="turn-banner">
            <div class="swatch" id="turnSwatch" style="background:#555;"></div>
            <div>
              <div class="label">On the clock</div>
              <div class="name" id="turnName">Add teams to begin</div>
            </div>
          </div>

          <div class="dice-area">
            <div class="die-big" id="dieBig">1</div>
            <button class="btn primary" id="btnRoll" style="width:100%;">Roll dice</button>
          </div>
          <div class="row" style="margin-top:12px;">
            <button class="btn" id="btnUndo" disabled>Undo last</button>
          </div>
        </div>

        <div class="panel" id="modePanel">
          <h2>Game Mode</h2>
          <p class="empty-note" id="modeDesc" style="margin-top:0;"></p>
          <div id="modeList" class="mode-list"></div>
        </div>

        <div class="panel" id="shadowPanel" style="display:none;">
          <h2>Master Key (Shadow Grid)</h2>
          <p class="empty-note">Snakes and ladders are revealed only after a team lands on them.</p>
          <div id="masterKey" class="master-key"></div>
        </div>

        <div class="panel" id="draftPanel" style="display:none;">
          <h2>Draft &amp; Trade — Inventory</h2>
          <p class="empty-note">Use items during your turn to gain an advantage.</p>
          <div class="turn-banner" style="margin-bottom:8px;">
            <div class="label">Current team</div>
            <div class="name" id="draftTeamName">—</div>
          </div>
          <div id="draftItems"></div>
          <hr class="sep">
            <div class="loaded-die-row">
              <span class="label" id="loadedStatus">Loaded Die idle.</span>
            </div>
            <div class="row" style="margin-top:8px;">
              <button class="btn small" id="btnLoadLow">Load 1–3</button>
              <button class="btn small" id="btnLoadHigh">Load 4–6</button>
            </div>
        </div>

        <div class="panel" id="gravityPanel" style="display:none;">
          <h2>Audience-Driven Gravity</h2>
          <p class="empty-note" id="shiftStatus">Board Shift available in 3 turns.</p>
          <div class="row" style="margin-top:8px;flex-wrap:wrap;">
            <button class="btn small" id="btnInvert">Invert Gravity</button>
            <button class="btn small" id="btnQuicksand">Quicksand</button>
            <button class="btn small" id="btnBounty">Bounty on 50</button>
          </div>
          <hr class="sep">
          <p class="empty-note" id="activeModifiers">No active modifiers.</p>
        </div>

        <div class="panel">
          <h2>Players</h2>
          <div id="teamList"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- ============================================================
       SCREEN: ARENA — Top 50 Rankings
       ============================================================ -->
  <section class="screen hidden" id="screen-arena">
    <div class="panel">
      <div class="screen-head">
        <button class="btn small" id="btnBackFromArena">◂ Back</button>
        <h2 class="screen-title">🏟 The Arena</h2>
        <div></div>
      </div>
      <p class="arena-intro">Top 50 finishes per Game Mode + Player Count. Names only — no stats, just glory.</p>

      <div class="arena-filters">
        <div class="filter-group">
          <label class="filter-label">Game Mode</label>
          <div class="filter-pills" id="arenaModePills">
            <button class="pill active" data-mode="classic">Classic</button>
            <button class="pill" data-mode="shadow">Shadow</button>
            <button class="pill" data-mode="draft">Draft</button>
            <button class="pill" data-mode="gravity">Gravity</button>
          </div>
        </div>
        <div class="filter-group">
          <label class="filter-label">Player Count</label>
          <div class="filter-pills" id="arenaCountPills">
            <button class="pill" data-count="1">Solo vs AI</button>
            <button class="pill active" data-count="2">Duo</button>
            <button class="pill" data-count="3">Trio</button>
            <button class="pill" data-count="4">4-Player</button>
          </div>
        </div>
      </div>

      <div class="arena-table-wrap">
        <table class="arena-table">
          <thead>
            <tr>
              <th class="col-rank">#</th>
              <th class="col-name">Name</th>
            </tr>
          </thead>
          <tbody id="arenaBody">
            <tr><td colspan="2" class="empty-note">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

</div>

<!-- CHALLENGE MODAL -->
<div class="modal-bg hidden" id="challengeModalBg">
  <div class="modal" id="challengeModal">
    <div class="team-color-bar" id="chTeamColor"></div>
    <h3 id="chTitle">Ladder Challenge</h3>
    <p class="sub" id="chSub">Team must complete the physical challenge before time runs out.</p>
    <div class="timer-ring">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle class="bg" cx="65" cy="65" r="55"></circle>
        <circle class="fg" id="timerFg" cx="65" cy="65" r="55"></circle>
      </svg>
      <div class="num" id="timerNum">15</div>
    </div>
    <div class="modal-actions">
      <button class="btn primary" id="btnChComplete">Mark Completed</button>
      <button class="btn danger" id="btnChFail">Mark Failed</button>
    </div>
  </div>
</div>

<!-- CUSTOM PROMPT MODAL -->
<div class="modal-bg hidden" id="promptModalBg">
  <div class="modal prompt-modal" id="promptModal">
    <div class="prompt-title" id="promptTitle">Choose an option</div>
    <div class="prompt-options" id="promptOptions"></div>
    <div class="modal-actions">
      <button class="btn" id="promptCancel">Cancel</button>
    </div>
  </div>
</div>

<!-- VICTORY -->
<div class="victory-bg hidden" id="victoryBg">
  <div class="victory">
    <div class="medal">🏆</div>
    <h2 id="victoryName">TEAM WINS</h2>
    <p>Reached square 100 first. Recorded to the leaderboard and the Arena.</p>
    <button class="btn primary" id="btnVictoryClose">New match</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<!-- Mobile sticky roll button (only shown <= 768px) -->
<button class="btn primary mobile-roll" id="btnRollMobile">🎲 ROLL</button>

<script src="assets/js/game.js"></script>
</body>
</html>