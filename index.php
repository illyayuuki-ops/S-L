<?php
/**
 * index.php — Main Application Entry Point
 * Snakes & Ladders — Laragon Hosted
 */

declare(strict_types=1);
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Field Day 100 — Giant Snakes &amp; Ladders Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/styles.css">
</head>
<body>

<!-- SOUND TOGGLE -->
<div class="sound-toggle">
  <button class="btn icon" id="btnSound" title="Toggle sound">🔊</button>
</div>

<div class="wrap">

  <!-- HEADER -->
  <header class="top">
    <div class="brand">
      <span class="num">100</span>
      <div>
        <h1>FIELD DAY — GIANT SNAKES &amp; LADDERS</h1>
        <span class="tag">Live moderator console for intramural competitions</span>
      </div>
    </div>
    <div class="top-actions">
      <button class="btn" id="btnRules">How it works</button>
      <button class="btn danger" id="btnResetMatch">Reset match</button>
      <button class="btn danger" id="btnClearAll">Clear all data</button>
    </div>
  </header>

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

      <div class="panel">
        <h2>Game Mode</h2>
        <div id="modeList" class="mode-list"></div>
        <p class="empty-note" id="modeDesc" style="margin-top:8px;"></p>
      </div>

      <div class="panel" id="shadowPanel" style="display:none;">
        <h2>Master Key <button class="btn small" id="btnToggleKey">Reveal (host only)</button></h2>
        <p class="empty-note">Board starts blank. Squares reveal only once a pawn actually lands on them.</p>
        <div id="masterKey" class="master-key hidden"></div>
      </div>

      <div class="panel" id="draftPanel" style="display:none;">
        <h2>Inventory — <span id="draftTeamName">—</span></h2>
        <div id="draftItems"></div>
        <hr class="sep">
        <div class="row">
          <button class="btn" id="btnLoadedLow">Loaded die: 1–3</button>
          <button class="btn" id="btnLoadedHigh">Loaded die: 4–6</button>
        </div>
        <p class="empty-note" id="loadedStatus" style="margin-top:8px;"></p>
      </div>

      <div class="panel" id="gravityPanel" style="display:none;">
        <h2>Audience Board Shift</h2>
        <p class="empty-note" id="shiftStatus">Shift available every 3 turns.</p>
        <div class="row">
          <button class="btn" id="btnInvert" disabled>Invert Gravity</button>
          <button class="btn" id="btnQuicksand" disabled>Quicksand</button>
          <button class="btn" id="btnBounty" disabled>Bounty</button>
        </div>
        <p class="empty-note" id="activeModifiers" style="margin-top:10px;"></p>
      </div>

      <div class="panel">
        <h2>Teams</h2>
        <div id="teamList"></div>
        <div class="row" style="margin-top:10px;">
          <input type="text" class="field" id="newTeamName" placeholder="New team name (e.g. Team Red)">
          <button class="btn" id="btnAddTeam" style="flex:0 0 auto;">Add</button>
        </div>
        <hr class="sep">
        <button class="btn primary" id="btnStartMatch" style="width:100%;">Start match</button>
      </div>

      <div class="panel">
        <h2>Leaderboard <button class="btn small" id="btnClearLb">Clear history</button></h2>
        <table class="lb">
          <thead><tr><th></th><th>Team</th><th>Wins</th><th>Losses</th><th>Matches</th></tr></thead>
          <tbody id="lbBody"></tbody>
        </table>
      </div>
    </div>
  </div>
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
    <p>Reached square 100 first. Recorded to the leaderboard.</p>
    <button class="btn primary" id="btnVictoryClose">New match</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script src="assets/js/game.js"></script>
</body>
</html>
