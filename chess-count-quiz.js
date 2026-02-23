// -----------------------------------------------------------
// Global variables

let chess_data = null; // See loadSettings for value of chess_data
let gameEnded = false;
let timerInterval = null;

// -----------------------------------------------------------
// Chess functions

// Return the number of possible checking moves
function countChecks(game) {
  const moves = game.moves({ verbose: true });

  const checkingMoves = moves.filter((m) => {
    const tempGame = new Chess(game.fen());
    tempGame.move(m);
    return tempGame.in_check();
  });

  return {
    count: checkingMoves.length,
    moves: checkingMoves.map((m) => m.san),
    targets: checkingMoves.map((m) => ({ to: m.to, piece: m.piece })),
  };
}

// Return the number of possible capturing moves
function countCaptures(game) {
  const moves = game.moves({ verbose: true });
  const capturingMoves = moves.filter((m) => m.flags.includes("c") || m.flags.includes("e"));

  return {
    count: capturingMoves.length,
    moves: capturingMoves.map((m) => m.san),
    targets: capturingMoves.map((m) => ({ to: m.to, piece: m.piece })),
  };
}

// Return the total number of moves
function countAllLegal(game) {
  const moves = game.moves({ verbose: true });

  return {
    count: moves.length,
    moves: moves.map((m) => m.san),
    targets: moves.map((m) => ({ to: m.to, piece: m.piece })),
  };
}

// Return a game where it's the specified player to move ('w' or 'b') from the given FEN
function switchFenSides(fen, side) {
  const fenParts = fen.split(" ");
  fenParts[1] = side;
  return fenParts.join(" ");
}

// Return array of PGN games
async function getGames() {
  const path = "lichess-puzzles/selected_games.pgn";
  console.log("Loading games from:", path);
  const response = await fetch(path);
  const text = await response.text();
  console.log("Raw PGN text length:", text.length);

  // Split into potential games (sections separated by blank lines)
  const sections = text.split("\n\n").filter((section) => section.trim() !== "");

  // Combine header and moves sections into complete games
  const games = [];
  let currentGame = "";

  for (const section of sections) {
    if (section.startsWith("[")) {
      if (currentGame) games.push(currentGame.trim());
      currentGame = section;
    } else {
      currentGame += "\n\n" + section;
    }
  }

  if (currentGame) games.push(currentGame.trim());

  console.log("Number of games found:", games.length);
  if (games.length <= 0) console.log("Error with PGN file");
  return games;
}

// Load the game weights file and return parsed weights
async function getWeights() {
  const path = "lichess-puzzles/selected_weights.json";
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const weights = await response.json();
    console.log(`Loaded ${weights.length} weight rows`);
    return weights;
  } catch (error) {
    console.error("Failed to load game stats:", error);
    return null;
  }
}

function getRandomPosNumber(game_weights, white) {
  // white => pick even ply, false => pick odd ply
  const filtered = game_weights.filter((entry) => (white ? entry.ply % 2 === 0 : entry.ply % 2 !== 0));
  if (filtered.length === 0) throw new Error("No entries available for the specified color.");

  const totalWeight = filtered.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = Math.random() * totalWeight;

  for (let i = 0; i < filtered.length; i++) {
    threshold -= filtered[i].weight;
    if (threshold < 0) {
      console.log(`Selected: game=${filtered[i].game}, ply=${filtered[i].ply}, weight=${filtered[i].weight}`);
      return { game: filtered[i].game, ply: filtered[i].ply };
    }
  }

  // fallback (ne devrait jamais arriver)
  return { game: filtered[0].game, ply: filtered[0].ply };
}

// Return a game object with the given index
function getGame(game_index, ply) {
  const game = new Chess();
  const pgn = chess_data.games[game_index];
  console.log("PGN length:", pgn.length);

  const parsedGame = game.load_pgn(pgn);
  if (!parsedGame) {
    console.log("Error parsing PGN");
    return null;
  }

  const moves = game.history();
  game.reset();
  for (let i = 0; i < ply; i++) game.move(moves[i]);
  return game;
}

// Return object with correct counts for black and white from given fen
function getCorrectAnswers(fen, questionTypes) {
  return questionTypes.reduce((result, quesType) => {
    result[quesType] = getOneCorrectAnswer(fen, quesType);
    return result;
  }, {});
}

function getOneCorrectAnswer(fen, questionType) {
  let modFen;

  if (questionType.startsWith("p1")) {
    modFen = switchFenSides(fen, chess_data.playerToMove);
  } else if (questionType.startsWith("p2")) {
    const p2Color = chess_data.playerToMove === "w" ? "b" : "w";
    modFen = switchFenSides(fen, p2Color);
  } else {
    throw new RangeError("Expected p1 or p2");
  }

  const game = new Chess();
  game.load(modFen);

  if (questionType.endsWith("Checks")) return countChecks(game);
  if (questionType.endsWith("Captures")) return countCaptures(game);
  if (questionType.endsWith("AllLegal")) return countAllLegal(game);

  throw new RangeError("Expected Checks or Captures or AllLegal");
}

// -----------------------------------------------------------
// Timer and score code

function updateTimerDisplay() {
  const minutes = Math.floor(chess_data.timeRemaining / 60);
  const seconds = chess_data.timeRemaining % 60;
  const timerEl = document.getElementById("timer");
  if (!timerEl) return;

  timerEl.textContent = `Time: ${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function incrementScore() {
  chess_data.score++;
  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = `Score: ${chess_data.score}`;
}

function resetScore() {
  chess_data.score = 0;
  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = `Score: ${chess_data.score}`;
}

function initTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  updateTimerDisplay();
  timerInterval = setInterval(() => {
    if (gameEnded) return;

    chess_data.timeRemaining = Math.max(0, chess_data.timeRemaining - 1);
    updateTimerDisplay();

    if (chess_data.timeRemaining <= 0) endGame();
  }, 1000);
}

function startTimer() {
  if (chess_data.showTimer) chess_data.timeRemaining = chess_data.defaultTimeRemaining;
  else chess_data.timeRemaining = Infinity;

  setTimerVisibility(chess_data.showTimer);
  updateTimerDisplay();
}

function penalizeTime() {
  chess_data.timeRemaining = Math.max(0, chess_data.timeRemaining - 10);
  updateTimerDisplay();
  if (chess_data.timeRemaining <= 0) endGame();
}

// -----------------------------------------------------------
// Display ordering (White then Black, Moves->Checks->Captures)

function qTypeForAbsColorAndKind(color, kind) {
  const p1Color = chess_data.playerToMove; // side to move
  const prefix = color === p1Color ? "p1" : "p2";
  return `${prefix}${kind}`;
}

function getFixedDisplayQuestionTypes() {
  const kinds = ["AllLegal", "Checks", "Captures"];
  const out = [];

  ["w", "b"].forEach((color) => {
    kinds.forEach((kind) => {
      const qt = qTypeForAbsColorAndKind(color, kind);
      if (Array.isArray(chess_data.questionTypes) && chess_data.questionTypes.includes(qt)) out.push(qt);
    });
  });

  return out;
}

// -----------------------------------------------------------
// Reveal answers (numbers near inputs + moves list in #movesList)

function revealAnswers() {
  const movesList = document.getElementById("movesList");
  if (movesList) {
    movesList.innerHTML = "";
    movesList.style.display = "block";
  }

  getFixedDisplayQuestionTypes().forEach((id) => {
    const shownMovesLabel = document.getElementById(id + "ShownMoves");
    const correct = chess_data.correct?.[id];
    if (!shownMovesLabel || !correct) return;

    const movesText = Array.isArray(correct.moves) ? correct.moves.join(", ") : "";

    // next to inputs: ONLY the number
    shownMovesLabel.innerHTML = `<span style="font-weight:700; font-size:1.4em;">${correct.count}</span>`;

    // bottom list: label + (moves)
    if (movesList) {
      const row = document.createElement("div");
      row.className = "movesRow";

      const lab = document.createElement("div");
      lab.className = "movesLabel";
      lab.textContent = createDynamicInputsLabel(id);

      const txt = document.createElement("div");
      txt.className = "movesText";
      txt.textContent = movesText ? `(${movesText})` : "";

      row.appendChild(lab);
      row.appendChild(txt);
      movesList.appendChild(row);
    }
  });

  const showMovesButton = document.getElementById("showMovesButton");
  if (showMovesButton) {
    showMovesButton.disabled = true;
    showMovesButton.style.backgroundColor = "#d3d3d3";
  }
}

function endGame() {
  if (gameEnded) return;
  gameEnded = true;

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  revealAnswers();
}

// -----------------------------------------------------------
// Board square highlights

function clearBoardHighlights() {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;
  boardEl.querySelectorAll(".hl-red").forEach((el) => el.classList.remove("hl-red"));
}

function highlightSquares(squares) {
  clearBoardHighlights();

  const boardEl = document.getElementById("board");
  if (!boardEl || !Array.isArray(squares)) return;

  squares.forEach((sq) => {
    const el = boardEl.querySelector(`[data-square="${sq}"]`);
    if (el) return el.classList.add("hl-red");

    const el2 = boardEl.querySelector(`.square-${sq}`);
    if (el2) el2.classList.add("hl-red");
  });
}

// -----------------------------------------------------------
// Piece markers (6 zones)

function ensurePieceMarkers() {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;

  const squares = boardEl.querySelectorAll(".square-55d63");

  squares.forEach((sqEl) => {
    if (!sqEl.querySelector(":scope > .pmBig")) {
      const big = document.createElement("div");
      big.className = "pmBig";
      sqEl.appendChild(big);
    }

    if (sqEl.querySelector(":scope > .pm6")) return;

    const wrap = document.createElement("div");
    wrap.className = "pm6";

    ["p", "n", "b", "r", "q", "k"].forEach((piece) => {
      const d = document.createElement("div");
      d.className = `pm ${piece}`;
      wrap.appendChild(d);
    });

    sqEl.appendChild(wrap);
  });
}

function clearPieceMarkers() {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;

  boardEl.querySelectorAll(".pm6 .pm.on, .pm6 .pm.solid").forEach((el) => el.classList.remove("on", "solid"));
}

function clearBigMarkers() {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;

  boardEl.querySelectorAll(".pmBig").forEach((el) => {
    el.classList.remove("on", "side-w", "side-b");
    el.classList.remove("piece-p", "piece-n", "piece-b", "piece-r", "piece-q", "piece-k");
  });
}

function markSquarePiece(square, piece) {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;

  const sqEl = boardEl.querySelector(`[data-square="${square}"]`) || boardEl.querySelector(`.square-${square}`);
  if (!sqEl) return;

  if (!sqEl.querySelector(":scope > .pm6")) ensurePieceMarkers();

  const marker = sqEl.querySelector(`:scope > .pm6 .pm.${piece}`);
  if (marker) marker.classList.add("on");
}

function highlightMovesByPiece(moveList, side) {
  clearPieceMarkers();
  clearBigMarkers();
  ensurePieceMarkers();

  if (!Array.isArray(moveList)) return;

  const map = new Map();

  moveList.forEach((m) => {
    if (!m?.to || !m?.piece) return;
    if (!map.has(m.to)) map.set(m.to, new Map());
    const counts = map.get(m.to);
    counts.set(m.piece, (counts.get(m.piece) || 0) + 1);
  });

  const boardEl = document.getElementById("board");

  for (const [sq, counts] of map.entries()) {
    const piecesDistinct = Array.from(counts.keys());

    piecesDistinct.forEach((p) => markSquarePiece(sq, p));

    const sqEl = boardEl.querySelector(`[data-square="${sq}"]`) || boardEl.querySelector(`.square-${sq}`);
    if (!sqEl) continue;

    const pm6 = sqEl.querySelector(":scope > .pm6");
    if (!pm6) continue;

    for (const p of piecesDistinct) {
      if ((counts.get(p) || 0) >= 2) {
        const mini = pm6.querySelector(`.pm.${p}`);
        if (mini) mini.classList.add("solid");
      }
    }

    const big = sqEl.querySelector(":scope > .pmBig");
    if (!big) continue;

    big.classList.add("on");
    big.classList.remove(
      "piece-p",
      "piece-n",
      "piece-b",
      "piece-r",
      "piece-q",
      "piece-k",
      "side-w",
      "side-b"
    );

    if (piecesDistinct.length === 1) big.classList.add(`piece-${piecesDistinct[0]}`);
    else big.classList.add(side === "w" ? "side-w" : "side-b");
  }
}

function setupHighlightButtons() {
  const byLabel = {
    "white’s moves": { qType: qTypeForAbsColorAndKind("w", "AllLegal"), side: "w" },
    "black’s moves": { qType: qTypeForAbsColorAndKind("b", "AllLegal"), side: "b" },
    "white’s checks": { qType: qTypeForAbsColorAndKind("w", "Checks"), side: "w" },
    "black’s checks": { qType: qTypeForAbsColorAndKind("b", "Checks"), side: "b" },
    "white’s captures": { qType: qTypeForAbsColorAndKind("w", "Captures"), side: "w" },
    "black’s captures": { qType: qTypeForAbsColorAndKind("b", "Captures"), side: "b" },
    clear: { clear: true },
  };

  const norm = (s) =>
    (s || "")
      .trim()
      .toLowerCase()
      .replaceAll("'", "’")
      .replace(/\s+/g, " ");

  document.querySelectorAll("#boardHighlightsControls button").forEach((btn) => {
    const key = norm(btn.textContent);
    const cfg = byLabel[key];
    if (!cfg) return;

    btn.type = "button";
    btn.onclick = () => {
      if (cfg.clear) {
        clearBoardHighlights();
        clearPieceMarkers();
        clearBigMarkers();
        return;
      }

      if (!chess_data.correct) chess_data.correct = {};

      let ans = chess_data.correct[cfg.qType];
      if (!ans) {
        ans = getOneCorrectAnswer(chess_data.fen, cfg.qType);
        chess_data.correct[cfg.qType] = ans;
      }

      if (!ans?.targets) return;
      highlightMovesByPiece(ans.targets, cfg.side);
    };
  });
}

// ----------------------------------------------------------
// Moves table (remainingMoves)

function createMovesTableHtml(movesList, isBlackToMove) {
  let tableHtml = `
        <h3>Compute counts after these moves:</h3>
        <table class="moves-table">
            <tr>
                <th>White</th>
                <th>Black</th>
            </tr>`;

  if (isBlackToMove) {
    tableHtml += `
            <tr>
                <td></td>
                <td>${movesList[0] || ""}</td>
            </tr>`;
    for (let i = 1; i < movesList.length; i += 2) {
      const whiteMove = movesList[i] || "";
      const blackMove = i + 1 < movesList.length ? movesList[i + 1] : "";
      tableHtml += `
                <tr>
                    <td>${whiteMove}</td>
                    <td>${blackMove}</td>
                </tr>`;
    }
  } else {
    for (let i = 0; i < movesList.length; i += 2) {
      const whiteMove = movesList[i] || "";
      const blackMove = i + 1 < movesList.length ? movesList[i + 1] : "";
      tableHtml += `
                <tr>
                    <td>${whiteMove}</td>
                    <td>${blackMove}</td>
                </tr>`;
    }
  }

  tableHtml += "</table>";
  return tableHtml;
}

function updateMovesDisplay() {
  const movesDisplay = document.getElementById("remainingMoves");
  if (!movesDisplay) return;

  if (chess_data.plyAhead === 0) {
    movesDisplay.innerHTML = "";
    return;
  }

  const fullHistory = chess_data.game.history();
  const prevPlyIndex = fullHistory.length - chess_data.plyAhead;
  const movesList = fullHistory.slice(prevPlyIndex);
  const isBlackToMove = chess_data.playerToMove === "b";
  movesDisplay.innerHTML = createMovesTableHtml(movesList, isBlackToMove);
}

// ----------------------------------------------------------
// Game load / puzzle

function loadNewPuzzle() {
  clearBoardHighlights();

  const game_and_ply = getRandomPosNumber(chess_data.game_weights, chess_data.playerToMoveAfter === "w");
  chess_data.game_index = game_and_ply.game;
  chess_data.ply = game_and_ply.ply;

  chess_data.game = getGame(game_and_ply.game, game_and_ply.ply);
  chess_data.fen = chess_data.game.fen();

  const prior_game = getGame(game_and_ply.game, Math.max(0, game_and_ply.ply - chess_data.plyAhead));
  chess_data.board.position(prior_game.fen());

  ensurePieceMarkers();
  clearPieceMarkers();
  updateMovesDisplay();

  chess_data.correct = getCorrectAnswers(chess_data.fen, chess_data.questionTypes);

  // Pre-calc AllLegal for highlight buttons (useful even if not asked)
  [qTypeForAbsColorAndKind("w", "AllLegal"), qTypeForAbsColorAndKind("b", "AllLegal")].forEach((qType) => {
    if (!chess_data.correct[qType]) chess_data.correct[qType] = getOneCorrectAnswer(chess_data.fen, qType);
  });

  chess_data.is_correct = Object.fromEntries(getFixedDisplayQuestionTypes().map((name) => [name, false]));

  getFixedDisplayQuestionTypes().forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = 0;

    const feedbackIcon = document.getElementById(id + "FeedbackIcon");
    if (feedbackIcon) {
      feedbackIcon.textContent = "";
      feedbackIcon.className = "feedbackIcon";
    }

    const shownMovesLabel = document.getElementById(id + "ShownMoves");
    if (shownMovesLabel) shownMovesLabel.textContent = "";
  });

  // Clear movesList (bottom) when new puzzle loads
  const movesList = document.getElementById("movesList");
  if (movesList) {
    movesList.innerHTML = "";
    movesList.style.display = "none";
  }

  if (window.innerWidth > 768 && !("ontouchstart" in window || navigator.maxTouchPoints)) {
    const first = chess_data.questionTypes?.[0];
    if (first) {
      const el = document.getElementById(first);
      if (el) el.focus();
    }
  }

  const showMovesButton = document.getElementById("showMovesButton");
  if (showMovesButton) {
    showMovesButton.disabled = false;
    showMovesButton.style.backgroundColor = "";
  }

  const form = document.getElementById("chessCountForm");
  if (form) form.onsubmit = submitAnswers;
}

function startNewGame() {
  gameEnded = false;
  resetScore();
  loadNewPuzzle();
  startTimer();
  initTimer();
}

// ----------------------------------------------------------
// Submit answers

function submitAnswers(event) {
  event.preventDefault();
  if (gameEnded) return;

  getFixedDisplayQuestionTypes().forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    const inputValue = parseInt(input.value, 10);
    const isCorrect = inputValue === chess_data.correct[id].count;

    const feedbackIcon = document.getElementById(id + "FeedbackIcon");
    if (feedbackIcon) {
      feedbackIcon.textContent = isCorrect ? "✓" : "✗";
      feedbackIcon.className = isCorrect ? "feedbackIcon correct" : "feedbackIcon incorrect";
    }

    if (!chess_data.is_correct[id] && isCorrect) {
      chess_data.is_correct[id] = true;
      incrementScore();
    }

    if (!isCorrect) penalizeTime();
  });

  if (gameEnded) return;

  const all_correct = Object.values(chess_data.is_correct).reduce((acc, cur) => acc && cur, true);
  if (all_correct) loadNewPuzzle();
}

// ----------------------------------------------------------
// Settings dialog box

function setupSettingsModal() {
  const settings = document.getElementById("settingsModal");
  const settingsBtn = document.getElementById("settingsButton");
  const closeBtn = document.querySelector("#settingsModal .close-button");

  if (!settings) return;

  // Force closed on load (even if CSS modal is broken)
  settings.style.display = "none";

  if (settingsBtn) {
    settingsBtn.type = "button";
    settingsBtn.onclick = () => (settings.style.display = "block");
  }

  if (closeBtn) {
    closeBtn.onclick = () => (settings.style.display = "none");
  }

  window.addEventListener("click", (event) => {
    if (event.target === settings) settings.style.display = "none";
  });
}

async function saveSettings() {
  const showTimer = document.getElementById("showTimer").checked;
  chess_data.showTimer = showTimer;
  localStorage.setItem("showTimer", showTimer);
  setTimerVisibility(showTimer);

  const selectedToMove = document.querySelector('input[name="playerToMove"]:checked');
  localStorage.setItem("selectedToMove", selectedToMove.value);
  setPlayerToMove(selectedToMove.value);

  chess_data.games = await getGames();
  chess_data.game_weights = await getWeights();
  setBoard();

  const questionCheckboxes = document.querySelectorAll('input[name="quizOption"]:checked');
  chess_data.questionTypes = Array.from(questionCheckboxes).map((opt) => opt.value);
  localStorage.setItem("questionTypes", JSON.stringify(chess_data.questionTypes));

  createDynamicInputs(getFixedDisplayQuestionTypes());
  setupHighlightButtons();

  const plyAhead = parseInt(document.getElementById("plyAhead").value, 10);
  chess_data.plyAhead = plyAhead;
  localStorage.setItem("plyAhead", plyAhead);

  setPlayerToMoveAfter();

  const settings = document.getElementById("settingsModal");
  if (settings) settings.style.display = "none";

  startNewGame();
}

function setTimerVisibility(visible) {
  const timerSection = document.getElementById("timerSection");
  if (!timerSection) return;
  timerSection.style.display = visible ? "block" : "none";
}

// ----------------------------------------------------------
// Load settings

async function loadSettings() {
  chess_data = {
    showTimer: true,
    fen: null,
    correct: null,
    defaultTimeRemaining: 180,
    timeRemaining: 999,
    score: 0,
    is_correct: null,
    games: null,
    game_weights: null,
    board: null,
    questionTypes: null,
    plyAhead: 0,
    playerToMove: "w",
    playerToMoveAfter: "w",
  };

  chess_data.showTimer = localStorage.getItem("showTimer") === "false" ? false : true;
  const showTimerEl = document.getElementById("showTimer");
  if (showTimerEl) showTimerEl.checked = chess_data.showTimer;
  setTimerVisibility(chess_data.showTimer);

  const selectedToMoveStored = localStorage.getItem("selectedToMove") || "Random";
  const radio = document.querySelector(`input[value="${selectedToMoveStored}"]`);
  if (radio) radio.checked = true;
  setPlayerToMove(selectedToMoveStored);

  const savedPlyAhead = localStorage.getItem("plyAhead");
  chess_data.plyAhead = savedPlyAhead ? parseInt(savedPlyAhead, 10) : 0;
  const plyAheadEl = document.getElementById("plyAhead");
  if (plyAheadEl) plyAheadEl.value = chess_data.plyAhead;

  setPlayerToMoveAfter();

  chess_data.games = await getGames();
  chess_data.game_weights = await getWeights();
  setBoard();

  const storedTypes = localStorage.getItem("questionTypes");
  if (storedTypes) chess_data.questionTypes = JSON.parse(storedTypes);
  else chess_data.questionTypes = ["p1Checks", "p1Captures", "p2Checks", "p2Captures"];

  document.querySelectorAll('input[name="quizOption"]').forEach((option) => (option.checked = false));
  chess_data.questionTypes.forEach((questionType) => {
    const el = document.querySelector(`input[value="${questionType}"]`);
    if (el) el.checked = true;
  });

  createDynamicInputs(getFixedDisplayQuestionTypes());
  setupHighlightButtons();
}

function setPlayerToMove(selected) {
  const el = document.querySelector(`input[value="${selected}"]`);
  if (el) el.checked = true;

  if (selected === "White") chess_data.playerToMove = "w";
  else if (selected === "Black") chess_data.playerToMove = "b";
  else chess_data.playerToMove = Math.random() < 0.5 ? "w" : "b";
}

function setPlayerToMoveAfter() {
  chess_data.playerToMoveAfter =
    chess_data.plyAhead % 2 === 0 ? chess_data.playerToMove : chess_data.playerToMove === "w" ? "b" : "w";
}

function setBoard() {
  chess_data.board = Chessboard("board", "start");
  if (chess_data.playerToMove === "b") chess_data.board.flip();
  ensurePieceMarkers();
}

// ----------------------------------------------------------
// Dynamic inputs

function createDynamicInputs(questionTypes) {
  const elem = document.getElementById("count-inputs");
  if (!elem) return;

  elem.innerHTML = "";

  questionTypes.forEach((questionType) => {
    const div = document.createElement("div");
    div.className = "input-group";

    const label = document.createElement("label");
    const input = document.createElement("input");
    const decrementButton = document.createElement("button");
    const incrementButton = document.createElement("button");
    const feedbackIcon = document.createElement("span");
    const shownMoves = document.createElement("label");

    label.textContent = createDynamicInputsLabel(questionType);

    input.type = "number";
    input.id = questionType;
    input.name = questionType;
    input.min = "0";
    input.required = true;

    decrementButton.textContent = "←";
    decrementButton.type = "button";
    decrementButton.onclick = () => {
      if (parseInt(input.value || "0", 10) > 0) input.value = parseInt(input.value || "0", 10) - 1;
    };
    decrementButton.className = "decrement";

    incrementButton.textContent = "→";
    incrementButton.type = "button";
    incrementButton.onclick = () => {
      input.value = parseInt(input.value || "0", 10) + 1;
    };
    incrementButton.className = "increment";

    feedbackIcon.className = "feedbackIcon";
    feedbackIcon.id = `${questionType}FeedbackIcon`;

    shownMoves.className = "shownMoves";
    shownMoves.id = `${questionType}ShownMoves`;

    div.appendChild(label);
    div.appendChild(decrementButton);
    div.appendChild(input);
    div.appendChild(incrementButton);
    div.appendChild(feedbackIcon);
    div.appendChild(shownMoves);

    elem.appendChild(div);
  });
}

function createDynamicInputsLabel(questionType) {
  const isP1 = questionType.startsWith("p1");
  const colorAbs = isP1 ? chess_data.playerToMove : chess_data.playerToMove === "w" ? "b" : "w";
  const who = colorAbs === "w" ? "White's" : "Black's";

  let what = "Moves";
  if (questionType.endsWith("Checks")) what = "Checks";
  if (questionType.endsWith("Captures")) what = "Captures";
  if (questionType.endsWith("AllLegal")) what = "Moves";

  return `${who}\n${what}:`;
}

// -----------------------------------------------------------
// Main boot

document.addEventListener("DOMContentLoaded", () => {
  // Settings modal wiring
  setupSettingsModal();

  // Show Moves button wiring (single, no duplicate)
  const btn = document.getElementById("showMovesButton");
  if (btn) {
    btn.type = "button";
    btn.addEventListener("click", revealAnswers);
  }
});

(async () => {
  await loadSettings();
  startNewGame();
})();
