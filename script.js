/* ==========================================================
   KONFIGURATION – hier deine Werte eintragen
   ========================================================== */
const SHEET_ID = "1wPc2gtuH7GM27OcCLJ5aYjlYbRSERNjbAI5VRsmPb9g"; // aus der Sheet-URL zwischen /d/ und /edit
const SHEET_GID = "0";                       // Tab-ID, "0" ist meist der erste Tab
const REFRESH_MS = 5000;                     // wie oft neu geladen wird (ms)
const FLY_DURATION_MS = 650;                 // Dauer der Punkte-Flug-Animation

/* Spalten:
   A2:A -> Teilnehmername
   E2:E -> Gesamtpunktestand
   B2:B -> Name des Spiels je Runde (z.B. "League")
   C2:C -> Gewinner dieser Runde (leer = Runde läuft noch)
   D2:D -> Punkte, die es für dieses Spiel gibt (nur relevant im Modus "Einfach")
   F2   -> Wertungssystem ("Einfach" oder "Gewinnbaum")
   -> das aktuelle Spiel ist die erste Zeile ohne Eintrag in C
   -> bei "Gewinnbaum" entspricht die Punktzahl eines Spiels immer
      seiner Spielnummer (Spiel 3 = 3 Punkte, unabhängig von Spalte D)
   -> bei "Gewinnbaum" fliegen die Punkte beim Eintragen eines
      Gewinners animiert von der Spielnummer zu dessen Punktestand
*/

const gameNumberEl = document.getElementById("game-number");
const gamePillEl = document.getElementById("game-pill");
const playersEl = document.getElementById("players");

let lastScores = {};     // zum Erkennen von Punkteänderungen (für den Puls-Effekt)
let prevGameRows = null; // zum Erkennen frisch eingetragener Gewinner (für die Flug-Animation)

function buildUrl() {
  const ts = Date.now(); // cache-busting
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}&_=${ts}`;
}

function parseGvizResponse(text) {
  const match = text.match(/\{.*\}/s);
  if (!match) throw new Error("Konnte Sheet-Antwort nicht lesen.");
  return JSON.parse(match[0]);
}

function cellValue(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return "";
  return cell.v;
}

async function fetchSheetData() {
  const res = await fetch(buildUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet-Anfrage fehlgeschlagen: ${res.status}`);
  const data = parseGvizResponse(await res.text());
  const rows = data.table.rows;

  let currentGame = null;
  let gameCount = 0;
  let scoreSystem = "";
  const players = [];
  const gameRows = [];

  rows.forEach((row, rowIndex) => {
    const cells = row.c || [];
    const rowNumber = rowIndex + 2;       // Sheet-Zeilennummer (Zeile 1 = Header, A2 = erste Datenzeile)
    const name = cellValue(cells[0]);     // Spalte A
    const gameName = cellValue(cells[1]); // Spalte B
    const winner = cellValue(cells[2]);   // Spalte C
    const points = cellValue(cells[3]);   // Spalte D
    const score = cellValue(cells[4]);    // Spalte E
    const system = cellValue(cells[5]);   // Spalte F

    if (system !== "" && scoreSystem === "") {
      scoreSystem = String(system).trim();
    }

    // Spielnummer = Position der Zeile innerhalb der befüllten "Spiele"-Liste
    if (gameName !== "") {
      gameCount += 1;
      if (winner === "" && currentGame === null) {
        currentGame = gameCount;
      }
      // Im Modus "Gewinnbaum" ist die Punktzahl eines Spiels immer gleich
      // seiner Spielnummer (Spiel 3 -> 3 Punkte), sonst zählt Spalte D.
      const effectivePoints =
        scoreSystem === "Gewinnbaum" ? gameCount : (points === "" ? 0 : points);
      gameRows.push({ index: gameCount, winner, points: effectivePoints });
    }
    if (name !== "" && rowNumber <= 20) {
      players.push({ name, score: score === "" ? 0 : score });
    }
  });

  // Alle bisherigen Spiele haben schon einen Gewinner -> nächstes Spiel ist "dran"
  if (currentGame === null && gameCount > 0) {
    currentGame = gameCount + 1;
  }

  return { currentGame, players, gameRows, scoreSystem };
}

function findNewlyCompletedGames(prevRows, currRows) {
  return currRows.filter((g) => {
    if (g.winner === "") return false;
    const prev = prevRows.find((p) => p.index === g.index);
    return !prev || prev.winner === "";
  });
}

function cssEscapeName(name) {
  return window.CSS && CSS.escape ? CSS.escape(name) : name.replace(/["\\]/g, "\\$&");
}

function flyPointsTo(points, winnerName) {
  const target = playersEl.querySelector(
    `.pill--player[data-name="${cssEscapeName(winnerName)}"] .player-score`
  );
  if (!gamePillEl || !target) return;

  const startRect = gamePillEl.getBoundingClientRect();
  const endRect = target.getBoundingClientRect();

  const startX = startRect.left + startRect.width / 2;
  const startY = startRect.top + startRect.height / 2;
  const endX = endRect.left + endRect.width / 2;
  const endY = endRect.top + endRect.height / 2;

  const dot = document.createElement("div");
  dot.className = "flying-point";
  dot.textContent = points;
  dot.style.left = `${startX - 15}px`;
  dot.style.top = `${startY - 15}px`;
  document.body.appendChild(dot);

  // im nächsten Frame starten, damit die CSS-Transition greift
  requestAnimationFrame(() => {
    dot.style.transform = `translate(${endX - startX}px, ${endY - startY}px) scale(0.75)`;
    dot.style.opacity = "0.1";
  });

  setTimeout(() => dot.remove(), FLY_DURATION_MS + 150);
}

function render({ currentGame, players }) {
  gameNumberEl.textContent = currentGame !== null ? currentGame : "–";

  playersEl.querySelectorAll(".pill--player").forEach((el) => el.remove());

  players.forEach((player, i) => {
    const colorClass = `c-${(i % 5) + 1}`;
    const changed = lastScores[player.name] !== undefined && lastScores[player.name] !== player.score;

    const pill = document.createElement("div");
    pill.className = `pill pill--player ${colorClass}${changed ? " pulse" : ""}`;
    pill.dataset.name = player.name;
    pill.innerHTML = `
      <span class="player-name">${player.name}</span>
      <span class="player-score">${player.score}</span>
    `;
    playersEl.appendChild(pill);

    lastScores[player.name] = player.score;
  });
}

async function tick() {
  try {
    const data = await fetchSheetData();
    const completed = prevGameRows ? findNewlyCompletedGames(prevGameRows, data.gameRows) : [];
    prevGameRows = data.gameRows;

    if (completed.length && data.scoreSystem === "Gewinnbaum") {
      completed.forEach((g) => flyPointsTo(g.points, g.winner));
      // Punktestand erst updaten, wenn die Flug-Animation gelandet ist
      setTimeout(() => render(data), FLY_DURATION_MS);
    } else {
      render(data);
    }
  } catch (err) {
    console.error("Overlay-Update fehlgeschlagen:", err);
  }
}

tick();
setInterval(tick, REFRESH_MS);
