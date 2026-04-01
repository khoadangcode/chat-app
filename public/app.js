const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// State
let currentUser = null;
let authToken = localStorage.getItem('authToken');
let selectedUserId = null;
let selectedGroupId = null; // Group chat state
let socket = null;
let onlineUserIds = [];
let unreadCounts = {};
let blockedUserIds = new Set();
let userRoles = {}; // userId -> role
let allUsers = []; // Cache for group creation
let lastSeenData = {}; // userId -> last_seen timestamp

// Message queue for offline/pending messages
const pendingMessages = new Map();
let nextTempId = -1;

// ---- DARK MODE ----
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const sun = $('#theme-icon-sun');
  const moon = $('#theme-icon-moon');
  if (sun && moon) {
    sun.classList.toggle('hidden', theme === 'dark');
    moon.classList.toggle('hidden', theme !== 'dark');
  }
}

initTheme();
$('#theme-toggle')?.addEventListener('click', toggleTheme);

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

// ---- LAST SEEN HELPER ----

function formatLastSeen(lastSeenStr) {
  if (!lastSeenStr) return 'Offline';
  const lastSeen = new Date(lastSeenStr);
  const now = new Date();
  const diffMs = now - lastSeen;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Online vừa mới';
  if (diffMin < 60) return `Online ${diffMin} phút trước`;
  if (diffHour < 24) return `Online ${diffHour} giờ trước`;
  if (diffDay < 7) return `Online ${diffDay} ngày trước`;
  return 'Offline';
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
  selectedGroupId = null;
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
        displayName: $('#reg-displayname').value.trim(),
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

  const myName = user.display_name || user.username;
  $('#my-username').textContent = myName;
  setStaticAvatar($('#my-avatar'), myName, true);

  const adminBtn = $('#admin-btn');
  if (user.role === 'admin') {
    adminBtn.classList.remove('hidden');
  } else {
    adminBtn.classList.add('hidden');
  }

  connectSocket();
  loadBlockedUsers();
  loadUsers();
  loadGroups();
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
    } else if (selectedGroupId) {
      const name = $('#chat-with-name').textContent;
      selectGroup(selectedGroupId, name);
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

  // ---- READ RECEIPTS socket listener ----
  socket.on('messages_read', (data) => {
    // data: { readerId } - the user who read our messages
    const readerId = data.readerId;
    // If we're currently chatting with this user, update all sent messages to "read"
    if (readerId === selectedUserId) {
      $$('.message.sent .msg-status').forEach(statusEl => {
        if (statusEl.textContent === '✓') {
          statusEl.textContent = '✓✓';
          statusEl.classList.add('read');
        }
      });
    }
  });

  // ---- GROUP CHAT socket listener ----
  socket.on('new_group_message', (msg) => {
    // msg: { id, group_id, sender_id, sender_name, content, created_at }
    if (msg.sender_id !== currentUser.id) {
      playNotifSound();
    }

    if (selectedGroupId === msg.group_id) {
      // Skip if we sent it optimistically
      if (msg.sender_id === currentUser.id) {
        const existing = document.querySelector(`[data-msg-id="${msg.id}"]`);
        if (existing) return;
        const pendingEl = document.querySelector('.message.pending');
        if (pendingEl) return;
      }
      appendMessage(msg, true, true);
      scrollToBottom();
    }
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

  if (pending.groupId) {
    // Group message
    socket.emit('send_group_message',
      { groupId: pending.groupId, content: pending.content, tempId },
      (ack) => {
        if (ack && ack.success) {
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
  } else {
    // DM message
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
    allUsers = users; // Cache for group creation
    // Store last_seen data
    users.forEach(u => {
      if (u.last_seen) lastSeenData[u.id] = u.last_seen;
    });
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
    userRoles[user.id] = user.role;
    const isOnline = user.role === 'bot' || onlineUserIds.includes(user.id);
    const item = document.createElement('div');
    item.className = 'user-item' + (user.id === selectedUserId && !selectedGroupId ? ' active' : '');
    item.dataset.userId = user.id;
    item.dataset.username = user.username;

    const avatar = createAvatar(user.username, isOnline);
    const info = document.createElement('div');
    info.className = 'user-item-info';

    let roleBadgeHtml = '';
    if (user.role === 'admin') roleBadgeHtml = '<span class="role-badge admin-badge">Admin</span>';
    else if (user.role === 'bot') roleBadgeHtml = '<span class="role-badge bot-badge">AI</span>';
    const isBot = user.role === 'bot';
    const displayName = user.nickname || user.display_name || user.username;
    info.innerHTML = `
      <div class="user-item-name">${isBot ? '🤖 ' : ''}${escapeHtml(displayName)} ${roleBadgeHtml}</div>
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

    item.addEventListener('click', () => selectUser(user.id, displayName));
    list.appendChild(item);
  });

  $('#search-users').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $$('.user-item').forEach(item => {
      const name = item.dataset.username.toLowerCase();
      item.style.display = name.includes(q) ? '' : 'none';
    });
    // Also filter groups
    $$('.group-item').forEach(item => {
      const name = (item.dataset.groupName || '').toLowerCase();
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
  if (selectedGroupId) return; // Groups don't have online status
  const isOnline = onlineUserIds.includes(selectedUserId);
  const statusEl = $('#chat-status');

  if (isOnline) {
    statusEl.textContent = 'Online';
    statusEl.className = 'status-text online';
  } else {
    // Show last seen if available
    const lastSeen = lastSeenData[selectedUserId];
    if (lastSeen) {
      statusEl.textContent = formatLastSeen(lastSeen);
    } else {
      statusEl.textContent = 'Offline';
    }
    statusEl.className = 'status-text';
  }

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
  if (el) {
    if (text && text.startsWith('[image]')) {
      el.textContent = '📷 Hình ảnh';
    } else {
      el.textContent = text.slice(0, 40);
    }
  }
}

// ---- MESSAGES ----

async function selectUser(userId, username) {
  selectedUserId = userId;
  selectedGroupId = null; // Deselect group

  delete unreadCounts[userId];
  updateUnreadBadge(userId);

  $$('.user-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.userId) === userId);
  });
  // Deselect groups
  $$('.group-item').forEach(item => item.classList.remove('active'));

  $('#no-chat').classList.add('hidden');
  $('#chat-box').classList.remove('hidden');
  $('#chat-with-name').textContent = username;
  setStaticAvatar($('#chat-avatar'), username, onlineUserIds.includes(userId));
  updateChatHeaderStatus();
  updateBlockButton();

  // Mobile: hide sidebar and show chat
  if (document.body.classList.contains('mobile')) {
    $('.sidebar').classList.add('sidebar-hidden');
    $('.chat-area').classList.add('chat-visible');
  }

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

    // ---- READ RECEIPTS: mark messages as read ----
    try {
      authFetch(`/api/messages/read/${userId}`, { method: 'POST' });
    } catch {}
    if (socket && socket.connected) {
      socket.emit('mark_read', { senderId: userId });
    }

  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Failed to load messages');
  }

  $('#message-input').focus();
}

function appendMessage(msg, animate = true, isGroupMsg = false) {
  const isSent = msg.sender_id === currentUser.id;
  const isPending = !!msg.pending;
  const isSticker = msg.content && msg.content.startsWith('[sticker]');
  const isImage = msg.content && msg.content.startsWith('[image]');
  const el = document.createElement('div');
  el.className = 'message ' + (isSent ? 'sent' : 'received') + (isPending ? ' pending' : '') + (isSticker ? ' sticker-message' : '') + (isImage ? ' image-message' : '');
  el.dataset.msgId = msg.id;
  if (!animate) el.style.animation = 'none';

  let status = '';
  if (isSent) {
    if (isPending) {
      status = '<span class="msg-status">⏳</span>';
    } else if (msg.is_read) {
      status = '<span class="msg-status read">✓✓</span>';
    } else {
      status = '<span class="msg-status">✓</span>';
    }
  }

  // Show sender name in group messages for received messages
  let senderLabel = '';
  if (isGroupMsg && !isSent && msg.sender_name) {
    senderLabel = `<div class="group-sender-name" style="font-size:11px;font-weight:600;color:${getColor(msg.sender_name)};margin-bottom:2px;">${escapeHtml(msg.sender_name)}</div>`;
  }

  if (isImage) {
    // Render image message
    const dataUrl = msg.content.substring(7); // Remove [image] prefix
    el.innerHTML = `${senderLabel}<img src="${dataUrl}" class="chat-image" alt="Hình ảnh" onclick="openImagePreview(this.src)" /><span class="time">${formatTime(msg.created_at)}${status}</span>`;
  } else if (isSticker) {
    // Render sticker as large emoji without bubble
    const stickerEmoji = msg.content.replace('[sticker]', '').trim();
    el.innerHTML = `${senderLabel}<span class="sticker-display">${stickerEmoji}</span><span class="time">${formatTime(msg.created_at)}${status}</span>`;
  } else {
    el.innerHTML = `${senderLabel}${escapeHtml(msg.content)}<span class="time">${formatTime(msg.created_at)}${status}</span>`;
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

// ---- IMAGE PREVIEW ----

function openImagePreview(src) {
  // Remove existing preview
  const existing = $('#image-preview-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'image-preview-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:pointer;';
  overlay.innerHTML = `<img src="${src}" style="max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,0.5);" />`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// Make it globally accessible
window.openImagePreview = openImagePreview;

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
    grid.classList.add('search-mode');
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
    grid.classList.remove('search-mode');
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
  if (!selectedUserId && !selectedGroupId) return;

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

  if (selectedGroupId) {
    msg.group_id = selectedGroupId;
    msg.sender_name = currentUser.display_name || currentUser.username;
    appendMessage(msg, true, true);
  } else {
    appendMessage(msg);
  }
  scrollToBottom();
  if (selectedUserId) updateUserPreview(selectedUserId, content);

  if (selectedGroupId) {
    pendingMessages.set(tempId, { content, groupId: selectedGroupId });
  } else {
    pendingMessages.set(tempId, { content, receiverId: selectedUserId });
  }
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
  if (!content || (!selectedUserId && !selectedGroupId)) return;

  // Close emoji picker if open
  emojiPickerOpen = false;
  const picker = $('#emoji-picker');
  if (picker) picker.classList.add('hidden');

  // Hide emoji suggest
  const suggest = $('#emoji-suggest');
  if (suggest) hideEmojiSuggest(suggest);

  const tempId = nextTempId--;

  if (selectedGroupId) {
    // Group message
    const msg = {
      id: tempId,
      sender_id: currentUser.id,
      group_id: selectedGroupId,
      sender_name: currentUser.display_name || currentUser.username,
      content,
      created_at: new Date().toISOString(),
      pending: true
    };
    appendMessage(msg, true, true);
    scrollToBottom();
    pendingMessages.set(tempId, { content, groupId: selectedGroupId });
    input.value = '';
    input.focus();
    sendPendingMessage(tempId);
  } else {
    // DM message
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
  }
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

// ---- IMAGE UPLOAD ----

function initImageUpload() {
  const form = $('#message-form');
  const emojiBtn = $('#emoji-btn');
  if (!form || !emojiBtn) return;

  // Create image upload button
  const imgBtn = document.createElement('button');
  imgBtn.type = 'button';
  imgBtn.id = 'image-btn';
  imgBtn.className = 'emoji-btn';
  imgBtn.title = 'Gửi hình ảnh';
  imgBtn.textContent = '📷';
  imgBtn.style.cssText = 'margin-left:0;';

  // Create hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.id = 'image-file-input';

  // Insert after emoji button
  emojiBtn.parentNode.insertBefore(imgBtn, emojiBtn.nextSibling);
  form.appendChild(fileInput);

  imgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    // Validate size < 500KB
    if (file.size > 500 * 1024) {
      alert('Hình ảnh quá lớn! Tối đa 500KB.');
      fileInput.value = '';
      return;
    }

    // Validate it's actually an image
    if (!file.type.startsWith('image/')) {
      alert('Vui lòng chọn file hình ảnh.');
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const content = '[image]' + dataUrl;

      if (!selectedUserId && !selectedGroupId) {
        alert('Vui lòng chọn người nhận trước.');
        return;
      }

      const tempId = nextTempId--;

      if (selectedGroupId) {
        const msg = {
          id: tempId,
          sender_id: currentUser.id,
          group_id: selectedGroupId,
          sender_name: currentUser.display_name || currentUser.username,
          content,
          created_at: new Date().toISOString(),
          pending: true
        };
        appendMessage(msg, true, true);
        scrollToBottom();
        pendingMessages.set(tempId, { content, groupId: selectedGroupId });
        sendPendingMessage(tempId);
      } else {
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
      }
    };
    reader.readAsDataURL(file);

    // Reset file input so same file can be selected again
    fileInput.value = '';
  });
}

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
  // Hide block button for bot
  if (userRoles[selectedUserId] === 'bot') {
    btn.classList.add('hidden');
    return;
  }
  // Hide block button in group chat
  if (selectedGroupId) {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
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

// ---- GROUP CHAT ----

async function loadGroups() {
  try {
    const res = await authFetch('/api/groups');
    if (!res.ok) return;
    const groups = await res.json();
    renderGroupList(groups);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Failed to load groups');
  }
}

function renderGroupList(groups) {
  // Remove existing group list if any
  let groupSection = $('#group-list-section');
  if (!groupSection) {
    // Create group section in sidebar, after user-list
    groupSection = document.createElement('div');
    groupSection.id = 'group-list-section';
    groupSection.className = 'group-list-section';
    const userList = $('#user-list');
    userList.parentNode.insertBefore(groupSection, userList.nextSibling);
  }

  if (!groups || groups.length === 0) {
    groupSection.innerHTML = '<div class="group-list-header"><span>Nhóm chat</span></div><p class="empty-state" style="padding:8px 16px;font-size:13px;">Chưa có nhóm nào</p>';
    return;
  }

  groupSection.innerHTML = '<div class="group-list-header"><span>Nhóm chat</span></div>';
  const list = document.createElement('div');
  list.id = 'group-list';
  list.className = 'group-list';

  groups.forEach(group => {
    const item = document.createElement('div');
    item.className = 'group-item user-item' + (group.id === selectedGroupId ? ' active' : '');
    item.dataset.groupId = group.id;
    item.dataset.groupName = group.name;

    const avatar = document.createElement('span');
    avatar.className = 'user-avatar group-avatar';
    avatar.style.background = getColor(group.name);
    avatar.textContent = '👥';

    const info = document.createElement('div');
    info.className = 'user-item-info';
    info.innerHTML = `
      <div class="user-item-name">${escapeHtml(group.name)}</div>
      <div class="user-item-preview">${group.member_count || ''} thành viên</div>
    `;

    item.appendChild(avatar);
    item.appendChild(info);
    item.addEventListener('click', () => selectGroup(group.id, group.name));
    list.appendChild(item);
  });

  groupSection.appendChild(list);
}

async function selectGroup(groupId, name) {
  selectedGroupId = groupId;
  selectedUserId = null; // Deselect DM

  // Deselect users
  $$('.user-item').forEach(item => item.classList.remove('active'));
  // Select group
  $$('.group-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.groupId) === groupId);
  });

  $('#no-chat').classList.add('hidden');
  $('#chat-box').classList.remove('hidden');
  $('#chat-with-name').textContent = name;

  // Set group avatar
  const chatAvatar = $('#chat-avatar');
  chatAvatar.style.background = getColor(name);
  chatAvatar.textContent = '👥';
  chatAvatar.className = 'user-avatar';

  const statusEl = $('#chat-status');
  statusEl.textContent = 'Nhóm chat';
  statusEl.className = 'status-text';

  // Hide block button for groups
  const blockBtn = $('#block-btn');
  if (blockBtn) blockBtn.classList.add('hidden');

  // Mobile: hide sidebar and show chat
  if (document.body.classList.contains('mobile')) {
    $('.sidebar').classList.add('sidebar-hidden');
    $('.chat-area').classList.add('chat-visible');
  }

  $('#messages').innerHTML = '';

  try {
    const res = await authFetch(`/api/groups/${groupId}/messages`);
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
      appendMessage(msg, false, true);
    });
    scrollToBottom(false);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Failed to load group messages');
  }

  $('#message-input').focus();
}

function createGroup() {
  // Build modal
  const existing = $('#create-group-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'create-group-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--bg-primary, #fff);border-radius:12px;padding:24px;min-width:300px;max-width:400px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);';

  let userCheckboxes = '';
  allUsers.forEach(u => {
    if (u.id !== currentUser.id) {
      const displayName = u.nickname || u.display_name || u.username;
      userCheckboxes += `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
          <input type="checkbox" value="${u.id}" class="group-user-cb" />
          <span>${escapeHtml(displayName)}</span>
        </label>
      `;
    }
  });

  dialog.innerHTML = `
    <h3 style="margin:0 0 16px;font-size:18px;">Tạo nhóm chat</h3>
    <input type="text" id="group-name-input" placeholder="Tên nhóm..." style="width:100%;padding:10px;border:1px solid var(--border-color, #ddd);border-radius:8px;margin-bottom:12px;background:var(--bg-secondary, #f5f5f5);color:var(--text-primary, #333);box-sizing:border-box;" />
    <div style="margin-bottom:12px;font-weight:600;font-size:14px;">Chọn thành viên:</div>
    <div style="max-height:200px;overflow-y:auto;margin-bottom:16px;">
      ${userCheckboxes || '<p style="color:#999;font-size:13px;">Không có người dùng khả dụng</p>'}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="cancel-group-btn" style="padding:8px 16px;border:1px solid var(--border-color, #ddd);border-radius:8px;background:transparent;cursor:pointer;color:var(--text-primary, #333);">Hủy</button>
      <button id="confirm-group-btn" style="padding:8px 16px;border:none;border-radius:8px;background:var(--primary, #5b5ea6);color:#fff;cursor:pointer;">Tạo nhóm</button>
    </div>
  `;

  modal.appendChild(dialog);
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  dialog.querySelector('#cancel-group-btn').addEventListener('click', () => modal.remove());

  dialog.querySelector('#confirm-group-btn').addEventListener('click', async () => {
    const name = dialog.querySelector('#group-name-input').value.trim();
    if (!name) {
      alert('Vui lòng nhập tên nhóm');
      return;
    }

    const selectedIds = [];
    dialog.querySelectorAll('.group-user-cb:checked').forEach(cb => {
      selectedIds.push(parseInt(cb.value));
    });

    if (selectedIds.length === 0) {
      alert('Vui lòng chọn ít nhất 1 thành viên');
      return;
    }

    try {
      const res = await authFetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, memberIds: selectedIds })
      });
      if (res.ok) {
        const group = await res.json();
        modal.remove();
        loadGroups();
        selectGroup(group.id, group.name);
      } else {
        const data = await res.json();
        alert(data.error || 'Không thể tạo nhóm');
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') alert('Lỗi kết nối server');
    }
  });
}

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

// ---- MOBILE RESPONSIVE ----

function initMobile() {
  // Add mobile class based on viewport
  if (window.innerWidth <= 768) {
    document.body.classList.add('mobile');
  }
  window.addEventListener('resize', () => {
    document.body.classList.toggle('mobile', window.innerWidth <= 768);
  });

  // Create hamburger button (inserted into chat-area header when mobile)
  const hamburger = document.createElement('button');
  hamburger.id = 'mobile-hamburger';
  hamburger.className = 'icon-btn mobile-only-btn';
  hamburger.title = 'Menu';
  hamburger.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
  hamburger.addEventListener('click', () => {
    $('.sidebar').classList.remove('sidebar-hidden');
    $('.chat-area').classList.remove('chat-visible');
  });

  // Insert hamburger into no-chat area
  const noChat = $('#no-chat');
  if (noChat) {
    const noChatHamburger = hamburger.cloneNode(true);
    noChatHamburger.addEventListener('click', () => {
      $('.sidebar').classList.remove('sidebar-hidden');
      $('.chat-area').classList.remove('chat-visible');
    });
    noChatHamburger.style.cssText = 'position:absolute;top:12px;left:12px;';
    noChat.style.position = 'relative';
    noChat.appendChild(noChatHamburger);
  }

  // Create back button in chat header
  const backBtn = document.createElement('button');
  backBtn.id = 'mobile-back-btn';
  backBtn.className = 'icon-btn mobile-only-btn';
  backBtn.title = 'Quay lại';
  backBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`;
  backBtn.addEventListener('click', () => {
    $('.sidebar').classList.remove('sidebar-hidden');
    $('.chat-area').classList.remove('chat-visible');
  });

  // Insert back button at the start of chat header
  const chatHeader = $('.chat-header');
  if (chatHeader) {
    chatHeader.insertBefore(backBtn, chatHeader.firstChild);
  }

  // Create "+" button for creating groups near search box
  const searchBox = $('.search-box');
  if (searchBox) {
    const createGroupBtn = document.createElement('button');
    createGroupBtn.id = 'create-group-btn';
    createGroupBtn.className = 'icon-btn';
    createGroupBtn.title = 'Tạo nhóm chat';
    createGroupBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    createGroupBtn.style.cssText = 'flex-shrink:0;margin-left:8px;';
    createGroupBtn.addEventListener('click', () => createGroup());
    searchBox.style.display = 'flex';
    searchBox.style.alignItems = 'center';
    searchBox.appendChild(createGroupBtn);
  }
}

// ---- INIT ----

initEmojiPicker();
initEmojiSuggest();
initImageUpload();
setInterval(loadUsers, 10000);
checkAuth();
initMobile();
