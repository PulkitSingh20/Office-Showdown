const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Game State ────────────────────────────────────────────────────────────
let gameState = {
  phase: 'lobby',       // lobby | team-select | question | reveal | scoreboard | finished
  teams: {
    A: { name: 'Team Alpha', players: [], score: 0, color: '#FF4D6D' },
    B: { name: 'Team Beta',  players: [], score: 0, color: '#4CC9F0' }
  },
  players: {},          // socketId -> { name, team, isAdmin }
  currentQuestion: null,
  questionIndex: -1,
  answers: {},          // socketId -> answer
  teamAnswers: {},      // teamId -> { answer, lockedBy, lockedAt }
  roundTimer: null,
  timerValue: 0,
  questionHistory: [],
  maxPlayers: 6,        // 2-3 per team, 2 teams
  teamSize: 3,
};

// ─── Question Bank ─────────────────────────────────────────────────────────
const QUESTIONS = [
  { q: "What does HTTP stand for?", options: ["HyperText Transfer Protocol","HighText Transfer Protocol","HyperText Transit Protocol","HyperTool Transfer Protocol"], correct: 0, category: "Tech" },
  { q: "Which company created the JavaScript programming language?", options: ["Microsoft","Google","Netscape","Apple"], correct: 2, category: "Tech" },
  { q: "What year was the first iPhone released?", options: ["2005","2006","2007","2008"], correct: 2, category: "General" },
  { q: "What is the capital of Japan?", options: ["Beijing","Seoul","Bangkok","Tokyo"], correct: 3, category: "Geography" },
  { q: "In office terms, what does KPI stand for?", options: ["Key Performance Indicator","Key Process Integration","Key Product Initiative","Knowledge Process Index"], correct: 0, category: "Office" },
  { q: "Which planet is known as the Red Planet?", options: ["Venus","Jupiter","Mars","Saturn"], correct: 2, category: "Science" },
  { q: "What does CEO stand for?", options: ["Chief Efficiency Officer","Chief Executive Officer","Central Executive Officer","Chief Engagement Officer"], correct: 1, category: "Office" },
  { q: "How many bytes are in a kilobyte (standard)?", options: ["512","1024","1000","2048"], correct: 1, category: "Tech" },
  { q: "What is the most widely spoken language in the world?", options: ["English","Spanish","Hindi","Mandarin Chinese"], correct: 3, category: "General" },
  { q: "What does 'Agile' refer to in the workplace?", options: ["A fitness program","A project management methodology","A software language","An HR system"], correct: 1, category: "Office" },
  { q: "Who painted the Mona Lisa?", options: ["Michelangelo","Raphael","Leonardo da Vinci","Donatello"], correct: 2, category: "Culture" },
  { q: "What does SaaS stand for?", options: ["Software as a Service","Sales as a Strategy","System and Security","Software and Architecture Stack"], correct: 0, category: "Tech" },
  { q: "Which of these is NOT a programming language?", options: ["Python","Cobra","Ruby","Photoshop"], correct: 3, category: "Tech" },
  { q: "What year did World War II end?", options: ["1943","1944","1945","1946"], correct: 2, category: "History" },
  { q: "What does ROI stand for?", options: ["Rate of Income","Return on Investment","Revenue over Investment","Range of Impact"], correct: 1, category: "Office" },
];

let shuffledQuestions = [];

function shuffleArray(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function resetGame() {
  shuffledQuestions = shuffleArray(QUESTIONS);
  gameState.phase = 'lobby';
  gameState.questionIndex = -1;
  gameState.currentQuestion = null;
  gameState.answers = {};
  gameState.teamAnswers = {};
  gameState.questionHistory = [];
  gameState.teams.A.score = 0;
  gameState.teams.B.score = 0;
  gameState.teams.A.players = [];
  gameState.teams.B.players = [];
  // reassign teams
  Object.values(gameState.players).forEach(p => { p.team = null; });
}

function getPublicState() {
  return {
    phase: gameState.phase,
    teams: gameState.teams,
    players: Object.entries(gameState.players).map(([id, p]) => ({ id, ...p })),
    currentQuestion: gameState.currentQuestion
      ? { q: gameState.currentQuestion.q, options: gameState.currentQuestion.options, category: gameState.currentQuestion.category, index: gameState.questionIndex, total: shuffledQuestions.length }
      : null,
    teamAnswers: gameState.phase === 'reveal'
      ? gameState.teamAnswers
      : Object.fromEntries(Object.entries(gameState.teamAnswers).map(([k,v]) => [k, { locked: !!v?.lockedBy }])),
    timerValue: gameState.timerValue,
    questionHistory: gameState.questionHistory,
    totalQuestions: shuffledQuestions.length,
  };
}

function startTimer(seconds, onEnd) {
  if (gameState.roundTimer) clearInterval(gameState.roundTimer);
  gameState.timerValue = seconds;
  io.emit('stateUpdate', getPublicState());
  gameState.roundTimer = setInterval(() => {
    gameState.timerValue--;
    io.emit('timerTick', gameState.timerValue);
    if (gameState.timerValue <= 0) {
      clearInterval(gameState.roundTimer);
      gameState.roundTimer = null;
      onEnd();
    }
  }, 1000);
}

function revealAnswer() {
  gameState.phase = 'reveal';
  const q = gameState.currentQuestion;
  let winner = null;

  ['A', 'B'].forEach(teamId => {
    const ta = gameState.teamAnswers[teamId];
    if (ta && ta.answer === q.correct) {
      gameState.teams[teamId].score += 10;
      winner = teamId;
    }
  });

  gameState.questionHistory.push({
    question: q.q,
    correct: q.options[q.correct],
    teamA: gameState.teamAnswers.A ? { answer: q.options[gameState.teamAnswers.A.answer], correct: gameState.teamAnswers.A.answer === q.correct } : null,
    teamB: gameState.teamAnswers.B ? { answer: q.options[gameState.teamAnswers.B.answer], correct: gameState.teamAnswers.B.answer === q.correct } : null,
  });

  io.emit('stateUpdate', getPublicState());
  io.emit('revealResult', {
    correctIndex: q.correct,
    correctAnswer: q.options[q.correct],
    teamAnswers: gameState.teamAnswers,
    winner,
    scores: { A: gameState.teams.A.score, B: gameState.teams.B.score }
  });
}

function nextQuestion() {
  gameState.questionIndex++;
  if (gameState.questionIndex >= shuffledQuestions.length) {
    gameState.phase = 'finished';
    io.emit('stateUpdate', getPublicState());
    io.emit('gameOver', {
      scores: { A: gameState.teams.A.score, B: gameState.teams.B.score },
      winner: gameState.teams.A.score > gameState.teams.B.score ? 'A' : gameState.teams.B.score > gameState.teams.A.score ? 'B' : 'draw'
    });
    return;
  }

  gameState.phase = 'question';
  gameState.currentQuestion = shuffledQuestions[gameState.questionIndex];
  gameState.answers = {};
  gameState.teamAnswers = {};

  io.emit('stateUpdate', getPublicState());
  io.emit('newQuestion', {
    q: gameState.currentQuestion.q,
    options: gameState.currentQuestion.options,
    category: gameState.currentQuestion.category,
    index: gameState.questionIndex,
    total: shuffledQuestions.length,
  });

  startTimer(30, () => {
    if (gameState.phase === 'question') revealAnswer();
  });
}

// ─── Socket Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('joinGame', ({ name }) => {
    if (!name || name.trim().length < 1) return;
    const playerName = name.trim().slice(0, 20);
    const isAdmin = Object.keys(gameState.players).length === 0;
    gameState.players[socket.id] = { name: playerName, team: null, isAdmin };
    io.emit('stateUpdate', getPublicState());
    socket.emit('joined', { id: socket.id, isAdmin, name: playerName });
    io.emit('chatMessage', { system: true, text: `${playerName} joined the game!` });
  });

  socket.on('chooseTeam', ({ team }) => {
    const player = gameState.players[socket.id];
    if (!player || gameState.phase !== 'lobby') return;
    if (!['A', 'B'].includes(team)) return;

    const teamPlayers = Object.values(gameState.players).filter(p => p.team === team);
    if (teamPlayers.length >= gameState.teamSize) {
      socket.emit('error', { message: `Team ${gameState.teams[team].name} is full (max ${gameState.teamSize})` });
      return;
    }

    // remove from old team
    const oldTeam = player.team;
    if (oldTeam) {
      gameState.teams[oldTeam].players = gameState.teams[oldTeam].players.filter(id => id !== socket.id);
    }

    player.team = team;
    gameState.teams[team].players = Object.keys(gameState.players).filter(id => gameState.players[id].team === team);
    io.emit('stateUpdate', getPublicState());
    io.emit('chatMessage', { system: true, text: `${player.name} joined ${gameState.teams[team].name}` });
  });

  socket.on('startGame', () => {
    const player = gameState.players[socket.id];
    if (!player?.isAdmin) return;
    const teamA = Object.values(gameState.players).filter(p => p.team === 'A');
    const teamB = Object.values(gameState.players).filter(p => p.team === 'B');
    if (teamA.length < 1 || teamB.length < 1) {
      socket.emit('error', { message: 'Each team needs at least 1 player!' });
      return;
    }
    shuffledQuestions = shuffleArray(QUESTIONS);
    gameState.questionIndex = -1;
    gameState.questionHistory = [];
    gameState.teams.A.score = 0;
    gameState.teams.B.score = 0;
    nextQuestion();
  });

  socket.on('submitAnswer', ({ answerIndex }) => {
    const player = gameState.players[socket.id];
    if (!player?.team || gameState.phase !== 'question') return;
    if (typeof answerIndex !== 'number') return;

    gameState.answers[socket.id] = answerIndex;

    const teamId = player.team;
    // Only lock answer if majority of team agrees or first to submit (team captain logic)
    if (!gameState.teamAnswers[teamId]) {
      gameState.teamAnswers[teamId] = { answer: answerIndex, lockedBy: player.name, lockedAt: Date.now() };
      io.emit('stateUpdate', getPublicState());
      io.emit('chatMessage', { system: true, text: `${gameState.teams[teamId].name} locked in their answer!` });
    }

    // If both teams answered, reveal early
    if (gameState.teamAnswers.A && gameState.teamAnswers.B) {
      if (gameState.roundTimer) clearInterval(gameState.roundTimer);
      setTimeout(revealAnswer, 500);
    }
  });

  socket.on('nextQuestion', () => {
    const player = gameState.players[socket.id];
    if (!player?.isAdmin || gameState.phase !== 'reveal') return;
    nextQuestion();
  });

  socket.on('resetGame', () => {
    const player = gameState.players[socket.id];
    if (!player?.isAdmin) return;
    resetGame();
    io.emit('gameReset');
    io.emit('stateUpdate', getPublicState());
  });

  socket.on('chatMessage', ({ text }) => {
    const player = gameState.players[socket.id];
    if (!player || !text) return;
    io.emit('chatMessage', {
      player: player.name,
      team: player.team,
      teamColor: player.team ? gameState.teams[player.team].color : '#999',
      text: text.slice(0, 200),
    });
  });

  socket.on('requestState', () => {
    socket.emit('stateUpdate', getPublicState());
  });

  socket.on('disconnect', () => {
    const player = gameState.players[socket.id];
    if (player) {
      if (player.team) {
        gameState.teams[player.team].players = gameState.teams[player.team].players.filter(id => id !== socket.id);
      }
      // Transfer admin if needed
      if (player.isAdmin) {
        const remaining = Object.keys(gameState.players).filter(id => id !== socket.id);
        if (remaining.length > 0) {
          gameState.players[remaining[0]].isAdmin = true;
        }
      }
      io.emit('chatMessage', { system: true, text: `${player.name} left the game.` });
      delete gameState.players[socket.id];
      io.emit('stateUpdate', getPublicState());
    }
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🎮 Office Quiz Game running at http://localhost:${PORT}`);
});
