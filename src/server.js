import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { Server } from 'socket.io';

import { Topics } from './quizTopics.js';
import matchCounter from './matchCounter.js';

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
    origin: 'https://www.doodleplay.xyz', // production 도메인만 허용
    // origin: '*', // local 개발 시 모든 도메인 허용
  },
});

const gameRooms = {};
let wordWave = 0;

const getRandomWords = topicName => {
  const topic = Topics.find(t => t.name === topicName);
  if (!topic) throw new Error(`Topic ${topicName} not found`);

  const shuffleWords = [...topic.words].sort(() => Math.random() - 0.5);
  return shuffleWords;
};

// 유저 소켓 연결
io.on('connection', socket => {
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
      currentWord: '',
      totalWords: getRandomWords(topic),
      selectedWords: [],
      isWordSelected: false,
      topic,
      selectionDeadline: null,
      maxRound: rounds,
      round: 0,
      turn: 0,
      turnDeadline: null,
      correctAnswerCount: 0,
      isItemsEnabled,
      correctAnsweredUser: [],
      items: {
        toxicCover: { user: null, status: false },
        growingBomb: { user: null, status: false },
        phantomReverse: { user: null, status: false },
        laundryFlip: { user: null, status: false },
        timeCutter: { user: null, status: false },
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

  const finishedGame = async roomId => {
    const gameState = gameRooms[roomId];
    if (!gameState || gameState.gameStatus === 'gameOver') return;

    gameState.gameStatus = 'gameOver';
    gameState.selectionDeadline = null;
    gameState.turnDeadline = null;

    // items 초기화
    gameState.items = {
      toxicCover: { user: null, status: false },
      growingBomb: { user: null, status: false },
      phantomReverse: { user: null, status: false },
      laundryFlip: { user: null, status: false },
      timeCutter: { user: null, status: false },
    };

    // Firebase의 gameStatus를 'waiting'으로 업데이트
    try {
      const roomRef = db.collection('GameRooms').doc(roomId);
      await roomRef.update({ gameStatus: 'waiting' });
    } catch (error) {
      console.error(
        `Failed to update gameStatus in Firebase for room ${roomId}:`,
        error
      );
    }
    io.to(roomId).emit('gameStateUpdate', gameState);
  };

  // 게임 진행 함수 현재 turnDeadline이 되면 다음 턴이 되도록 구현되어 있음. 정답 처리 추가 부분
  const nextTurn = roomId => {
    const gameState = gameRooms[roomId];

    if (!gameState) return;

    if (Date.now() >= gameState.turnDeadline) {
      // 단어가 선택되었고 턴 시간이 종료되었을 때 다음 턴으로 넘어가기
      io.to(roomId).emit('announceAnswer', {
        nickname: 'System',
        message: `정답은 '${gameState.currentWord}' 입니다. `,
        isAnnounceAnswer: true,
      });
      //시간 초과로 인해 턴이 변경되기전 정답자 수에 따른 출제자 정답 부여 및 아바타효과 렌더링
      if (
        gameState.correctAnswerCount > 0 &&
        gameState.correctAnswerCount < gameState.order.length - 1
      ) {
        gameState.participants[gameState.currentDrawer].score += 10;
        io.to(roomId).emit(
          'playDrawerScoreAnimation',
          gameState.currentDrawer,
          10
        );
      }

      proceedToNextDrawer(roomId);
    }
  };

  // 다음 Drawer로 진행하고 초기화 설정
  const proceedToNextDrawer = roomId => {
    const gameState = gameRooms[roomId];
    if (!gameState) return;

    // items 초기화
    gameState.items = {
      toxicCover: { user: null, status: false },
      growingBomb: { user: null, status: false },
      phantomReverse: { user: null, status: false },
      laundryFlip: { user: null, status: false },
      timeCutter: { user: null, status: false },
    };

    // 턴을 조정해 참여자 수를 넘지 않도록 하고, 턴이 참여자 수와 같으면 라운드를 증가
    if (
      gameState.turn >= gameState.order.length &&
      gameState.gameStatus !== 'gameOver'
    ) {
      gameState.turn = 1;
      gameState.round += 1;
      // 게임 종료 조건 확인: 라운드가 maxRound보다 크거나 같으면 게임 종료
      if (gameState.round > gameState.maxRound) {
        finishedGame(roomId);
        return;
      }
      io.to(roomId).emit('roundProcess', {
        nickname: 'System',
        message: `━━━━━━━━━━━━━━━━━━ ${gameState.round} 라운드 ━━━━━━━━━━━━━━━━━━`,
        isRoundMessage: true,
      });
    } else {
      gameState.turn += 1;
    }

    if (gameState.gameStatus !== 'gameOver') {
      // currentDrawer를 현재 turn에 맞춰 할당
      const nextDrawerIndex = gameState.turn - 1;
      gameState.currentDrawer = gameState.order[nextDrawerIndex];

      wordWave += 1;
      gameState.gameStatus = 'choosing';
      gameState.currentWord = null;
      gameState.isWordSelected = false;
      gameState.selectedWords = gameState.totalWords.slice(
        (wordWave - 1) * 2,
        wordWave * 2
      );
      gameState.selectionDeadline = Date.now() + 5000;
      gameState.turnDeadline = null;
      gameState.correctAnswerCount = 0;
      gameState.correctAnsweredUser = [];

      io.to(roomId).emit('clearCanvas');
      io.to(roomId).emit('gameStateUpdate', gameState);

      setTimeout(() => {
        if (
          !gameState.isWordSelected &&
          Date.now() >= gameState.selectionDeadline
        ) {
          // 단어가 선택되지 않은 경우, TimeOver 상태로 전환
          if (gameState.gameStatus !== 'gameOver') {
            gameState.gameStatus = 'timeOver';
            io.to(roomId).emit('gameStateUpdate', gameState);
          }

          // 3초 후에 다음 턴으로 전환
          setTimeout(() => {
            proceedToNextDrawer(roomId);
            io.to(roomId).emit('gameStateUpdate', gameState);
          }, 3000);
        }
      }, 5000);
    }
  };

  // 선택 후 턴 시작 및 turnDeadline 설정
  const startTurn = roomId => {
    const gameState = gameRooms[roomId];
    if (
      !gameState ||
      gameState.gameStatus === 'waiting' ||
      gameState.gameStatus === 'gameOver'
    )
      return;
    // 턴 시작 시 초기화: 단어 선택 상태 및 현재 단어 초기화

    if (gameState.isWordSelected) {
      gameState.gameStatus = 'drawing';
      gameState.turnDeadline = Date.now() + 90000;
      io.to(roomId).emit('gameStateUpdate', gameState);
    } else if (Date.now() >= gameState.selectionDeadline) {
      // 선택 시간이 지나면 timeOver 상태로 전환 후 다음 턴 진행

      gameState.gameStatus = 'timeOver';
      io.to(roomId).emit('gameStateUpdate', gameState);

      setTimeout(() => {
        proceedToNextDrawer(roomId);
        io.to(roomId).emit('gameStateUpdate', gameState);
      }, 3000);
    }
  };

  // 게임 시작
  socket.on('startGame', async roomId => {
    const gameState = gameRooms[roomId];
    wordWave = 1;

    if (!gameState) {
      console.error(`Room ${roomId} not found`);
      return;
    }

    // items 초기화
    gameState.items = {
      toxicCover: { user: null, status: false },
      growingBomb: { user: null, status: false },
      phantomReverse: { user: null, status: false },
      laundryFlip: { user: null, status: false },
      timeCutter: { user: null, status: false },
    };

    gameState.gameStatus = 'choosing';
    gameState.currentDrawer = gameState.host;
    gameState.round = 1;
    gameState.turn = 1;
    gameState.currentWord = null;
    gameState.isWordSelected = false;
    gameState.totalWords = getRandomWords(gameState.topic);
    gameState.correctAnswerCount = 0;
    gameState.correctAnsweredUser = [];

    // 모든 참가자의 점수를 0으로 초기화
    Object.keys(gameState.participants).forEach(socketId => {
      gameState.participants[socketId].score = 0;
    });

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
    io.to(roomId).emit('roundProcess', {
      nickname: 'System',
      message: `━━━━━━━━━━━━━━━━━━ ${gameState.round} 라운드 ━━━━━━━━━━━━━━━━━━`,
      isRoundMessage: true,
    });
    io.to(roomId).emit('gameStateUpdate', gameState);

    setTimeout(() => startTurn(roomId), 5000);
  });

  // 일정 시간마다 모든 방의 turnDeadline을 체크하고, 만료되었으면 다음 턴으로 넘김
  setInterval(() => {
    Object.keys(gameRooms).forEach(roomId => {
      const gameState = gameRooms[roomId];

      if (
        gameState &&
        gameState.turnDeadline &&
        gameState.gameStatus !== 'waiting' &&
        gameState.gameStatus !== 'gameOver'
      ) {
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

    gameState.items[itemId].user = socket.id;
    gameState.items[itemId].status = true;

    if (itemId === 'toxicCover') {
      const toxicImagePaths = [
        '/images/drawing/items/effects/toxic01.svg',
        '/images/drawing/items/effects/toxic02.svg',
        '/images/drawing/items/effects/toxic03.svg',
        '/images/drawing/items/effects/toxic04.svg',
        '/images/drawing/items/effects/toxic05.svg',
        '/images/drawing/items/effects/toxic06.svg',
        '/images/drawing/items/effects/toxic07.svg',
      ];

      const step = Math.floor(80 / Math.sqrt(7));
      let leftPos = 0;
      let topPos = 0;

      const toxicPositions = Array.from({ length: 7 }, (_, i) => {
        const src = toxicImagePaths[i % toxicImagePaths.length];
        const left = leftPos + Math.random() * step;
        const top = topPos + Math.random() * step;

        leftPos += step;
        if (leftPos >= 80) {
          leftPos = 0;
          topPos += step;
        }

        return { src, left, top };
      });

      io.to(roomId).emit('toxicEffectPositions', toxicPositions);
    }

    if (itemId === 'timeCutter') {
      if (gameState.turnDeadline) {
        const remainingTime = Math.max(gameState.turnDeadline - Date.now(), 0);
        gameState.turnDeadline = Date.now() + remainingTime / 2;
      }
    }

    const itemDetails = {
      toxicCover: { emoji: '☠️', name: 'Toxic Cover' },
      growingBomb: { emoji: '💣', name: 'Growing Bomb' },
      phantomReverse: { emoji: '👻', name: 'Phantom Reverse' },
      laundryFlip: { emoji: '🌀', name: 'Laundry Flip' },
      timeCutter: { emoji: '⏳', name: 'Time Cutter' },
    };

    const { emoji, name: itemName } = itemDetails[itemId] || {};
    const nickname = gameState.participants[socket.id].nickname;

    if (emoji && itemName) {
      io.to(roomId).emit('itemMessage', {
        nickname: 'System',
        message: `${emoji} ${nickname}님이 ${itemName} 발동! ${emoji} `,
        isItemMessage: true,
      });
    }

    io.to(roomId).emit('gameStateUpdate', gameState);
  });

  // 채팅 메시지 전송
  socket.on('sendMessage', (roomId, messageData) => {
    const gameState = gameRooms[roomId];
    const adaptiveScore = 10 - gameState.correctAnswerCount * 1; //점점 낮은 점수를 주도록 설정합니다.
    const { nickname, message } = messageData;
    console.log(`${nickname} sent message in room ${roomId}: ${message}`);

    //waiting 상태 일 경우 조건과 상관없이 메세지를 전송
    if (
      gameState.gameStatus === 'waiting' ||
      gameState.gameStatus === 'gameOver'
    ) {
      io.to(roomId).emit('newMessage', {
        nickname,
        message,
        socketId: socket.id,
      });
      return;
    }

    //정답과 비슷한 채팅을 쳤을 때
    if (
      !gameState.correctAnsweredUser.includes(socket.id) &&
      !gameState.currentDrawer.includes(socket.id) &&
      message.replace(/\s+/g, '') !==
        gameState.currentWord.replace(/\s+/g, '') &&
      matchCounter(message, gameState.currentWord) >
        gameState.currentWord.length / 2 //정답과 일치하는 글자 수가 1/2 보다 많으면
    ) {
      socket.emit('closeAnswer', {
        nickname,
        message: '정답에 근접했습니다!',
        socketId: socket.id,
      });
      return;
    }
    //정답은 아니더라도 정답을 포함하는 채팅일 경우 블록처리(정답자 또는 출제자의 경우에만)
    if (
      message !== gameState.currentWord &&
      message.includes(gameState.currentWord)
    ) {
      if (
        gameState.correctAnsweredUser.includes(socket.id) ||
        gameState.currentDrawer.includes(socket.id)
      ) {
        socket.emit('cheating', {
          nickname,
          message: '🚫 정답이 포함된 메시지입니다.',
          socketId: socket.id,
        });
        return;
      }
    }

    //정답일 경우 메시지 및 점수 처리
    if (
      message.replace(/\s+/g, '') === gameState.currentWord.replace(/\s+/g, '')
    ) {
      // 정답자 또는 출제자가 정답을 썼을 때
      if (
        gameState.correctAnsweredUser.includes(socket.id) ||
        gameState.currentDrawer.includes(socket.id)
      ) {
        socket.emit('cheating', {
          nickname,
          message: '🚫 정답이 포함된 메시지입니다.',
          socketId: socket.id,
        });
        return;
      }
      //정답을 맞춘 유저에게 점수를 부여하고 아바타 효과를 렌더링
      gameState.participants[socket.id].score += adaptiveScore;
      io.to(roomId).emit('playScoreAnimation', socket.id, adaptiveScore);
      gameState.correctAnsweredUser.push(socket.id); //정답을 맞춘 그룹에 해당 유저를 추가

      if (gameState.correctAnswerCount < gameState.order.length) {
        gameState.correctAnswerCount++;
      }
      //정답자의 클라이언트에만 정답과 점수를 전송합니다.
      socket.emit('privateMessage', {
        nickname,
        message: `✔️  ${gameState.currentWord}`,
        socketId: socket.id,
      });
      socket.emit('success');
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
      //시스템 메시지로 다른 유저의 정답을 안내합니다.
      socket.to(roomId).emit('correctAnswer', {
        nickname,
        message: `✔️ ${nickname} 님 정답입니다.(+${adaptiveScore}points)`,
        socketId: socket.id,
        isCorrectMessage: true,
      });
      //모든 유저가 정답을 맞추면 다음턴으로 진행
      if (gameState.correctAnswerCount === gameState.order.length - 1) {
        gameState.participants[gameState.currentDrawer].score += 8; //전원 정답이므로 출제자 8점
        io.to(roomId).emit(
          'playDrawerScoreAnimation',
          gameState.currentDrawer,
          8
        );

        //턴이 종료될 때 해당 라운드의 정답 안내
        io.to(roomId).emit('announceAnswer', {
          nickname: 'System',
          message: `정답은 '${gameState.currentWord}' 입니다. `,
          isAnnounceAnswer: true,
        });
        setTimeout(() => {
          proceedToNextDrawer(roomId);
          io.to(roomId).emit('gameStateUpdate', gameState);
        }, 2500);
        return;
      }

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

    socket.rooms.forEach(async roomId => {
      if (roomId === socket.id) return;

      const gameState = gameRooms[roomId];

      if (!gameState) return console.error(`Room ${roomId} not found`);

      const nickname = gameState.participants[socket.id].nickname;
      delete gameState.participants[socket.id];
      gameState.order = gameState.order.filter(id => id !== socket.id);

      // 방에 남은 사람이 없으면 DB에서 방 삭제
      if (gameState.order.length === 0) {
        delete gameRooms[roomId];

        try {
          const roomRef = db.collection('GameRooms').doc(roomId);
          await roomRef.delete();
          return;
        } catch (error) {
          console.error('Error deleting room from Firestore:', error);
        }
      }

      // 방에 남은 사람에게 시스템 메세지 전송 및 gameState DB 업데이트
      socket.to(roomId).emit('userLeft', nickname);
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

      // 현재 방장이 나가면 차례대로 들어온 사람을 방장으로 지정
      if (gameState.host === socket.id) {
        const remainingUsers = gameState.order;

        if (remainingUsers.length > 0) {
          gameState.host = remainingUsers[0];
          io.to(roomId).emit('gameStateUpdate', gameState);
        }
      }

      // 남은 플레이어 수가 3명 미만이면 게임을 대기 상태로 전환
      if (gameState.order.length <= 2) {
        await finishedGame(roomId);
        io.to(roomId).emit('gameStateUpdate', gameState);
        return;
      }

      // 현재 그림을 그리는 출제자가 나가면 다음 순서로 지정
      if (gameState.currentDrawer === socket.id) {
        const nextDrawerIndex = gameState.turn - 1;
        gameState.currentDrawer = gameState.order[nextDrawerIndex];

        wordWave += 1;

        gameState.gameStatus = 'choosing';
        gameState.currentWord = null;
        gameState.isWordSelected = false;
        gameState.selectedWords = gameState.totalWords.slice(
          (wordWave - 1) * 2,
          wordWave * 2
        );
        gameState.selectionDeadline = Date.now() + 5000;

        gameState.turnDeadline = null;
        io.to(roomId).emit('clearCanvas');
        io.to(roomId).emit('gameStateUpdate', gameState);

        setTimeout(() => {
          if (
            gameState.gameStatus !== 'gameOver' &&
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
            }, 3000);
          }
        }, 5000);
      }
    });
  });

  // 에러 핸들링
  socket.on('error', error => {
    console.error('Socket encountered error:', error);
    socket.disconnect();
  });
});

console.log('Socket.IO server running on port 4000 🚀');
