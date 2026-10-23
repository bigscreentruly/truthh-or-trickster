const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Host creates a room
    socket.on('create-room', (callback) => {
        const code = generateRoomCode();
        const hostSecret = Math.random().toString(36).substring(2);
        
        rooms[code] = {
            code: code,
            hostSocketId: socket.id,
            hostSecret: hostSecret,
            status: 'lobby',
            roundNumber: 0,
            currentTopic: '',
            speakerId: null,
            players: [],
            votes: {}
        };

        socket.join(code);
        callback({ success: true, code, hostSecret });
        console.log(`Room created: ${code}`);
    });

    // Player joins a room
    socket.on('join-room', ({ code, name }, callback) => {
        code = code ? code.trim() : '';
        const room = rooms[code];

        if (!room) {
            return callback({ success: false, error: 'Room not found. Check the code.' });
        }

        const playerId = socket.id;
        room.players.push({
            id: playerId,
            name: name || 'Player',
            score: 0,
            hasVoted: false,
            vote: null,
            isSpeaker: false
        });

        socket.join(code);
        callback({ success: true, playerId, roomCode: code });
        
        // Broadcast updated room state to everyone in the room
        io.to(code).emit('room-update', getPublicState(room));
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.hostSocketId === socket.id) {
                io.to(code).emit('room-closed');
                delete rooms[code];
            } else {
                io.to(code).emit('room-update', getPublicState(room));
            }
        }
    });
});

function getPublicState(room) {
    return {
        code: room.code,
        status: room.status,
        roundNumber: room.roundNumber,
        currentTopic: room.currentTopic,
        players: room.players
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});