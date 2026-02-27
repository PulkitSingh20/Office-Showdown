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

// ─── Question Bank (60 questions — 15 picked randomly each game) ───────────
const ALL_QUESTIONS = [
  // ── TECH ──
  { q: "What does HTTP stand for?", options: ["HyperText Transfer Protocol","HighText Transfer Protocol","HyperText Transit Protocol","HyperTool Transfer Protocol"], correct: 0, category: "Tech" },
  { q: "Which company created JavaScript?", options: ["Microsoft","Google","Netscape","Apple"], correct: 2, category: "Tech" },
  { q: "How many bytes are in a kilobyte?", options: ["512","1024","1000","2048"], correct: 1, category: "Tech" },
  { q: "What does SaaS stand for?", options: ["Software as a Service","Sales as a Strategy","System and Security","Software and Architecture Stack"], correct: 0, category: "Tech" },
  { q: "Which of these is NOT a programming language?", options: ["Python","Cobra","Ruby","Photoshop"], correct: 3, category: "Tech" },
  { q: "What does CPU stand for?", options: ["Central Process Unit","Core Processing Unit","Central Processing Unit","Computed Processing Unit"], correct: 2, category: "Tech" },
  { q: "Which company makes the Android operating system?", options: ["Apple","Microsoft","Samsung","Google"], correct: 3, category: "Tech" },
  { q: "What does UI stand for in design?", options: ["User Interface","Unified Integration","Upload Interface","User Interaction"], correct: 0, category: "Tech" },
  { q: "Which language is primarily used for styling web pages?", options: ["HTML","JavaScript","CSS","Python"], correct: 2, category: "Tech" },
  { q: "What does API stand for?", options: ["Applied Program Index","Application Programming Interface","Automated Process Integration","Application Process Index"], correct: 1, category: "Tech" },
  { q: "What does URL stand for?", options: ["Uniform Resource Locator","Universal Remote Link","Unified Resource Layer","User Resource Link"], correct: 0, category: "Tech" },
  { q: "Which of these is a version control system?", options: ["Slack","Docker","Git","Jira"], correct: 2, category: "Tech" },

  // ── OFFICE ──
  { q: "What does KPI stand for?", options: ["Key Performance Indicator","Key Process Integration","Key Product Initiative","Knowledge Process Index"], correct: 0, category: "Office" },
  { q: "What does CEO stand for?", options: ["Chief Efficiency Officer","Chief Executive Officer","Central Executive Officer","Chief Engagement Officer"], correct: 1, category: "Office" },
  { q: "What does ROI stand for?", options: ["Rate of Income","Return on Investment","Revenue over Investment","Range of Impact"], correct: 1, category: "Office" },
  { q: "What does Agile refer to in the workplace?", options: ["A fitness program","A project management methodology","A software language","An HR system"], correct: 1, category: "Office" },
  { q: "What does B2B stand for?", options: ["Back to Basics","Business to Business","Budget to Baseline","Brand to Buyer"], correct: 1, category: "Office" },
  { q: "What does OKR stand for?", options: ["Objectives and Key Results","Operations and Key Risks","Output and Knowledge Review","Objectives and KPI Rating"], correct: 0, category: "Office" },
  { q: "In project management, what is a deliverable?", options: ["A courier service","A tangible output of a project","A team meeting","A budget report"], correct: 1, category: "Office" },
  { q: "What does CRM stand for?", options: ["Customer Relationship Management","Central Revenue Model","Client Reporting Module","Customer Retention Method"], correct: 0, category: "Office" },
  { q: "What does P&L stand for?", options: ["Product and Logistics","Profit and Loss","Planning and Launching","Policy and Limits"], correct: 1, category: "Office" },
  { q: "What is a stakeholder?", options: ["A butcher","Anyone with an interest in a project","A company shareholder only","The project manager"], correct: 1, category: "Office" },
  { q: "What does WFH stand for?", options: ["Work From Home","Working For Hours","Workflow Handling","Weekly Follow-up Hours"], correct: 0, category: "Office" },
  { q: "What is scope creep?", options: ["A type of software bug","Uncontrolled expansion of project scope","A management technique","A performance review"], correct: 1, category: "Office" },

  // ── GENERAL ──
  { q: "What year was the first iPhone released?", options: ["2005","2006","2007","2008"], correct: 2, category: "General" },
  { q: "What is the most widely spoken language in the world?", options: ["English","Spanish","Hindi","Mandarin Chinese"], correct: 3, category: "General" },
  { q: "How many sides does a hexagon have?", options: ["5","6","7","8"], correct: 1, category: "General" },
  { q: "What is the smallest planet in our solar system?", options: ["Mars","Venus","Mercury","Pluto"], correct: 2, category: "General" },
  { q: "How many continents are there on Earth?", options: ["5","6","7","8"], correct: 2, category: "General" },
  { q: "What is the hardest natural substance on Earth?", options: ["Gold","Iron","Diamond","Quartz"], correct: 2, category: "General" },
  { q: "How many hours are in a week?", options: ["148","168","172","156"], correct: 1, category: "General" },
  { q: "What is the largest ocean on Earth?", options: ["Atlantic","Indian","Arctic","Pacific"], correct: 3, category: "General" },
  { q: "What is the chemical symbol for water?", options: ["WA","HO","H2O","W2O"], correct: 2, category: "General" },
  { q: "Which number is considered unlucky in many Western cultures?", options: ["7","11","13","17"], correct: 2, category: "General" },

  // ── GEOGRAPHY ──
  { q: "What is the capital of Japan?", options: ["Beijing","Seoul","Bangkok","Tokyo"], correct: 3, category: "Geography" },
  { q: "What is the capital of Australia?", options: ["Sydney","Melbourne","Canberra","Brisbane"], correct: 2, category: "Geography" },
  { q: "Which country has the largest population?", options: ["USA","India","China","Indonesia"], correct: 1, category: "Geography" },
  { q: "What is the longest river in the world?", options: ["Amazon","Yangtze","Mississippi","Nile"], correct: 3, category: "Geography" },
  { q: "Which country is home to the Eiffel Tower?", options: ["Italy","Spain","Germany","France"], correct: 3, category: "Geography" },
  { q: "What is the capital of Brazil?", options: ["Rio de Janeiro","Sao Paulo","Brasilia","Salvador"], correct: 2, category: "Geography" },
  { q: "Which is the largest country by land area?", options: ["Canada","China","USA","Russia"], correct: 3, category: "Geography" },
  { q: "The Great Barrier Reef is located in which country?", options: ["USA","South Africa","New Zealand","Australia"], correct: 3, category: "Geography" },

  // ── SCIENCE ──
  { q: "Which planet is known as the Red Planet?", options: ["Venus","Jupiter","Mars","Saturn"], correct: 2, category: "Science" },
  { q: "What gas do plants absorb from the atmosphere?", options: ["Oxygen","Nitrogen","Carbon Dioxide","Hydrogen"], correct: 2, category: "Science" },
  { q: "What is the powerhouse of the cell?", options: ["Nucleus","Ribosome","Mitochondria","Golgi body"], correct: 2, category: "Science" },
  { q: "What is the approximate speed of light in km/s?", options: ["150,000","300,000","500,000","1,000,000"], correct: 1, category: "Science" },
  { q: "How many elements are in the periodic table?", options: ["108","116","118","124"], correct: 2, category: "Science" },
  { q: "What does DNA stand for?", options: ["Digital Nucleic Acid","Deoxyribonucleic Acid","Dynamic Nucleus Array","Data Nucleic Arrangement"], correct: 1, category: "Science" },
  { q: "Which planet has the most moons?", options: ["Jupiter","Neptune","Uranus","Saturn"], correct: 3, category: "Science" },
  { q: "What is the boiling point of water in Celsius?", options: ["90","95","100","105"], correct: 2, category: "Science" },

  // ── HISTORY ──
  { q: "What year did World War II end?", options: ["1943","1944","1945","1946"], correct: 2, category: "History" },
  { q: "Who was the first person to walk on the Moon?", options: ["Buzz Aldrin","Yuri Gagarin","Neil Armstrong","John Glenn"], correct: 2, category: "History" },
  { q: "In what year did the Berlin Wall fall?", options: ["1987","1988","1989","1990"], correct: 2, category: "History" },
  { q: "Who invented the telephone?", options: ["Thomas Edison","Nikola Tesla","Alexander Graham Bell","Guglielmo Marconi"], correct: 2, category: "History" },
  { q: "What year did the Titanic sink?", options: ["1910","1911","1912","1913"], correct: 2, category: "History" },

  // ── CULTURE ──
  { q: "Who painted the Mona Lisa?", options: ["Michelangelo","Raphael","Leonardo da Vinci","Donatello"], correct: 2, category: "Culture" },
  { q: "Which author wrote Harry Potter?", options: ["Roald Dahl","J.R.R. Tolkien","J.K. Rowling","C.S. Lewis"], correct: 2, category: "Culture" },
  { q: "What is the world's best-selling video game of all time?", options: ["Tetris","GTA V","Minecraft","Super Mario Bros"], correct: 2, category: "Culture" },
  { q: "Which musical instrument has 88 keys?", options: ["Organ","Harpsichord","Piano","Synthesizer"], correct: 2, category: "Culture" },
  { q: "How many players are on a standard soccer team?", options: ["9","10","11","12"], correct: 2, category: "Culture" },
];

const QUESTIONS_PER_GAME = 15;

let shuffledQuestions = [];

// Fisher-Yates shuffle for true randomness
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick a fresh random 15 questions each game
function pickQuestions() {
  return shuffleArray(ALL_QUESTIONS).slice(0, QUESTIONS_PER_GAME);
}

function resetGame() {
  shuffledQuestions = pickQuestions();
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
    shuffledQuestions = pickQuestions();
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
