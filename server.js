// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// rooms map: roomId -> Set(socketId)
const rooms = new Map();

io.on('connection', socket => {
  console.log('connected', socket.id);

  socket.on('join', ({ roomId, userName, avatar }) => {
    socket.data.roomId = roomId;
    socket.data.userName = userName || socket.id;
    socket.data.avatar = avatar || null;

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const set = rooms.get(roomId);

    // notify existing peers about new user
    socket.to(roomId).emit('user-joined', { id: socket.id, userName: socket.data.userName, avatar: socket.data.avatar });

    // send joined event to the joining peer: your id + peers list
    socket.emit('joined', { you: socket.id, peers: Array.from(set) });

    set.add(socket.id);
    socket.join(roomId);
    console.log(`${socket.id} joined ${roomId}`);
  });

  // Signaling (directed)
  socket.on('offer', ({ to, sdp }) => io.to(to).emit('offer', { from: socket.id, sdp }));
  socket.on('answer', ({ to, sdp }) => io.to(to).emit('answer', { from: socket.id, sdp }));
  socket.on('ice-candidate', ({ to, candidate }) => io.to(to).emit('ice-candidate', { from: socket.id, candidate }));

  // Chat: relay to others in same room (exclude sender) -> prevents duplicate
  socket.on('chat-message', ({ roomId, userName, avatar, message, type }) => {
    socket.to(roomId).emit('chat-message', {
      id: socket.id,
      userName,
      avatar,
      message,
      type: type || 'text',
      timestamp: Date.now()
    });
  });

  // Typing indicator -> relay to others
  socket.on('typing', ({ roomId, userName, isTyping }) => {
    socket.to(roomId).emit('typing', { id: socket.id, userName, isTyping });
  });

  // Leave
  socket.on('leave', () => {
    const rid = socket.data.roomId;
    if (rid && rooms.has(rid)) {
      socket.to(rid).emit('user-left', { id: socket.id });
      rooms.get(rid).delete(socket.id);
      socket.leave(rid);
    }
  });

  socket.on('disconnect', () => {
    const rid = socket.data.roomId;
    if (rid && rooms.has(rid)) {
      socket.to(rid).emit('user-left', { id: socket.id });
      rooms.get(rid).delete(socket.id);
    }
    console.log('disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
