const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 30000,
  pingInterval: 10000,
  transports: ['websocket', 'polling']
});

// Database setup
const db = new Database(path.join(__dirname, 'chat.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    is_banned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS blocked_users (
    user_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, blocked_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (blocked_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(sender_id, receiver_id);
`);

// Migration for existing DB: add columns if missing
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0'); } catch {}

// Promote first user to admin if no admin exists
const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
if (!adminExists) {
  const firstUser = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (firstUser) {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(firstUser.id);
  }
}

// Session middleware
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'chat-app-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax', secure: false }
});

app.set('trust proxy', 1);
app.use(sessionMiddleware);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth tokens for socket.io (bypass cookie issues with tunnels)
const authTokens = new Map(); // token -> { userId, username }

function createAuthToken(userId, username) {
  const token = crypto.randomBytes(32).toString('hex');
  authTokens.set(token, { userId, username });
  // Clean up token after 24h
  setTimeout(() => authTokens.delete(token), 24 * 60 * 60 * 1000);
  return token;
}

// Socket.io auth via token
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token && authTokens.has(token)) {
    const user = authTokens.get(token);
    socket.userId = user.userId;
    socket.username = user.username;
    next();
  } else {
    next(new Error('Unauthorized'));
  }
});

// --- MIDDLEWARE ---

function resolveTokenUser(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    const t = authTokens.get(h.slice(7));
    if (t) return t;
  }
  return null;
}

function requireAuth(req, res, next) {
  const tokenUser = resolveTokenUser(req);
  if (tokenUser) {
    req.userId = tokenUser.userId;
    req.username = tokenUser.username;
    return next();
  }
  if (req.session.userId) {
    req.userId = req.session.userId;
    req.username = req.session.username;
    return next();
  }
  return res.status(401).json({ error: 'Chưa đăng nhập' });
}

function requireAdmin(req, res, next) {
  const tokenUser = resolveTokenUser(req);
  if (tokenUser) {
    req.userId = tokenUser.userId;
    req.username = tokenUser.username;
  } else if (req.session.userId) {
    req.userId = req.session.userId;
    req.username = req.session.username;
  } else {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền admin' });
  }
  next();
}

// --- AUTH ROUTES ---

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
  }
  if (username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Username >= 3 ký tự, password >= 4 ký tự' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: 'Username đã tồn tại' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const role = userCount === 0 ? 'admin' : 'user';

  const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);

  req.session.userId = result.lastInsertRowid;
  req.session.username = username;
  req.session.role = role;
  const token = createAuthToken(result.lastInsertRowid, username);
  res.json({ id: result.lastInsertRowid, username, role, token });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Sai username hoặc password' });
  }

  if (user.is_banned) {
    return res.status(403).json({ error: 'Tài khoản đã bị khóa bởi admin' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  const token = createAuthToken(user.id, user.username);
  res.json({ id: user.id, username: user.username, role: user.role, token });
});

app.post('/api/logout', (req, res) => {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) authTokens.delete(h.slice(7));
  if (req.session) req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  let userId = null;
  const tokenUser = resolveTokenUser(req);
  if (tokenUser) {
    userId = tokenUser.userId;
  } else if (req.session.userId) {
    userId = req.session.userId;
  }
  if (!userId) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }
  const user = db.prepare('SELECT id, username, role, is_banned FROM users WHERE id = ?').get(userId);
  if (!user || user.is_banned) {
    if (req.session) req.session.destroy();
    return res.status(401).json({ error: 'Tài khoản đã bị khóa' });
  }
  const token = createAuthToken(user.id, user.username);
  res.json({ id: user.id, username: user.username, role: user.role, token });
});

// --- USER & MESSAGE ROUTES ---

app.get('/api/users', requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role FROM users u
    WHERE u.id != ? AND u.is_banned = 0
      AND u.id NOT IN (SELECT blocked_id FROM blocked_users WHERE user_id = ?)
  `).all(req.userId, req.userId);
  res.json(users);
});

app.get('/api/messages/:userId', requireAuth, (req, res) => {
  const otherId = parseInt(req.params.userId);
  const messages = db.prepare(`
    SELECT m.*, u1.username as sender_name, u2.username as receiver_name
    FROM messages m
    JOIN users u1 ON m.sender_id = u1.id
    JOIN users u2 ON m.receiver_id = u2.id
    WHERE (m.sender_id = ? AND m.receiver_id = ?)
       OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at ASC
    LIMIT 200
  `).all(req.userId, otherId, otherId, req.userId);
  res.json(messages);
});

// --- BLOCK ROUTES ---

app.get('/api/blocked', requireAuth, (req, res) => {
  const blocked = db.prepare(`
    SELECT u.id, u.username FROM blocked_users b
    JOIN users u ON b.blocked_id = u.id
    WHERE b.user_id = ?
  `).all(req.userId);
  res.json(blocked);
});

app.post('/api/block/:userId', requireAuth, (req, res) => {
  const blockedId = parseInt(req.params.userId);
  if (blockedId === req.userId) {
    return res.status(400).json({ error: 'Không thể tự block mình' });
  }
  db.prepare('INSERT OR IGNORE INTO blocked_users (user_id, blocked_id) VALUES (?, ?)').run(req.userId, blockedId);
  res.json({ ok: true });
});

app.delete('/api/block/:userId', requireAuth, (req, res) => {
  const blockedId = parseInt(req.params.userId);
  db.prepare('DELETE FROM blocked_users WHERE user_id = ? AND blocked_id = ?').run(req.userId, blockedId);
  res.json({ ok: true });
});

// --- ADMIN ROUTES ---

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const bannedUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 1').get().c;
  const totalMessages = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;
  const todayMessages = db.prepare("SELECT COUNT(*) as c FROM messages WHERE date(created_at) = date('now')").get().c;
  res.json({ totalUsers, bannedUsers, totalMessages, todayMessages });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.is_banned, u.created_at,
      (SELECT COUNT(*) FROM messages WHERE sender_id = u.id) as message_count
    FROM users u ORDER BY u.created_at DESC
  `).all();
  res.json(users);
});

app.post('/api/admin/ban/:userId', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.userId);
  if (targetId === req.userId) {
    return res.status(400).json({ error: 'Không thể tự ban mình' });
  }
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId);
  if (target && target.role === 'admin') {
    return res.status(400).json({ error: 'Không thể ban admin khác' });
  }
  db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(targetId);

  // Kick banned user offline
  const sockets = onlineUsers.get(targetId);
  if (sockets) {
    sockets.forEach(sid => io.sockets.sockets.get(sid)?.disconnect());
    onlineUsers.delete(targetId);
  }
  res.json({ ok: true });
});

app.post('/api/admin/unban/:userId', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.userId);
  db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(targetId);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:userId', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.userId);
  if (targetId === req.userId) {
    return res.status(400).json({ error: 'Không thể xoá chính mình' });
  }
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId);
  if (target && target.role === 'admin') {
    return res.status(400).json({ error: 'Không thể xoá admin khác' });
  }

  db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(targetId, targetId);
  db.prepare('DELETE FROM blocked_users WHERE user_id = ? OR blocked_id = ?').run(targetId, targetId);
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  const sockets = onlineUsers.get(targetId);
  if (sockets) {
    sockets.forEach(sid => io.sockets.sockets.get(sid)?.disconnect());
    onlineUsers.delete(targetId);
  }
  res.json({ ok: true });
});

app.post('/api/admin/role/:userId', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.userId);
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role không hợp lệ' });
  }
  if (targetId === req.userId) {
    return res.status(400).json({ error: 'Không thể đổi role của chính mình' });
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
  res.json({ ok: true });
});

// --- SOCKET.IO ---

const onlineUsers = new Map();

io.on('connection', (socket) => {
  const userId = socket.userId;
  const username = socket.username;

  if (!userId) {
    socket.disconnect();
    return;
  }

  const user = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(userId);
  if (!user || user.is_banned) {
    socket.disconnect();
    return;
  }

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);

  function broadcastOnline() {
    const online = Array.from(onlineUsers.keys());
    io.emit('online_users', online);
  }
  broadcastOnline();

  socket.on('send_message', (data, callback) => {
    const { receiverId, content, tempId } = data;
    if (!content || !content.trim() || !receiverId) return;

    const blocked = db.prepare(`
      SELECT 1 FROM blocked_users
      WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)
    `).get(userId, receiverId, receiverId, userId);

    if (blocked) {
      socket.emit('error_message', { error: 'Không thể gửi tin nhắn cho người này' });
      if (callback) callback({ success: false, error: 'blocked' });
      return;
    }

    const sanitized = content.trim().slice(0, 2000);

    const result = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)'
    ).run(userId, receiverId, sanitized);

    const message = {
      id: result.lastInsertRowid,
      sender_id: userId,
      receiver_id: receiverId,
      sender_name: username,
      content: sanitized,
      created_at: new Date().toISOString()
    };

    // ACK back to sender with real ID
    if (callback) callback({ success: true, messageId: result.lastInsertRowid, tempId });

    socket.emit('new_message', message);

    const receiverSockets = onlineUsers.get(receiverId);
    if (receiverSockets) {
      receiverSockets.forEach(sid => {
        io.to(sid).emit('new_message', message);
      });
    }
  });

  socket.on('typing', (receiverId) => {
    const receiverSockets = onlineUsers.get(receiverId);
    if (receiverSockets) {
      receiverSockets.forEach(sid => {
        io.to(sid).emit('user_typing', { userId, username });
      });
    }
  });

  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(userId);
      }
    }
    broadcastOnline();
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
  console.log(`Mạng LAN / Remote: http://0.0.0.0:${PORT}`);
});
