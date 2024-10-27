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
      currentWord: '사자',
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

  socket.on('connectRTC', (roomId) => {
    socket.broadcast.to(roomId).emit('welcome');
  });
  socket.on('offer', (offer, roomId) => {
    socket.broadcast.to(roomId).emit('offer', offer);
  });
  socket.on('answer', (answer, roomId) => {
    socket.broadcast.to(roomId).emit('answer', answer);
  });
  socket.on('ice', (ice, roomId) => {
    socket.broadcast.to(roomId).emit('ice', ice);
  });

  // 그림 데이터 수신 및 브로드캐스트
  socket.on('drawing', (roomId, drawingData) => {
    socket.to(roomId).emit('drawingData', drawingData); // 같은 방에 있는 다른 사용자에게 브로드캐스트
  });

  // 게임 시작
  socket.on('startGame', (roomId) => {
    const gameState = gameRooms[roomId];

    if (!gameState) {
      console.error(`Room ${roomId} not found`);
      return;
    }

    gameState.gameStatus = 'choosing';
    gameState.currentDrawer = gameState.host; // TEST
    gameState.round = 1;
    gameState.turn = 1;
    gameState.selectedWords = gameState.totalWords.slice(0, 2);
    gameState.selectionDeadline = Date.now() + 5000;

    io.to(roomId).emit('gameStateUpdate', gameState);
  });

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
    // gameState.turnDeadline = Date.now() + 90000;

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
    const gameState = gameRooms[roomId];
    const adaptiveScore = 10 - gameState.correctAnswerCount * 1; //점점 낮은 점수를 주도록 설정합니다.
    const { nickname, message } = messageData;
    console.log(`${nickname} sent message in room ${roomId}: ${message}`);

    //정답일 경우 메시지 처리
    if (message === gameState.currentWord) {
      gameState.participants[socket.id].score += adaptiveScore;
      if (gameState.correctAnswerCount < gameState.order.length) gameState.correctAnswerCount++;
      //정답자에게만 정답과 점수를 내려줍니다.
      socket.emit('privateMessage', gameState.currentWord, adaptiveScore);
      //다른 사람에게는 안내문구를 내려줍니다
      socket.to(roomId).emit('correctAnswer', {
        nickname,
        message: '❔❔❔',
        socketId: socket.id,
      });
      io.to(roomId).emit('adaptiveScore', {
        nickname,
        message: `정답입니다.(+${adaptiveScore}points)`,
        socketId: socket.id,
        isScoreMessage: true,
      });
      io.to(roomId).emit('gameStateUpdate', gameState);
    } else {
      io.to(roomId).emit('newMessage', {
        nickname,
        message,
        socketId: socket.id,
      });
    }
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
            console.error('Error decrementing current players in Firestore:', error);
          }
        }
      }
    });
  });

  socket.on('game start', (roomId) => {
    const gameState = gameRooms[roomId];

    // 기존 turn 값을 사용해 updatedTurn을 계산
    const updatedTurn = (gameState.turn % gameState.order.length) + 1;

    // updatedGameState에 updatedTurn을 사용해 turn 값을 설정
    const updatedGameState = {
      ...gameState,
      turn: updatedTurn, // 한 번만 증가된 updatedTurn을 사용
      currentDrawer: gameState.order[updatedTurn - 1], // 배열 인덱스 맞추기
    };

    gameRooms[roomId] = updatedGameState; // 업데이트된 상태 저장

    io.to(roomId).emit('game started', updatedGameState);
    io.to(roomId).emit('roundProcess', gameState.round);
    console.log(
      `Turn: ${updatedGameState.turn}, updatedTurn: ${updatedTurn}, Current Drawer: ${updatedGameState.currentDrawer}`
    );
  });

  // 에러 핸들링
  socket.on('error', (error) => {
    console.error('Socket encountered error:', error);
    socket.disconnect();
  });
});

console.log('Socket.IO server running on port 4000 🚀');
