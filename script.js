/* ==========================================================
   KONFIGURATION – hier deine Werte eintragen
   ========================================================== */
const SHEET_ID = "1wPc2gtuH7GM27OcCLJ5aYjlYbRSERNjbAI5VRsmPb9g"; // aus der Sheet-URL zwischen /d/ und /edit
const SHEET_GID = "0";                       // Tab-ID, "0" ist meist der erste Tab
const REFRESH_MS = 5000;                     // wie oft neu geladen wird (ms)

/* Spalten:
   A2:A -> Teilnehmername
   E2:E -> Punktestand
   B2:B -> Spielnummer je Runde
   C2:C -> Gewinner dieser Runde (leer = Runde läuft noch)
   -> das aktuelle Spiel ist die erste Zeile ohne Eintrag in C
*/

const gameNumberEl = document.getElementById("game-number");
const playersEl = document.getElementById("players");

let lastScores = {}; // zum Erkennen von Punkteänderungen (für den Puls-Effekt)

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
  const players = [];

  rows.forEach((row) => {
    const cells = row.c || [];
    const name = cellValue(cells[0]);   // Spalte A
    const gameNo = cellValue(cells[1]); // Spalte B
    const winner = cellValue(cells[2]); // Spalte C
    const score = cellValue(cells[4]);  // Spalte E

    if (gameNo !== "" && winner === "" && currentGame === null) {
      currentGame = gameNo;
    }
    if (name !== "") {
      players.push({ name, score: score === "" ? 0 : score });
    }
  });

  return { currentGame, players };
}

function render({ currentGame, players }) {
  gameNumberEl.textContent = currentGame !== null ? currentGame : "–";

  playersEl.querySelectorAll(".pill--player").forEach((el) => el.remove());

  players.forEach((player, i) => {
    const colorClass = `c-${(i % 5) + 1}`;
    const changed = lastScores[player.name] !== undefined && lastScores[player.name] !== player.score;

    const pill = document.createElement("div");
    pill.className = `pill pill--player ${colorClass}${changed ? " pulse" : ""}`;
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
    render(data);
  } catch (err) {
    console.error("Overlay-Update fehlgeschlagen:", err);
  }
}

tick();
setInterval(tick, REFRESH_MS);
