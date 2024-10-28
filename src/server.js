import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { Server } from 'socket.io';

import { Topics } from './quizTopics.js';

// Firebase Admin 초기화
dotenv.config();

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Socket.io 서버 생성 및 CORS 설정
const io = new Server(4000, {
  cors: {
    origin: '*', // 모든 도메인 허용, 추후 vercel 도메인으로 수정
  },
});

const gameRooms = {};
let wordWave = 0;

// 유저 소켓 연결
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // 게임방 만들기
  socket.on('createRoom', (roomId, userInfo, roomInfo) => {
    const { nickname, clickedAvatarIndex, isVideoOn, isFlipped } = userInfo;
    const { rounds, topic, isItemsEnabled } = roomInfo;

    socket.join(roomId);
    console.log(`User ${nickname} (ID: ${socket.id}) created room ${roomId}`);

    const getRandomWords = (topicName) => {
      const topic = Topics.find((t) => t.name === topicName);
      if (!topic) throw new Error(`Topic ${topicName} not found`);

      const shuffleWords = [...topic.words].sort(() => Math.random() - 0.5);
      return shuffleWords;
    };

    gameRooms[roomId] = {
      host: socket.id,
      gameStatus: 'waiting',
      currentDrawer: null,
      currentWord: null,
      totalWords: getRandomWords(topic),
      selectedWords: [],
      isWordSelected: false,
      selectionDeadline: null,
      maxRound: rounds,
      round: 0,
      turn: 0,
      turnDeadline: null,
      correctAnswerCount: 0,
      isItemsEnabled,
      activeItem: null,
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

  // 그림 데이터 수신 및 브로드캐스트
  socket.on('drawing', (roomId, drawingData) => {
    socket.to(roomId).emit('drawingData', drawingData); // 같은 방에 있는 다른 사용자에게 브로드캐스트
  });

  // 게임 진행
  const nextTurn = (roomId) => {
    const gameState = gameRooms[roomId];

    if (!gameState) return;

    if (Date.now() >= gameState.turnDeadline) {
      // 단어가 선택되었고 턴 시간이 종료되었을 때 다음 턴으로 넘어가기
      proceedToNextDrawer(roomId);
    }
  };

  // 다음 Drawer로 진행하고 초기화 설정
  const proceedToNextDrawer = (roomId) => {
    const gameState = gameRooms[roomId];
    if (!gameState) return;

    // 턴을 조정해 참여자 수를 넘지 않도록 하고, 턴이 참여자 수와 같으면 라운드를 증가
    if (gameState.turn >= gameState.order.length) {
      gameState.turn = 1;
      gameState.round += 1;
    } else {
      gameState.turn += 1;
    }

    // 게임 종료 조건 확인: 라운드가 maxRound보다 크거나 같으면 게임 종료
    if (gameState.round > gameState.maxRound) {
      gameState.gameStatus = 'waiting';
      io.to(roomId).emit('gameStateUpdate', gameState);
      return;
    }

    // currentDrawer를 현재 turn에 맞춰 할당
    const nextDrawerIndex = (gameState.turn - 1) % gameState.order.length;
    gameState.currentDrawer = gameState.order[nextDrawerIndex];

    wordWave += 1;
    // 다음 턴 준비 및 'choosing' 단계로 설정
    gameState.gameStatus = 'choosing';
    gameState.isWordSelected = false;
    gameState.selectedWords = gameState.totalWords.slice(
      (wordWave - 1) * 2,
      wordWave * 2
    );
    gameState.selectionDeadline = Date.now() + 5000;
    gameState.turnDeadline = null;

    io.to(roomId).emit('gameStateUpdate', gameState);
  };

  // 선택 후 턴 시작 및 turnDeadline 설정
  const startTurn = (roomId) => {
    const gameState = gameRooms[roomId];

    if (!gameState) return;

    if (
      !gameState.isWordSelected &&
      Date.now() >= gameState.selectionDeadline
    ) {
      // 단어가 선택되지 않은 경우, TimeOver 상태로 전환
      gameState.gameStatus = 'timeOver';
      io.to(roomId).emit('gameStateUpdate', gameState);

      // 3초 후에 다음 턴으로 전환
      setTimeout(() => {
        proceedToNextDrawer(roomId);
        io.to(roomId).emit('gameStateUpdate', gameState);

        setTimeout(() => startTurn(roomId), 5000); // 다시 5초 후에 선택된 단어가 없으면 다시 TimeOver 상태로 설정
      }, 3000);
    } else if (gameState.isWordSelected) {
      gameState.gameStatus = 'drawing';
      gameState.turnDeadline = Date.now() + 90000;
      io.to(roomId).emit('gameStateUpdate', gameState);
    }
  };

  // 게임 시작
  socket.on('startGame', async (roomId) => {
    const gameState = gameRooms[roomId];
    wordWave = 1;

    if (!gameState) {
      console.error(`Room ${roomId} not found`);
      return;
    }

    gameState.gameStatus = 'choosing';
    gameState.currentDrawer = gameState.host;
    gameState.round = 1;
    gameState.turn = 1;
    gameState.selectedWords = gameState.totalWords.slice(0, 2);
    gameState.selectionDeadline = Date.now() + 5000;

    // Firebase의 gameStatus를 'playing'으로 업데이트
    try {
      const roomRef = db.collection('GameRooms').doc(roomId);
      await roomRef.update({ gameStatus: 'playing' });
    } catch (error) {
      console.error(
        `Failed to update gameStatus in Firebase for room ${roomId}:`,
        error
      );
    }

    io.to(roomId).emit('gameStateUpdate', gameState);

    setTimeout(() => startTurn(roomId), 5000);
  });

  // 일정 시간마다 모든 방의 turnDeadline을 체크하고, 만료되었으면 다음 턴으로 넘김
  setInterval(() => {
    Object.keys(gameRooms).forEach((roomId) => {
      const gameState = gameRooms[roomId];

      if (gameState && gameState.turnDeadline) {
        nextTurn(roomId);
      }
    });
  }, 1000); // 매 초마다 체크

  // 단어 선택
  socket.on('chooseWord', (roomId, chooseWord) => {
    const gameState = gameRooms[roomId];

    if (!gameState) {
      console.error(`Room ${roomId} not found`);
      return;
    }

    gameState.currentWord = chooseWord;
    gameState.isWordSelected = true;
    gameState.gameStatus = 'drawing';
    gameState.turnDeadline = Date.now() + 90000;

    io.to(roomId).emit('gameStateUpdate', gameState);
  });

  // 아이템 사용
  socket.on('itemUsed', (roomId, itemId) => {
    const gameState = gameRooms[roomId];

    gameState.activeItem = itemId;
    gameState.items[itemId].user = socket.id;
    gameState.items[itemId].status = true;

    io.to(roomId).emit('itemUsedUpdate', gameState);
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

    socket.rooms.forEach(async (roomId) => {
      const gameState = gameRooms[roomId];

      if (gameState) {
        const nickname = gameState.participants[socket.id].nickname;
        delete gameState.participants[socket.id];
        gameState.order = gameState.order.filter((id) => id !== socket.id);

        socket.to(roomId).emit('userLeft', nickname);

        if (gameState.order.length === 0) {
          delete gameRooms[roomId];

          try {
            const roomRef = db.collection('GameRooms').doc(roomId);
            await roomRef.delete();
          } catch (error) {
            console.error('Error deleting room from Firestore:', error);
          }
        } else {
          io.to(roomId).emit('gameStateUpdate', gameState);

          try {
            const roomRef = db.collection('GameRooms').doc(roomId);
            await roomRef.update({
              currentPlayers: admin.firestore.FieldValue.increment(-1),
            });
          } catch (error) {
            console.error(
              'Error decrementing current players in Firestore:',
              error
            );
          }
        }
      }
    });
  });

  // 에러 핸들링
  socket.on('error', (error) => {
    console.error('Socket encountered error:', error);
    socket.disconnect();
  });
});

console.log('Socket.IO server running on port 4000 🚀');
