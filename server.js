// Simple signaling server using Express + Socket.IO
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// rooms data not strictly required but helpful for listing
const rooms = {}; // { roomId: Set(socketId) }

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('join', ({ roomId, userName }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userName = userName || socket.id;

    if (!rooms[roomId]) rooms[roomId] = new Set();
    // Notify existing peers about new peer
    socket.to(roomId).emit('user-joined', { id: socket.id, userName: socket.data.userName });

    // Send list of existing participants to the joining peer
    const others = Array.from(rooms[roomId]);
    socket.emit('joined', { you: socket.id, peers: others });

    rooms[roomId].add(socket.id);
    console.log(`join ${socket.id} -> ${roomId}`);
  });

  socket.on('offer', ({ to, sdp }) => {
    io.to(to).emit('offer', { from: socket.id, sdp });
  });

  socket.on('answer', ({ to, sdp }) => {
    io.to(to).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('leave', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit('user-left', { id: socket.id });
      rooms[roomId].delete(socket.id);
      socket.leave(roomId);
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      socket.to(roomId).emit('user-left', { id: socket.id });
      rooms[roomId].delete(socket.id);
    }
    console.log('socket disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on', PORT));