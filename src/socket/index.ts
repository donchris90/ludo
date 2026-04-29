// src/socket/index.ts
import { Server, Socket } from 'socket.io';
import { User, Wallet, Game } from '../models';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
}

export function setupSocketHandlers(io: Server) {
  // Authentication middleware for socket.io
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }
      
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
      const user = await User.findByPk(decoded.id);
      
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }
      
      socket.userId = user.id;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`✅ User ${socket.userId} connected: ${socket.id}`);

    // Join a game room
    socket.on('joinGame', async (data: { gameId: string }) => {
      const { gameId } = data;
      socket.join(gameId);
      console.log(`User ${socket.userId} joined game ${gameId}`);
      
      // Notify others in the room
      socket.to(gameId).emit('userJoined', { userId: socket.userId });
    });

    // Leave a game room
    socket.on('leaveGame', (data: { gameId: string }) => {
      const { gameId } = data;
      socket.leave(gameId);
      console.log(`User ${socket.userId} left game ${gameId}`);
      
      socket.to(gameId).emit('userLeft', { userId: socket.userId });
    });

    // Make a move in game
    socket.on('makeMove', (data: { gameId: string; moveData: any }) => {
      const { gameId, moveData } = data;
      console.log(`Move made in game ${gameId} by user ${socket.userId}`);
      
      // Broadcast to all other players in the room
      socket.to(gameId).emit('moveMade', {
        userId: socket.userId,
        moveData,
        timestamp: Date.now(),
      });
    });

    // Chat message
    socket.on('chatMessage', (data: { gameId: string; message: string }) => {
      const { gameId, message } = data;
      io.to(gameId).emit('newChatMessage', {
        userId: socket.userId,
        username: socket.user?.username,
        message,
        timestamp: Date.now(),
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`❌ User ${socket.userId} disconnected: ${socket.id}`);
      
      // Notify all rooms the user was in
      const rooms = Array.from(socket.rooms);
      rooms.forEach(room => {
        if (room !== socket.id) {
          socket.to(room).emit('userDisconnected', { userId: socket.userId });
        }
      });
    });
  });
}