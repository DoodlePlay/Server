import { Server } from 'socket.io';

// Socket.io 서버 생성 및 CORS 설정
const io = new Server(3000, {
  cors: {
    origin: '*', // 모든 도메인 허용, 추후 vercel 도메인으로 수정
  },
});

// 사용자 연결 처리
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // 방 입장 이벤트
  socket.on('enter_room', (nickname, roomName, done) => {
    socket.join(roomName);
    socket['nickname'] = nickname;
    console.log(`${nickname} joined room: ${roomName}`);
    done();
    io.to(roomName).emit('welcome', nickname);
  });

  // 메시지 전송 이벤트
  socket.on('new_message', (msg, roomName, done) => {
    console.log(`Message from ${socket.nickname} in room ${roomName}: ${msg}`);
    socket.to(roomName).emit('new_message', `${socket.nickname}: ${msg}`);
    done();
  });

  // 사용자 연결 해제 처리
  socket.on('disconnecting', () => {
    socket.rooms.forEach((room) => io.to(room).emit('bye', socket.nickname));
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
  });

  // 에러 핸들링
  socket.on('error', (error) => {
    console.error('Socket encountered error:', error);
    socket.disconnect();
  });
});

console.log('Socket.IO server running on port 3000 🚀');
