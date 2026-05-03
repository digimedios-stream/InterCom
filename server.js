import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory storage for rooms state
// Format: { [roomCode]: { director: socketId, crew: { [socketId]: { name, battery, active } } } }
const rooms = {};

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Handle joining a room
  socket.on('join-room', ({ room, role, name, battery }) => {
    socket.join(room);
    socket.roomCode = room;
    socket.userRole = role;

    if (!rooms[room]) {
      rooms[room] = {
        director: null,
        crew: {}
      };
    }

    if (role === 'director') {
      rooms[room].director = socket.id;
    } else {
      rooms[room].crew[socket.id] = {
        name: name || 'CREW_MEMBER',
        battery: battery !== undefined ? battery : 100,
        active: true
      };
    }

    console.log(`${role} joined room ${room} - ${name || ''}`);
    
    // Broadcast updated crew list to Director
    io.to(room).emit('room-state', {
      room,
      directorConnected: !!rooms[room].director,
      crew: Object.entries(rooms[room].crew).map(([id, data]) => ({
        id,
        name: data.name,
        battery: data.battery,
        active: data.active
      }))
    });
  });

  // Handle crew battery updates
  socket.on('battery-update', ({ room, name, battery }) => {
    if (rooms[room] && rooms[room].crew[socket.id]) {
      rooms[room].crew[socket.id].battery = battery;
      
      io.to(room).emit('room-state', {
        room,
        directorConnected: !!rooms[room].director,
        crew: Object.entries(rooms[room].crew).map(([id, data]) => ({
          id,
          name: data.name,
          battery: data.battery,
          active: data.active
        }))
      });
    }
  });

  // Handle Director routing updates
  socket.on('director-routing', ({ room, activeTargets }) => {
    socket.to(room).emit('routing-update', { activeTargets });
  });

  // Audio stream from Director to Crew
  socket.on('director-audio-stream', ({ room, targets, chunk }) => {
    // targets is an array of crew names or ['todos']
    if (rooms[room]) {
      // Find crew member socket IDs matching the names/roles or 'todos'
      const crewSockets = Object.entries(rooms[room].crew)
        .filter(([id, data]) => targets.includes('todos') || targets.includes(data.name))
        .map(([id]) => id);

      crewSockets.forEach((crewId) => {
        io.to(crewId).emit('audio-stream', { from: 'director', chunk });
      });
    }
  });

  // Audio stream from Crew to Director
  socket.on('crew-audio-stream', ({ room, from, chunk }) => {
    if (rooms[room] && rooms[room].director) {
      io.to(rooms[room].director).emit('audio-stream', { from, chunk });
    }
  });

  // Alert from Crew to Director
  socket.on('crew-alert', ({ room, from, message }) => {
    if (rooms[room] && rooms[room].director) {
      io.to(rooms[room].director).emit('alert', { from, message });
    }
  });

  // Alert from Director to specific Crew or all
  socket.on('director-alert', ({ room, targets, message }) => {
    if (rooms[room]) {
      const crewSockets = Object.entries(rooms[room].crew)
        .filter(([id, data]) => targets.includes('todos') || targets.includes(data.name))
        .map(([id]) => id);

      crewSockets.forEach((crewId) => {
        io.to(crewId).emit('alert', { from: 'director', message });
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const room = socket.roomCode;
    if (room && rooms[room]) {
      if (socket.userRole === 'director') {
        rooms[room].director = null;
      } else {
        delete rooms[room].crew[socket.id];
      }

      // If both director and all crew leave, delete room
      if (!rooms[room].director && Object.keys(rooms[room].crew).length === 0) {
        delete rooms[room];
      } else {
        // Broadcast updated state to room
        io.to(room).emit('room-state', {
          room,
          directorConnected: !!rooms[room].director,
          crew: Object.entries(rooms[room].crew).map(([id, data]) => ({
            id,
            name: data.name,
            battery: data.battery,
            active: data.active
          }))
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
