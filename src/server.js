import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { Server } from 'socket.io';

import { Topics } from './quizTopics.js';
import matchCounter from './matchCounter.js';
import drawerScoreCalculator from './drawerScore.js';

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
      currentWord: '',
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
      correctAnsweredUser: [],
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

    //정답은 아니지만 정답과 2글자 이상 겹칠 때
    if (
      !gameState.correctAnsweredUser.includes(socket.id) &&
      message !== gameState.currentWord &&
      matchCounter(message, gameState.currentWord) > gameState.currentWord.length / 2
    ) {
      socket.emit('closeAnswer', {
        nickname,
        message: '정답에 근접했습니다!',
        socketId: socket.id,
      });
      return;
    }
    //
    if (message !== gameState.currentWord && message.includes(gameState.currentWord)) {
      if (gameState.correctAnsweredUser.includes(socket.id)) {
        socket.emit('cheating', {
          nickname,
          message: '🚫 정답이 포함된 메시지입니다.',
          socketId: socket.id,
        });
        return;
      }
    }

    //정답일 경우 메시지 및 점수 처리
    if (message === gameState.currentWord) {
      if (gameState.correctAnsweredUser.includes(socket.id)) {
        socket.emit('cheating', {
          nickname,
          message: '🚫 정답이 포함된 메시지입니다.',
          socketId: socket.id,
        });
        return;
      } // 이미 맞춘 사람이 또 다시 정답을 썼을 때

      gameState.participants[socket.id].score += adaptiveScore;
      io.to(roomId).emit('playScoreAnimation', socket.id, adaptiveScore);
      gameState.participants[gameState.currentDrawer].score += drawerScoreCalculator(
        gameState.order.length,
        gameState.correctAnswerCount
      );
      io.to(roomId).emit(
        'playDrawerScoreAnimation',
        gameState.currentDrawer,
        drawerScoreCalculator(gameState.order.length, gameState.correctAnswerCount)
      );
      gameState.correctAnsweredUser.push(socket.id);
      if (gameState.correctAnswerCount < gameState.order.length) {
        gameState.correctAnswerCount++;
      }
      //정답자의 클라이언트에만 정답과 점수를 전송합니다.
      socket.emit('privateMessage', gameState.currentWord, adaptiveScore);
      socket.emit('adaptiveScore', {
        nickname,
        message: `정답입니다.(+${adaptiveScore}points)`,
        socketId: socket.id,
        isPrivateCorrectMessage: true,
      });
      //정답자 이외의 클라이언트에게는 안내문구를 전송합니다.
      socket.to(roomId).emit('correctAnswer', {
        nickname,
        message: '❗❔❗❔❗❔',
        socketId: socket.id,
      });
      socket.to(roomId).emit('correctAnswer', {
        nickname,
        message: `✔️ ${nickname} 님 정답입니다.(+${adaptiveScore}points)`,
        socketId: socket.id,
        isCorrectMessage: true,
      });

      io.to(roomId).emit('gameStateUpdate', gameState);
      // io.to(roomId).emit('roundProcess', gameState.round); //test용 코드
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
        io.to(roomId).emit('gameStateUpdate', gameState);

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

  // 에러 핸들링
  socket.on('error', (error) => {
    console.error('Socket encountered error:', error);
    socket.disconnect();
  });
});

console.log('Socket.IO server running on port 4000 🚀');
