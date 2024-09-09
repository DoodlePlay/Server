const socket = io();

const welcome = document.getElementById('welcome');
const room = document.getElementById('room');
const form = welcome.querySelector('form');

room.hidden = true;

let roomName;

const addMessage = (message) => {
  const ul = room.querySelector('ul');
  const li = document.createElement('li');
  li.innerText = message;
  ul.appendChild(li);
};

const updateRoomTitle = (newCount) => {
  const h3 = room.querySelector('h3');
  h3.innerText = `Room ${roomName} (${newCount})`;
};

const handleMessageSubmit = (event) => {
  event.preventDefault();
  const input = room.querySelector('input');
  const value = input.value;
  socket.emit('new_message', input.value, roomName, () => {
    addMessage(`You: ${value}`);
  });
  input.value = '';
};

const showRoom = () => {
  welcome.hidden = true;
  room.hidden = false;
  const form = room.querySelector('form');
  form.addEventListener('submit', handleMessageSubmit);
};

const handleRoomAndNicknameSubmit = (event) => {
  event.preventDefault();
  const nicknameInput = form.querySelector('#nickname');
  const roomNameInput = form.querySelector('#roomName');
  socket.emit('enter_room', nicknameInput.value, roomNameInput.value, showRoom);
  roomName = roomNameInput.value;
};

form.addEventListener('submit', handleRoomAndNicknameSubmit);

socket.on('welcome', (user, newCount) => {
  updateRoomTitle(newCount);
  addMessage(`${user} arrived!`);
});

socket.on('bye', (user, newCount) => {
  updateRoomTitle(newCount);
  addMessage(`${user} left!`);
});

socket.on('new_message', addMessage);

socket.on('room_change', (rooms) => {
  const roomList = welcome.querySelector('ul');
  roomList.innerHTML = '';
  if (rooms.length === 0) {
    return;
  }
  rooms.forEach((room) => {
    const li = document.createElement('li');
    const { roomName, roomCount } = room;
    li.innerText = `${roomName} (${roomCount}명 접속 중)`;
    roomList.append(li);
  });
});

/**
 * WebSocket을 이용한 채팅 구현 (클라이언트)
 */
// const messageList = document.querySelector('ul');
// const nickForm = document.querySelector('#nick');
// const messageForm = document.querySelector('#message');
// const socket = new WebSocket(`ws://${window.location.host}`);

// const makeMessage = (type, payload) => {
//   const msg = { type, payload };
//   return JSON.stringify(msg);
// };

// socket.addEventListener('open', () => {
//   console.log('Connected to Server ✅');
// });

// socket.addEventListener('message', (message) => {
//   const li = document.createElement('li');
//   li.innerText = message.data;
//   messageList.append(li);
// });

// socket.addEventListener('close', () => {
//   console.log('Disconnected from Server ❌');
// });

// const handleSubmit = (event) => {
//   event.preventDefault();
//   const input = messageForm.querySelector('input');
//   socket.send(makeMessage('new_message', input.value));
//   input.value = '';
// };

// const handleNickSubmit = (event) => {
//   event.preventDefault();
//   const input = nickForm.querySelector('input');
//   socket.send(makeMessage('nickname', input.value));
//   input.value = '';
// };

// messageForm.addEventListener('submit', handleSubmit);
// nickForm.addEventListener('submit', handleNickSubmit);
