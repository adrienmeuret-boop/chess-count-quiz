// -----------------------------------------------------------
// Global variables

let chess_data = null; // See loadSettings for value of chess_data
let gameEnded = true;
let timerInterval = null;

// -----------------------------------------------------------
// DOM helpers

function byId(id) {
  return document.getElementById(id);
}

// -----------------------------------------------------------
// FEN / player helpers

function getPlayersFromFen(fen) {
  if (typeof fen !== "string") {
    return { p1: "w", p2: "b" };
  }

  const parts = fen.trim().split(/\s+/);
  const turn = parts[1] === "b" ? "b" : "w";

  return {
    p1: turn,
    p2: turn === "w" ? "b" : "w",
  };
}

function getFenTurn(fen) {
  return getPlayersFromFen(fen).p1;
}

function getOpponentColor(color) {
  return color === "w" ? "b" : "w";
}

// p1 / p2 for the quiz are defined from the DISPLAYED board,
// not from the final calculation position.
function getQuizPlayers() {
  const sourceFen = chess_data?.displayFen || chess_data?.fen;

  if (typeof sourceFen !== "string") {
    return { p1: "w", p2: "b" };
  }

  return getPlayersFromFen(sourceFen);
}

// Return a game where it's the specified player to move ("w" or "b") from the given FEN
function switchFenSides(fen, side) {
  if (typeof fen !== "string") return fen;

  const fenParts = fen.trim().split(/\s+/);
  if (fenParts.length < 2) return fen;

  fenParts[1] = side === "b" ? "b" : "w";
  return fenParts.join(" ");
}

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

// -----------------------------------------------------------
// Game loading helpers

// Return array of PGN games
async function getGames() {
  const path = "lichess-puzzles/selected_games.pgn";
  console.log("Loading games from:", path);

  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load PGN file: HTTP ${response.status}`);
  }

  const text = await response.text();
  console.log("Raw PGN text length:", text.length);

  const sections = text.split("\n\n").filter((section) => section.trim() !== "");
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
  if (games.length <= 0) console.error("Error with PGN file");

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
  if (!Array.isArray(game_weights) || game_weights.length === 0) {
    throw new Error("No weights available.");
  }

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

  return { game: filtered[0].game, ply: filtered[0].ply };
}

// Return a game object with the given index
function getGame(game_index, ply) {
  if (!chess_data?.games?.[game_index]) {
    console.error("Game index out of range:", game_index);
    return null;
  }

  const game = new Chess();
  const pgn = chess_data.games[game_index];
  console.log("PGN length:", pgn.length);

  const parsedGame = game.load_pgn(pgn);
  if (!parsedGame) {
    console.error("Error parsing PGN");
    return null;
  }

  const moves = game.history();
  game.reset();

  for (let i = 0; i < ply && i < moves.length; i++) {
    game.move(moves[i]);
  }

  return game;
}

// -----------------------------------------------------------
// Correct answers logic
// p1 = player to move on the DISPLAYED board
// p2 = the other player
// answers are computed from chess_data.fen

function getCorrectAnswers(fen, questionTypes) {
  return questionTypes.reduce((result, questionType) => {
    result[questionType] = getOneCorrectAnswer(fen, questionType);
    return result;
  }, {});
}

function getOneCorrectAnswer(fen, questionType) {
  const players = getQuizPlayers();
  let side;

  if (questionType.startsWith("p1")) side = players.p1;
  else if (questionType.startsWith("p2")) side = players.p2;
  else throw new RangeError("Expected p1 or p2");

  const modFen = switchFenSides(fen, side);
  const game = new Chess();
  const loaded = game.load(modFen);

  if (!loaded) {
    throw new Error(`Invalid FEN for ${questionType}: ${modFen}`);
  }

  if (questionType.endsWith("Checks")) return countChecks(game);
  if (questionType.endsWith("Captures")) return countCaptures(game);
  if (questionType.endsWith("AllLegal")) return countAllLegal(game);

  throw new RangeError("Expected Checks or Captures or AllLegal");
}

// -----------------------------------------------------------
// Timer and score code

function updateTimerDisplay() {
  const timerEl = byId("timer");
  if (!timerEl || !chess_data) return;

  if (!chess_data.showTimer) {
    timerEl.textContent = "";
    return;
  }

  const safeTime = Number.isFinite(chess_data.timeRemaining)
    ? Math.max(0, chess_data.timeRemaining)
    : 0;

  const minutes = Math.floor(safeTime / 60);
  const seconds = safeTime % 60;

  timerEl.textContent = `Time: ${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function incrementScore() {
  if (!chess_data) return;

  chess_data.score++;
  const scoreEl = byId("score");
  if (scoreEl) scoreEl.textContent = `Score: ${chess_data.score}`;
}

function resetScore() {
  if (!chess_data) return;

  chess_data.score = 0;
  const scoreEl = byId("score");
  if (scoreEl) scoreEl.textContent = `Score: ${chess_data.score}`;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function triggerGameOver() {
  if (gameEnded) return;

  gameEnded = true;
  stopTimer();

  const startBtn = byId("startButton");
  if (startBtn) startBtn.disabled = false;

  playDuck();
}

function initTimer() {
  stopTimer();
  updateTimerDisplay();

  if (!chess_data?.showTimer) return;

  timerInterval = setInterval(() => {
    if (gameEnded || !chess_data) return;

    chess_data.timeRemaining = Math.max(0, chess_data.timeRemaining - 1);
    updateTimerDisplay();

    if (chess_data.timeRemaining <= 0) {
      triggerGameOver();
    }
  }, 1000);
}

function startTimer() {
  if (!chess_data) return;

  if (chess_data.showTimer) chess_data.timeRemaining = chess_data.defaultTimeRemaining;
  else chess_data.timeRemaining = Infinity;

  setTimerVisibility(chess_data.showTimer);
  updateTimerDisplay();
}

function penalizeTime() {
  if (!chess_data || gameEnded || !chess_data.showTimer) return;

  chess_data.timeRemaining = Math.max(0, chess_data.timeRemaining - 10);
  updateTimerDisplay();

  if (chess_data.timeRemaining <= 0) {
    triggerGameOver();
  }
}

// -----------------------------------------------------------
// Display ordering and mapping
// Display is always fixed:
// White then Black
// Quiz logic stays in p1 / p2 based on displayFen

function getFixedDisplayQuestionTypes() {
  return [
    "wAllLegal",
    "wChecks",
    "wCaptures",
    "bAllLegal",
    "bChecks",
    "bCaptures",
  ];
}

function getAllLogicalQuestionTypes() {
  return [
    "p1AllLegal",
    "p1Checks",
    "p1Captures",
    "p2AllLegal",
    "p2Checks",
    "p2Captures",
  ];
}

function getQuestionKindFromId(id) {
  if (id.endsWith("AllLegal")) return "AllLegal";
  if (id.endsWith("Checks")) return "Checks";
  if (id.endsWith("Captures")) return "Captures";
  throw new RangeError("Unknown question kind: " + id);
}

function getDisplayIdFromQuestionType(questionType) {
  const players = getQuizPlayers();
  const color = questionType.startsWith("p1") ? players.p1 : players.p2;
  const kind = getQuestionKindFromId(questionType);
  return `${color}${kind}`;
}

function getQuestionTypeFromDisplayId(displayId) {
  const players = getQuizPlayers();
  const color = displayId.startsWith("w") ? "w" : "b";
  const prefix = color === players.p1 ? "p1" : "p2";
  const kind = getQuestionKindFromId(displayId);
  return `${prefix}${kind}`;
}

// -----------------------------------------------------------
// Reveal answers (numbers near inputs + moves list in #movesList)

function updateShowAnswersButtonLabel() {
  const btn = byId("showMovesButton");
  if (!btn) return;
  btn.textContent = chess_data?.answersVisible ? "Hide answers" : "Show answers";
}

function hideAnswers() {
  const activeDisplayed = getFixedDisplayQuestionTypes().filter((displayId) => {
    const questionType = getQuestionTypeFromDisplayId(displayId);
    return chess_data?.questionTypes?.includes(questionType);
  });

  activeDisplayed.forEach((displayId) => {
    const shownMovesLabel = byId(displayId + "ShownMoves");
    if (shownMovesLabel) shownMovesLabel.textContent = "";
  });

  const movesList = byId("movesList");
  if (movesList) {
    movesList.innerHTML = "";
    movesList.style.display = "none";
  }

  if (chess_data) chess_data.answersVisible = false;
  updateShowAnswersButtonLabel();
}

function revealAnswers() {
  const activeDisplayed = getFixedDisplayQuestionTypes().filter((displayId) => {
    const questionType = getQuestionTypeFromDisplayId(displayId);
    return chess_data?.questionTypes?.includes(questionType);
  });

  const movesList = byId("movesList");
  if (movesList) {
    movesList.innerHTML = "";
    movesList.style.display = "block";
  }

  activeDisplayed.forEach((displayId) => {
    const shownMovesLabel = byId(displayId + "ShownMoves");
    const questionType = getQuestionTypeFromDisplayId(displayId);
    const correct = chess_data?.correct?.[questionType];
    if (!shownMovesLabel || !correct) return;

    const movesText = Array.isArray(correct.moves) ? correct.moves.join(", ") : "";

    shownMovesLabel.innerHTML = `<span style="font-weight:700; font-size:1.4em;">${correct.count}</span>`;

    if (movesList) {
      const row = document.createElement("div");
      row.className = "movesRow";

      const lab = document.createElement("div");
      lab.className = "movesLabel";
      lab.textContent = createDynamicInputsLabel(displayId);

      const txt = document.createElement("div");
      txt.className = "movesText";
      txt.textContent = movesText ? `(${movesText})` : "";

      row.appendChild(lab);
      row.appendChild(txt);
      movesList.appendChild(row);
    }
  });

  if (chess_data) chess_data.answersVisible = true;
  updateShowAnswersButtonLabel();
}

function evaluateAnswersFromShowButton() {
  if (!chess_data || !chess_data.correct) return;

  let hasWrongAnswer = false;

  const activeDisplayed = getFixedDisplayQuestionTypes().filter((displayId) => {
    const questionType = getQuestionTypeFromDisplayId(displayId);
    return chess_data.questionTypes.includes(questionType);
  });

  activeDisplayed.forEach((displayId) => {
    const input = byId(displayId);
    const questionType = getQuestionTypeFromDisplayId(displayId);
    const correct = chess_data.correct[questionType];
    if (!input || !correct) return;

    const inputValue = parseInt(input.value, 10);
    const safeValue = Number.isNaN(inputValue) ? 0 : inputValue;
    const isCorrect = safeValue === correct.count;

    const feedbackIcon = byId(displayId + "FeedbackIcon");
    if (feedbackIcon) {
      feedbackIcon.textContent = isCorrect ? "✓" : "✗";
      feedbackIcon.className = isCorrect ? "feedbackIcon correct" : "feedbackIcon incorrect";
    }

    if (!isCorrect) {
      hasWrongAnswer = true;
      penalizeTime();
    }
  });

  if (hasWrongAnswer && !gameEnded) playDuck();
}

function toggleShowAnswers() {
  if (!chess_data || !chess_data.correct) return;

  if (chess_data.answersVisible) {
    hideAnswers();
    return;
  }

  evaluateAnswersFromShowButton();
  revealAnswers();
}

// -----------------------------------------------------------
// Board square highlights

function clearBoardHighlights() {
  const boardEl = byId("board");
  if (!boardEl) return;

  boardEl.querySelectorAll(".hl-red").forEach((el) => el.classList.remove("hl-red"));
}

function highlightSquares(squares) {
  clearBoardHighlights();

  const boardEl = byId("board");
  if (!boardEl || !Array.isArray(squares)) return;

  squares.forEach((sq) => {
    const el = boardEl.querySelector(`[data-square="${sq}"]`) || boardEl.querySelector(`.square-${sq}`);
    if (el) el.classList.add("hl-red");
  });
}

// -----------------------------------------------------------
// Piece markers (6 zones)

function ensurePieceMarkers() {
  const boardEl = byId("board");
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
  const boardEl = byId("board");
  if (!boardEl) return;

  boardEl
    .querySelectorAll(".pm6 .pm.on, .pm6 .pm.solid")
    .forEach((el) => el.classList.remove("on", "solid"));
}

function clearBigMarkers() {
  const boardEl = byId("board");
  if (!boardEl) return;

  boardEl.querySelectorAll(".pmBig").forEach((el) => {
    el.classList.remove("on", "side-w", "side-b");
    el.classList.remove("piece-p", "piece-n", "piece-b", "piece-r", "piece-q", "piece-k");
  });
}

function markSquarePiece(square, piece) {
  const boardEl = byId("board");
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
  const boardEl = byId("board");
  if (!boardEl) return;

  moveList.forEach((m) => {
    if (!m?.to || !m?.piece) return;
    if (!map.has(m.to)) map.set(m.to, new Map());
    const counts = map.get(m.to);
    counts.set(m.piece, (counts.get(m.piece) || 0) + 1);
  });

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
  const labels = {
    "white’s moves": "w",
    "black’s moves": "b",
    "white’s checks": "w",
    "black’s checks": "b",
    "white’s captures": "w",
    "black’s captures": "b",
    clear: null,
  };

  const norm = (s) =>
    (s || "")
      .trim()
      .toLowerCase()
      .replaceAll("'", "’")
      .replace(/\s+/g, " ");

  document.querySelectorAll("#boardHighlightsControls button").forEach((btn) => {
    const key = norm(btn.textContent);
    const side = labels[key];

    btn.type = "button";

    btn.onclick = () => {
      if (!side) {
        clearBoardHighlights();
        clearPieceMarkers();
        clearBigMarkers();
        return;
      }

      if (!chess_data?.fen || !chess_data?.displayFen) return;
      if (!chess_data.correct) chess_data.correct = {};

      let kind;
      if (key.includes("moves")) kind = "AllLegal";
      else if (key.includes("checks")) kind = "Checks";
      else if (key.includes("captures")) kind = "Captures";
      else return;

      const displayId = `${side}${kind}`;
      const questionType = getQuestionTypeFromDisplayId(displayId);

      let ans = chess_data.correct[questionType];
      if (!ans) {
        ans = getOneCorrectAnswer(chess_data.fen, questionType);
        chess_data.correct[questionType] = ans;
      }

      if (!ans?.targets) return;
      highlightMovesByPiece(ans.targets, side);
    };
  });
}

// ----------------------------------------------------------
// Moves table

function createMovesTableHtml(movesList, fenTurn) {
  let tableHtml = `<h3>Compute counts after these moves:</h3>
<table class="moves-table">`;

  const totalMoves = movesList.length;
  let turnNumber = 1;
  let currentIsWhite = fenTurn === "w";

  let i = 0;
  while (i < totalMoves) {
    let whiteMove = "";
    let blackMove = "";

    if (currentIsWhite) {
      whiteMove = movesList[i] || "";
      i++;
      currentIsWhite = false;

      if (i < totalMoves) {
        blackMove = movesList[i] || "";
        i++;
        currentIsWhite = true;
      }
    } else {
      whiteMove = "...";
      blackMove = movesList[i] || "";
      i++;
      currentIsWhite = true;
    }

    tableHtml += `
    <tr>
      <td class="turn">${turnNumber}.</td>
      <td class="w">${whiteMove}</td>
      <td class="b">${blackMove}</td>
    </tr>`;

    turnNumber++;
  }

  tableHtml += "</table>";
  return tableHtml;
}

function updateMovesDisplay() {
  const movesDisplay = byId("remainingMoves");
  if (!movesDisplay) return;

  if (!chess_data?.game || chess_data.plyAhead === 0) {
    movesDisplay.innerHTML = "";
    return;
  }

  const fullHistory = chess_data.game.history();
  const startIndex = fullHistory.length - chess_data.plyAhead;
  const movesList = fullHistory.slice(startIndex);

  const firstMoveIsWhite = startIndex % 2 === 0;
  const fenTurnAfterPlyAhead = firstMoveIsWhite ? "w" : "b";

  movesDisplay.innerHTML = createMovesTableHtml(movesList, fenTurnAfterPlyAhead);
}

// ----------------------------------------------------------
// Board helpers

function setBoardOrientation() {
  if (!chess_data?.board) return;

  const wanted = chess_data.playerToMove === "b" ? "black" : "white";

  if (typeof chess_data.board.orientation === "function") {
    chess_data.board.orientation(wanted);
  }
}

function setBoard() {
  if (!chess_data.board) {
    chess_data.board = Chessboard("board", { position: "start" });
  } else {
    chess_data.board.position("start");
  }

  setBoardOrientation();
  ensurePieceMarkers();
}

// ----------------------------------------------------------
// Reset helpers

function resetAnswerUi() {
  getFixedDisplayQuestionTypes().forEach((id) => {
    const input = byId(id);
    if (input) {
      input.value = 0;
      input.disabled = false;
    }

    const shownMovesLabel = byId(id + "ShownMoves");
    if (shownMovesLabel) shownMovesLabel.textContent = "";
  });

  const movesList = byId("movesList");
  if (movesList) {
    movesList.innerHTML = "";
    movesList.style.display = "none";
  }

  if (chess_data) chess_data.answersVisible = false;
  updateShowAnswersButtonLabel();

  const showMovesButton = byId("showMovesButton");
  if (showMovesButton) {
    showMovesButton.disabled = false;
    showMovesButton.style.backgroundColor = "";
  }
}

function clearBoardDecorations() {
  clearBoardHighlights();
  clearPieceMarkers();
  clearBigMarkers();
}

function resetRoundState() {
  clearBoardDecorations();

  chess_data.fen = null;
  chess_data.displayFen = null;
  chess_data.correct = null;
  chess_data.is_correct = null;
  chess_data.answersVisible = false;
  chess_data.game = null;
  chess_data.game_index = null;
  chess_data.ply = 0;

  const remainingMoves = byId("remainingMoves");
  if (remainingMoves) remainingMoves.innerHTML = "";

  resetAnswerUi();
}

// ----------------------------------------------------------
// Game load / puzzle

function loadNewPuzzle() {
  clearBoardDecorations();
  refreshPlayerToMoveForNextPuzzle();

  const game_and_ply = getRandomPosNumber(chess_data.game_weights, chess_data.playerToMoveAfter === "w");
  chess_data.game_index = game_and_ply.game;
  chess_data.ply = game_and_ply.ply;

  chess_data.game = getGame(game_and_ply.game, game_and_ply.ply);
  if (!chess_data.game) {
    console.error("Failed to load puzzle.");
    return;
  }

  chess_data.fen = chess_data.game.fen();

  const prior_game = getGame(game_and_ply.game, Math.max(0, game_and_ply.ply - chess_data.plyAhead));
  if (!prior_game) {
    console.error("Failed to load prior game.");
    return;
  }

  chess_data.displayFen = prior_game.fen();

  createDynamicInputs(getFixedDisplayQuestionTypes(), false);

  chess_data.board.position(chess_data.displayFen);
  setBoardOrientation();

  ensurePieceMarkers();
  clearPieceMarkers();
  clearBigMarkers();
  updateMovesDisplay();

  const allQuestionTypes = getAllLogicalQuestionTypes();
  chess_data.correct = getCorrectAnswers(chess_data.fen, allQuestionTypes);
  chess_data.is_correct = Object.fromEntries(allQuestionTypes.map((name) => [name, false]));

  getFixedDisplayQuestionTypes().forEach((id) => {
    const feedbackIcon = byId(id + "FeedbackIcon");
    if (feedbackIcon) {
      feedbackIcon.textContent = "";
      feedbackIcon.className = "feedbackIcon";
    }
  });

  resetAnswerUi();

  const form = byId("chessCountForm");
  if (form) form.onsubmit = submitAnswers;
}

function startNewGame() {
  const selectedInput = document.querySelector('input[name="playerToMove"]:checked');
  const selected = selectedInput ? selectedInput.value : "Random";

  setPlayerToMove(selected);
  setBoard();

  gameEnded = false;
  resetScore();
  loadNewPuzzle();
  focusInputForPlayerToMove();

  chess_data.timeRemaining = chess_data.showTimer ? chess_data.defaultTimeRemaining : Infinity;
  initTimer();
}

// ----------------------------------------------------------
// Input / player mapping

function playerColorForInputId(id) {
  return id.startsWith("w") ? "w" : "b";
}

// ----------------------------------------------------------
// Submit answers

function submitAnswers(event) {
  event.preventDefault();

  if (!chess_data || !chess_data.correct) return;

  const prevTime = chess_data.timeRemaining;
  let hasWrongAnswer = false;

  const activeDisplayed = getFixedDisplayQuestionTypes().filter((displayId) => {
    const questionType = getQuestionTypeFromDisplayId(displayId);
    return chess_data.questionTypes.includes(questionType);
  });

  activeDisplayed.forEach((displayId) => {
    const input = byId(displayId);
    const questionType = getQuestionTypeFromDisplayId(displayId);
    const correct = chess_data.correct[questionType];
    if (!input || !correct) return;

    const inputValue = parseInt(input.value, 10);
    const safeValue = Number.isNaN(inputValue) ? 0 : inputValue;
    const isCorrect = safeValue === correct.count;

    const feedbackIcon = byId(displayId + "FeedbackIcon");
    if (feedbackIcon) {
      feedbackIcon.textContent = isCorrect ? "✓" : "✗";
      feedbackIcon.className = isCorrect ? "feedbackIcon correct" : "feedbackIcon incorrect";
    }

    if (!chess_data.is_correct[questionType] && isCorrect) {
      chess_data.is_correct[questionType] = true;
      incrementScore();
    }

if (!isCorrect && !gameEnded && chess_data.timeRemaining > 0) {
      hasWrongAnswer = true;
      penalizeTime();
    }
  });

  if (hasWrongAnswer && !gameEnded) {
    playDuck();
  }

  if (chess_data.showTimer && prevTime > 0 && chess_data.timeRemaining <= 0) {
    triggerGameOver();
    return;
  }

  if (gameEnded) {
    return;
  }

  const allCorrect = activeDisplayed.every((displayId) => {
    const questionType = getQuestionTypeFromDisplayId(displayId);
    return chess_data.is_correct[questionType];
  });

  if (allCorrect) {
    loadNewPuzzle();
    focusInputForPlayerToMove();
  }
}

// ----------------------------------------------------------
// Settings dialog box

function setupSettingsModal() {
  const settings = byId("settingsModal");
  const settingsBtn = byId("settingsButton");
  const closeBtn = document.querySelector("#settingsModal .close-button");

  if (!settings) return;

  settings.style.display = "none";

  if (settingsBtn) {
    settingsBtn.type = "button";
    settingsBtn.onclick = () => {
      settings.style.display = "block";
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      settings.style.display = "none";
    };
  }

  window.addEventListener("click", (event) => {
    if (event.target === settings) settings.style.display = "none";
  });
}

function setTimerVisibility(visible) {
  const timerSection = byId("timerSection");
  if (!timerSection) return;
  timerSection.style.display = visible ? "block" : "none";
}

// -----------------------------------------------------------
// Load settings

async function loadSettings() {
  chess_data = {
    showTimer: true,
    fen: null,
    displayFen: null,
    correct: null,
    defaultTimeRemaining: 180,
    timeRemaining: 999,
    score: 0,
    is_correct: null,
    games: null,
    game_weights: null,
    board: null,
    questionTypes: null,
    answersVisible: false,
    plyAhead: 0,
    selectedToMove: "Random",
    playerToMove: "w",
    playerToMoveAfter: "w",
    game: null,
    game_index: null,
    ply: 0,
  };

  chess_data.showTimer = localStorage.getItem("showTimer") === "false" ? false : true;

  const showTimerEl = byId("showTimer");
  if (showTimerEl) showTimerEl.checked = chess_data.showTimer;
  setTimerVisibility(chess_data.showTimer);

  const savedDefaultTimeRemaining = localStorage.getItem("defaultTimeRemaining");
  chess_data.defaultTimeRemaining = savedDefaultTimeRemaining
    ? parseInt(savedDefaultTimeRemaining, 10)
    : chess_data.defaultTimeRemaining;

  const defaultTimeMinutesEl = byId("defaultTimeMinutes");
  if (defaultTimeMinutesEl) {
    defaultTimeMinutesEl.value = Math.max(1, Math.round(chess_data.defaultTimeRemaining / 60));
  }

  const selectedToMoveStored = localStorage.getItem("selectedToMove") || "Random";
  const radio = document.querySelector(`input[value="${selectedToMoveStored}"]`);
  if (radio) radio.checked = true;
  setPlayerToMove(selectedToMoveStored);

  const savedPlyAhead = localStorage.getItem("plyAhead");
  chess_data.plyAhead = savedPlyAhead ? parseInt(savedPlyAhead, 10) : 0;

  const plyAheadEl = byId("plyAhead");
  if (plyAheadEl) plyAheadEl.value = chess_data.plyAhead;

  setPlayerToMoveAfter();

  chess_data.games = await getGames();
  chess_data.game_weights = await getWeights();
  setBoard();

  const storedTypes = localStorage.getItem("questionTypes");
  if (storedTypes) chess_data.questionTypes = JSON.parse(storedTypes);
  else chess_data.questionTypes = ["p1Checks", "p1Captures", "p2Checks", "p2Captures"];

  document.querySelectorAll('input[name="quizOption"]').forEach((option) => {
    option.checked = false;
  });

  chess_data.questionTypes.forEach((questionType) => {
    const el = document.querySelector(`input[value="${questionType}"]`);
    if (el) el.checked = true;
  });

  createDynamicInputs(getFixedDisplayQuestionTypes(), false);
  setupHighlightButtons();
  updateShowAnswersButtonLabel();
  resetScore();
  startTimer();
}

function setPlayerToMove(selected) {
  const el = document.querySelector(`input[value="${selected}"]`);
  if (el) el.checked = true;

  chess_data.selectedToMove = selected;

  if (selected === "White") chess_data.playerToMove = "w";
  else if (selected === "Black") chess_data.playerToMove = "b";
  else chess_data.playerToMove = Math.random() < 0.5 ? "w" : "b";
}

function refreshPlayerToMoveForNextPuzzle() {
  if (!chess_data) return;

  if (chess_data.selectedToMove === "White") {
    chess_data.playerToMove = "w";
  } else if (chess_data.selectedToMove === "Black") {
    chess_data.playerToMove = "b";
  } else {
    chess_data.playerToMove = Math.random() < 0.5 ? "w" : "b";
  }

  setPlayerToMoveAfter();
}

function setPlayerToMoveAfter() {
  chess_data.playerToMoveAfter =
    chess_data.plyAhead % 2 === 0
      ? chess_data.playerToMove
      : chess_data.playerToMove === "w"
      ? "b"
      : "w";
}

// ----------------------------------------------------------
// Dynamic inputs

function createDynamicInputs(displayIds, doFocus = true) {
  const container = byId("count-inputs");
  if (!container) return;

  container.innerHTML = "";

  displayIds.forEach((displayId) => {
    const div = document.createElement("div");
    div.className = "input-group";

    const label = document.createElement("label");
    label.textContent = createDynamicInputsLabel(displayId);

    const input = document.createElement("input");
    input.type = "number";
    input.id = displayId;
    input.name = displayId;
    input.min = "0";
    input.value = 0;
    input.required = true;

    const decrementButton = document.createElement("button");
    decrementButton.type = "button";
    decrementButton.textContent = "←";
    decrementButton.className = "decrement";
    decrementButton.onclick = () => {
      const current = parseInt(input.value || "0", 10);
      if (current > 0) input.value = current - 1;
    };

    const incrementButton = document.createElement("button");
    incrementButton.type = "button";
    incrementButton.textContent = "→";
    incrementButton.className = "increment";
    incrementButton.onclick = () => {
      const current = parseInt(input.value || "0", 10);
      input.value = current + 1;
    };

    const feedbackIcon = document.createElement("span");
    feedbackIcon.className = "feedbackIcon";
    feedbackIcon.id = `${displayId}FeedbackIcon`;

    const shownMoves = document.createElement("label");
    shownMoves.className = "shownMoves";
    shownMoves.id = `${displayId}ShownMoves`;

    div.appendChild(label);
    div.appendChild(decrementButton);
    div.appendChild(input);
    div.appendChild(incrementButton);
    div.appendChild(feedbackIcon);
    div.appendChild(shownMoves);

    container.appendChild(div);
  });

  if (doFocus) focusInputForPlayerToMove();
}

function focusInputForPlayerToMove() {
  setTimeout(() => {
    if (!chess_data?.questionTypes?.length) return;

    const focusOrder = [
      "p1AllLegal",
      "p1Checks",
      "p1Captures",
      "p2AllLegal",
      "p2Checks",
      "p2Captures",
    ];

    const firstActiveQuestionType = focusOrder.find((questionType) =>
      chess_data.questionTypes.includes(questionType)
    );

    if (!firstActiveQuestionType) return;

    const targetId = getDisplayIdFromQuestionType(firstActiveQuestionType);
    const el = byId(targetId);

    if (el && !el.disabled) el.focus();
  }, 0);
}

// ----------------------------------------------------------
// saveSettings

async function saveSettings() {
  const showTimerEl = byId("showTimer");
  const defaultTimeMinutesEl = byId("defaultTimeMinutes");
  const selectedToMove = document.querySelector('input[name="playerToMove"]:checked');
  const plyAheadEl = byId("plyAhead");

  chess_data.showTimer = !!showTimerEl?.checked;
  localStorage.setItem("showTimer", chess_data.showTimer);
  setTimerVisibility(chess_data.showTimer);

  if (defaultTimeMinutesEl) {
    const minutes = parseInt(defaultTimeMinutesEl.value, 10);
    chess_data.defaultTimeRemaining = (Number.isNaN(minutes) ? 3 : Math.max(1, minutes)) * 60;
    localStorage.setItem("defaultTimeRemaining", chess_data.defaultTimeRemaining);
  }

  if (selectedToMove) {
    localStorage.setItem("selectedToMove", selectedToMove.value);
    setPlayerToMove(selectedToMove.value);
  }

  chess_data.games = await getGames();
  chess_data.game_weights = await getWeights();

  const questionCheckboxes = document.querySelectorAll('input[name="quizOption"]:checked');
  chess_data.questionTypes = Array.from(questionCheckboxes).map((opt) => opt.value);
  localStorage.setItem("questionTypes", JSON.stringify(chess_data.questionTypes));

  const plyAhead = parseInt(plyAheadEl?.value, 10);
  chess_data.plyAhead = Number.isNaN(plyAhead) ? 0 : plyAhead;
  localStorage.setItem("plyAhead", chess_data.plyAhead);

  setPlayerToMoveAfter();

  createDynamicInputs(getFixedDisplayQuestionTypes(), false);
  setupHighlightButtons();

  gameEnded = true;
  stopTimer();

  resetRoundState();
  setBoard();
  resetScore();
  startTimer();

  const settings = byId("settingsModal");
  if (settings) settings.style.display = "none";
}

function createDynamicInputsLabel(displayId) {
  const who = displayId.startsWith("w") ? "White's" : "Black's";

  let what;
  if (displayId.endsWith("Checks")) what = "Checks";
  else if (displayId.endsWith("Captures")) what = "Captures";
  else what = "Moves";

  return `${who}\n${what}:`;
}

function playDuck() {
  try {
    if (!playDuck._ctx || !playDuck._buffer) return;

    if (playDuck._ctx.state === "suspended") {
      playDuck._ctx.resume();
    }

    const source = playDuck._ctx.createBufferSource();
    source.buffer = playDuck._buffer;
    source.connect(playDuck._ctx.destination);
    source.start(0);
  } catch (e) {
    console.warn("Failed to play duck:", e);
  }
}

// -----------------------------------------------------------
// Main boot

document.addEventListener("DOMContentLoaded", () => {
  try {
    if (!playDuck._ctx) {
      playDuck._ctx = new (window.AudioContext || window.webkitAudioContext)();

      fetch("duck.mp3")
        .then((r) => r.arrayBuffer())
        .then((b) => playDuck._ctx.decodeAudioData(b))
        .then((buf) => {
          playDuck._buffer = buf;
        })
        .catch((e) => console.warn("Audio decode failed:", e));
    }
  } catch (e) {
    console.warn("AudioContext creation failed:", e);
  }

  setupSettingsModal();

  const startBtn = byId("startButton");
  if (startBtn) {
    startBtn.type = "button";
    startBtn.addEventListener("click", startNewGame);
  }

  const btn = byId("showMovesButton");
  if (btn) {
    btn.type = "button";
    btn.addEventListener("click", toggleShowAnswers);
  }
});

(async () => {
  await loadSettings();
})();
