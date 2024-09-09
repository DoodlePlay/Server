import http from 'http';
// import WebSocket from 'ws';
import SocketIO from 'socket.io';
import express from 'express';

const app = express();

app.set('view engine', 'pug');
app.set('views', __dirname + '/views');
app.use('/public', express.static(__dirname + '/public'));
app.get('/', (req, res) => res.render('home'));
app.get('/*', (req, res) => res.redirect('/'));

const httpServer = http.createServer(app);
const wsServer = SocketIO(httpServer);

const countRoom = (roomName) => {
  return wsServer.sockets.adapter.rooms.get(roomName)?.size;
};

const publicRooms = () => {
  const {
    sockets: {
      adapter: { sids, rooms },
    },
  } = wsServer;
  const publicRooms = [];
  rooms.forEach((_, key) => {
    if (sids.get(key) === undefined) {
      publicRooms.push({
        roomName: key,
        roomCount: countRoom(key),
      });
    }
  });
  return publicRooms;
};

wsServer.on('connection', (socket) => {
  wsServer.sockets.emit('room_change', publicRooms());

  socket.onAny((event) => {
    console.log(`Socket Event: ${event}`);
  });

  socket.on('enter_room', (nickname, roomName, done) => {
    socket.join(roomName);
    socket['nickname'] = nickname;
    done();
    wsServer.to(roomName).emit('welcome', nickname, countRoom(roomName));
    wsServer.sockets.emit('room_change', publicRooms());
  });

  socket.on('disconnecting', () => {
    socket.rooms.forEach((room) =>
      wsServer.to(room).emit('bye', socket.nickname, countRoom(room) - 1)
    );
  });

  socket.on('disconnect', () => {
    wsServer.sockets.emit('room_change', publicRooms());
  });

  socket.on('new_message', (msg, roomName, done) => {
    socket.to(roomName).emit('new_message', `${socket.nickname}: ${msg}`);
    done();
  });
});

const handleListen = () => console.log('Listening on http://localhost:3000');
httpServer.listen(3000, handleListen);

/**
 * WebSocket을 이용한 채팅 구현 (서버)
 */
// const wss = new WebSocket.Server({ httpServer });
// const sockets = [];
// wss.on('connection', (socket) => {
//   sockets.push(socket);
//   socket['nickname'] = 'Anon';
//   console.log('Connected to Browser ✅');
//   socket.on('close', () => console.log('Disconnected from the Browser ❌'));
//   socket.on('message', (msg) => {
//     const message = JSON.parse(msg);
//     switch (message.type) {
//       case 'new_message':
//         sockets.forEach((aSocket) =>
//           aSocket.send(`${socket.nickname}: ${message.payload}`)
//         );
//         break;
//       case 'nickname':
//         socket['nickname'] = message.payload;
//         break;
//     }
//   });
// });
