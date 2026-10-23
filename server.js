const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Middleware om JSON te lezen
app.use(express.json());

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// In-memory database of active game rooms
const rooms = {};

// Helper to generate a random 4-digit room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);
    return code;
}

// API: Create a new room (Host)
app.post('/api/game/create', (req, res) => {
    const code = generateRoomCode();
    const hostSecret = Math.random().toString(36).substring(2);
    
    rooms[code] = {
        code: code,
        hostSecret: hostSecret,
        status: 'lobby',
        roundNumber: 0,
        currentTopic: '',
        speakerId: null,
        speakerIsTrickster: false,
        players: [],
        resultTitle: '',
        resultSubtitle: ''
    };

    console.log(`Room created: ${code}`);
    res.json({ success: true, code, hostSecret });
});

// API: Join an existing room (Player)
app.post('/api/game/join', (req, res) => {
    let { code, name } = req.body;
    code = code ? code.trim().toUpperCase() : '';
    name = name ? name.trim() : 'Player';

    const room = rooms[code];
    if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found. Check the 4-digit code.' });
    }

    const playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    room.players.push({
        id: playerId,
        name: name,
        score: 0,
        hasVoted: false,
        vote: null,
        isSpeaker: false
    });

    console.log(`Player ${name} joined room ${code}`);
    res.json({ success: true, playerId, roomCode: code });
});

// API: Get Game State (Polled by Host and Players)
app.get('/api/game/state', (req, res) => {
    const { code, hostSecret, playerId } = req.query;
    const room = rooms[code];

    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    // If Host is requesting
    if (hostSecret && hostSecret === room.hostSecret) {
        const speaker = room.players.find(p => p.id === room.speakerId);
        return res.json({
            code: room.code,
            status: room.status,
            roundNumber: room.roundNumber,
            currentTopic: room.currentTopic,
            speakerName: speaker ? speaker.name : null,
            speakerIsTrickster: room.speakerIsTrickster,
            resultTitle: room.resultTitle,
            resultSubtitle: room.resultSubtitle,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                score: p.score,
                hasVoted: p.hasVoted,
                vote: p.vote,
                isSpeaker: p.id === room.speakerId
            }))
        });
    }

    // If Player is requesting
    if (playerId) {
        const player = room.players.find(p => p.id === playerId);
        if (!player) {
            return res.status(404).json({ error: 'Player not found in room' });
        }

        const speaker = room.players.find(p => p.id === room.speakerId);
        const isSpeaker = player.id === room.speakerId;

        return res.json({
            status: room.status,
            roundNumber: room.roundNumber,
            speakerIsTrickster: room.speakerIsTrickster,
            resultTitle: room.resultTitle,
            resultSubtitle: room.resultSubtitle,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                score: p.score
            })),
            playerState: {
                score: player.score,
                hasVoted: player.hasVoted,
                vote: player.vote,
                role: {
                    isSpeaker: isSpeaker,
                    isTrickster: isSpeaker ? room.speakerIsTrickster : false,
                    speakerName: speaker ? speaker.name : '',
                    topic: room.currentTopic
                },
                lastEarned: player.lastEarned || 0
            }
        });
    }

    res.status(400).json({ error: 'Unauthorized state request' });
});

// API: Host picks next speaker and topic
app.post('/api/game/next-round', (req, res) => {
    const { code, hostSecret, topic } = req.body;
    const room = rooms[code];

    if (!room || room.hostSecret !== hostSecret) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    if (room.players.length === 0) {
        return res.status(400).json({ error: 'Need at least one player to start a round' });
    }

    room.roundNumber += 1;
    room.status = 'storytelling';
    room.currentTopic = topic || 'General Topic';
    room.resultTitle = '';
    room.resultSubtitle = '';

    // Reset player votes
    room.players.forEach(p => {
        p.hasVoted = false;
        p.vote = null;
        p.lastEarned = 0;
    });

    // Pick random speaker
    const randomIndex = Math.floor(Math.random() * room.players.length);
    room.speakerId = room.players[randomIndex].id;

    // Pick random Trickster among players
    const tricksterIndex = Math.floor(Math.random() * room.players.length);
    room.speakerIsTrickster = (room.players[tricksterIndex].id === room.speakerId);
    // (Optioneel: zorg dat de speaker altijd 50% kans heeft om Trickster te zijn)
    room.speakerIsTrickster = Math.random() < 0.5;

    console.log(`Round ${room.roundNumber} started in room ${code}. Speaker: ${room.speakerId}, Trickster: ${room.speakerIsTrickster}`);
    res.json({ success: true });
});

// API: Host opens voting phase
app.post('/api/game/start-voting', (req, res) => {
    const { code, hostSecret } = req.body;
    const room = rooms[code];

    if (!room || room.hostSecret !== hostSecret) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    room.status = 'voting';
    res.json({ success: true });
});

// API: Player submits vote ('truth' or 'lie')
app.post('/api/game/vote', (req, res) => {
    const { code, playerId, guess } = req.body;
    const room = rooms[code];

    if (!room || room.status !== 'voting') {
        return res.status(400).json({ error: 'Voting is not active' });
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player || player.id === room.speakerId) {
        return res.status(400).json({ error: 'Invalid player or speaker cannot vote' });
    }

    player.hasVoted = true;
    player.vote = guess; // 'truth' or 'lie'

    res.json({ success: true });
});

// API: Host reveals results and calculates scores
app.post('/api/game/reveal', (req, res) => {
    const { code, hostSecret } = req.body;
    const room = rooms[code];

    if (!room || room.hostSecret !== hostSecret) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    room.status = 'reveal';
    const speaker = room.players.find(p => p.id === room.speakerId);
    const speakerName = speaker ? speaker.name : 'The Speaker';

    let tricksterFooledEveryone = true;

    // Calculate scores
    room.players.forEach(p => {
        if (p.id === room.speakerId) return; // Skip speaker for a moment

        const guessedLie = (p.vote === 'lie');
        // If speaker was actually a Trickster (lying) and player guessed 'lie', player gets +10 pts
        if (room.speakerIsTrickster && guessedLie) {
            p.lastEarned = 10;
            p.score += 10;
        } 
        // If speaker was telling the Truth and player guessed 'truth', player gets +10 pts
        else if (!room.speakerIsTrickster && !guessedLie) {
            p.lastEarned = 10;
            p.score += 10;
        } else {
            p.lastEarned = 0;
        }

        // Check if trickster got caught by this juror
        if (room.speakerIsTrickster && guessedLie) {
            tricksterFooledEveryone = false;
        }
    });

    // Score for the Speaker
    if (speaker) {
        if (room.speakerIsTrickster) {
            if (tricksterFooledEveryone) {
                speaker.lastEarned = 20;
                speaker.score += 20;
                room.resultTitle = `🎭 THE TRICKSTER WON! (+20 PTS)`;
                room.resultSubtitle = `${speakerName} successfully bluffed everyone and got away with the lie!`;
            } else {
                speaker.lastEarned = 0;
                room.resultTitle = `⚖️ THE JURY CAUGHT THE TRICKSTER!`;
                room.resultSubtitle = `${speakerName} was lying, and the jury successfully saw through it!`;
            }
        } else {
            speaker.lastEarned = 15;
            speaker.score += 15;
            room.resultTitle = `✅ IT WAS 100% THE TRUTH!`;
            room.resultSubtitle = `${speakerName} told a genuine real story and convinced the jury (+15 PTS)!`;
        }
    }

    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Truth or Trickster Server running on port ${PORT}`);
});