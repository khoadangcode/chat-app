const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// State
let currentUser = null;
let authToken = localStorage.getItem('authToken');
let selectedUserId = null;
let selectedGroupId = null;
let socket = null;
let onlineUserIds = [];
let unreadCounts = {};
let blockedUserIds = new Set();
let userRoles = {};
let allUsers = [];
let lastSeenData = {};
let replyingTo = null; // { id, senderName, content }

// Voice recording state
let mediaRecorder = null;
let voiceChunks = [];
let voiceRecording = false;
let voiceRecordTimer = null;

// Pinned messages
let pinnedMessages = [];

// Online count
let onlineCount = 0;

// Message queue for offline/pending messages
const pendingMessages = new Map();
let nextTempId = -1;

// Pagination state
let loadingOlder = false;
let hasMoreMessages = true;
let oldestMessageId = null;

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

// ---- NOTIFICATION SOUND & BROWSER NOTIFICATIONS ----

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

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showBrowserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return;
  try {
    const n = new Notification(title, { body: body.slice(0, 100), icon: '/favicon.ico' });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 5000);
  } catch {}
}

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

const FILE_ICONS = {
  'pdf': '📄', 'doc': '📝', 'docx': '📝', 'xls': '📊', 'xlsx': '📊',
  'ppt': '📊', 'pptx': '📊', 'zip': '📦', 'rar': '📦', '7z': '📦',
  'txt': '📃', 'csv': '📃', 'json': '📃', 'xml': '📃',
  'mp3': '🎵', 'wav': '🎵', 'mp4': '🎬', 'avi': '🎬', 'mov': '🎬',
  'default': '📎'
};

// ---- HELPERS ----

function getColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function createAvatar(name, isOnline, avatarUrl) {
  const el = document.createElement('span');
  el.className = 'user-avatar' + (isOnline ? ' online' : '');
  if (avatarUrl) {
    el.style.backgroundImage = `url(${avatarUrl})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  } else {
    el.style.background = getColor(name);
    el.textContent = name.charAt(0).toUpperCase();
  }
  return el;
}

function setStaticAvatar(el, name, isOnline, avatarUrl) {
  if (avatarUrl) {
    el.style.backgroundImage = `url(${avatarUrl})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundColor = 'transparent';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.style.background = getColor(name);
    el.textContent = name.charAt(0).toUpperCase();
  }
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

function mathSymbols(text) {
  return text
    .replace(/sqrt\(([^)]+)\)/gi, '√($1)')
    .replace(/sqrt/gi, '√')
    .replace(/\^2(?![0-9])/g, '²')
    .replace(/\^3(?![0-9])/g, '³')
    .replace(/\^4(?![0-9])/g, '⁴')
    .replace(/\^n(?![a-z])/gi, 'ⁿ')
    .replace(/\bDelta\b/g, 'Δ')
    .replace(/\bdelta\b/g, 'δ')
    .replace(/\bpi\b/gi, 'π')
    .replace(/\binfinity\b/gi, '∞')
    .replace(/!==/g, '≢')
    .replace(/!=/g, '≠')
    .replace(/<=/g, '≤')
    .replace(/>=/g, '≥')
    .replace(/~=/g, '≈')
    .replace(/\+-/g, '±')
    .replace(/\+\/-/g, '±')
    .replace(/->/g, '→')
    .replace(/=>/g, '⇒');
}

function renderMessageContent(text) {
  // First escape HTML to prevent XSS
  let html = escapeHtml(text);
  // Replace math text with Unicode symbols
  html = mathSymbols(html);
  // Code blocks (``` ... ```) - must be before inline code
  html = html.replace(/```([\s\S]*?)```/g, function(match, code) {
    return '<pre><code>' + code.replace(/^\n/, '') + '</code></pre>';
  });
  // Inline code (`...`)
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Bold (**...**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic (*...*)
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

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

function getFileExt(name) {
  return (name || '').split('.').pop().toLowerCase();
}

function getFileIcon(name) {
  const ext = getFileExt(name);
  return FILE_ICONS[ext] || FILE_ICONS['default'];
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
  setStaticAvatar($('#my-avatar'), myName, true, user.avatar);

  const adminBtn = $('#admin-btn');
  if (user.role === 'admin') {
    adminBtn.classList.remove('hidden');
  } else {
    adminBtn.classList.add('hidden');
  }

  requestNotificationPermission();
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
    flushPendingMessages();
  });

  socket.on('disconnect', () => {});

  let reconnectShown = false;
  socket.on('reconnect_attempt', (attempt) => {
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
      selectGroup(selectedGroupId, $('#chat-with-name').textContent);
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
    updateOnlineCount(ids.length);
  });

  socket.on('online_count', (count) => {
    updateOnlineCount(count);
  });

  socket.on('new_message', (msg) => {
    if (msg.sender_id === currentUser.id) {
      const existing = document.querySelector(`[data-msg-id="${msg.id}"]`);
      if (existing) return;
      const pendingEl = document.querySelector('.message.pending');
      if (pendingEl) return;
    }

    if (msg.sender_id !== currentUser.id) {
      playNotifSound();
      const senderName = msg.sender_display_name || msg.sender_name || 'Người dùng';
      showBrowserNotification(senderName, msg.content.startsWith('[') ? 'Gửi một tệp' : msg.content);
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

  socket.on('reaction_updated', (data) => {
    updateMessageReactions(data.messageId, data.reactions);
  });

  socket.on('messages_read', (data) => {
    const readerId = data.readBy;
    if (readerId === selectedUserId) {
      $$('.message.sent .msg-status').forEach(statusEl => {
        if (statusEl.textContent === '✓') {
          statusEl.textContent = '✓✓';
          statusEl.classList.add('read');
        }
      });
    }
  });

  socket.on('new_group_message', (msg) => {
    if (msg.sender_id !== currentUser.id) {
      playNotifSound();
      showBrowserNotification('Nhóm chat', `${msg.sender_name}: ${msg.content.startsWith('[') ? 'Gửi một tệp' : msg.content}`);
    }

    if (selectedGroupId === msg.group_id) {
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

  // --- Edit/Delete listeners ---
  socket.on('message_edited', (data) => {
    const el = document.querySelector(`[data-msg-id="${data.messageId}"]`);
    if (!el) return;
    const contentEl = el.querySelector('.msg-content');
    if (contentEl) contentEl.textContent = data.content;
    // Add edited badge
    if (!el.querySelector('.edited-badge')) {
      const badge = document.createElement('span');
      badge.className = 'edited-badge';
      badge.textContent = '(đã chỉnh sửa)';
      const timeEl = el.querySelector('.time');
      if (timeEl) timeEl.insertBefore(badge, timeEl.firstChild);
    }
  });

  socket.on('message_deleted', (data) => {
    const el = document.querySelector(`[data-msg-id="${data.messageId}"]`);
    if (!el) return;
    el.classList.add('deleted');
    const contentEl = el.querySelector('.msg-content');
    if (contentEl) contentEl.innerHTML = '<em>Tin nhắn đã bị xóa</em>';
    // Remove action buttons
    const actions = el.querySelector('.msg-actions');
    if (actions) actions.remove();
    const replyQuote = el.querySelector('.reply-quote');
    if (replyQuote) replyQuote.remove();
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
    socket.emit('send_group_message',
      { groupId: pending.groupId, content: pending.content, tempId, replyTo: pending.replyTo, fileName: pending.fileName, fileType: pending.fileType },
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
    socket.emit('send_message',
      { receiverId: pending.receiverId, content: pending.content, tempId, replyTo: pending.replyTo, fileName: pending.fileName, fileType: pending.fileType },
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
    allUsers = users;
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

    const avatar = createAvatar(user.username, isOnline, user.avatar);
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
    if (avatar) {
      avatar.classList.toggle('online', isOnline);
    }
  });
}

function updateChatHeaderStatus() {
  if (!selectedUserId) return;
  if (selectedGroupId) return;
  const isOnline = onlineUserIds.includes(selectedUserId);
  const statusEl = $('#chat-status');

  if (isOnline) {
    statusEl.textContent = 'Online';
    statusEl.className = 'status-text online';
  } else {
    const lastSeen = lastSeenData[selectedUserId];
    statusEl.textContent = lastSeen ? formatLastSeen(lastSeen) : 'Offline';
    statusEl.className = 'status-text';
  }

  const avatar = $('#chat-avatar');
  avatar.classList.toggle('online', isOnline);
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
    if (text && text.startsWith('[image]')) el.textContent = '📷 Hình ảnh';
    else if (text && text.startsWith('[file]')) el.textContent = '📎 Tệp đính kèm';
    else if (text && text.startsWith('[sticker]')) el.textContent = '🎃 Sticker';
    else if (text && text.startsWith('[voice]')) el.textContent = '🎤 Tin nhắn thoại';
    else el.textContent = (text || '').slice(0, 40);
  }
}

// ---- MESSAGES ----

async function selectUser(userId, username) {
  selectedUserId = userId;
  selectedGroupId = null;
  hasMoreMessages = true;
  oldestMessageId = null;
  clearReply();

  delete unreadCounts[userId];
  updateUnreadBadge(userId);

  $$('.user-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.userId) === userId);
  });
  $$('.group-item').forEach(item => item.classList.remove('active'));

  $('#no-chat').classList.add('hidden');
  $('#chat-box').classList.remove('hidden');
  $('#chat-with-name').textContent = username;
  const userObj = allUsers.find(u => u.id === userId);
  setStaticAvatar($('#chat-avatar'), username, onlineUserIds.includes(userId), userObj?.avatar);
  updateChatHeaderStatus();
  updateBlockButton();

  if (document.body.classList.contains('mobile')) {
    $('.sidebar').classList.add('sidebar-hidden');
    $('.chat-area').classList.add('chat-visible');
  }

  loadPinnedFromLocal();

  $('#messages').innerHTML = '';
  try {
    const res = await authFetch(`/api/messages/${userId}?limit=50`);
    const messages = await res.json();

    if (messages.length > 0) {
      oldestMessageId = messages[0].id;
      hasMoreMessages = messages.length >= 50;
    } else {
      hasMoreMessages = false;
    }

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

// ---- INFINITE SCROLL (load older messages) ----

function initInfiniteScroll() {
  const messagesEl = $('#messages');
  messagesEl.addEventListener('scroll', async () => {
    if (messagesEl.scrollTop < 80 && !loadingOlder && hasMoreMessages && oldestMessageId) {
      await loadOlderMessages();
    }
  });
}

async function loadOlderMessages() {
  loadingOlder = true;
  const messagesEl = $('#messages');
  const prevHeight = messagesEl.scrollHeight;

  try {
    let url;
    if (selectedGroupId) {
      url = `/api/groups/${selectedGroupId}/messages?before=${oldestMessageId}&limit=50`;
    } else if (selectedUserId) {
      url = `/api/messages/${selectedUserId}?before=${oldestMessageId}&limit=50`;
    } else {
      loadingOlder = false;
      return;
    }

    const res = await authFetch(url);
    const messages = await res.json();

    if (messages.length === 0) {
      hasMoreMessages = false;
      loadingOlder = false;
      return;
    }

    hasMoreMessages = messages.length >= 50;
    oldestMessageId = messages[0].id;

    const fragment = document.createDocumentFragment();
    let lastDate = '';
    messages.forEach(msg => {
      const msgDate = formatDate(msg.created_at);
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerHTML = `<span>${msgDate}</span>`;
        fragment.appendChild(divider);
      }
      const el = createMessageEl(msg, false, !!selectedGroupId);
      fragment.appendChild(el);
    });

    messagesEl.insertBefore(fragment, messagesEl.firstChild);
    // Maintain scroll position
    messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight;
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Failed to load older messages');
  }

  loadingOlder = false;
}

// ---- MESSAGE ELEMENT CREATION ----

function createMessageEl(msg, animate = true, isGroupMsg = false) {
  const isSent = msg.sender_id === currentUser.id;
  const isPending = !!msg.pending;
  const isSticker = msg.content && msg.content.startsWith('[sticker]');
  const isImage = msg.content && msg.content.startsWith('[image]');
  const isFile = msg.content && msg.content.startsWith('[file]');
  const isVoice = msg.content && msg.content.startsWith('[voice]');
  const isDeleted = msg.is_deleted;
  const isEdited = msg.is_edited;

  const el = document.createElement('div');
  el.className = 'message ' + (isSent ? 'sent' : 'received')
    + (isPending ? ' pending' : '')
    + (isSticker ? ' sticker-message' : '')
    + (isImage ? ' image-message' : '')
    + (isFile ? ' file-message' : '')
    + (isVoice ? ' voice-message' : '')
    + (isDeleted ? ' deleted' : '');
  el.dataset.msgId = msg.id;
  if (!animate) el.style.animation = 'none';

  let status = '';
  if (isSent) {
    if (isPending) status = '<span class="msg-status">⏳</span>';
    else if (msg.is_read) status = '<span class="msg-status read">✓✓</span>';
    else status = '<span class="msg-status">✓</span>';
  }

  let senderLabel = '';
  if (isGroupMsg && !isSent && msg.sender_name) {
    senderLabel = `<div class="group-sender-name" style="font-size:11px;font-weight:600;color:${getColor(msg.sender_name)};margin-bottom:2px;">${escapeHtml(msg.sender_display_name || msg.sender_name)}</div>`;
  }

  // Reply quote
  let replyHtml = '';
  if (msg.reply_to && msg.reply_content && !isDeleted) {
    const replyPreview = msg.reply_content.startsWith('[') ? 'Tệp đính kèm' : msg.reply_content.slice(0, 60);
    replyHtml = `<div class="reply-quote"><span class="reply-author">${escapeHtml(msg.reply_sender_name || 'Người dùng')}</span><span class="reply-text">${escapeHtml(replyPreview)}</span></div>`;
  }

  let editedBadge = isEdited && !isDeleted ? '<span class="edited-badge">(đã chỉnh sửa) </span>' : '';

  if (isDeleted) {
    el.innerHTML = `${senderLabel}<span class="msg-content"><em>Tin nhắn đã bị xóa</em></span><span class="time">${editedBadge}${formatTime(msg.created_at)}${status}</span>`;
  } else if (isFile) {
    const dataUrl = msg.content.substring(6);
    const fName = msg.file_name || 'file';
    const fIcon = getFileIcon(fName);
    el.innerHTML = `${senderLabel}${replyHtml}<div class="file-attachment"><span class="file-icon">${fIcon}</span><a href="${dataUrl}" download="${escapeHtml(fName)}" class="file-link">${escapeHtml(fName)}</a></div><span class="time">${editedBadge}${formatTime(msg.created_at)}${status}</span>`;
  } else if (isVoice) {
    const dataUrl = msg.content.substring(7);
    el.innerHTML = `${senderLabel}${replyHtml}<div class="voice-msg"><span class="voice-icon">🎤</span><audio controls src="${dataUrl}" preload="metadata"></audio></div><span class="time">${editedBadge}${formatTime(msg.created_at)}${status}</span>`;
  } else if (isImage) {
    const dataUrl = msg.content.substring(7);
    el.innerHTML = `${senderLabel}${replyHtml}<img src="${dataUrl}" class="chat-image" alt="Hình ảnh" onclick="openImagePreview(this.src)" /><span class="time">${editedBadge}${formatTime(msg.created_at)}${status}</span>`;
  } else if (isSticker) {
    const stickerEmoji = escapeHtml(msg.content.replace('[sticker]', '').trim());
    el.innerHTML = `${senderLabel}${replyHtml}<span class="sticker-display">${stickerEmoji}</span><span class="time">${editedBadge}${formatTime(msg.created_at)}${status}</span>`;
  } else {
    el.innerHTML = `${senderLabel}${replyHtml}<span class="msg-content">${renderMessageContent(msg.content)}</span><span class="time">${editedBadge}${formatTime(msg.created_at)}${status}</span>`;
  }

  if (!isDeleted) {
    // Action buttons (reply, edit, delete)
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'msg-actions';

    // Reply button
    const replyBtn = document.createElement('button');
    replyBtn.className = 'msg-action-btn';
    replyBtn.title = 'Trả lời';
    replyBtn.innerHTML = '↩';
    replyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setReply(msg);
    });
    actionsDiv.appendChild(replyBtn);

    // Pin button
    const pinBtn = document.createElement('button');
    pinBtn.className = 'msg-action-btn';
    pinBtn.title = 'Ghim tin nhắn';
    pinBtn.innerHTML = '📌';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pinMessage(msg);
    });
    actionsDiv.appendChild(pinBtn);

    if (isSent && !isSticker && !isImage && !isFile) {
      // Edit button
      const editBtn = document.createElement('button');
      editBtn.className = 'msg-action-btn';
      editBtn.title = 'Chỉnh sửa';
      editBtn.innerHTML = '✏️';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startEditMessage(el, msg);
      });
      actionsDiv.appendChild(editBtn);
    }

    if (isSent) {
      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'msg-action-btn';
      delBtn.title = 'Xóa';
      delBtn.innerHTML = '🗑️';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMessage(msg.id);
      });
      actionsDiv.appendChild(delBtn);
    }

    el.appendChild(actionsDiv);

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
  }

  // Reactions container
  const reactionsContainer = document.createElement('div');
  reactionsContainer.className = 'reactions-container';
  reactionsContainer.dataset.reactionsFor = msg.id;
  el.appendChild(reactionsContainer);

  if (msg.reactions && msg.reactions.length > 0) {
    renderReactions(reactionsContainer, msg.id, msg.reactions);
  }

  return el;
}

function appendMessage(msg, animate = true, isGroupMsg = false) {
  const el = createMessageEl(msg, animate, isGroupMsg);
  $('#messages').appendChild(el);
}

// ---- REPLY ----

function setReply(msg) {
  replyingTo = { id: msg.id, senderName: msg.sender_display_name || msg.sender_name || 'Người dùng', content: msg.content };
  const bar = $('#reply-bar');
  bar.classList.remove('hidden');
  bar.querySelector('.reply-bar-name').textContent = replyingTo.senderName;
  const preview = msg.content.startsWith('[') ? 'Tệp đính kèm' : msg.content.slice(0, 60);
  bar.querySelector('.reply-bar-text').textContent = preview;
  $('#message-input').focus();
}

function clearReply() {
  replyingTo = null;
  const bar = $('#reply-bar');
  if (bar) bar.classList.add('hidden');
}

// ---- EDIT MESSAGE ----

function startEditMessage(el, msg) {
  const contentEl = el.querySelector('.msg-content');
  if (!contentEl) return;
  const originalText = msg.content;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-msg-input';
  input.value = originalText;
  input.maxLength = 2000;

  contentEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = (save) => {
    const newContent = input.value.trim();
    if (save && newContent && newContent !== originalText) {
      socket.emit('edit_message', { messageId: msg.id, content: newContent, isGroup: !!selectedGroupId });
      const span = document.createElement('span');
      span.className = 'msg-content';
      span.textContent = newContent;
      input.replaceWith(span);
    } else {
      const span = document.createElement('span');
      span.className = 'msg-content';
      span.textContent = originalText;
      input.replaceWith(span);
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// ---- DELETE MESSAGE ----

function deleteMessage(messageId) {
  if (!confirm('Xóa tin nhắn này?')) return;
  socket.emit('delete_message', { messageId, isGroup: !!selectedGroupId });
}

// ---- IMAGE PREVIEW ----

function openImagePreview(src) {
  const existing = $('#image-preview-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'image-preview-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:pointer;';
  overlay.innerHTML = `<img src="${src}" style="max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,0.5);" />`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}
window.openImagePreview = openImagePreview;

// ---- REACTIONS ----

function showReactionPicker(messageEl, messageId) {
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
let currentEmojiTab = 'emoji';

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

  document.addEventListener('click', (e) => {
    if (emojiPickerOpen && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPickerOpen = false;
      emojiPicker.classList.add('hidden');
    }
  });

  emojiPicker.addEventListener('click', (e) => {
    if (e.target.classList.contains('emoji-tab')) {
      currentEmojiTab = e.target.dataset.tab;
      $$('.emoji-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentEmojiTab));
      renderEmojiPickerContent();
    }
  });

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
    const matchedFromKeywords = new Set();
    Object.entries(EMOJI_KEYWORDS).forEach(([keyword, emojis]) => {
      if (keyword.includes(searchQuery)) emojis.forEach(e => matchedFromKeywords.add(e));
    });
    Object.entries(EMOJI_DATA).forEach(([category, emojis]) => {
      if (category.toLowerCase().includes(searchQuery)) emojis.forEach(e => matchedFromKeywords.add(e));
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
    const match = textBeforeCursor.match(/:([a-zA-Z\u00C0-\u024F]+)$/);

    if (match) {
      const keyword = match[1].toLowerCase()
        .replace(/[àáảãạăắằẳẵặâấầẩẫậ]/g, 'a')
        .replace(/[èéẻẽẹêếềểễệ]/g, 'e')
        .replace(/[ìíỉĩị]/g, 'i')
        .replace(/[òóỏõọôốồổỗộơớờởỡợ]/g, 'o')
        .replace(/[ùúủũụưứừửữự]/g, 'u')
        .replace(/[ỳýỷỹỵ]/g, 'y')
        .replace(/đ/g, 'd');

      const matches = [];
      Object.entries(EMOJI_KEYWORDS).forEach(([key, emojis]) => {
        if (key.includes(keyword)) emojis.forEach(e => { if (!matches.includes(e)) matches.push(e); });
      });

      if (matches.length > 0) {
        showEmojiSuggest(suggest, matches.slice(0, 12), match[0], cursorPos);
        return;
      }
    }
    hideEmojiSuggest(suggest);
  });

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
      e.preventDefault();
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
  const hasImages = pendingImages.length > 0;
  if (!content && !hasImages) return;
  if (!selectedUserId && !selectedGroupId) return;

  emojiPickerOpen = false;
  const picker = $('#emoji-picker');
  if (picker) picker.classList.add('hidden');
  const suggest = $('#emoji-suggest');
  if (suggest) hideEmojiSuggest(suggest);

  // Send pending images first
  if (hasImages) {
    sendPendingImages();
  }

  // Then send text message if any
  if (content) {
    const tempId = nextTempId--;
    const replyTo = replyingTo ? replyingTo.id : null;
    const replyContent = replyingTo ? replyingTo.content : null;
    const replySenderName = replyingTo ? replyingTo.senderName : null;

    if (selectedGroupId) {
      const msg = {
        id: tempId,
        sender_id: currentUser.id,
        group_id: selectedGroupId,
        sender_name: currentUser.display_name || currentUser.username,
        content,
        created_at: new Date().toISOString(),
        pending: true,
        reply_to: replyTo,
        reply_content: replyContent,
        reply_sender_name: replySenderName
      };
      appendMessage(msg, true, true);
      scrollToBottom();
      pendingMessages.set(tempId, { content, groupId: selectedGroupId, replyTo });
      sendPendingMessage(tempId);
    } else {
      const msg = {
        id: tempId,
        sender_id: currentUser.id,
        receiver_id: selectedUserId,
        content,
        created_at: new Date().toISOString(),
        pending: true,
        reply_to: replyTo,
        reply_content: replyContent,
        reply_sender_name: replySenderName
      };
      appendMessage(msg);
      scrollToBottom();
      updateUserPreview(selectedUserId, content);
      pendingMessages.set(tempId, { content, receiverId: selectedUserId, replyTo });
      sendPendingMessage(tempId);
    }
  }

  input.value = '';
  input.focus();
  clearReply();
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

  const imgBtn = document.createElement('button');
  imgBtn.type = 'button';
  imgBtn.id = 'image-btn';
  imgBtn.className = 'emoji-btn';
  imgBtn.title = 'Gửi hình ảnh';
  imgBtn.textContent = '📷';
  imgBtn.style.cssText = 'margin-left:0;';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.id = 'image-file-input';

  emojiBtn.parentNode.insertBefore(imgBtn, emojiBtn.nextSibling);
  form.appendChild(fileInput);

  imgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Vui lòng chọn file hình ảnh.');
      fileInput.value = '';
      return;
    }
    if (!selectedUserId && !selectedGroupId) { alert('Vui lòng chọn người nhận trước.'); fileInput.value = ''; return; }

    compressImage(file).then(dataUrl => {
      pendingImages.push(dataUrl);
      renderImagePreview();
      $('#message-input').focus();
    });
    fileInput.value = '';
  });
}

// ---- AUTO COMPRESS IMAGE ----
function compressImage(file, maxSizeKB = 450, maxDimension = 1200) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      // Scale down if too large
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Try decreasing quality until under maxSizeKB
      let quality = 0.8;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > maxSizeKB * 1370 && quality > 0.1) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      // If still too large, scale down more
      if (dataUrl.length > maxSizeKB * 1370) {
        const ratio = 0.6;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL('image/jpeg', 0.5);
      }

      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Fallback: read as-is
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}

// ---- CLIPBOARD PASTE IMAGE (with preview, multi-image support) ----

let pendingImages = []; // Array of dataUrl strings waiting to be sent

function initClipboardPaste() {
  const chatBox = $('#chat-box');
  const messageInput = $('#message-input');
  if (!chatBox || !messageInput) return;

  function handlePasteImage(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    let imageFile = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageFile = items[i].getAsFile();
        break;
      }
    }
    if (!imageFile) return;

    // Prevent default so the image blob isn't inserted as text
    e.preventDefault();

    if (!selectedUserId && !selectedGroupId) {
      alert('Vui lòng chọn người nhận trước.');
      return;
    }

    compressImage(imageFile).then(dataUrl => {
      pendingImages.push(dataUrl);
      renderImagePreview();
      messageInput.focus();
    });
  }

  // Listen on the input field (Ctrl+V while typing)
  messageInput.addEventListener('paste', handlePasteImage);

  // Also listen on the entire chat-box area so paste works even when
  // the input is not focused (e.g. after scrolling through messages)
  chatBox.addEventListener('paste', (e) => {
    // Avoid double-fire when the event bubbles from messageInput
    if (e.target === messageInput) return;
    handlePasteImage(e);
  });
}

function renderImagePreview() {
  let container = $('#image-preview-bar');
  if (!container) {
    container = document.createElement('div');
    container.id = 'image-preview-bar';
    const form = $('#message-form');
    form.parentNode.insertBefore(container, form);
  }

  container.innerHTML = '';
  if (pendingImages.length === 0) {
    container.remove();
    return;
  }

  pendingImages.forEach((dataUrl, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'image-preview-item';
    wrapper.innerHTML = `<img src="${dataUrl}" alt="Preview" /><button class="image-preview-remove" data-idx="${idx}" title="Xóa ảnh">✕</button>`;
    container.appendChild(wrapper);
  });

  // Remove button handlers
  container.querySelectorAll('.image-preview-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      pendingImages.splice(idx, 1);
      renderImagePreview();
    });
  });
}

function sendPendingImages() {
  const images = [...pendingImages];
  pendingImages = [];
  renderImagePreview();

  for (const dataUrl of images) {
    const content = '[image]' + dataUrl;
    const tempId = nextTempId--;
    if (selectedGroupId) {
      const msg = { id: tempId, sender_id: currentUser.id, group_id: selectedGroupId, sender_name: currentUser.display_name || currentUser.username, content, created_at: new Date().toISOString(), pending: true };
      appendMessage(msg, true, true);
      scrollToBottom();
      pendingMessages.set(tempId, { content, groupId: selectedGroupId });
      sendPendingMessage(tempId);
    } else {
      const msg = { id: tempId, sender_id: currentUser.id, receiver_id: selectedUserId, content, created_at: new Date().toISOString(), pending: true };
      appendMessage(msg);
      scrollToBottom();
      updateUserPreview(selectedUserId, content);
      pendingMessages.set(tempId, { content, receiverId: selectedUserId });
      sendPendingMessage(tempId);
    }
  }
}

function showPasteToast(fileName) {
  // Remove any existing toast
  const old = $('#paste-toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.id = 'paste-toast';
  toast.textContent = '📷 Đang gửi ảnh từ clipboard...';
  toast.style.cssText =
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
    'background:var(--primary,#5b5ea6);color:#fff;padding:8px 18px;' +
    'border-radius:20px;font-size:13px;z-index:9999;opacity:1;' +
    'transition:opacity 0.4s ease;box-shadow:0 2px 12px rgba(0,0,0,0.2);' +
    'pointer-events:none;';
  document.body.appendChild(toast);

  setTimeout(() => { toast.style.opacity = '0'; }, 1500);
  setTimeout(() => { toast.remove(); }, 2000);
}

// ---- FILE UPLOAD ----

function initFileUpload() {
  const form = $('#message-form');
  const imgBtn = $('#image-btn');
  if (!form) return;

  const fileBtn = document.createElement('button');
  fileBtn.type = 'button';
  fileBtn.id = 'file-btn';
  fileBtn.className = 'emoji-btn';
  fileBtn.title = 'Gửi tệp';
  fileBtn.textContent = '📎';
  fileBtn.style.cssText = 'margin-left:0;';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.txt,.csv,.json,.xml,.mp3,.wav,.mp4';
  fileInput.style.display = 'none';
  fileInput.id = 'general-file-input';

  const insertAfter = imgBtn || $('#emoji-btn');
  if (insertAfter) insertAfter.parentNode.insertBefore(fileBtn, insertAfter.nextSibling);
  form.appendChild(fileInput);

  fileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('Tệp quá lớn! Tối đa 2MB.');
      fileInput.value = '';
      return;
    }
    if (!selectedUserId && !selectedGroupId) { alert('Vui lòng chọn người nhận trước.'); fileInput.value = ''; return; }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const content = '[file]' + dataUrl;
      const tempId = nextTempId--;

      if (selectedGroupId) {
        const msg = { id: tempId, sender_id: currentUser.id, group_id: selectedGroupId, sender_name: currentUser.display_name || currentUser.username, content, created_at: new Date().toISOString(), pending: true, file_name: file.name, file_type: file.type };
        appendMessage(msg, true, true);
        scrollToBottom();
        pendingMessages.set(tempId, { content, groupId: selectedGroupId, fileName: file.name, fileType: file.type });
        sendPendingMessage(tempId);
      } else {
        const msg = { id: tempId, sender_id: currentUser.id, receiver_id: selectedUserId, content, created_at: new Date().toISOString(), pending: true, file_name: file.name, file_type: file.type };
        appendMessage(msg);
        scrollToBottom();
        updateUserPreview(selectedUserId, content);
        pendingMessages.set(tempId, { content, receiverId: selectedUserId, fileName: file.name, fileType: file.type });
        sendPendingMessage(tempId);
      }
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
  });
}

// ---- MESSAGE SEARCH ----

function initMessageSearch() {
  const searchBtn = $('#msg-search-btn');
  const searchBar = $('#msg-search-bar');
  const searchInput = $('#msg-search-input');
  const closeBtn = $('#msg-search-close');
  const resultsDiv = $('#msg-search-results');

  if (!searchBtn) return;

  searchBtn.addEventListener('click', () => {
    searchBar.classList.toggle('hidden');
    if (!searchBar.classList.contains('hidden')) {
      searchInput.focus();
      searchInput.value = '';
      resultsDiv.innerHTML = '';
    }
  });

  closeBtn.addEventListener('click', () => {
    searchBar.classList.add('hidden');
    resultsDiv.innerHTML = '';
    searchInput.value = '';
  });

  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doMessageSearch(searchInput.value.trim()), 400);
  });
}

async function doMessageSearch(query) {
  const resultsDiv = $('#msg-search-results');
  if (!query || query.length < 2) { resultsDiv.innerHTML = ''; return; }

  try {
    let url;
    if (selectedGroupId) {
      url = `/api/groups/${selectedGroupId}/messages/search?q=${encodeURIComponent(query)}`;
    } else if (selectedUserId) {
      url = `/api/messages/search/${selectedUserId}?q=${encodeURIComponent(query)}`;
    } else return;

    const res = await authFetch(url);
    const messages = await res.json();

    if (messages.length === 0) {
      resultsDiv.innerHTML = '<div class="search-no-result">Không tìm thấy</div>';
      return;
    }

    resultsDiv.innerHTML = '';
    messages.forEach(msg => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const sender = msg.sender_display_name || msg.sender_name || 'Người dùng';
      item.innerHTML = `<span class="search-result-sender">${escapeHtml(sender)}</span><span class="search-result-text">${escapeHtml(msg.content.slice(0, 80))}</span><span class="search-result-time">${formatDate(msg.created_at)} ${formatTime(msg.created_at)}</span>`;
      item.addEventListener('click', () => {
        // Scroll to message if visible
        const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight');
          setTimeout(() => el.classList.remove('highlight'), 2000);
        }
      });
      resultsDiv.appendChild(item);
    });
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('Search failed');
  }
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
  if (userRoles[selectedUserId] === 'bot') { btn.classList.add('hidden'); return; }
  if (selectedGroupId) { btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  const isBlocked = blockedUserIds.has(selectedUserId);
  const textEl = btn.querySelector('.block-btn-text');
  if (textEl) textEl.textContent = isBlocked ? 'Bỏ chặn' : 'Chặn';
  btn.classList.toggle('blocked', isBlocked);
}

async function blockUser(userId) {
  try {
    const res = await authFetch(`/api/block/${userId}`, { method: 'POST' });
    if (res.ok) { blockedUserIds.add(userId); updateBlockButton(); loadBlockedUsers(); loadUsers(); }
    else { const data = await res.json(); alert(data.error || 'Không thể chặn người dùng'); }
  } catch (err) { if (err.message !== 'Unauthorized') alert('Lỗi kết nối server'); }
}

async function unblockUser(userId) {
  try {
    const res = await authFetch(`/api/block/${userId}`, { method: 'DELETE' });
    if (res.ok) { blockedUserIds.delete(userId); updateBlockButton(); loadBlockedUsers(); loadUsers(); }
    else { const data = await res.json(); alert(data.error || 'Không thể bỏ chặn người dùng'); }
  } catch (err) { if (err.message !== 'Unauthorized') alert('Lỗi kết nối server'); }
}

$('#block-btn').addEventListener('click', () => {
  if (!selectedUserId) return;
  if (blockedUserIds.has(selectedUserId)) unblockUser(selectedUserId);
  else blockUser(selectedUserId);
});

$('#blocked-users-btn').addEventListener('click', () => {
  const section = $('#blocked-users-section');
  section.classList.toggle('hidden');
  if (!section.classList.contains('hidden')) loadBlockedUsers();
});

$('#close-blocked-section').addEventListener('click', () => {
  $('#blocked-users-section').classList.add('hidden');
});

// ---- PROFILE ----

function initProfile() {
  const profileBtn = $('#profile-btn');
  if (!profileBtn) return;

  profileBtn.addEventListener('click', () => {
    showProfileModal();
  });
}

function showProfileModal() {
  const existing = $('#profile-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'profile-modal';
  modal.className = 'modal-overlay';

  const avatarSrc = currentUser.avatar || '';
  const displayName = currentUser.display_name || '';

  modal.innerHTML = `
    <div class="modal">
      <h3>Hồ sơ cá nhân</h3>
      <div style="text-align:center;margin-bottom:16px;">
        <div id="profile-avatar-preview" class="profile-avatar-preview" style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:32px;color:#fff;cursor:pointer;background:${avatarSrc ? `url(${avatarSrc}) center/cover` : getColor(currentUser.username)};box-shadow:0 2px 12px rgba(0,0,0,0.15);">${avatarSrc ? '' : currentUser.username.charAt(0).toUpperCase()}</div>
        <input type="file" id="profile-avatar-input" accept="image/*" style="display:none;" />
        <button id="profile-change-avatar" style="font-size:12px;background:none;border:1px solid var(--border);padding:4px 12px;border-radius:8px;cursor:pointer;color:var(--text);">Đổi ảnh đại diện</button>
        <button id="profile-remove-avatar" style="font-size:12px;background:none;border:1px solid var(--danger);padding:4px 12px;border-radius:8px;cursor:pointer;color:var(--danger);margin-left:6px;${avatarSrc ? '' : 'display:none;'}">Xóa ảnh</button>
      </div>
      <label style="font-size:13px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Tên hiển thị</label>
      <input type="text" id="profile-display-name" value="${escapeHtml(displayName)}" placeholder="Nhập tên hiển thị..." style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;background:var(--bg);color:var(--text);box-sizing:border-box;" />
      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn-cancel" id="profile-cancel">Hủy</button>
        <button class="btn-primary" id="profile-save">Lưu</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let newAvatar = currentUser.avatar || null;

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#profile-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#profile-change-avatar').addEventListener('click', () => modal.querySelector('#profile-avatar-input').click());
  modal.querySelector('#profile-remove-avatar').addEventListener('click', () => {
    newAvatar = null;
    const preview = modal.querySelector('#profile-avatar-preview');
    preview.style.backgroundImage = '';
    preview.style.background = getColor(currentUser.username);
    preview.textContent = currentUser.username.charAt(0).toUpperCase();
    modal.querySelector('#profile-remove-avatar').style.display = 'none';
  });

  modal.querySelector('#profile-avatar-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 150 * 1024) { alert('Ảnh quá lớn (tối đa 150KB)'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      newAvatar = ev.target.result;
      const preview = modal.querySelector('#profile-avatar-preview');
      preview.style.backgroundImage = `url(${newAvatar})`;
      preview.style.backgroundSize = 'cover';
      preview.style.backgroundPosition = 'center';
      preview.textContent = '';
      modal.querySelector('#profile-remove-avatar').style.display = '';
    };
    reader.readAsDataURL(file);
  });

  modal.querySelector('#profile-save').addEventListener('click', async () => {
    const displayName = modal.querySelector('#profile-display-name').value.trim();
    try {
      const res = await authFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, avatar: newAvatar })
      });
      if (res.ok) {
        const updated = await res.json();
        currentUser.display_name = updated.display_name;
        currentUser.avatar = updated.avatar;
        const myName = updated.display_name || currentUser.username;
        $('#my-username').textContent = myName;
        setStaticAvatar($('#my-avatar'), myName, true, updated.avatar);
        modal.remove();
      } else {
        const d = await res.json();
        alert(d.error || 'Lỗi cập nhật hồ sơ');
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') alert('Lỗi kết nối server');
    }
  });
}

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
  let groupSection = $('#group-list-section');
  if (!groupSection) {
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
  selectedUserId = null;
  hasMoreMessages = true;
  oldestMessageId = null;
  clearReply();

  $$('.user-item').forEach(item => item.classList.remove('active'));
  $$('.group-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.groupId) === groupId);
  });

  $('#no-chat').classList.add('hidden');
  $('#chat-box').classList.remove('hidden');
  $('#chat-with-name').textContent = name;

  const chatAvatar = $('#chat-avatar');
  chatAvatar.style.backgroundImage = '';
  chatAvatar.style.background = getColor(name);
  chatAvatar.textContent = '👥';
  chatAvatar.className = 'user-avatar';

  const statusEl = $('#chat-status');
  statusEl.textContent = 'Nhóm chat';
  statusEl.className = 'status-text';

  const blockBtn = $('#block-btn');
  if (blockBtn) blockBtn.classList.add('hidden');

  if (document.body.classList.contains('mobile')) {
    $('.sidebar').classList.add('sidebar-hidden');
    $('.chat-area').classList.add('chat-visible');
  }

  loadPinnedFromLocal();

  $('#messages').innerHTML = '';

  try {
    const res = await authFetch(`/api/groups/${groupId}/messages?limit=50`);
    const messages = await res.json();

    if (messages.length > 0) {
      oldestMessageId = messages[0].id;
      hasMoreMessages = messages.length >= 50;
    } else {
      hasMoreMessages = false;
    }

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
  const existing = $('#create-group-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'create-group-modal';
  modal.className = 'modal-overlay';

  let userCheckboxes = '';
  allUsers.forEach(u => {
    if (u.id !== currentUser.id && u.role !== 'bot') {
      const displayName = u.nickname || u.display_name || u.username;
      userCheckboxes += `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;"><input type="checkbox" value="${u.id}" class="group-user-cb" /><span>${escapeHtml(displayName)}</span></label>`;
    }
  });

  modal.innerHTML = `
    <div class="modal">
      <h3>Tạo nhóm chat</h3>
      <input type="text" id="group-name-input" placeholder="Tên nhóm..." />
      <div style="margin-bottom:12px;font-weight:600;font-size:14px;">Chọn thành viên:</div>
      <div style="max-height:200px;overflow-y:auto;margin-bottom:16px;">${userCheckboxes || '<p style="color:#999;font-size:13px;">Không có người dùng khả dụng</p>'}</div>
      <div class="modal-actions">
        <button class="btn-cancel" id="cancel-group-btn">Hủy</button>
        <button class="btn-primary" id="confirm-group-btn">Tạo nhóm</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#cancel-group-btn').addEventListener('click', () => modal.remove());

  modal.querySelector('#confirm-group-btn').addEventListener('click', async () => {
    const name = modal.querySelector('#group-name-input').value.trim();
    if (!name) { alert('Vui lòng nhập tên nhóm'); return; }
    const selectedIds = [];
    modal.querySelectorAll('.group-user-cb:checked').forEach(cb => selectedIds.push(parseInt(cb.value)));
    if (selectedIds.length === 0) { alert('Vui lòng chọn ít nhất 1 thành viên'); return; }

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

$('#admin-refresh-btn')?.addEventListener('click', () => {
  loadAdminStats();
  loadAdminUsers();
  const btn = $('#admin-refresh-btn');
  if (btn) {
    btn.classList.add('spinning');
    setTimeout(() => btn.classList.remove('spinning'), 600);
  }
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

let allAdminUsers = [];

function renderAdminUsers(users) {
  allAdminUsers = users || [];
  const tbody = $('#admin-users-tbody');
  const noUsers = $('#admin-no-users');

  // Init search filter if not done
  let searchInput = $('#admin-user-search');
  if (!searchInput) {
    const wrap = $('.admin-table-wrap');
    if (wrap) {
      const searchDiv = document.createElement('div');
      searchDiv.className = 'admin-search-bar';
      searchDiv.innerHTML = '<input type="text" id="admin-user-search" placeholder="Tìm kiếm người dùng..." />';
      const h3 = wrap.querySelector('h3');
      if (h3) h3.after(searchDiv);
      searchInput = searchDiv.querySelector('#admin-user-search');
      searchInput.addEventListener('input', () => {
        filterAdminUsers(searchInput.value.trim().toLowerCase());
      });
    }
  }

  renderAdminUserRows(users);
}

function filterAdminUsers(query) {
  if (!query) { renderAdminUserRows(allAdminUsers); return; }
  const filtered = allAdminUsers.filter(u =>
    u.username.toLowerCase().includes(query) ||
    (u.display_name || '').toLowerCase().includes(query) ||
    (u.role || '').toLowerCase().includes(query)
  );
  renderAdminUserRows(filtered);
}

function renderAdminUserRows(users) {
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
      if (user.is_banned) actions += `<button class="admin-action-btn unban-btn" data-user-id="${user.id}">Bỏ cấm</button>`;
      else actions += `<button class="admin-action-btn ban-btn" data-user-id="${user.id}">Cấm</button>`;
      if (user.role === 'admin') actions += `<button class="admin-action-btn role-btn" data-user-id="${user.id}" data-role="user">Hạ quyền</button>`;
      else actions += `<button class="admin-action-btn role-btn" data-user-id="${user.id}" data-role="admin">Nâng quyền</button>`;
      actions += `<button class="admin-action-btn delete-btn" data-user-id="${user.id}">Xoá</button>`;
    } else {
      actions = '<span class="admin-self-label">Bạn</span>';
    }

    const displayName = user.display_name || user.username;
    tr.innerHTML = `<td>${escapeHtml(user.username)}</td><td>${escapeHtml(displayName)}</td><td>${roleBadge}</td><td>${statusBadge}</td><td>${user.message_count || 0}</td><td class="admin-actions">${actions}</td>`;
    tbody.appendChild(tr);

    if (!isSelf) {
      const banBtn = tr.querySelector('.ban-btn');
      if (banBtn) banBtn.addEventListener('click', () => adminBanUser(user.id));
      const unbanBtn = tr.querySelector('.unban-btn');
      if (unbanBtn) unbanBtn.addEventListener('click', () => adminUnbanUser(user.id));
      const roleBtn = tr.querySelector('.role-btn');
      if (roleBtn) roleBtn.addEventListener('click', () => adminChangeRole(user.id, roleBtn.dataset.role));
      const deleteBtn = tr.querySelector('.delete-btn');
      if (deleteBtn) deleteBtn.addEventListener('click', () => adminDeleteUser(user.id, user.username));
    }
  });
}

async function adminBanUser(userId) {
  try {
    const res = await authFetch(`/api/admin/ban/${userId}`, { method: 'POST' });
    if (res.ok) { loadAdminStats(); loadAdminUsers(); loadUsers(); }
    else { const d = await res.json(); alert(d.error); }
  } catch (err) { if (err.message !== 'Unauthorized') alert('Lỗi kết nối server'); }
}

async function adminUnbanUser(userId) {
  try {
    const res = await authFetch(`/api/admin/unban/${userId}`, { method: 'POST' });
    if (res.ok) { loadAdminStats(); loadAdminUsers(); loadUsers(); }
    else { const d = await res.json(); alert(d.error); }
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
    else { const d = await res.json(); alert(d.error); }
  } catch (err) { if (err.message !== 'Unauthorized') alert('Lỗi kết nối server'); }
}

async function adminDeleteUser(userId, username) {
  if (!confirm(`Xoá người dùng "${username}"? Không thể hoàn tác.`)) return;
  try {
    const res = await authFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      if (selectedUserId === userId) { selectedUserId = null; $('#chat-box').classList.add('hidden'); $('#no-chat').classList.remove('hidden'); }
      loadAdminStats(); loadAdminUsers(); loadUsers();
    } else { const d = await res.json(); alert(d.error); }
  } catch (err) { if (err.message !== 'Unauthorized') alert('Lỗi kết nối server'); }
}

// ---- MOBILE RESPONSIVE ----

function initMobile() {
  if (window.innerWidth <= 768) document.body.classList.add('mobile');
  window.addEventListener('resize', () => {
    document.body.classList.toggle('mobile', window.innerWidth <= 768);
  });

  const hamburger = document.createElement('button');
  hamburger.id = 'mobile-hamburger';
  hamburger.className = 'icon-btn mobile-only-btn';
  hamburger.title = 'Menu';
  hamburger.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
  hamburger.addEventListener('click', () => {
    $('.sidebar').classList.remove('sidebar-hidden');
    $('.chat-area').classList.remove('chat-visible');
  });

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

  const backBtn = document.createElement('button');
  backBtn.id = 'mobile-back-btn';
  backBtn.className = 'icon-btn mobile-only-btn';
  backBtn.title = 'Quay lại';
  backBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`;
  backBtn.addEventListener('click', () => {
    $('.sidebar').classList.remove('sidebar-hidden');
    $('.chat-area').classList.remove('chat-visible');
  });

  const chatHeader = $('.chat-header');
  if (chatHeader) chatHeader.insertBefore(backBtn, chatHeader.firstChild);

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

// ---- VOICE RECORDING ----

function initVoiceRecording() {
  const form = $('#message-form');
  const fileBtn = $('#file-btn');
  if (!form) return;

  const voiceBtn = document.createElement('button');
  voiceBtn.type = 'button';
  voiceBtn.id = 'voice-btn';
  voiceBtn.className = 'emoji-btn voice-btn';
  voiceBtn.title = 'Tin nhắn thoại';
  voiceBtn.textContent = '🎤';
  voiceBtn.style.cssText = 'margin-left:0;';

  const insertAfter = fileBtn || $('#image-btn') || $('#emoji-btn');
  if (insertAfter) insertAfter.parentNode.insertBefore(voiceBtn, insertAfter.nextSibling);

  voiceBtn.addEventListener('click', async () => {
    if (voiceRecording) {
      stopVoiceRecording();
    } else {
      await startVoiceRecording();
    }
  });
}

async function startVoiceRecording() {
  if (!selectedUserId && !selectedGroupId) { alert('Vui lòng chọn người nhận trước.'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    voiceChunks = [];
    voiceRecording = true;

    const voiceBtn = $('#voice-btn');
    if (voiceBtn) voiceBtn.classList.add('recording');

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) voiceChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      voiceRecording = false;
      const voiceBtn = $('#voice-btn');
      if (voiceBtn) voiceBtn.classList.remove('recording');
      clearTimeout(voiceRecordTimer);

      const blob = new Blob(voiceChunks, { type: 'audio/webm' });
      if (blob.size < 500) return; // too short, ignore

      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        const content = '[voice]' + dataUrl;
        const tempId = nextTempId--;

        if (selectedGroupId) {
          const msg = { id: tempId, sender_id: currentUser.id, group_id: selectedGroupId, sender_name: currentUser.display_name || currentUser.username, content, created_at: new Date().toISOString(), pending: true };
          appendMessage(msg, true, true);
          scrollToBottom();
          pendingMessages.set(tempId, { content, groupId: selectedGroupId });
          sendPendingMessage(tempId);
        } else {
          const msg = { id: tempId, sender_id: currentUser.id, receiver_id: selectedUserId, content, created_at: new Date().toISOString(), pending: true };
          appendMessage(msg);
          scrollToBottom();
          updateUserPreview(selectedUserId, content);
          pendingMessages.set(tempId, { content, receiverId: selectedUserId });
          sendPendingMessage(tempId);
        }
      };
      reader.readAsDataURL(blob);
    };

    mediaRecorder.start();
    // Auto-stop after 60 seconds
    voiceRecordTimer = setTimeout(() => {
      if (voiceRecording) stopVoiceRecording();
    }, 60000);
  } catch (err) {
    alert('Không thể truy cập micro. Vui lòng cấp quyền.');
    voiceRecording = false;
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

// ---- PIN MESSAGES ----

async function pinMessage(msg) {
  try {
    const res = await authFetch('/api/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId: msg.id,
        content: msg.content,
        senderName: msg.sender_display_name || msg.sender_name || (msg.sender_id === currentUser.id ? (currentUser.display_name || currentUser.username) : 'User'),
        chatUserId: selectedUserId,
        groupId: selectedGroupId
      })
    });
    if (res.ok) {
      const pinned = { id: msg.id, content: msg.content, senderName: msg.sender_display_name || msg.sender_name || 'User' };
      if (!pinnedMessages.find(p => p.id === pinned.id)) {
        pinnedMessages.push(pinned);
      }
      renderPinnedBar();
    }
  } catch (err) {
    // If backend doesn't have /api/pin, store locally
    const pinned = { id: msg.id, content: msg.content, senderName: msg.sender_display_name || msg.sender_name || 'User' };
    if (!pinnedMessages.find(p => p.id === pinned.id)) {
      pinnedMessages.push(pinned);
    }
    savePinnedToLocal();
    renderPinnedBar();
  }
}

function unpinMessage(msgId) {
  pinnedMessages = pinnedMessages.filter(p => p.id !== msgId);
  savePinnedToLocal();
  renderPinnedBar();
}

function savePinnedToLocal() {
  const key = selectedGroupId ? `pinned_group_${selectedGroupId}` : `pinned_user_${selectedUserId}`;
  localStorage.setItem(key, JSON.stringify(pinnedMessages));
}

function loadPinnedFromLocal() {
  const key = selectedGroupId ? `pinned_group_${selectedGroupId}` : `pinned_user_${selectedUserId}`;
  try {
    pinnedMessages = JSON.parse(localStorage.getItem(key)) || [];
  } catch { pinnedMessages = []; }
  renderPinnedBar();
}

function renderPinnedBar() {
  let bar = $('#pinned-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pinned-bar';
    bar.className = 'pinned-bar hidden';
    const chatHeader = $('.chat-header');
    if (chatHeader) chatHeader.parentNode.insertBefore(bar, chatHeader.nextSibling);
  }

  if (pinnedMessages.length === 0) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }

  bar.classList.remove('hidden');
  bar.innerHTML = '';

  pinnedMessages.forEach(pin => {
    const item = document.createElement('div');
    item.className = 'pinned-item';
    let preview = pin.content;
    if (preview.startsWith('[image]')) preview = '📷 Hình ảnh';
    else if (preview.startsWith('[file]')) preview = '📎 Tệp';
    else if (preview.startsWith('[voice]')) preview = '🎤 Tin nhắn thoại';
    else if (preview.startsWith('[sticker]')) preview = '🎃 Sticker';
    else preview = preview.slice(0, 50);

    item.innerHTML = `<span class="pinned-icon">📌</span><span class="pinned-text" data-pin-msg-id="${pin.id}">${escapeHtml(pin.senderName)}: ${escapeHtml(preview)}</span><button class="pinned-remove" title="Bỏ ghim">✕</button>`;

    item.querySelector('.pinned-text').addEventListener('click', () => {
      const el = document.querySelector(`[data-msg-id="${pin.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 2000);
      }
    });

    item.querySelector('.pinned-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      unpinMessage(pin.id);
    });

    bar.appendChild(item);
  });
}

// ---- CUSTOM THEME (Color Picker) ----

function initColorPicker() {
  const sidebarActions = $('.sidebar-header-actions');
  if (!sidebarActions) return;

  const colorBtn = document.createElement('button');
  colorBtn.id = 'color-picker-btn';
  colorBtn.className = 'icon-btn';
  colorBtn.title = 'Đổi màu nền chat';
  colorBtn.textContent = '🎨';
  colorBtn.style.fontSize = '18px';

  // Insert before the theme toggle
  const themeToggle = $('#theme-toggle');
  if (themeToggle) sidebarActions.insertBefore(colorBtn, themeToggle);
  else sidebarActions.appendChild(colorBtn);

  const CHAT_COLORS = [
    { name: 'Mặc định', value: '' },
    { name: 'Hoàng hôn', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
    { name: 'Đại dương', value: 'linear-gradient(135deg, #0093E9 0%, #80D0C7 100%)' },
    { name: 'Hồng pastel', value: 'linear-gradient(135deg, #FFDEE9 0%, #B5FFFC 100%)' },
    { name: 'Rừng xanh', value: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' },
    { name: 'Lửa cam', value: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
    { name: 'Tím galaxy', value: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
    { name: 'Nắng vàng', value: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
    { name: 'Bạc hà', value: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' },
    { name: 'Đêm tối', value: 'linear-gradient(135deg, #0c0c1d 0%, #1a1a3e 50%, #2d2d6e 100%)' }
  ];

  const SENT_COLORS = [
    { name: 'Mặc định', value: '' },
    { name: 'Tím đậm', value: '#7c3aed' },
    { name: 'Xanh dương', value: '#2563eb' },
    { name: 'Xanh lá', value: '#059669' },
    { name: 'Hồng', value: '#e11d48' },
    { name: 'Cam', value: '#ea580c' },
    { name: 'Xám', value: '#475569' },
    { name: 'Đen', value: '#18181b' }
  ];

  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    let popup = $('#color-picker-popup');
    if (popup) { popup.remove(); return; }

    popup = document.createElement('div');
    popup.id = 'color-picker-popup';
    popup.className = 'color-picker-popup';

    // Chat background section
    let bgHtml = '<div class="color-picker-section"><div class="color-picker-label">Nền chat</div><div class="color-picker-grid">';
    CHAT_COLORS.forEach((c, i) => {
      const style = c.value ? `background:${c.value}` : 'background:var(--chat-bg);border:2px dashed var(--border)';
      bgHtml += `<button class="color-swatch" data-bg-idx="${i}" title="${c.name}" style="${style}"></button>`;
    });
    bgHtml += '</div></div>';

    // Sent message color section
    let sentHtml = '<div class="color-picker-section"><div class="color-picker-label">Tin nhắn gửi</div><div class="color-picker-grid">';
    SENT_COLORS.forEach((c, i) => {
      const style = c.value ? `background:${c.value}` : 'background:var(--sent);border:2px dashed var(--border)';
      sentHtml += `<button class="color-swatch" data-sent-idx="${i}" title="${c.name}" style="${style}"></button>`;
    });
    sentHtml += '</div></div>';

    popup.innerHTML = bgHtml + sentHtml;
    colorBtn.parentNode.appendChild(popup);

    popup.querySelectorAll('[data-bg-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.bgIdx);
        const val = CHAT_COLORS[idx].value;
        localStorage.setItem('chatBgColor', val);
        applyChatBg(val);
        popup.remove();
      });
    });

    popup.querySelectorAll('[data-sent-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.sentIdx);
        const val = SENT_COLORS[idx].value;
        localStorage.setItem('chatSentColor', val);
        applySentColor(val);
        popup.remove();
      });
    });

    const closeHandler = (ev) => {
      if (!popup.contains(ev.target) && ev.target !== colorBtn) {
        popup.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  });

  // Apply saved colors on init
  const savedBg = localStorage.getItem('chatBgColor');
  if (savedBg) applyChatBg(savedBg);
  const savedSent = localStorage.getItem('chatSentColor');
  if (savedSent) applySentColor(savedSent);
}

function applyChatBg(val) {
  const chatArea = $('.chat-area');
  const messagesEl = $('#messages');
  if (val) {
    if (chatArea) chatArea.style.background = val;
    if (messagesEl) messagesEl.style.background = 'transparent';
  } else {
    if (chatArea) chatArea.style.background = '';
    if (messagesEl) messagesEl.style.background = '';
  }
}

function applySentColor(val) {
  if (val) {
    document.documentElement.style.setProperty('--sent', val);
  } else {
    document.documentElement.style.removeProperty('--sent');
  }
}

// ---- ONLINE COUNT ----

function initOnlineCount() {
  const currentUserEl = $('.current-user');
  if (!currentUserEl) return;

  let badge = $('#online-count-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'online-count-badge';
    badge.className = 'online-count-badge';
    badge.textContent = '0 online';
    currentUserEl.appendChild(badge);
  }
}

function updateOnlineCount(count) {
  onlineCount = count;
  const badge = $('#online-count-badge');
  if (badge) badge.textContent = count + ' online';
}

// ---- INIT ----

initEmojiPicker();
initEmojiSuggest();
initImageUpload();
initFileUpload();
initVoiceRecording();
initClipboardPaste();
initInfiniteScroll();
initMessageSearch();
initProfile();
initColorPicker();
initOnlineCount();
setInterval(loadUsers, 10000);
checkAuth();
initMobile();
