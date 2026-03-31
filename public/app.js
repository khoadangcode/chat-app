const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// State
let currentUser = null;
let authToken = localStorage.getItem('authToken');
let selectedUserId = null;
let socket = null;
let onlineUserIds = [];
let unreadCounts = {};
let blockedUserIds = new Set();

// Message queue for offline/pending messages
const pendingMessages = new Map();
let nextTempId = -1;

const COLORS = ['#5b5ea6','#e07a5f','#3d85c6','#81b29a','#f2a65a','#e76f51','#457b9d','#8338ec'];

// ---- NOTIFICATION SOUND ----

const playNotifSound = (() => {
  let ctx;
  return () => {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  };
})();

// ---- EMOJI DATA ----

const EMOJI_DATA = {
  'Mặt cười': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥴','😵','🤯','🥱','😎','🤓','🧐'],
  'Cảm xúc': ['😤','😡','🤬','😈','👿','💀','☠️','💩','🤡','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
  'Tay & Cử chỉ': ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🙏','💪'],
  'Trái tim': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟'],
  'Động vật': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜'],
  'Đồ ăn': ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆','🌶️','🫑','🥒','🥬','🧄','🧅','🥔','🍠','🌽','🥕','🍕','🍔','🍟','🌭','🍿','🧂','🥚','🍳','🧈','🥞','🧇','🥓','🍗','🍖','🌮','🍜','🍝','🍣','🍱','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','🍮','🍯'],
  'Hoạt động': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏑','🥍','🏏','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤸','🤺','⛹️','🧗','🚴','🚵','🏇','🧘','🏄','🏊','🤽','🚣','🧑‍🚀'],
  'Du lịch': ['🚗','🚕','🚌','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍️','🚲','🛴','🚆','🚇','🚈','🚂','✈️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','🏠','🏡','🏢','🏣','🏥','🏦','🏪','🏫','🏬','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🏰','🏯','🎡','🎢','🎠','⛲','🌋','🗻','🏕️','🏖️','🌅','🌄','🌠','🎆','🎇'],
  'Vật dụng': ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','💾','💿','📀','📷','📹','🎥','📺','📻','🎙️','🎚️','🎛️','⏱️','⏰','🔔','🔕','📯','💡','🔦','🕯️','🪔','💰','💵','💴','💶','💷','💎','🔑','🗡️','🛡️','🔧','🔨','⛏️','🪓','🔩','🪛','🧲','🧪','🧫','🧬','🔬','🔭','📡']
};

const EMOJI_KEYWORDS = {
  'vui': ['😀','😃','😄','😁','😆','😊','🥳','🎉'],
  'buon': ['😢','😭','😞','😔','🥺','😿'],
  'gian': ['😤','😡','🤬','👿','💢'],
  'tim': ['❤️','💕','💖','💗','💓','💘','💝','🥰','😍'],
  'yeu': ['🥰','😍','😘','💕','💖','❤️','💗','😻'],
  'cuoi': ['😂','🤣','😆','😹','🤭','😄'],
  'khoc': ['😢','😭','😿','🥲','😥'],
  'so': ['😨','😱','🫣','😰','🥶','👻'],
  'ngu': ['😴','💤','🥱','😪'],
  'an': ['🍕','🍔','🍟','🍗','🍜','🍣','🍰','🍩','😋'],
  'ok': ['👍','👌','✅','🆗','💯'],
  'suy': ['🤔','🧐','💭','🫠'],
  'chao': ['👋','🤚','✋','🖐️'],
  'thua': ['🏆','🥇','🎉','🥳','🎊'],
  'hoa': ['🌸','🌹','🌺','🌻','🌼','💐','🌷'],
  'may': ['☁️','⛅','🌤️','🌥️','🌦️','🌧️','⛈️'],
  'lua': ['🔥','🔥','🔥','❤️‍🔥','🌋'],
  'star': ['⭐','🌟','✨','💫','🌠'],
  'nhac': ['🎵','🎶','🎸','🎹','🥁','🎤','🎧'],
  'xin': ['🙏','🥺','🫶','💖'],
  'cool': ['😎','🤙','🆒','✨','💅'],
  'meo': ['🐱','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
  'cho': ['🐶','🐕','🦮','🐕‍🦺','🐩'],
  'ga': ['🐔','🐓','🐣','🐤','🐥','🍗'],
};

const STICKERS = [
  '😂','🤣','😍','🥰','😘','🤗','😎','🤩','🥳','😭',
  '😤','🤬','😱','🤯','🥺','😇','🤡','💀','👻','👽',
  '❤️','💔','💕','🔥','✨','💯','👍','👎','👏','🙏',
  '💪','🤝','✌️','🤟','👋','🫶','🐶','🐱','🐼','🦄'
];

const REACTION_EMOJIS = ['❤️','😂','👍','😮','😢'];

// ---- HELPERS ----

function getColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function createAvatar(name, isOnline) {
  const el = document.createElement('span');
  el.className = 'user-avatar' + (isOnline ? ' online' : '');
  el.style.background = getColor(name);
  el.textContent = name.charAt(0).toUpperCase();
  return el;
}

function setStaticAvatar(el, name, isOnline) {
  el.style.background = getColor(name);
  el.textContent = name.charAt(0).toUpperCase();
  el.className = 'user-avatar' + (isOnline ? ' online' : '');
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Hôm nay';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- AUTH HELPERS ----

function saveToken(token) {
  authToken = token;
  localStorage.setItem('authToken', token);
}

function clearToken() {
  authToken = null;
  localStorage.removeItem('authToken');
}

async function authFetch(url, opts = {}) {
  if (!opts.headers) opts.headers = {};
  if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
  const res = await fetch(url, opts);
  if (res.status === 401) {
    handleAuthFailure();
    throw new Error('Unauthorized');
  }
  return res;
}

function handleAuthFailure() {
  if (socket) socket.disconnect();
  currentUser = null;
  clearToken();
  selectedUserId = null;
  unreadCounts = {};
  blockedUserIds = new Set();
  pendingMessages.clear();
  $('#chat-screen').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  $('#admin-panel').classList.add('hidden');
}

// ---- AUTH ----

$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    $('#login-form').classList.toggle('hidden', !isLogin);
    $('#register-form').classList.toggle('hidden', isLogin);
    $('#auth-error').classList.add('hidden');
  });
});

function showAuthError(msg) {
  const el = $('#auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: $('#login-username').value.trim(),
        password: $('#login-password').value
      })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    saveToken(data.token);
    enterChat(data);
  } catch {
    showAuthError('Lỗi kết nối server');
  }
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: $('#reg-username').value.trim(),
        password: $('#reg-password').value
      })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    saveToken(data.token);
    enterChat(data);
  } catch {
    showAuthError('Lỗi kết nối server');
  }
});

async function checkAuth() {
  if (!authToken) return;
  try {
    const res = await authFetch('/api/me');
    if (res.ok) {
      const data = await res.json();
      saveToken(data.token);
      enterChat(data);
    } else {
      clearToken();
    }
  } catch {}
}

// ---- CHAT ----

function enterChat(user) {
  currentUser = user;
  $('#auth-screen').classList.add('hidden');
  $('#chat-screen').classList.remove('hidden');

  $('#my-username').textContent = user.username;
  setStaticAvatar($('#my-avatar'), user.username, true);

  const adminBtn = $('#admin-btn');
  if (user.role === 'admin') {
    adminBtn.classList.remove('hidden');
  } else {
    adminBtn.classList.add('hidden');
  }

  connectSocket();
  loadBlockedUsers();
  loadUsers();
}

function connectSocket() {
  if (socket) socket.disconnect();

  socket = io({
    auth: { token: authToken },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    timeout: 10000
  });

  socket.on('connect', () => {
    hideConnectionError();
    loadUsers();
    // Retry all pending messages
    flushPendingMessages();
  });

  socket.on('disconnect', () => {
    // Don't show error immediately - wait for reconnect attempts
  });

  let reconnectShown = false;
  socket.on('reconnect_attempt', (attempt) => {
    // Only show after 2 failed attempts (not on brief hiccups)
    if (attempt >= 2 && !reconnectShown) {
      showConnectionError('Đang kết nối lại...');
      reconnectShown = true;
    }
  });

  socket.on('reconnect', () => {
    reconnectShown = false;
    hideConnectionError();
    loadUsers();
    if (selectedUserId) {
      selectUser(selectedUserId, $('#chat-with-name').textContent);
    }
  });

  socket.on('connect_error', async (err) => {
    if (err.message === 'Unauthorized' && authToken) {
      try {
        const res = await authFetch('/api/me');
        if (res.ok) {
          const data = await res.json();
          saveToken(data.token);
          socket.auth = { token: authToken };
        }
      } catch {}
    }
  });

  socket.on('online_users', (ids) => {
    onlineUserIds = ids;
    updateUserListOnlineStatus();
    updateChatHeaderStatus();
  });

  socket.on('new_message', (msg) => {
    // Skip if this is our own message (already shown optimistically)
    if (msg.sender_id === currentUser.id) {
      // Check if we already have this as a pending message shown
      const existing = document.querySelector(`[data-msg-id="${msg.id}"]`);
      if (existing) return; // Already confirmed
      // Check if any pending message matches this content (duplicate prevention)
      const pendingEl = document.querySelector('.message.pending');
      if (pendingEl) return; // We showed it optimistically
      // Otherwise show it (sent from another tab/device)
    }

    // Play notification sound for messages from others
    if (msg.sender_id !== currentUser.id) {
      playNotifSound();
    }

    if (
      (msg.sender_id === selectedUserId && msg.receiver_id === currentUser.id) ||
      (msg.sender_id === currentUser.id && msg.receiver_id === selectedUserId)
    ) {
      appendMessage(msg);
      scrollToBottom();
    } else if (msg.sender_id !== currentUser.id) {
      unreadCounts[msg.sender_id] = (unreadCounts[msg.sender_id] || 0) + 1;
      updateUnreadBadge(msg.sender_id);
    }

    updateUserPreview(msg.sender_id === currentUser.id ? msg.receiver_id : msg.sender_id, msg.content);
  });

  socket.on('user_typing', (data) => {
    if (data.userId === selectedUserId) {
      const el = $('#typing-indicator');
      el.querySelector('span').textContent = data.username;
      el.classList.remove('hidden');
      clearTimeout(el._timeout);
      el._timeout = setTimeout(() => el.classList.add('hidden'), 2000);
    }
  });

  socket.on('error_message', (data) => {
    const msg = typeof data === 'string' ? data : (data.message || data.error || 'Có lỗi xảy ra');
    alert(msg);
  });

  // Listen for reaction updates
  socket.on('reaction_updated', (data) => {
    // data: { messageId, reactions: [{ emoji, user_id, username }, ...] }
    updateMessageReactions(data.messageId, data.reactions);
  });
}

// ---- MESSAGE QUEUE ----

function flushPendingMessages() {
  pendingMessages.forEach((msg, tempId) => {
    sendPendingMessage(tempId);
  });
}

function sendPendingMessage(tempId) {
  const pending = pendingMessages.get(tempId);
  if (!pending || !socket || !socket.connected) return;

  socket.emit('send_message',
    { receiverId: pending.receiverId, content: pending.content, tempId },
    (ack) => {
      if (ack && ack.success) {
        // Update UI: remove pending state, set real ID
        const el = document.querySelector(`[data-msg-id="${tempId}"]`);
        if (el) {
          el.dataset.msgId = ack.messageId;
          el.classList.remove('pending');
          const status = el.querySelector('.msg-status');
          if (status) status.textContent = '✓';
        }
        pendingMessages.delete(tempId);
      }
    }
  );
}

// ---- CONNECTION UI ----

function showConnectionError(msg) {
  let bar = $('#connection-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'connection-bar';
    document.body.prepend(bar);
  }
  bar.textContent = msg;
  bar.classList.remove('hidden');
}

function hideConnectionError() {
  const bar = $('#connection-bar');
  if (bar) bar.classList.add('hidden');
}

// ---- USER LIST ----

async function loadUsers() {
  try {
    const res = await authFetch('/api/users');
    const users = await res.json();
    renderUserList(users);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Failed to load users');
  }
}

function renderUserList(users) {
  const list = $('#user-list');
  if (users.length === 0) {
    list.innerHTML = '<p class="empty-state">Chưa có người dùng khác</p>';
    return;
  }

  list.innerHTML = '';
  users.forEach(user => {
    const isOnline = onlineUserIds.includes(user.id);
    const item = document.createElement('div');
    item.className = 'user-item' + (user.id === selectedUserId ? ' active' : '');
    item.dataset.userId = user.id;
    item.dataset.username = user.username;

    const avatar = createAvatar(user.username, isOnline);
    const info = document.createElement('div');
    info.className = 'user-item-info';

    const adminBadge = user.role === 'admin'
      ? '<span class="role-badge admin-badge">Admin</span>'
      : '';
    info.innerHTML = `
      <div class="user-item-name">${escapeHtml(user.username)} ${adminBadge}</div>
      <div class="user-item-preview" data-preview-for="${user.id}"></div>
    `;

    item.appendChild(avatar);
    item.appendChild(info);

    if (unreadCounts[user.id]) {
      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.dataset.badgeFor = user.id;
      badge.textContent = unreadCounts[user.id];
      item.appendChild(badge);
    }

    item.addEventListener('click', () => selectUser(user.id, user.username));
    list.appendChild(item);
  });

  $('#search-users').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $$('.user-item').forEach(item => {
      const name = item.dataset.username.toLowerCase();
      item.style.display = name.includes(q) ? '' : 'none';
    });
  };
}

function updateUserListOnlineStatus() {
  $$('.user-item').forEach(item => {
    const uid = parseInt(item.dataset.userId);
    const isOnline = onlineUserIds.includes(uid);
    const avatar = item.querySelector('.user-avatar');
    avatar.className = 'user-avatar' + (isOnline ? ' online' : '');
  });
}

function updateChatHeaderStatus() {
  if (!selectedUserId) return;
  const isOnline = onlineUserIds.includes(selectedUserId);
  const statusEl = $('#chat-status');
  statusEl.textContent = isOnline ? 'Online' : 'Offline';
  statusEl.className = 'status-text' + (isOnline ? ' online' : '');

  const avatar = $('#chat-avatar');
  avatar.className = 'user-avatar' + (isOnline ? ' online' : '');
}

function updateUnreadBadge(userId) {
  const existing = document.querySelector(`[data-badge-for="${userId}"]`);
  if (existing) {
    existing.textContent = unreadCounts[userId] || '';
    if (!unreadCounts[userId]) existing.remove();
  } else if (unreadCounts[userId]) {
    const item = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    if (item) {
      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.dataset.badgeFor = userId;
      badge.textContent = unreadCounts[userId];
      item.appendChild(badge);
    }
  }
}

function updateUserPreview(userId, text) {
  const el = document.querySelector(`[data-preview-for="${userId}"]`);
  if (el) el.textContent = text.slice(0, 40);
}

// ---- MESSAGES ----

async function selectUser(userId, username) {
  selectedUserId = userId;

  delete unreadCounts[userId];
  updateUnreadBadge(userId);

  $$('.user-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.userId) === userId);
  });

  $('#no-chat').classList.add('hidden');
  $('#chat-box').classList.remove('hidden');
  $('#chat-with-name').textContent = username;
  setStaticAvatar($('#chat-avatar'), username, onlineUserIds.includes(userId));
  updateChatHeaderStatus();
  updateBlockButton();

  $('#messages').innerHTML = '';
  try {
    const res = await authFetch(`/api/messages/${userId}`);
    const messages = await res.json();

    let lastDate = '';
    messages.forEach(msg => {
      const msgDate = formatDate(msg.created_at);
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerHTML = `<span>${msgDate}</span>`;
        $('#messages').appendChild(divider);
      }
      appendMessage(msg, false);
    });
    scrollToBottom(false);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Failed to load messages');
  }

  $('#message-input').focus();
}

function appendMessage(msg, animate = true) {
  const isSent = msg.sender_id === currentUser.id;
  const isPending = !!msg.pending;
  const isSticker = msg.content && msg.content.startsWith('[sticker]');
  const el = document.createElement('div');
  el.className = 'message ' + (isSent ? 'sent' : 'received') + (isPending ? ' pending' : '') + (isSticker ? ' sticker-message' : '');
  el.dataset.msgId = msg.id;
  if (!animate) el.style.animation = 'none';

  let status = '';
  if (isSent) {
    status = isPending
      ? '<span class="msg-status">⏳</span>'
      : '<span class="msg-status">✓</span>';
  }

  if (isSticker) {
    // Render sticker as large emoji without bubble
    const stickerEmoji = msg.content.replace('[sticker]', '').trim();
    el.innerHTML = `<span class="sticker-display">${stickerEmoji}</span><span class="time">${formatTime(msg.created_at)}${status}</span>`;
  } else {
    el.innerHTML = `${escapeHtml(msg.content)}<span class="time">${formatTime(msg.created_at)}${status}</span>`;
  }

  // Reaction button
  const reactionBtn = document.createElement('button');
  reactionBtn.className = 'reaction-add-btn';
  reactionBtn.textContent = '+';
  reactionBtn.title = 'Thêm reaction';
  reactionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showReactionPicker(el, msg.id);
  });
  el.appendChild(reactionBtn);

  // Reactions container
  const reactionsContainer = document.createElement('div');
  reactionsContainer.className = 'reactions-container';
  reactionsContainer.dataset.reactionsFor = msg.id;
  el.appendChild(reactionsContainer);

  // Render existing reactions if any
  if (msg.reactions && msg.reactions.length > 0) {
    renderReactions(reactionsContainer, msg.id, msg.reactions);
  }

  $('#messages').appendChild(el);
}

// ---- REACTIONS ----

function showReactionPicker(messageEl, messageId) {
  // Remove any existing picker
  const existing = document.querySelector('.reaction-picker-popup');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.className = 'reaction-picker-popup';

  REACTION_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'reaction-picker-emoji';
    btn.textContent = emoji;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleReaction(messageId, emoji);
      picker.remove();
    });
    picker.appendChild(btn);
  });

  messageEl.appendChild(picker);

  // Close picker on outside click
  const closeHandler = (e) => {
    if (!picker.contains(e.target)) {
      picker.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function toggleReaction(messageId, emoji) {
  if (!socket || !socket.connected) return;

  // Check if user already reacted with this emoji
  const container = document.querySelector(`[data-reactions-for="${messageId}"]`);
  if (container) {
    const existingBadge = container.querySelector(`[data-reaction-emoji="${emoji}"]`);
    if (existingBadge && existingBadge.classList.contains('reacted-by-me')) {
      socket.emit('remove_reaction', { messageId, emoji });
      return;
    }
  }

  socket.emit('add_reaction', { messageId, emoji });
}

function updateMessageReactions(messageId, reactions) {
  const container = document.querySelector(`[data-reactions-for="${messageId}"]`);
  if (!container) return;
  renderReactions(container, messageId, reactions);
}

function renderReactions(container, messageId, reactions) {
  container.innerHTML = '';
  if (!reactions || reactions.length === 0) return;

  // Group reactions by emoji
  const grouped = {};
  reactions.forEach(r => {
    if (!grouped[r.emoji]) grouped[r.emoji] = [];
    grouped[r.emoji].push(r);
  });

  Object.entries(grouped).forEach(([emoji, users]) => {
    const badge = document.createElement('button');
    badge.className = 'reaction-badge';
    badge.dataset.reactionEmoji = emoji;

    const isMine = users.some(u => u.user_id === currentUser.id);
    if (isMine) badge.classList.add('reacted-by-me');

    const names = users.map(u => u.username).join(', ');
    badge.title = names;
    badge.textContent = `${emoji} ${users.length}`;

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleReaction(messageId, emoji);
    });

    container.appendChild(badge);
  });
}

function scrollToBottom(smooth = true) {
  const el = $('#messages');
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

// ---- EMOJI PICKER ----

let emojiPickerOpen = false;
let currentEmojiTab = 'emoji'; // 'emoji' or 'sticker'

function initEmojiPicker() {
  const emojiBtn = $('#emoji-btn');
  const emojiPicker = $('#emoji-picker');
  if (!emojiBtn || !emojiPicker) return;

  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPickerOpen = !emojiPickerOpen;
    emojiPicker.classList.toggle('hidden', !emojiPickerOpen);
    if (emojiPickerOpen) {
      renderEmojiPickerContent();
      const searchInput = $('#emoji-search');
      if (searchInput) searchInput.value = '';
    }
  });

  // Close picker on outside click
  document.addEventListener('click', (e) => {
    if (emojiPickerOpen && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPickerOpen = false;
      emojiPicker.classList.add('hidden');
    }
  });

  // Tab switching
  emojiPicker.addEventListener('click', (e) => {
    if (e.target.classList.contains('emoji-tab')) {
      currentEmojiTab = e.target.dataset.tab;
      $$('.emoji-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentEmojiTab));
      renderEmojiPickerContent();
    }
  });

  // Search
  emojiPicker.addEventListener('input', (e) => {
    if (e.target.id === 'emoji-search') {
      renderEmojiPickerContent(e.target.value.trim().toLowerCase());
    }
  });
}

function renderEmojiPickerContent(searchQuery = '') {
  const emojiGrid = $('#emoji-grid');
  const stickerGrid = $('#sticker-grid');
  if (!emojiGrid || !stickerGrid) return;

  if (currentEmojiTab === 'emoji') {
    emojiGrid.classList.remove('hidden');
    stickerGrid.classList.add('hidden');
    renderEmojiGrid(searchQuery);
  } else {
    emojiGrid.classList.add('hidden');
    stickerGrid.classList.remove('hidden');
    renderStickerGrid();
  }
}

function renderEmojiGrid(searchQuery = '') {
  const grid = $('#emoji-grid');
  grid.innerHTML = '';

  if (searchQuery) {
    // Search mode - filter all emojis
    const allEmojis = new Set();
    Object.values(EMOJI_DATA).forEach(emojis => emojis.forEach(e => allEmojis.add(e)));

    // Also search by Vietnamese keywords
    const matchedFromKeywords = new Set();
    Object.entries(EMOJI_KEYWORDS).forEach(([keyword, emojis]) => {
      if (keyword.includes(searchQuery)) {
        emojis.forEach(e => matchedFromKeywords.add(e));
      }
    });

    // Also search by category name
    Object.entries(EMOJI_DATA).forEach(([category, emojis]) => {
      if (category.toLowerCase().includes(searchQuery)) {
        emojis.forEach(e => matchedFromKeywords.add(e));
      }
    });

    if (matchedFromKeywords.size > 0) {
      matchedFromKeywords.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-item';
        btn.textContent = emoji;
        btn.addEventListener('click', () => insertEmojiAtCursor(emoji));
        grid.appendChild(btn);
      });
    } else {
      grid.innerHTML = '<p class="empty-state" style="padding:10px;font-size:13px;">Không tìm thấy emoji</p>';
    }
  } else {
    // Category mode
    Object.entries(EMOJI_DATA).forEach(([category, emojis]) => {
      const header = document.createElement('div');
      header.className = 'emoji-category-header';
      header.textContent = category;
      grid.appendChild(header);

      const categoryGrid = document.createElement('div');
      categoryGrid.className = 'emoji-category-grid';
      emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-item';
        btn.textContent = emoji;
        btn.addEventListener('click', () => insertEmojiAtCursor(emoji));
        categoryGrid.appendChild(btn);
      });
      grid.appendChild(categoryGrid);
    });
  }
}

function renderStickerGrid() {
  const grid = $('#sticker-grid');
  grid.innerHTML = '';

  STICKERS.forEach(sticker => {
    const btn = document.createElement('button');
    btn.className = 'sticker-item';
    btn.textContent = sticker;
    btn.addEventListener('click', () => sendSticker(sticker));
    grid.appendChild(btn);
  });
}

function insertEmojiAtCursor(emoji) {
  const input = $('#message-input');
  if (!input) return;

  const start = input.selectionStart;
  const end = input.selectionEnd;
  const value = input.value;
  input.value = value.substring(0, start) + emoji + value.substring(end);
  input.selectionStart = input.selectionEnd = start + emoji.length;
  input.focus();

  // Close picker
  emojiPickerOpen = false;
  const picker = $('#emoji-picker');
  if (picker) picker.classList.add('hidden');
}

function sendSticker(sticker) {
  if (!selectedUserId) return;

  const content = '[sticker]' + sticker;
  const tempId = nextTempId--;
  const msg = {
    id: tempId,
    sender_id: currentUser.id,
    receiver_id: selectedUserId,
    content,
    created_at: new Date().toISOString(),
    pending: true
  };

  appendMessage(msg);
  scrollToBottom();
  updateUserPreview(selectedUserId, content);

  pendingMessages.set(tempId, { content, receiverId: selectedUserId });
  sendPendingMessage(tempId);

  // Close picker
  emojiPickerOpen = false;
  const picker = $('#emoji-picker');
  if (picker) picker.classList.add('hidden');
}

// ---- EMOJI SUGGEST (:keyword) ----

let emojiSuggestVisible = false;

function initEmojiSuggest() {
  const input = $('#message-input');
  const suggest = $('#emoji-suggest');
  if (!input || !suggest) return;

  input.addEventListener('input', () => {
    const value = input.value;
    const cursorPos = input.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);

    // Find :keyword pattern
    const match = textBeforeCursor.match(/:([a-zA-Z\u00C0-\u024F]+)$/);

    if (match) {
      const keyword = match[1].toLowerCase()
        // Normalize Vietnamese characters for matching
        .replace(/[àáảãạăắằẳẵặâấầẩẫậ]/g, 'a')
        .replace(/[èéẻẽẹêếềểễệ]/g, 'e')
        .replace(/[ìíỉĩị]/g, 'i')
        .replace(/[òóỏõọôốồổỗộơớờởỡợ]/g, 'o')
        .replace(/[ùúủũụưứừửữự]/g, 'u')
        .replace(/[ỳýỷỹỵ]/g, 'y')
        .replace(/đ/g, 'd');

      const matches = [];
      Object.entries(EMOJI_KEYWORDS).forEach(([key, emojis]) => {
        if (key.includes(keyword)) {
          emojis.forEach(e => {
            if (!matches.includes(e)) matches.push(e);
          });
        }
      });

      if (matches.length > 0) {
        showEmojiSuggest(suggest, matches.slice(0, 12), match[0], cursorPos);
        return;
      }
    }

    hideEmojiSuggest(suggest);
  });

  // Hide on blur (with delay so click can register)
  input.addEventListener('blur', () => {
    setTimeout(() => hideEmojiSuggest(suggest), 200);
  });
}

function showEmojiSuggest(suggest, emojis, matchText, cursorPos) {
  suggest.innerHTML = '';
  emojiSuggestVisible = true;
  suggest.classList.remove('hidden');

  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-suggest-item';
    btn.textContent = emoji;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent blur
      const input = $('#message-input');
      const value = input.value;
      const start = cursorPos - matchText.length;
      input.value = value.substring(0, start) + emoji + value.substring(cursorPos);
      input.selectionStart = input.selectionEnd = start + emoji.length;
      input.focus();
      hideEmojiSuggest(suggest);
    });
    suggest.appendChild(btn);
  });
}

function hideEmojiSuggest(suggest) {
  if (!suggest) return;
  emojiSuggestVisible = false;
  suggest.classList.add('hidden');
  suggest.innerHTML = '';
}

// Send message - OPTIMISTIC UI
$('#message-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#message-input');
  const content = input.value.trim();
  if (!content || !selectedUserId) return;

  // Close emoji picker if open
  emojiPickerOpen = false;
  const picker = $('#emoji-picker');
  if (picker) picker.classList.add('hidden');

  // Hide emoji suggest
  const suggest = $('#emoji-suggest');
  if (suggest) hideEmojiSuggest(suggest);

  const tempId = nextTempId--;
  const msg = {
    id: tempId,
    sender_id: currentUser.id,
    receiver_id: selectedUserId,
    content,
    created_at: new Date().toISOString(),
    pending: true
  };

  // Show immediately (optimistic)
  appendMessage(msg);
  scrollToBottom();
  updateUserPreview(selectedUserId, content);

  // Queue for sending
  pendingMessages.set(tempId, { content, receiverId: selectedUserId });
  input.value = '';
  input.focus();

  // Try to send now
  sendPendingMessage(tempId);
});

// Typing indicator
let typingTimeout;
$('#message-input').addEventListener('input', () => {
  if (!selectedUserId) return;
  clearTimeout(typingTimeout);
  if (socket && socket.connected) socket.emit('typing', selectedUserId);
  typingTimeout = setTimeout(() => {}, 2000);
});

// Logout
$('#logout-btn').addEventListener('click', async () => {
  try {
    await authFetch('/api/logout', { method: 'POST' });
  } catch {}
  handleAuthFailure();
  $('#login-username').value = '';
  $('#login-password').value = '';
});

// ---- BLOCK / UNBLOCK ----

async function loadBlockedUsers() {
  try {
    const res = await authFetch('/api/blocked');
    if (res.ok) {
      const users = await res.json();
      blockedUserIds = new Set(users.map(u => u.id));
      renderBlockedUsersList(users);
    }
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Failed to load blocked users');
  }
}

function renderBlockedUsersList(users) {
  const list = $('#blocked-users-list');
  if (!users || users.length === 0) {
    list.innerHTML = '<p class="empty-state">Chưa chặn người dùng nào</p>';
    return;
  }
  list.innerHTML = '';
  users.forEach(user => {
    const item = document.createElement('div');
    item.className = 'blocked-user-item';
    item.innerHTML = `
      <span class="blocked-user-name">${escapeHtml(user.username)}</span>
      <button class="unblock-btn" data-user-id="${user.id}" title="Bỏ chặn">Bỏ chặn</button>
    `;
    item.querySelector('.unblock-btn').addEventListener('click', () => unblockUser(user.id));
    list.appendChild(item);
  });
}

function updateBlockButton() {
  const btn = $('#block-btn');
  if (!btn || !selectedUserId) return;
  const isBlocked = blockedUserIds.has(selectedUserId);
  const textEl = btn.querySelector('.block-btn-text');
  if (textEl) {
    textEl.textContent = isBlocked ? 'Bỏ chặn' : 'Chặn';
  }
  btn.classList.toggle('blocked', isBlocked);
}

async function blockUser(userId) {
  try {
    const res = await authFetch(`/api/block/${userId}`, { method: 'POST' });
    if (res.ok) {
      blockedUserIds.add(userId);
      updateBlockButton();
      loadBlockedUsers();
      loadUsers();
    } else {
      const data = await res.json();
      alert(data.error || 'Không thể chặn người dùng');
    }
  } catch (err) {
    if (err.message !== 'Unauthorized') alert('Lỗi kết nối server');
  }
}

async function unblockUser(userId) {
  try {
    const res = await authFetch(`/api/block/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      blockedUserIds.delete(userId);
      updateBlockButton();
      loadBlockedUsers();
      loadUsers();
    } else {
      const data = await res.json();
      alert(data.error || 'Không thể bỏ chặn người dùng');
    }
  } catch (err) {
    if (err.message !== 'Unauthorized') alert('Lỗi kết nối server');
  }
}

$('#block-btn').addEventListener('click', () => {
  if (!selectedUserId) return;
  if (blockedUserIds.has(selectedUserId)) {
    unblockUser(selectedUserId);
  } else {
    blockUser(selectedUserId);
  }
});

$('#blocked-users-btn').addEventListener('click', () => {
  const section = $('#blocked-users-section');
  section.classList.toggle('hidden');
  if (!section.classList.contains('hidden')) {
    loadBlockedUsers();
  }
});

$('#close-blocked-section').addEventListener('click', () => {
  $('#blocked-users-section').classList.add('hidden');
});

// ---- ADMIN PANEL ----

$('#admin-btn').addEventListener('click', () => {
  $('#admin-panel').classList.remove('hidden');
  loadAdminStats();
  loadAdminUsers();
});

$('#admin-close-btn').addEventListener('click', () => {
  $('#admin-panel').classList.add('hidden');
});

async function loadAdminStats() {
  try {
    const res = await authFetch('/api/admin/stats');
    if (res.ok) {
      const stats = await res.json();
      $('#stat-total-users').textContent = stats.totalUsers || 0;
      $('#stat-banned-users').textContent = stats.bannedUsers || 0;
      $('#stat-total-messages').textContent = stats.totalMessages || 0;
      $('#stat-messages-today').textContent = stats.todayMessages || 0;
    }
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Failed to load admin stats');
  }
}

async function loadAdminUsers() {
  try {
    const res = await authFetch('/api/admin/users');
    if (res.ok) {
      const users = await res.json();
      renderAdminUsers(users);
    }
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Failed to load admin users');
  }
}

function renderAdminUsers(users) {
  const tbody = $('#admin-users-tbody');
  const noUsers = $('#admin-no-users');

  if (!users || users.length === 0) {
    tbody.innerHTML = '';
    noUsers.classList.remove('hidden');
    return;
  }

  noUsers.classList.add('hidden');
  tbody.innerHTML = '';

  users.forEach(user => {
    const tr = document.createElement('tr');
    const isSelf = user.id === currentUser.id;

    const roleBadge = user.role === 'admin'
      ? '<span class="role-badge admin-badge">Admin</span>'
      : '<span class="role-badge user-badge">User</span>';

    const statusBadge = user.is_banned
      ? '<span class="status-badge banned-badge">Bị cấm</span>'
      : '<span class="status-badge active-badge">Hoạt động</span>';

    let actions = '';
    if (!isSelf) {
      if (user.is_banned) {
        actions += `<button class="admin-action-btn unban-btn" data-user-id="${user.id}" title="Bỏ cấm">Bỏ cấm</button>`;
      } else {
        actions += `<button class="admin-action-btn ban-btn" data-user-id="${user.id}" title="Cấm">Cấm</button>`;
      }

      if (user.role === 'admin') {
        actions += `<button class="admin-action-btn role-btn" data-user-id="${user.id}" data-role="user" title="Hạ xuống User">Hạ quyền</button>`;
      } else {
        actions += `<button class="admin-action-btn role-btn" data-user-id="${user.id}" data-role="admin" title="Nâng lên Admin">Nâng quyền</button>`;
      }

      actions += `<button class="admin-action-btn delete-btn" data-user-id="${user.id}" title="Xoá người dùng">Xoá</button>`;
    } else {
      actions = '<span class="admin-self-label">Bạn</span>';
    }

    tr.innerHTML = `
      <td>${escapeHtml(user.username)}</td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td>${user.message_count || 0}</td>
      <td class="admin-actions">${actions}</td>
    `;

    tbody.appendChild(tr);

    if (!isSelf) {
      const banBtn = tr.querySelector('.ban-btn');
      if (banBtn) banBtn.addEventListener('click', () => adminBanUser(user.id));

      const unbanBtn = tr.querySelector('.unban-btn');
      if (unbanBtn) unbanBtn.addEventListener('click', () => adminUnbanUser(user.id));

      const roleBtn = tr.querySelector('.role-btn');
      if (roleBtn) roleBtn.addEventListener('click', () => {
        adminChangeRole(user.id, roleBtn.dataset.role);
      });

      const deleteBtn = tr.querySelector('.delete-btn');
      if (deleteBtn) deleteBtn.addEventListener('click', () => adminDeleteUser(user.id, user.username));
    }
  });
}

async function adminBanUser(userId) {
  try {
    const res = await authFetch(`/api/admin/ban/${userId}`, { method: 'POST' });
    if (res.ok) { loadAdminStats(); loadAdminUsers(); loadUsers(); }
    else { const d = await res.json(); alert(d.error || 'Không thể cấm người dùng'); }
  } catch (err) { if (err.message !== 'Unauthorized') alert('Lỗi kết nối server'); }
}

async function adminUnbanUser(userId) {
  try {
    const res = await authFetch(`/api/admin/unban/${userId}`, { method: 'POST' });
    if (res.ok) { loadAdminStats(); loadAdminUsers(); loadUsers(); }
    else { const d = await res.json(); alert(d.error || 'Không thể bỏ cấm người dùng'); }
  } catch (err) { if (err.message !== 'Unauthorized') alert('Lỗi kết nối server'); }
}

async function adminChangeRole(userId, newRole) {
  try {
    const res = await authFetch(`/api/admin/role/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole })
    });
    if (res.ok) { loadAdminUsers(); loadUsers(); }
    else { const d = await res.json(); alert(d.error || 'Không thể đổi vai trò'); }
  } catch (err) { if (err.message !== 'Unauthorized') alert('Lỗi kết nối server'); }
}

async function adminDeleteUser(userId, username) {
  if (!confirm(`Bạn có chắc muốn xoá người dùng "${username}"? Hành động này không thể hoàn tác.`)) return;
  try {
    const res = await authFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      if (selectedUserId === userId) {
        selectedUserId = null;
        $('#chat-box').classList.add('hidden');
        $('#no-chat').classList.remove('hidden');
      }
      loadAdminStats(); loadAdminUsers(); loadUsers();
    } else { const d = await res.json(); alert(d.error || 'Không thể xoá người dùng'); }
  } catch (err) { if (err.message !== 'Unauthorized') alert('Lỗi kết nối server'); }
}

// ---- INIT ----

initEmojiPicker();
initEmojiSuggest();
setInterval(loadUsers, 10000);
checkAuth();
