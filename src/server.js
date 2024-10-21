import { Server } from 'socket.io';

// Socket.io 서버 생성 및 CORS 설정
const io = new Server(4000, {
  cors: {
    origin: '*', // 모든 도메인 허용, 추후 vercel 도메인으로 수정
  },
});

const gameRooms = {};

// 유저 소켓 연결
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // 게임방 만들기
  socket.on('createRoom', (roomId, userInfo, roomInfo) => {
    const { nickname, clickedAvatarIndex, isVideoOn, isFlipped } = userInfo;
    const { rounds, topic, isItemsEnabled } = roomInfo;

    socket.join(roomId);
    console.log(`User ${nickname} (ID: ${socket.id}) created room ${roomId}`);

    gameRooms[roomId] = {
      host: socket.id,
      gameStatus: 'waiting',
      currentDrawer: null,
      currentWord: null,
      totalWords: [], // 단어카드 DB 작업 이후 주제별 120개의 단어로 초기세팅 (topic 사용)
      selectedWords: [],
      isWordSelected: false,
      selectionDeadline: null,
      maxRound: rounds,
      round: 0,
      turn: 0,
      turnDeadline: null,
      correctAnswerCount: 0,
      isItemsEnabled,
      items: {
        ToxicCover: { user: null, status: false },
        GrowingBomb: { user: null, status: false },
        PhantomReverse: { user: null, status: false },
        LaundryFlip: { user: null, status: false },
        TimeCutter: { user: null, status: false },
      },
      order: [],
      participants: {},
    };

    const gameState = gameRooms[roomId];

    gameState.order.push(socket.id);
    gameState.participants[socket.id] = {
      nickname,
      score: 0,
      clickedAvatarIndex,
      isVideoOn,
      isFlipped,
    };

    io.to(roomId).emit('gameStateUpdate', gameState);
  });

  // 게임방 입장
  socket.on('joinRoom', (roomId, userInfo) => {
    const { nickname, clickedAvatarIndex, isVideoOn, isFlipped } = userInfo;

    socket.join(roomId);
    console.log(`User ${nickname} (ID: ${socket.id}) joined room ${roomId}`);

    const gameState = gameRooms[roomId];

    gameState.order.push(socket.id);
    gameState.participants[socket.id] = {
      nickname,
      score: 0,
      clickedAvatarIndex,
      isVideoOn,
      isFlipped,
    };

    io.to(roomId).emit('gameStateUpdate', gameState);

    socket.to(roomId).emit('userJoined', nickname);
  });

  // 채팅 메시지 전송
  socket.on('sendMessage', (roomId, messageData) => {
    const { nickname, message } = messageData;
    console.log(`${nickname} sent message in room ${roomId}: ${message}`);

    io.to(roomId).emit('newMessage', {
      nickname,
      message,
      socketId: socket.id,
    });
  });

  // 게임방 퇴장
  socket.on('disconnecting', () => {
    console.log(`User ${socket.id} disconnected`);

    socket.rooms.forEach((roomId) => {
      const gameState = gameRooms[roomId];

      if (gameState) {
        const nickname = gameState.participants[socket.id].nickname;
        delete gameState.participants[socket.id];
        gameState.order = gameState.order.filter((id) => id !== socket.id);

        socket.to(roomId).emit('userLeft', nickname);

        if (gameState.order.length === 0) {
          delete gameRooms[roomId];
        } else {
          socket.to(roomId).emit('gameStateUpdate', gameState);
        }
      }
    });
  });

  // 에러 핸들링
  socket.on('error', (error) => {
    console.error('Socket encountered error:', error);
    socket.disconnect();
  });

  // 그림 데이터 수신 및 브로드캐스트
  socket.on('drawing', (roomId, drawingData) => {
    socket.to(roomId).emit('drawingData', drawingData); // 같은 방에 있는 다른 사용자에게 브로드캐스트
  });
});

console.log('Socket.IO server running on port 4000 🚀');
