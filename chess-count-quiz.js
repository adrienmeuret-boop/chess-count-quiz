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
  const realTurn = fen.split(" ")[1];
  let side;

  if (questionType.startsWith("p1")) side = realTurn;
  else if (questionType.startsWith("p2")) side = realTurn === "w" ? "b" : "w";
  else throw new RangeError("Expected p1 or p2");

  const modFen = switchFenSides(fen, side);
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

    if (chess_data.timeRemaining === 0) {
      gameEnded = true;
      playBuzz();
      endGame();
    }
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
}

// -----------------------------------------------------------
// Display ordering (White then Black, Moves->Checks->Captures)

function qTypeForAbsColorAndKind(color, kind, fenTurn) {
  const prefix = color === fenTurn ? "p1" : "p2";
  return `${prefix}${kind}`;
}

function getFixedDisplayQuestionTypes() {
  const kinds = ["AllLegal", "Checks", "Captures"];
  const out = [];
  if (!chess_data.fen) return out;

  const fenTurn = chess_data.fen.split(" ")[1]; // 'w' ou 'b' selon FEN
  ["w", "b"].forEach((color) => {
    kinds.forEach((kind) => {
      const qt = qTypeForAbsColorAndKind(color, kind, fenTurn);
      if (Array.isArray(chess_data.questionTypes) && chess_data.questionTypes.includes(qt)) {
        out.push(qt);
      }
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

    shownMovesLabel.innerHTML = `<span style="font-weight:700; font-size:1.4em;">${correct.count}</span>`;

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
// (Le reste du code continue comme avant, inchangé)
