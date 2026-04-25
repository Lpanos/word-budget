const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const gm = require('./gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/health', (req, res) => res.status(200).send('ok'));

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'host', 'index.html'));
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'play', 'index.html'));
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

io.on('connection', (socket) => {

  socket.on('create_room', () => {
    const room = gm.createRoom(socket.id);
    socket.join(room.code + ':host');
    socket.emit('room_created', { code: room.code });
  });

  socket.on('join_room', ({ code, name }) => {
    if (!code || !name) {
      socket.emit('error', { message: 'Room code and name are required' });
      return;
    }
    const room = gm.getRoom(code.toUpperCase());
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (room.phase !== 'LOBBY') {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }
    const result = gm.addPlayer(room, socket.id, name);
    if (!result.ok) {
      socket.emit('error', { message: result.reason });
      return;
    }
    socket.join(room.code);
    const players = gm.getPlayerList(room);
    socket.emit('joined', { code: room.code, players, yourId: socket.id });
    io.to(room.code + ':host').emit('player_joined', { players });
    socket.to(room.code).emit('player_joined', { players });
  });

  socket.on('start_game', () => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room || room.host !== socket.id) return;
    gm.startGame(room, io);
  });

  socket.on('submit_answer', ({ text }) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return;
    const result = gm.submitAnswer(room, socket.id, text || '', io);
    if (!result.ok) {
      socket.emit('error', { message: result.reason });
    } else {
      socket.emit('answer_accepted', {});
    }
  });

  socket.on('submit_vote', ({ matchupId, choice }) => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return;
    const result = gm.submitVote(room, socket.id, matchupId, choice);
    if (!result.ok) {
      socket.emit('error', { message: result.reason });
    } else {
      socket.emit('vote_accepted', {});
    }
  });

  socket.on('play_again', () => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room || room.host !== socket.id) return;
    gm.playAgain(room, io);
  });

  socket.on('disconnect', () => {
    const room = gm.getRoomBySocket(socket.id);
    if (!room) return;

    if (room.host === socket.id) {
      for (const p of room.players) {
        io.to(p.id).emit('error', { message: 'Host disconnected. Game over.' });
      }
      gm.destroyRoom(room.code);
    } else {
      gm.removePlayer(room, socket.id);
      const players = gm.getPlayerList(room);
      io.to(room.code + ':host').emit('player_left', { players });
      io.to(room.code).emit('player_left', { players });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Word Budget server running on port ${PORT}`);
  console.log(`Host:   http://localhost:${PORT}/host`);
  console.log(`Play:   http://localhost:${PORT}/play`);
  console.log(`LAN:    http://<your-local-ip>:${PORT}/play`);
});
