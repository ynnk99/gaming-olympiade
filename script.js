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
   D40  -> Summe aller im Turnier vergebenen Punkte (nur relevant im Modus "Gewinnbaum")
   F2   -> Wertungssystem ("Einfach" oder "Gewinnbaum")
   -> das aktuelle Spiel ist die erste Zeile ohne Eintrag in C
   -> bei "Gewinnbaum" entspricht die Punktzahl eines Spiels immer
      seiner Spielnummer (Spiel 3 = 3 Punkte, unabhängig von Spalte D)
   -> bei "Gewinnbaum" fliegen die Punkte beim Eintragen eines
      Gewinners animiert von der Spielnummer zu dessen Punktestand
   -> Gesamtsieger "Gewinnbaum": Punktestand > die Hälfte von D40
   -> Gesamtsieger "Einfach": mehr als die Hälfte aller Spiele gewonnen
   -> beim erstmaligen Erreichen des Sieges: Konfetti + Krone neben dem Namen
*/

const TOTAL_POINTS_ROW = 40; // Sheet-Zeile, in der die Gesamtpunktsumme (Spalte D) stehen SOLLTE
// Hinweis: Google's gviz-API überspringt in ihrer JSON-Antwort komplett leere
// Zeilen, wodurch sich "rowIndex" gegenüber der echten Sheet-Zeile verschieben
// kann. Deshalb wird die Summenzeile NICHT primär über TOTAL_POINTS_ROW erkannt,
// sondern zusätzlich inhaltlich: die Zeile, in der A/B/C leer sind und nur D
// einen Wert hat (siehe totalPointsFromContent weiter unten).

const gameNumberEl = document.getElementById("game-number");
const gamePillEl = document.getElementById("game-pill");
const playersEl = document.getElementById("players");

let lastScores = {};     // zum Erkennen von Punkteänderungen (für den Puls-Effekt)
let prevGameRows = null; // zum Erkennen frisch eingetragener Gewinner (für die Flug-Animation)
let winnerName = null;   // Name des aktuellen Gesamtsiegers (für Krone + Konfetti)

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
  let totalPointsAvailable = null;
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

    // Spielnummer = Position der Zeile innerhalb der "Spiele"-Liste.
    // Eine Zeile zählt als Spiel, sobald Spalte B (Name) ODER Spalte C
    // (Gewinner) befüllt ist – so bleibt die Nummerierung auch dann korrekt,
    // wenn ein Gewinner schon eingetragen wurde, bevor der Spielname steht.
    if (gameName !== "" || winner !== "") {
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
    if (rowNumber === TOTAL_POINTS_ROW && points !== "") {
      totalPointsAvailable = points;
    }
    // Zusätzliche, robuste Erkennung: eine Zeile, die NUR in Spalte D einen
    // Wert hat (kein Spielername, kein Gewinner, kein Teilnehmername), ist
    // eindeutig die Gesamtpunktsumme – unabhängig davon, an welcher
    // tatsächlichen Zeilennummer sie in der gviz-Antwort landet.
    if (name === "" && gameName === "" && winner === "" && points !== "") {
      totalPointsAvailable = points;
    }
  });

  // Alle bisherigen Spiele haben schon einen Gewinner -> nächstes Spiel ist "dran"
  if (currentGame === null && gameCount > 0) {
    currentGame = gameCount + 1;
  }

  return { currentGame, players, gameRows, scoreSystem, totalPointsAvailable };
}

// Ermittelt den Gesamtsieger (falls die Siegbedingung schon erfüllt ist)
function computeWinner({ players, gameRows, scoreSystem, totalPointsAvailable }) {
  if (scoreSystem === "Gewinnbaum") {
    if (!totalPointsAvailable) return null;
    const threshold = totalPointsAvailable / 2;
    return players.find((p) => p.score > threshold) || null;
  }

  if (scoreSystem === "Einfach") {
    const totalGames = gameRows.length;
    if (totalGames === 0) return null;
    const threshold = totalGames / 2;

    const winCounts = {};
    gameRows.forEach((g) => {
      if (g.winner) winCounts[g.winner] = (winCounts[g.winner] || 0) + 1;
    });

    const winnerEntry = Object.entries(winCounts).find(([, count]) => count > threshold);
    if (!winnerEntry) return null;
    return players.find((p) => p.name === winnerEntry[0]) || null;
  }

  return null;
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
    const isWinner = player.name === winnerName;

    const pill = document.createElement("div");
    pill.className = `pill pill--player ${colorClass}${changed ? " pulse" : ""}${isWinner ? " winner" : ""}`;
    pill.dataset.name = player.name;
    pill.innerHTML = `
      <span class="player-name">${player.name}${isWinner ? '<span class="crown" aria-hidden="true">👑</span>' : ""}</span>
      <span class="player-score">${player.score}</span>
    `;
    playersEl.appendChild(pill);

    lastScores[player.name] = player.score;
  });
}

// Kleiner Konfetti-Regen quer über den Screen (kein externes Assett nötig)
function spawnConfetti(count = 90) {
  const colors = ["#e63946", "#3a86ff", "#2ecc71", "#f4c430", "#9d7bd8", "#ffd700"];

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.setProperty("--rot", `${360 + Math.random() * 360}deg`);
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 220}px`);
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4500);
  }
}

function celebrateWinner() {
  spawnConfetti();
}

async function tick() {
  try {
    const data = await fetchSheetData();
    const completed = prevGameRows ? findNewlyCompletedGames(prevGameRows, data.gameRows) : [];
    prevGameRows = data.gameRows;

    // Sieger neu ermitteln; Konfetti nur auslösen, wenn sich jemand NEU krönt
    const winner = computeWinner(data);
    const newWinnerName = winner ? winner.name : null;
    const winnerChanged = newWinnerName !== winnerName;
    winnerName = newWinnerName;

    if (completed.length && data.scoreSystem === "Gewinnbaum") {
      completed.forEach((g) => flyPointsTo(g.points, g.winner));
      // Punktestand erst updaten, wenn die Flug-Animation gelandet ist
      setTimeout(() => {
        render(data);
        if (winnerChanged && winnerName) celebrateWinner();
      }, FLY_DURATION_MS);
    } else {
      render(data);
      if (winnerChanged && winnerName) celebrateWinner();
    }
  } catch (err) {
    console.error("Overlay-Update fehlgeschlagen:", err);
  }
}

tick();
setInterval(tick, REFRESH_MS);
