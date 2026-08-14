/* ==========================================================
   KONFIGURATION – hier deine Werte eintragen
   ========================================================== */
const SHEET_ID = "1wPc2gtuH7GM27OcCLJ5aYjlYbRSERNjbAI5VRsmPb9g"; // aus der Sheet-URL zwischen /d/ und /edit
const SHEET_GID = "0";                       // Tab-ID, "0" ist meist der erste Tab
const REFRESH_MS = 5000;                     // wie oft neu geladen wird (ms)
const ODOMETER_CELL_H = 18;                  // Höhe einer Ziffer in px (muss zu style.css .odometer-cell passen)
const ODOMETER_DURATION_MS = 1500;           // Dauer der Ziffern-Hochroll-Animation

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
   -> Gesamtsieger "Gewinnbaum": Punktestand > die Hälfte von D40
   -> Gesamtsieger "Einfach": mehr als die Hälfte aller Spiele gewonnen
   -> beim erstmaligen Erreichen des Sieges: Konfetti + Krone neben dem Namen

   J2   -> Siegbedingung im Klartext, wird vereinfacht als Titel über
           dem Punktestand angezeigt. Erkannte Muster:
           - "Wer X von Y Spielen für sich entscheidet, gewinnt"
             -> Anzeige: "Best of Y"
           - "Erster mit X Punkten gewinnt"
             -> Anzeige: "Ziel: X Punkte"
           Passt der Text auf keins der beiden Muster, wird er
           unverändert als Titel übernommen. Ist J2 leer, bleibt
           der Titel ausgeblendet.

   M2, M3, M4 -> Kontrollkästchen zur Auswahl des Overlay-Designs
      M2 = Design 1 "Standard" (abgerundete Pillen, wie bisher)
      M3 = Design 2 "Karten"   (kantigere Karten mit Farbbalken)
      M4 = Design 3 "Comic"    (knallige Verlaufs-Pillen, Gameshow-Look)
   -> ist keine oder mehrere Boxen angehakt, bleibt das zuletzt gültige
      Design aktiv (Start-Default: Design 1)

   P2:P -> Liveticker-Meldungen (eine Meldung pro Zelle, beliebig viele)
   -> ist P2 leer, wird kein Ticker angezeigt
   -> ab P3 werden weitere Meldungen mit einem Trenner aneinandergereiht
      und laufen als endlos wiederholtes Band von links nach rechts

   Matchball: ein Teilnehmer hat "Matchball", wenn er mit dem Sieg im
   nächsten (noch nicht gespielten) Spiel den Gesamtsieg erringen würde.
   -> "Gewinnbaum": aktueller Punktestand + Punkte des nächsten Spiels
      (Spalte D der Zeile, in der Spalte C noch leer ist) > die Hälfte
      der Gesamtpunktsumme (robust erkannte Summenzeile, siehe unten)
   -> "Einfach": bereits gewonnene Spiele + 1 (für das nächste Spiel)
      > die Hälfte aller im Turnier gelisteten Spiele
   -> wer schon Gesamtsieger ist, bekommt keine Matchball-Markierung mehr
*/

const TOTAL_POINTS_ROW = 40; // Sheet-Zeile, in der die Gesamtpunktsumme (Spalte D) stehen SOLLTE
// Hinweis: Google's gviz-API überspringt in ihrer JSON-Antwort komplett leere
// Zeilen, wodurch sich "rowIndex" gegenüber der echten Sheet-Zeile verschieben
// kann. Deshalb wird die Summenzeile NICHT primär über TOTAL_POINTS_ROW erkannt,
// sondern zusätzlich inhaltlich: die Zeile, in der A/B/C leer sind und nur D
// einen Wert hat (siehe totalPointsFromContent weiter unten).

const gameNumberEl = document.getElementById("game-number");
const playersEl = document.getElementById("players");
const winConditionEl = document.getElementById("win-condition");
const tickerEl = document.getElementById("ticker");
const tickerTrackEl = document.getElementById("ticker-track");

const TICKER_SPEED_PX_S = 70; // Lauftempo des Tickers (px/Sekunde), unabhängig von der Textlänge konstant

let lastScores = {};     // zum Erkennen von Punkteänderungen (für den Puls-Effekt)
let winnerName = null;   // Name des aktuellen Gesamtsiegers (für Krone + Konfetti)
let currentDesign = 1;   // aktives Overlay-Design (1-3), Default = Standard
let lastTickerKey = null; // zum Erkennen, ob sich die Ticker-Meldungen geändert haben

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

// Google Sheets liefert Kontrollkästchen als boolean true/false (manchmal
// auch als String "TRUE"/"FALSE"), daher robust auf beides prüfen.
function isChecked(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return false;
  return cell.v === true || cell.v === "TRUE" || cell.v === 1;
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
  let design = null; // 1 = Standard, 2 = Karten, 3 = Comic (aus M2/M3/M4)
  let winConditionRaw = ""; // Rohtext aus J2 (Siegbedingung)
  const players = [];
  const gameRows = [];
  const tickerMessages = [];

  rows.forEach((row, rowIndex) => {
    const cells = row.c || [];
    const rowNumber = rowIndex + 2;       // Sheet-Zeilennummer (Zeile 1 = Header, A2 = erste Datenzeile)
    const name = cellValue(cells[0]);     // Spalte A
    const gameName = cellValue(cells[1]); // Spalte B
    const winner = cellValue(cells[2]);   // Spalte C
    const points = cellValue(cells[3]);   // Spalte D
    const score = cellValue(cells[4]);    // Spalte E
    const system = cellValue(cells[5]);   // Spalte F
    const winConditionText = cellValue(cells[9]); // Spalte J (Siegbedingung, nur J2 relevant)
    const designBox = cells[12];          // Spalte M (Kontrollkästchen)
    const tickerText = cellValue(cells[15]); // Spalte P (Liveticker-Meldung)

    if (rowNumber === 2 && winConditionText !== "") {
      winConditionRaw = String(winConditionText).trim();
    }

    if (tickerText !== "") {
      tickerMessages.push(String(tickerText).trim());
    }

    if (system !== "" && scoreSystem === "") {
      scoreSystem = String(system).trim();
    }

    // Design-Auswahl über die Kontrollkästchen in M2 (Zeile 2), M3 (Zeile 3)
    // und M4 (Zeile 4). Ist mehr als eine Box angehakt, gewinnt die zuerst
    // gefundene (M2 vor M3 vor M4).
    if (design === null && isChecked(designBox)) {
      if (rowNumber === 2) design = 1;
      else if (rowNumber === 3) design = 2;
      else if (rowNumber === 4) design = 3;
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
      // rawPoints = unveränderter Wert aus Spalte D, wird für die
      // Matchball-Berechnung im Modus "Gewinnbaum" benötigt.
      const rawPoints = points === "" ? 0 : Number(points);
      gameRows.push({ index: gameCount, winner, points: effectivePoints, rawPoints });
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

  return { currentGame, players, gameRows, scoreSystem, totalPointsAvailable, design, tickerMessages, winConditionRaw };
}

// Vereinfacht den Klartext aus J2 zu einem kurzen Titel.
// Erkennt die beiden üblichen Formulierungen und kürzt sie auf das
// Wesentliche; unbekannte Formulierungen werden unverändert übernommen.
function simplifyWinCondition(raw) {
  if (!raw) return "";
  const text = String(raw).trim();

  // "Wer X von Y Spielen für sich entscheidet, gewinnt" -> "Best of Y"
  let match = text.match(/wer\s+\d+\s+von\s+(\d+)\s+spielen?\b/i);
  if (match) return `Best of ${match[1]}`;

  // "Erster mit X Punkten gewinnt" -> "Ziel: X Punkte"
  match = text.match(/erster\s+mit\s+(\d+)\s+punkten?\b/i);
  if (match) return `Win Condition: ${match[1]} Punkte`;

  return text;
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

// Ermittelt, welche Teilnehmer mit dem Sieg im nächsten (noch nicht
// gespielten) Spiel den Gesamtsieg erringen würden ("Matchball").
// Wer schon Gesamtsieger ist, wird nicht mehr als Matchball markiert.
function computeMatchballPlayers({ players, gameRows, scoreSystem, totalPointsAvailable, currentGame }, winnerName) {
  const matchballNames = new Set();

  if (scoreSystem === "Gewinnbaum") {
    if (!totalPointsAvailable || currentGame === null) return matchballNames;
    // "nächstes Spiel" = die Zeile, in der Spalte C (Gewinner) noch leer ist
    const nextGameRow = gameRows.find((g) => g.index === currentGame);
    if (!nextGameRow || !nextGameRow.rawPoints) return matchballNames; // Spiel noch nicht im Sheet angelegt / keine Punkte hinterlegt
    const threshold = totalPointsAvailable / 2;
    players.forEach((p) => {
      if (p.name === winnerName) return;
      if (p.score + nextGameRow.rawPoints > threshold) matchballNames.add(p.name);
    });
    return matchballNames;
  }

  if (scoreSystem === "Einfach") {
    const totalGames = gameRows.length;
    if (totalGames === 0) return matchballNames;
    const threshold = totalGames / 2;
    const winCounts = {};
    gameRows.forEach((g) => {
      if (g.winner) winCounts[g.winner] = (winCounts[g.winner] || 0) + 1;
    });
    players.forEach((p) => {
      if (p.name === winnerName) return;
      const count = winCounts[p.name] || 0;
      if (count + 1 > threshold) matchballNames.add(p.name); // +1 = würde das nächste Spiel auch noch gewinnen
    });
    return matchballNames;
  }

  return matchballNames;
}

/* ==========================================================
   Odometer-Animation für den Punktestand (Ziffern rollen hoch)
   ========================================================== */

// Baut die Zelle(n) einer Ziffern-Walze
function odometerCellsHTML(digits) {
  return digits.map((d) => `<span class="odometer-cell">${d}</span>`).join("");
}

// Statische Anzeige (keine Animation nötig, z.B. beim ersten Laden)
function staticScoreHTML(value) {
  return String(value)
    .split("")
    .map(
      (ch) =>
        `<span class="odometer-digit"><span class="odometer-strip">${odometerCellsHTML([ch])}</span></span>`
    )
    .join("");
}

// Animiert den Wechsel von oldValue -> newValue. Jede Ziffer dreht sich
// dabei immer nach unten (neue Ziffer schiebt sich von oben rein), und
// zwar direkt zur Zielziffer – ohne andere Ziffern erst durchlaufen zu lassen,
// außer es liegen tatsächlich mehrere Schritte dazwischen (z.B. 2 -> 3 = ein
// einzelner Schritt, 7 -> 2 = fünf Schritte, immer vorwärts/nach unten gezählt).
function animateScoreChange(container, oldValue, newValue) {
  const oldStr = String(oldValue);
  const newStr = String(newValue);

  if (oldStr === newStr) {
    container.innerHTML = staticScoreHTML(newValue);
    return;
  }

  const maxLen = Math.max(oldStr.length, newStr.length);
  const oldPadded = oldStr.padStart(maxLen, " ");
  const newPadded = newStr.padStart(maxLen, " ");

  container.innerHTML = "";
  const spinning = []; // { strip, totalSteps }
  const entering = []; // neu auftauchende Ziffern (z.B. von 9 auf 10)

  for (let i = 0; i < maxLen; i++) {
    const oldCh = oldPadded[i];
    const newCh = newPadded[i];

    if (newCh === " ") continue; // Ziffer fällt weg (Zahl wurde kürzer) -> einfach auslassen

    const digitWrapper = document.createElement("span");
    digitWrapper.className = "odometer-digit";
    const strip = document.createElement("span");
    strip.className = "odometer-strip";
    digitWrapper.appendChild(strip);
    container.appendChild(digitWrapper);

    if (oldCh === newCh) {
      strip.innerHTML = odometerCellsHTML([newCh]);
      continue; // unverändert, keine Animation nötig
    }

    if (oldCh === " ") {
      // neue Ziffer taucht links auf (Zahl wird länger) -> einfach einblenden,
      // kein Durchrollen anderer Ziffern
      strip.innerHTML = odometerCellsHTML([newCh]);
      digitWrapper.classList.add("odometer-digit--enter");
      entering.push(digitWrapper);
      continue;
    }

    const d0 = parseInt(oldCh, 10);
    const d1 = parseInt(newCh, 10);
    const totalSteps = (d1 - d0 + 10) % 10; // immer vorwärts zählen (nie rückwärts)

    // Ziffern-Walze von oben nach unten aufbauen: oberste Zelle = Zielziffer,
    // unterste Zelle = aktuelle Ziffer. Start-Position zeigt die unterste
    // Zelle (= aktuelle Ziffer); beim Runterdrehen rutscht die Walze auf 0,
    // wodurch die Zielziffer von oben ins Bild kommt.
    const seq = Array.from({ length: totalSteps + 1 }, (_, p) => (d0 + (totalSteps - p)) % 10);
    strip.innerHTML = odometerCellsHTML(seq);
    strip.style.transform = `translateY(-${totalSteps * ODOMETER_CELL_H}px)`;
    spinning.push({ strip, totalSteps });
  }

  // Reflow erzwingen, damit die Transitions beim nächsten Frame greifen
  void container.offsetHeight;
  requestAnimationFrame(() => {
    spinning.forEach(({ strip }) => {
      strip.style.transition = `transform ${ODOMETER_DURATION_MS}ms cubic-bezier(0.45, 0, 0.15, 1)`;
      strip.style.transform = "translateY(0)";
    });
    entering.forEach((el) => el.classList.add("odometer-digit--enter-active"));
  });

  // Nach der Animation aufräumen: Walze wieder auf eine einzelne Zelle reduzieren
  setTimeout(() => {
    spinning.forEach(({ strip }) => {
      const finalDigit = strip.firstElementChild ? strip.firstElementChild.textContent : "";
      strip.style.transition = "none";
      strip.innerHTML = odometerCellsHTML([finalDigit]);
      strip.style.transform = "translateY(0)";
    });
  }, ODOMETER_DURATION_MS + 60);
}

// Zeigt die vereinfachte Siegbedingung (aus J2) als Titel über dem
// Punktestand an. Ist J2 leer, bleibt der Titel ausgeblendet.
function updateWinCondition(raw) {
  const simplified = simplifyWinCondition(raw);
  if (!simplified) {
    winConditionEl.hidden = true;
    winConditionEl.textContent = "";
    return;
  }
  winConditionEl.textContent = simplified;
  winConditionEl.hidden = false;
}

function render({ currentGame, players }, matchballNames = new Set()) {
  gameNumberEl.textContent = currentGame !== null ? currentGame : "–";

  playersEl.querySelectorAll(".pill--player").forEach((el) => el.remove());

  players.forEach((player, i) => {
    const colorClass = `c-${(i % 5) + 1}`;
    const prevScore = lastScores[player.name];
    const changed = prevScore !== undefined && prevScore !== player.score;
    const isWinner = player.name === winnerName;
    const isMatchball = !isWinner && matchballNames.has(player.name);

    const pill = document.createElement("div");
    pill.className = `pill pill--player ${colorClass}${changed ? " pulse" : ""}${isWinner ? " winner" : ""}${isMatchball ? " matchball" : ""}`;
    pill.dataset.name = player.name;
    pill.innerHTML = `
      <span class="player-name">${player.name}${isWinner ? '<span class="crown" aria-hidden="true">👑</span>' : ""}${isMatchball ? '<span class="matchball-badge" aria-hidden="true" title="Matchball">🎯</span>' : ""}</span>
      <span class="player-score"></span>
    `;
    playersEl.appendChild(pill);

    const scoreEl = pill.querySelector(".player-score");
    if (changed) {
      animateScoreChange(scoreEl, prevScore, player.score);
    } else {
      scoreEl.innerHTML = staticScoreHTML(player.score);
    }

    lastScores[player.name] = player.score;
  });

  // Einheitliche Breite für alle Spieler-Pillen, damit die Punktestände
  // rechtsbündig untereinander stehen – unabhängig von der Namenslänge.
  const pills = Array.from(playersEl.querySelectorAll(".pill--player"));
  if (pills.length) {
    pills.forEach((p) => { p.style.width = "auto"; });
    const maxWidth = Math.max(...pills.map((p) => p.getBoundingClientRect().width));
    pills.forEach((p) => { p.style.width = `${Math.ceil(maxWidth)}px`; });
  }
}

// Kleiner Konfetti-Regen, begrenzt auf den Bereich des Scoreboards (#overlay)
function spawnConfetti(count = 70) {
  const colors = ["#e63946", "#3a86ff", "#2ecc71", "#f4c430", "#9d7bd8", "#ffd700"];
  const overlayEl = document.getElementById("overlay");
  const rect = overlayEl ? overlayEl.getBoundingClientRect() : {
    left: 0, top: 0, width: window.innerWidth, height: window.innerHeight,
  };

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${rect.left + Math.random() * rect.width}px`;
    piece.style.top = `${rect.top - 16}px`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${1.6 + Math.random() * 1.1}s`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    piece.style.setProperty("--rot", `${360 + Math.random() * 360}deg`);
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * rect.width * 0.7}px`);
    piece.style.setProperty("--fall", `${rect.height + 40 + Math.random() * 40}px`);
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 3200);
  }
}

function celebrateWinner() {
  spawnConfetti();
}

// Zeigt kurz einen Banner "<Name> hat gewonnen!" über dem Overlay an,
// der nach ein paar Sekunden von selbst wieder verschwindet.
function showWinnerBanner(name) {
  const overlayEl = document.getElementById("overlay");
  const rect = overlayEl ? overlayEl.getBoundingClientRect() : {
    left: window.innerWidth / 2, top: 40, width: 0,
  };

  const banner = document.createElement("div");
  banner.className = "winner-banner";
  banner.textContent = `🏆 ${name} hat gewonnen!`;
  banner.style.left = `${rect.left + rect.width / 2}px`;
  banner.style.top = `${rect.top - 10}px`;
  document.body.appendChild(banner);

  setTimeout(() => banner.remove(), 4300); // an animation duration (4.2s) angepasst
}

/* ==========================================================
   Liveticker: läuft nur, wenn mind. eine Meldung vorhanden ist.
   Zwei identische Kopien der Meldungskette hintereinander ->
   nahtloser Endlos-Loop, Geschwindigkeit konstant unabhängig
   von der Textlänge.
   ========================================================== */

// Baut eine "Kopie" der aneinandergereihten Meldungen inkl. Trennzeichen
function buildTickerCopy(messages) {
  const wrapper = document.createElement("span");
  wrapper.className = "ticker-copy";
  messages.forEach((msg, i) => {
    const item = document.createElement("span");
    item.className = "ticker-item";
    item.textContent = msg;
    wrapper.appendChild(item);

    if (i < messages.length - 1) {
      const sep = document.createElement("span");
      sep.className = "ticker-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "✦";
      wrapper.appendChild(sep);
    }
  });
  return wrapper;
}

function updateTicker(messages) {
  if (!messages || messages.length === 0) {
    tickerEl.hidden = true;
    tickerTrackEl.innerHTML = "";
    tickerTrackEl.style.animationDuration = "";
    lastTickerKey = null;
    return;
  }

  // Läuft schon exakt dieser Meldungssatz? Dann nichts anfassen, damit
  // die laufende Animation nicht bei jedem Refresh (alle 5s) neu startet.
  const key = messages.join("||");
  if (key === lastTickerKey && !tickerEl.hidden) return;
  lastTickerKey = key;

  tickerEl.hidden = false;
  tickerTrackEl.innerHTML = "";
  tickerTrackEl.appendChild(buildTickerCopy(messages));
  tickerTrackEl.appendChild(buildTickerCopy(messages)); // zweite Kopie für den nahtlosen Loop

  // Lauftempo an die Textlänge anpassen, damit es immer gleich schnell wirkt
  requestAnimationFrame(() => {
    const singleCopyWidth = tickerTrackEl.firstElementChild
      ? tickerTrackEl.firstElementChild.getBoundingClientRect().width
      : 0;
    const duration = Math.max(singleCopyWidth / TICKER_SPEED_PX_S, 6);
    tickerTrackEl.style.animationDuration = `${duration}s`;
  });
}

// Passt die Ticker-Breite an die aktuelle Breite von #overlay an (von der
// Spielnummer-Pille bis zum Ende der breitesten Teilnehmer-Kapsel), damit
// der Ticker nicht die ganze Seite einnimmt, sondern exakt zum Overlay passt.
function syncTickerWidth() {
  const overlayEl = document.getElementById("overlay");
  if (!overlayEl) return;
  const width = overlayEl.getBoundingClientRect().width;
  if (width > 0) tickerEl.style.width = `${Math.ceil(width)}px`;
}

async function tick() {
  try {
    const data = await fetchSheetData();

    // Sieger neu ermitteln; Konfetti nur auslösen, wenn sich jemand NEU krönt
    const winner = computeWinner(data);
    const newWinnerName = winner ? winner.name : null;
    const winnerChanged = newWinnerName !== winnerName;
    winnerName = newWinnerName;

    // Design nur wechseln, wenn tatsächlich eine Box angehakt ist;
    // ansonsten bleibt das zuletzt gültige Design aktiv.
    if (data.design !== null) currentDesign = data.design;
    document.body.dataset.design = String(currentDesign);

    const matchballNames = computeMatchballPlayers(data, winnerName);

    updateWinCondition(data.winConditionRaw);
    render(data, matchballNames);
    syncTickerWidth();
    updateTicker(data.tickerMessages);
    if (winnerChanged && winnerName) {
      celebrateWinner();
      showWinnerBanner(winnerName);
    }
  } catch (err) {
    console.error("Overlay-Update fehlgeschlagen:", err);
  }
}

tick();
setInterval(tick, REFRESH_MS);
