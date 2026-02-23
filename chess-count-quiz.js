// -----------------------------------------------------------
// Global variables

let chess_data = null; // See loadSettings for value of chess_data
let pgn_games = []; // Array to store loaded PGN games
let gameEnded = false;
let timerInterval = null;

// -----------------------------------------------------------
// Chess functions

// Return the number of possible checking moves
function countChecks(game) {
    const moves = game.moves({ verbose: true });

    const checkingMoves = moves.filter(m => {
        const tempGame = new Chess(game.fen());
        tempGame.move(m);
        return tempGame.in_check();
    });

return {
    count: checkingMoves.length,
    moves: checkingMoves.map(m => m.san),
    targets: checkingMoves.map(m => ({ to: m.to, piece: m.piece }))
};
}

// Return the number of possible capturing moves
function countCaptures(game) {
    const moves = game.moves({ verbose: true });
    const capturingMoves = moves.filter(m => m.flags.includes('c') || m.flags.includes('e'));

return {
    count: capturingMoves.length,
    moves: capturingMoves.map(m => m.san),
    targets: capturingMoves.map(m => ({ to: m.to, piece: m.piece }))
};
}

// Return the total number of moves
function countAllLegal(game) {
    const moves = game.moves({ verbose: true });

return {
    count: moves.length,
    moves: moves.map(m => m.san),
    targets: moves.map(m => ({ to: m.to, piece: m.piece }))
};
}

// Return a game where it's the specified player to move ('w' or 'b') from the given FEN
function switchFenSides(fen, side) {
    var fenParts = fen.split(' ');
    fenParts[1] = side;
    return fenParts.join(' ');
}

// Return array of PGN games
async function getGames() {
    // Randomly select one of the four PGN files
    const path = "lichess-puzzles/selected_games.pgn";
    console.log('Loading games from:', path);
    const response = await fetch(path);
    const text = await response.text();
    console.log('Raw PGN text length:', text.length);
    
    // Split into potential games (sections separated by blank lines)
    const sections = text.split('\n\n').filter(section => section.trim() !== '');
    
    // Combine header and moves sections into complete games
    const games = [];
    let currentGame = '';
    
    for (const section of sections) {
        if (section.startsWith('[')) {
            // This is a header section
            if (currentGame) {
                // If we have a previous game, save it
                games.push(currentGame.trim());
            }
            currentGame = section;
        } else {
            // This is a moves section, append it to the current game
            currentGame += '\n\n' + section;
        }
    }
    
    // Don't forget to add the last game
    if (currentGame) {
        games.push(currentGame.trim());
    }
    
    console.log('Number of games found:', games.length);
    
    if (games.length <= 0) {
        console.log("Error with PGN file");
    }
    return games;
}

// Load the game weights file and return parsed weights
async function getWeights() {
    const path = "lichess-puzzles/selected_weights.json"
    try {
	const response = await fetch(path);
	if (!response.ok) {
	    throw new Error(`HTTP error! Status: ${response.status}`);
	}
	const weights = await response.json();
	console.log(`Loaded ${weights.length} weight rows`);
	return weights;
    } catch (error) {
	console.error('Failed to load game stats:', error);
	return null;
    }
}

function getRandomPosNumber(game_weights, white) {
    // Filter entries based on the boolean 'white'
    // white => pick even 'ply', false => pick odd 'ply'
    const filtered = game_weights.filter(entry => white ? (entry.ply % 2 === 0) : (entry.ply % 2 !== 0));

    // Check if there are any entries after filtering
    if (filtered.length === 0) {
	throw new Error("No entries available for the specified color.");
    }

    // Calculate the total weight of the filtered entries
    const totalWeight = filtered.reduce((sum, entry) => sum + entry.weight, 0);
  
    // Generate a random number between 0 (inclusive) and totalWeight (exclusive)
    let threshold = Math.random() * totalWeight;
  
    // Loop through the filtered entries, subtracting each weight from the threshold.
    for (let i = 0; i < filtered.length; i++) {
	threshold -= filtered[i].weight;
	if (threshold < 0) {
	    console.log(`Selected: game=${filtered[i].game}, ply=${filtered[i].ply}, weight=${filtered[i].weight}`);
	    return {
		game: filtered[i].game,
		ply: filtered[i].ply
	    };
	}
    }
}

// Return a game object with the given index
function getGame(game_index, ply) {
    const game = new Chess();
    const pgn = chess_data.games[game_index]
    console.log('PGN length:', pgn.length);    
    
    const parsedGame = game.load_pgn(pgn);
    if (!parsedGame) {
        console.log("Error parsing PGN");
        return null;
    }

    // Reset the game and play up to the random move
    const moves = game.history();
    game.reset();
    for (let i = 0; i < ply; i++) {
        game.move(moves[i]);
    }
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
    if (questionType.startsWith('p1')) {
        modFen = switchFenSides(fen, chess_data.playerToMove);
	} else if (questionType.startsWith('p2')) {
    const p2Color = (chess_data.playerToMove === 'w') ? 'b' : 'w';
    modFen = switchFenSides(fen, p2Color);
	} else {
        throw new RangeError('Expected p1 or p2');
    }

    const game = new Chess();
    game.load(modFen);

    if (questionType.endsWith('Checks')) {
        return countChecks(game);
    } else if (questionType.endsWith('Captures')) {
        return countCaptures(game);
    } else if (questionType.endsWith('AllLegal')) {
        return countAllLegal(game);
    } else {
        throw new RangeError('Expected Checks or Captures');
    }
}

// -----------------------------------------------------------
// Timer and score code

// Update the display based on the internal timer
function updateTimerDisplay() {
    const minutes = Math.floor(chess_data.timeRemaining / 60);
    const seconds = chess_data.timeRemaining % 60;
    document.getElementById('timer').textContent = `Time: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Update the score based on the internal timer
function incrementScore() {
    chess_data.score++;
    document.getElementById('score').textContent = `Score: ${chess_data.score}`;
}

// Set the score back to 0
function resetScore() {
    chess_data.score = 0;
    document.getElementById('score').textContent = `Score: ${chess_data.score}`;
}

// Start the timer count down
function initTimer() {
    // évite d'empiler plusieurs setInterval
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    updateTimerDisplay();
    timerInterval = setInterval(() => {
        if (gameEnded) return; // si la partie est finie, on ne touche plus au temps

        chess_data.timeRemaining = Math.max(0, chess_data.timeRemaining - 1);
        updateTimerDisplay();

        if (chess_data.timeRemaining <= 0) {
            endGame();
        }
    }, 1000);
}

// Start the timer and decrement by 1 every second
function startTimer() {
    if (chess_data.showTimer) {
	chess_data.timeRemaining = chess_data.defaultTimeRemaining;
    } else {
	chess_data.timeRemaining = Infinity;
    }
    setTimerVisibility(chess_data.showTimer);
}

// Deduct 10 seconds for incorrect answer
function penalizeTime() {
    chess_data.timeRemaining = Math.max(0, chess_data.timeRemaining - 10);
    updateTimerDisplay();

    if (chess_data.timeRemaining <= 0) {
        endGame();
    }
}


function qTypeForAbsColorAndKind(color, kind) {
    // color: 'w' ou 'b' (couleur absolue)
    // kind: 'AllLegal' | 'Checks' | 'Captures'
    const p1Color = chess_data.playerToMove; // côté qui a le trait
    const prefix = (color === p1Color) ? 'p1' : 'p2';
    return `${prefix}${kind}`;
}

function getFixedDisplayQuestionTypes() {
    // Ordre FIXE d'affichage : White puis Black, et Moves -> Checks -> Captures
    const kinds = ['AllLegal', 'Checks', 'Captures'];
    const out = [];

    ['w', 'b'].forEach(color => {
        kinds.forEach(kind => {
            const qt = qTypeForAbsColorAndKind(color, kind);
            if (Array.isArray(chess_data.questionTypes) && chess_data.questionTypes.includes(qt)) {
                out.push(qt);
            }
        });
    });

    return out;
}

function revealAnswers() {
	const panel = getOrCreateAnswersPanel();
panel.innerHTML = "";
panel.style.display = "block";
getFixedDisplayQuestionTypes().forEach((id) => {
        const shownMovesLabel = document.getElementById(id + "ShownMoves");
        const correct = chess_data.correct?.[id];
        if (!shownMovesLabel || !correct) return;

        const movesText = Array.isArray(correct.moves)
            ? correct.moves.join(', ')
            : '';
shownMovesLabel.innerHTML =
    `<span style="font-weight:700; font-size:1.4em;">${correct.count}</span>` +
    (movesText ? ` <span style="font-size:1em;">(${movesText})</span>` : '');
	// shownMovesLabel.innerHTML =
//   `<span style="font-weight:700; font-size:1.4em;">${correct.count}</span>` +
//   (movesText ? ` <span style="font-size:1em;">(${movesText})</span>` : '');
    });

    var showMovesButton = document.getElementById("showMovesButton");
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

    // ✅ Pas de pop-up, pas de restart automatique.
    // La page reste en place, les réponses sont visibles.
}

// Board square highlights

function clearBoardHighlights() {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;

    // Version robuste: enlève la classe sur toutes les cases, peu importe la structure DOM
    boardEl.querySelectorAll('.hl-red').forEach(el => el.classList.remove('hl-red'));
}

function highlightSquares(squares) {
    clearBoardHighlights();

    const boardEl = document.getElementById('board');
    if (!boardEl || !Array.isArray(squares)) return;

    squares.forEach(sq => {
        // Chessboard.js 1.0.0 : les cases ont souvent data-square="e4"
        const el = boardEl.querySelector(`[data-square="${sq}"]`);
        if (el) {
            el.classList.add('hl-red');
            return;
        }

        // Fallback : certaines versions ont des classes square-e4
        const el2 = boardEl.querySelector(`.square-${sq}`);
        if (el2) el2.classList.add('hl-red');
    });
}

// --- Piece markers (6 zones) --------------------------------

function ensurePieceMarkers() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  // Chessboard.js : les cases ont la classe .square-55d63
  const squares = boardEl.querySelectorAll('.square-55d63');

  squares.forEach(sqEl => {
    // grand carré (1 par case)
    if (!sqEl.querySelector(':scope > .pmBig')) {
      const big = document.createElement('div');
      big.className = 'pmBig';
      sqEl.appendChild(big);
    }

    // conteneur des 6 mini-zones (1 par case)
    if (sqEl.querySelector(':scope > .pm6')) return;

    const wrap = document.createElement('div');
    wrap.className = 'pm6';

    ['p','n','b','r','q','k'].forEach(piece => {
      const d = document.createElement('div');
      d.className = `pm ${piece}`;
      wrap.appendChild(d);
    });

    sqEl.appendChild(wrap);
  });
}

function clearPieceMarkers() {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;

    boardEl
      .querySelectorAll('.pm6 .pm.on, .pm6 .pm.solid')
      .forEach(el => el.classList.remove('on', 'solid'));
}

function clearBigMarkers() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  boardEl.querySelectorAll('.pmBig').forEach(el => {
    el.classList.remove('on', 'side-w', 'side-b');
    el.classList.remove('piece-p', 'piece-n', 'piece-b', 'piece-r', 'piece-q', 'piece-k');
  });
}

function markSquarePiece(square, piece) {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  const sqEl =
    boardEl.querySelector(`[data-square="${square}"]`) ||
    boardEl.querySelector(`.square-${square}`);

  if (!sqEl) return;

  if (!sqEl.querySelector(':scope > .pm6')) {
    ensurePieceMarkers();
  }

  const marker = sqEl.querySelector(`:scope > .pm6 .pm.${piece}`);
  if (marker) marker.classList.add('on');
}

function highlightMovesByPiece(moveList, side /* 'w'|'b' */) {
  clearPieceMarkers();
  clearBigMarkers();
  ensurePieceMarkers();

  if (!Array.isArray(moveList)) return;

  // square -> Map(piece -> count)
  const map = new Map();

  moveList.forEach(m => {
    if (!m?.to || !m?.piece) return;
    if (!map.has(m.to)) map.set(m.to, new Map());
    const counts = map.get(m.to);
    counts.set(m.piece, (counts.get(m.piece) || 0) + 1);
  });

  const boardEl = document.getElementById('board');

  for (const [sq, counts] of map.entries()) {
    const piecesDistinct = Array.from(counts.keys());

    // 1) Active les mini-carrés (une fois par pièce distincte)
    piecesDistinct.forEach(p => markSquarePiece(sq, p));

    // 2) Si doublon (même pièce >=2), rendre SOLIDE le mini-carré correspondant
    //    -> uniquement le petit carré de cette pièce, pas le grand.
    const sqEl =
      boardEl.querySelector(`[data-square="${sq}"]`) ||
      boardEl.querySelector(`.square-${sq}`);

    if (!sqEl) continue;

    const pm6 = sqEl.querySelector(':scope > .pm6');
    if (!pm6) continue;

    for (const p of piecesDistinct) {
      if ((counts.get(p) || 0) >= 2) {
        // Le mini carré existe sous la forme .pm6 .pm.<piece>
        const mini = pm6.querySelector(`.pm.${p}`);
        if (mini) mini.classList.add('solid');
      }
    }

    // 3) Grand carré : NE CHANGE PAS (comportement actuel)
    const big = sqEl.querySelector(':scope > .pmBig');
    if (!big) continue;

    big.classList.add('on');
    big.classList.remove(
      'piece-p','piece-n','piece-b','piece-r','piece-q','piece-k',
      'side-w','side-b'
    );

    if (piecesDistinct.length === 1) {
      big.classList.add(`piece-${piecesDistinct[0]}`);
    } else {
      big.classList.add(side === 'w' ? 'side-w' : 'side-b');
    }
  }
}

function setupHighlightButtons() {
  // Associe un "libellé de bouton" -> (qType + side)
  const byLabel = {
    "white’s moves":   { qType: qTypeForAbsColorAndKind('w', 'AllLegal'), side: 'w' },
    "black’s moves":   { qType: qTypeForAbsColorAndKind('b', 'AllLegal'), side: 'b' },
    "white’s checks":  { qType: qTypeForAbsColorAndKind('w', 'Checks'),   side: 'w' },
    "black’s checks":  { qType: qTypeForAbsColorAndKind('b', 'Checks'),   side: 'b' },
    "white’s captures":{ qType: qTypeForAbsColorAndKind('w', 'Captures'), side: 'w' },
    "black’s captures":{ qType: qTypeForAbsColorAndKind('b', 'Captures'), side: 'b' },
    "clear":           { clear: true },
  };

  // Nettoyage + normalisation du texte (apostrophe typographique ou simple)
  const norm = (s) =>
    (s || "")
      .trim()
      .toLowerCase()
      .replaceAll("'", "’")          // force apostrophe typographique
      .replace(/\s+/g, " ");         // espaces multiples -> 1 espace

  // Prend tous les boutons de la page et branche ceux qui matchent par texte
  document.querySelectorAll("button").forEach(btn => {
    const key = norm(btn.textContent);
    const cfg = byLabel[key];
    if (!cfg) return;

    // IMPORTANT: évite un submit si le bouton est dans un <form>
    btn.type = "button";

    btn.onclick = () => {
      if (cfg.clear) {
        clearBoardHighlights();
        clearPieceMarkers();
        clearBigMarkers();
        return;
      }

// Récupère la réponse si déjà calculée, sinon calcule-la à la volée
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

// ------------------------------------------------------------
// Code to show the moves when the user clicks the "Show Moves button"

// Function to show moves and disable the button
function showMoves() {
    revealAnswers();
}

// Add event listener to the button (safe even if DOM not ready yet)
const showMovesBtn = document.getElementById("showMovesButton");
if (showMovesBtn) {
    showMovesBtn.addEventListener("click", showMoves);
} else {
    // If the button isn't in the DOM yet, wait for the page to finish loading
    window.addEventListener("DOMContentLoaded", () => {
        const btn = document.getElementById("showMovesButton");
        if (btn) btn.addEventListener("click", showMoves);
    });
}


// ----------------------------------------------------------
// User input code

document.querySelectorAll('.increment').forEach(button => {
    button.addEventListener('click', function() {
        const input = this.previousElementSibling; // Assumes the input field is immediately before the increment button
        input.value = parseInt(input.value, 10) + 1;
    });
});

document.querySelectorAll('.decrement').forEach(button => {
    button.addEventListener('click', function() {
        const input = this.nextElementSibling; // Assumes the input field is immediately after the decrement button
        if (parseInt(input.value, 10) > 0) { // Prevents negative numbers
            input.value = parseInt(input.value, 10) - 1;
        }
    });
});


// -----------------------------------------------------------
// General page code

function createMovesTableHtml(movesList, isBlackToMove) {
    let tableHtml = `
        <h3>Compute counts after these moves:</h3>
        <table class="moves-table">
            <tr>
                <th>White</th>
                <th>Black</th>
            </tr>`;
    
    // If it's black's turn, start with an empty white move
    if (isBlackToMove) {
        tableHtml += `
            <tr>
                <td></td>
                <td>${movesList[0] || ''}</td>
            </tr>`;
        // Start pairing from the second move
        for (let i = 1; i < movesList.length; i += 2) {
            const whiteMove = movesList[i] || '';
            const blackMove = (i + 1 < movesList.length) ? movesList[i + 1] : '';
            tableHtml += `
                <tr>
                    <td>${whiteMove}</td>
                    <td>${blackMove}</td>
                </tr>`;
        }
    } else {
        // If it's white's turn, pair moves normally
        for (let i = 0; i < movesList.length; i += 2) {
            const whiteMove = movesList[i] || '';
            const blackMove = (i + 1 < movesList.length) ? movesList[i + 1] : '';
            tableHtml += `
                <tr>
                    <td>${whiteMove}</td>
                    <td>${blackMove}</td>
                </tr>`;
        }
    }
    tableHtml += '</table>';
    
    return tableHtml;
}

// Set the remainingMoves div based on the current game
function updateMovesDisplay() {
    const movesDisplay = document.getElementById('remainingMoves');
    if (chess_data.plyAhead == 0) {
        movesDisplay.innerHTML = ''; // Clear the moves display
	return;
    }

    const fullHistory = chess_data.game.history();
    const prevPlyIndex = fullHistory.length - chess_data.plyAhead;
    const movesList = fullHistory.slice(prevPlyIndex);
    const isBlackToMove = chess_data.playerToMove === 'b';
    movesDisplay.innerHTML = createMovesTableHtml(movesList, isBlackToMove);
}

function loadNewPuzzle() {
    clearBoardHighlights(); // ✅ reset highlight au changement de puzzle
    // Try a number of times to get a valid position
    const game_and_ply = getRandomPosNumber(chess_data.game_weights,
					    white=chess_data.playerToMoveAfter === 'w');

    chess_data.game_index = game_and_ply.game;
    chess_data.ply = game_and_ply.ply;

    chess_data.game = getGame(game_and_ply.game, game_and_ply.ply);
    chess_data.fen = chess_data.game.fen();
    
    // Need to set the board position to the earlier move
    const prior_game = getGame(game_and_ply.game,
			       Math.max(0, game_and_ply.ply - chess_data.plyAhead))
    chess_data.board.position(prior_game.fen());
	ensurePieceMarkers();
	clearPieceMarkers();
    updateMovesDisplay();
    
// Calcule les réponses sélectionnées dans les settings
chess_data.correct = getCorrectAnswers(chess_data.fen, chess_data.questionTypes);

// Calcule AUSSI AllLegal pour les boutons de highlight
[
  qTypeForAbsColorAndKind('w', 'AllLegal'),
  qTypeForAbsColorAndKind('b', 'AllLegal')
].forEach(qType => {
  if (!chess_data.correct[qType]) {
    chess_data.correct[qType] = getOneCorrectAnswer(chess_data.fen, qType);
  }
});

    // Initialize all answers to start as false
chess_data.is_correct = Object.fromEntries(
    getFixedDisplayQuestionTypes().map(name => [name, false])
);
    console.log(chess_data);
        
getFixedDisplayQuestionTypes().forEach((id) => {
        const input = document.getElementById(id);
        input.value = 0;
        const feedbackIcon = document.getElementById(id + "FeedbackIcon");
        feedbackIcon.textContent = ''; // Clear the feedback icon
        feedbackIcon.className = ''; // Reset the class
        const shownMovesLabel = document.getElementById(id + "ShownMoves");
        shownMovesLabel.textContent = ''; // Clear the shown moves list
    });
        
    if (window.innerWidth > 768 && !('ontouchstart' in window || navigator.maxTouchPoints)) {
        document.getElementById(chess_data.questionTypes[0]).focus();
    }

    const showMovesButton = document.getElementById("showMovesButton");
    showMovesButton.disabled = false;
    showMovesButton.style.backgroundColor = "";    
        
    // Add submit form listener
const form = document.getElementById('chessCountForm');
form.onsubmit = submitAnswers;
}

function startNewGame() {
    gameEnded = false;      // ✅ IMPORTANT
    resetScore();
    loadNewPuzzle();
    startTimer();           // remet timeRemaining
    initTimer();            // ✅ redémarre le setInterval si on l’a stoppé
}

// Return the event handler that is called when the user clicks to
// submits their answers
function submitAnswers(event) {
    event.preventDefault();

    if (gameEnded) return; // évite de jouer après la fin

getFixedDisplayQuestionTypes().forEach((id) => {
        const input = document.getElementById(id);
        const inputValue = parseInt(input.value, 10);
        const isCorrect = inputValue === chess_data.correct[id].count;

        const feedbackIcon = document.getElementById(id + "FeedbackIcon");
feedbackIcon.textContent = isCorrect ? '✓' : '✗';
feedbackIcon.className = isCorrect ? 'correct' : 'incorrect';

        if (!chess_data.is_correct[id] && isCorrect) {
            chess_data.is_correct[id] = true;
            incrementScore();
        }

        if (!isCorrect) {
            penalizeTime();           // peut déclencher endGame()
        }
    });

    // Si la partie s'est terminée via penalizeTime(), on ne charge pas de nouveau puzzle
    if (gameEnded) return;

    const all_correct = Object.values(chess_data.is_correct).reduce((acc, cur) => acc && cur, true);
    if (all_correct) {
        loadNewPuzzle();
    }
}


// ----------------------------------------------------------
// Settings dialog box

// Get the modal settings element
var settings = document.getElementById("settingsModal");

// When the user clicks the setting button, open the settings dialog
const settingsBtn = document.getElementById("settingsButton");
if (settingsBtn) {
    settingsBtn.onclick = function() {
        settings.style.display = "block";
    };
} else {
    window.addEventListener("DOMContentLoaded", () => {
        const btn = document.getElementById("settingsButton");
        if (btn) {
            btn.onclick = function() {
                settings.style.display = "block";
            };
        }
    });
}

// When the user clicks on the "Save Settings" button, close settings
document.getElementsByClassName("close-button")[0].onclick = function() {
    settings.style.display = "none";
}

// When the user clicks anywhere outside of the settings dialog, close it
window.onclick = function(event) {
    if (event.target == settings) {
        settings.style.display = "none";
    }
}

async function saveSettings() {
    // Timer settings
    const showTimer = document.getElementById('showTimer').checked;
    chess_data.showTimer = showTimer;
    localStorage.setItem('showTimer', showTimer);
    setTimerVisibility(showTimer);

    // Player to move
    const selectedToMove = document.querySelector('input[name="playerToMove"]:checked');
    localStorage.setItem('selectedToMove', selectedToMove.value);
    setPlayerToMove(selectedToMove.value);

    // Set positions, weights, and board
    chess_data.games = await getGames();
    chess_data.game_weights = await getWeights();
    setBoard();

    // Which count questions are asked
    const questionCheckboxes = document.querySelectorAll('input[name="quizOption"]:checked');
    chess_data.questionTypes = Array.from(questionCheckboxes).map(opt => opt.value);
    localStorage.setItem('questionTypes', JSON.stringify(chess_data.questionTypes));

    // ✅ Force l’ordre d’affichage (White puis Black, Moves->Checks->Captures)
    createDynamicInputs(getFixedDisplayQuestionTypes());

    // ✅ Rebranche les boutons de surlignage (important après changement du trait)
    setupHighlightButtons();

    // Save ply ahead setting
    const plyAhead = parseInt(document.getElementById('plyAhead').value, 10);
    chess_data.plyAhead = plyAhead;
    localStorage.setItem('plyAhead', plyAhead);

    setPlayerToMoveAfter();

    settings.style.display = "none"; // Close the settings window
    startNewGame();
}

function setTimerVisibility(visible) {
    if (visible) {
	document.getElementById('timerSection').style.display = 'block';
    } else {
	document.getElementById('timerSection').style.display = 'none';
    }
}

// ----------------------------------------------------------
// Load settings

// Load the settings and initialize chess_data
async function loadSettings() {
    chess_data = {
        showTimer: true, // whether the game should be timed
        fen: null, // current position
        correct: null, // stores the correct numbers of counts
        defaultTimeRemaining: 180, // default to 3 min
        timeRemaining: 999, // current time left on clock
        score: 0,
        is_correct: null, // stores which counts are correct
        games: null, // Array of PGN games
        board: null, // The board object
        questionTypes: null, // Array of questions, as strings, to ask the user
        plyAhead: 0  // Number of half-moves ahead to visualize
    };

    // Timer
    chess_data.showTimer = localStorage.getItem('showTimer') === 'false' ? false : true;
    document.getElementById('showTimer').checked = chess_data.showTimer; // Set the checkbox state
    setTimerVisibility(chess_data.showTimer);
    initTimer();

    // Positions and player to move
    var selectedToMove = localStorage.getItem('selectedToMove');
    if (selectedToMove === null || selectedToMove == '') {
        selectedToMove = 'Random';
    }
    console.log(selectedToMove);
    document.querySelector(`input[value="${selectedToMove}"]`).checked = true;
    setPlayerToMove(selectedToMove);

    // Plies ahead
    const savedPlyAhead = localStorage.getItem('plyAhead');
    chess_data.plyAhead = savedPlyAhead ? parseInt(savedPlyAhead) : 0;
    document.getElementById('plyAhead').value = chess_data.plyAhead;
    setPlayerToMoveAfter();
    
    // Load weights and PGN games
    chess_data.games = await getGames();
    chess_data.game_weights = await getWeights();
    setBoard();
    
    // Questions
    const storedTypes = localStorage.getItem('questionTypes');
    if (storedTypes !== null && storedTypes != '') {
        chess_data.questionTypes = JSON.parse(storedTypes)
    } else {
        chess_data.questionTypes = ['p1Checks', 'p1Captures', 'p2Checks', 'p2Captures'];
    }
    // Uncheck each input
    document.querySelectorAll('input[name="quizOption"]').forEach(option => {
        option.checked = false;
    });
    // Check the ones that are enabled
    chess_data.questionTypes.forEach(questionType => {
        document.querySelector(`input[value="${questionType}"]`).checked = true;
    })

    console.log(chess_data.questionTypes);
createDynamicInputs(getFixedDisplayQuestionTypes());
setupHighlightButtons();
}

// Set the player to move
function setPlayerToMove(selected) {
    document.querySelector(`input[value="${selected}"]`).checked = true;
    if (selected == 'White') {
	chess_data.playerToMove = 'w';
    } else if (selected == 'Black') {
	chess_data.playerToMove = 'b';
    } else if (Math.random() < .5) { // last two options are random with probability .5
	chess_data.playerToMove = 'w';
    } else {
	chess_data.playerToMove = 'b';
    }
}

// Set the player to move after the moves displayed on the screen
// Requires playerToMove and pliesAhead already set
function setPlayerToMoveAfter() {
    chess_data.playerToMoveAfter = (chess_data.plyAhead % 2 === 0
				    ? chess_data.playerToMove
				    : (chess_data.playerToMove === 'w' ? 'b' : 'w'))
}

// Initialize the board based on the player to move
function setBoard() {
    chess_data.board = Chessboard('board', 'start');
    if (chess_data.playerToMove == 'b') {
        chess_data.board.flip();
    }
    // ✅ injecte les marqueurs une fois que le board DOM est en place
    ensurePieceMarkers();
}

// Set the inputs where the user specifies how many possible moves there are
function createDynamicInputs(questionTypes) {
    const elem = document.getElementById('count-inputs');
    elem.innerHTML = ''; // Clear previous inputs

    questionTypes.forEach(questionType => {
	const div = document.createElement('div');
        div.className = 'input-group';

        const label = document.createElement('label');
        const input = document.createElement('input');
        const decrementButton = document.createElement('button');
        const incrementButton = document.createElement('button');
	const feedbackIcon = document.createElement('span');
	const shownMoves = document.createElement('label');
        
        label.textContent = createDynamicInputsLabel(questionType);
        input.type = 'number';
        input.id = questionType;
        input.name = questionType;
        input.min = '0';
        input.required = true;

        decrementButton.textContent = '←';
        decrementButton.type = 'button';
        decrementButton.onclick = () => { if (input.value > 0) input.value--; };
	decrementButton.className = 'decrement';

        incrementButton.textContent = '→';
        incrementButton.type = 'button';
        incrementButton.onclick = () => { input.value++; };
	incrementButton.className = 'increment';
	
        feedbackIcon.className = 'feedbackIcon';
        feedbackIcon.id = `${questionType}FeedbackIcon`;

	shownMoves.className = 'shownMoves';
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

// Return the label for each input
function createDynamicInputsLabel(questionType) {
  const isP1 = questionType.startsWith('p1');
  const colorAbs = isP1
    ? chess_data.playerToMove
    : (chess_data.playerToMove === 'w' ? 'b' : 'w');

  const who = (colorAbs === 'w') ? "White's" : "Black's";

  let what = "Moves";
  if (questionType.endsWith("Checks")) what = "Checks";
  if (questionType.endsWith("Captures")) what = "Captures";

  // \n = retour à la ligne
  return `${who}\n${what}:`;
}

// -----------------------------------------------------------
// Main logic, which depends on loaded positions

(async () => {
    await loadSettings();

    // ✅ active les boutons de highlight sous l’échiquier
    setupHighlightButtons();

    startNewGame();
})();

