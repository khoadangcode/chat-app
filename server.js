const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 30000,
  pingInterval: 10000,
  transports: ['websocket', 'polling']
});

// --- DATABASE (PostgreSQL / Neon) ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      is_banned INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      receiver_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      user_id INTEGER NOT NULL REFERENCES users(id),
      blocked_id INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(message_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(sender_id, receiver_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
  `);

  // Add display_name column and nicknames table
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nicknames (
      user_id INTEGER NOT NULL REFERENCES users(id),
      target_id INTEGER NOT NULL REFERENCES users(id),
      nickname TEXT NOT NULL,
      PRIMARY KEY (user_id, target_id)
    )
  `);

  // Promote first user to admin if none exists
  const { rows: admins } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (admins.length === 0) {
    const { rows: first } = await pool.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    if (first.length > 0) {
      await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [first[0].id]);
    }
  }

  // Create bot user if not exists
  const { rows: bots } = await pool.query("SELECT id FROM users WHERE username = $1", [BOT_USERNAME]);
  if (bots.length > 0) {
    BOT_ID = bots[0].id;
    // Ensure bot has display_name set
    await pool.query("UPDATE users SET display_name = 'AI Bot' WHERE id = $1 AND display_name IS NULL", [BOT_ID]);
  } else {
    const hash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
    const { rows } = await pool.query(
      "INSERT INTO users (username, password, role, display_name) VALUES ($1, $2, 'bot', 'AI Bot') RETURNING id",
      [BOT_USERNAME, hash]
    );
    BOT_ID = rows[0].id;
  }

  console.log('Database initialized, BOT_ID =', BOT_ID);
}

// --- AI BOT SETUP ---
const BOT_USERNAME = 'AI Bot';
let BOT_ID;

let geminiModel = null;
const BOT_SYSTEM_PROMPT = `Bạn là "AI Bot", một chatbot thân thiện trong app nhắn tin. Quy tắc:
- Trả lời bằng tiếng Việt, ngắn gọn (1-3 câu)
- Vui vẻ, dùng emoji phù hợp
- Nếu không biết thì nói thẳng
- Không bao giờ giả vờ là người thật`;

if (process.env.GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: BOT_SYSTEM_PROMPT
  });
  console.log('Gemini AI Bot enabled');
}

async function getBotReply(userMessage) {
  if (!geminiModel) return 'Xin lỗi, AI Bot chưa được kích hoạt 🔑';
  try {
    const result = await geminiModel.generateContent(userMessage);
    return result.response.text().slice(0, 2000);
  } catch (err) {
    console.error('Gemini error:', err.message);
    return 'Ối, mình bị lỗi rồi 😵 Thử lại sau nhé!';
  }
}

// --- SESSION & MIDDLEWARE ---
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

// Auth tokens
const authTokens = new Map();

function createAuthToken(userId, username) {
  const token = crypto.randomBytes(32).toString('hex');
  authTokens.set(token, { userId, username });
  setTimeout(() => authTokens.delete(token), 24 * 60 * 60 * 1000);
  return token;
}

// Socket.io auth
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
  if (tokenUser) { req.userId = tokenUser.userId; req.username = tokenUser.username; return next(); }
  if (req.session.userId) { req.userId = req.session.userId; req.username = req.session.username; return next(); }
  return res.status(401).json({ error: 'Chưa đăng nhập' });
}

async function requireAdmin(req, res, next) {
  const tokenUser = resolveTokenUser(req);
  if (tokenUser) { req.userId = tokenUser.userId; req.username = tokenUser.username; }
  else if (req.session.userId) { req.userId = req.session.userId; req.username = req.session.username; }
  else return res.status(401).json({ error: 'Chưa đăng nhập' });

  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId]);
  if (!rows[0] || rows[0].role !== 'admin') return res.status(403).json({ error: 'Không có quyền admin' });
  next();
}

// --- AUTH ROUTES ---

app.post('/api/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
  if (username.length < 3 || password.length < 4) return res.status(400).json({ error: 'Username >= 3 ký tự, password >= 4 ký tự' });

  const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.length > 0) return res.status(400).json({ error: 'Username đã tồn tại' });

  const hash = bcrypt.hashSync(password, 10);
  const { rows: countRows } = await pool.query("SELECT COUNT(*) as c FROM users WHERE role != 'bot'");
  const role = parseInt(countRows[0].c) === 0 ? 'admin' : 'user';

  const { rows } = await pool.query(
    'INSERT INTO users (username, password, role, display_name) VALUES ($1, $2, $3, $4) RETURNING id, display_name',
    [username, hash, role, displayName || null]
  );

  req.session.userId = rows[0].id;
  req.session.username = username;
  const token = createAuthToken(rows[0].id, username);
  res.json({ id: rows[0].id, username, role, display_name: rows[0].display_name, token });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });

  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Sai username hoặc password' });
  if (user.is_banned) return res.status(403).json({ error: 'Tài khoản đã bị khóa bởi admin' });

  req.session.userId = user.id;
  req.session.username = user.username;
  const token = createAuthToken(user.id, user.username);
  res.json({ id: user.id, username: user.username, role: user.role, display_name: user.display_name, token });
});

app.post('/api/logout', (req, res) => {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) authTokens.delete(h.slice(7));
  if (req.session) req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  let userId = null;
  const tokenUser = resolveTokenUser(req);
  if (tokenUser) userId = tokenUser.userId;
  else if (req.session.userId) userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Chưa đăng nhập' });

  const { rows } = await pool.query('SELECT id, username, role, is_banned, display_name FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user || user.is_banned) {
    if (req.session) req.session.destroy();
    return res.status(401).json({ error: 'Tài khoản đã bị khóa' });
  }
  const token = createAuthToken(user.id, user.username);
  res.json({ id: user.id, username: user.username, role: user.role, display_name: user.display_name, token });
});

// --- USER & MESSAGE ROUTES ---

app.get('/api/users', requireAuth, async (req, res) => {
  const { rows: users } = await pool.query(`
    SELECT u.id, u.username, u.display_name, u.role,
      n.nickname
    FROM users u
    LEFT JOIN nicknames n ON n.target_id = u.id AND n.user_id = $1
    WHERE u.id != $1 AND u.is_banned = 0 AND u.role != 'bot'
      AND u.id NOT IN (SELECT blocked_id FROM blocked_users WHERE user_id = $1)
  `, [req.userId]);
  users.unshift({ id: BOT_ID, username: BOT_USERNAME, display_name: 'AI Bot', role: 'bot', nickname: null });
  res.json(users);
});

app.get('/api/messages/:userId', requireAuth, async (req, res) => {
  const otherId = parseInt(req.params.userId);
  const { rows: messages } = await pool.query(`
    SELECT m.*, u1.username as sender_name, u1.display_name as sender_display_name,
      u2.username as receiver_name
    FROM messages m
    JOIN users u1 ON m.sender_id = u1.id
    JOIN users u2 ON m.receiver_id = u2.id
    WHERE (m.sender_id = $1 AND m.receiver_id = $2)
       OR (m.sender_id = $2 AND m.receiver_id = $1)
    ORDER BY m.created_at ASC
    LIMIT 200
  `, [req.userId, otherId]);

  const msgIds = messages.map(m => m.id);
  if (msgIds.length > 0) {
    const placeholders = msgIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows: reactions } = await pool.query(`
      SELECT r.message_id, r.user_id, r.emoji, u.username
      FROM reactions r JOIN users u ON r.user_id = u.id
      WHERE r.message_id IN (${placeholders})
    `, msgIds);

    const reactMap = {};
    reactions.forEach(r => {
      if (!reactMap[r.message_id]) reactMap[r.message_id] = [];
      reactMap[r.message_id].push({ user_id: r.user_id, emoji: r.emoji, username: r.username });
    });
    messages.forEach(m => { m.reactions = reactMap[m.id] || []; });
  }

  res.json(messages);
});

// --- BLOCK ROUTES ---

app.get('/api/blocked', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.username FROM blocked_users b
    JOIN users u ON b.blocked_id = u.id WHERE b.user_id = $1
  `, [req.userId]);
  res.json(rows);
});

app.post('/api/block/:userId', requireAuth, async (req, res) => {
  const blockedId = parseInt(req.params.userId);
  if (blockedId === req.userId) return res.status(400).json({ error: 'Không thể tự block mình' });
  await pool.query('INSERT INTO blocked_users (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.userId, blockedId]);
  res.json({ ok: true });
});

app.delete('/api/block/:userId', requireAuth, async (req, res) => {
  const blockedId = parseInt(req.params.userId);
  await pool.query('DELETE FROM blocked_users WHERE user_id = $1 AND blocked_id = $2', [req.userId, blockedId]);
  res.json({ ok: true });
});

// --- NICKNAME ROUTES ---

app.get('/api/nicknames', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT target_id, nickname FROM nicknames WHERE user_id = $1',
    [req.userId]
  );
  res.json(rows);
});

app.post('/api/nickname/:userId', requireAuth, async (req, res) => {
  const targetId = parseInt(req.params.userId);
  const { nickname } = req.body;
  if (!nickname || !nickname.trim()) return res.status(400).json({ error: 'Nickname không được để trống' });
  await pool.query(
    'INSERT INTO nicknames (user_id, target_id, nickname) VALUES ($1, $2, $3) ON CONFLICT (user_id, target_id) DO UPDATE SET nickname = $3',
    [req.userId, targetId, nickname.trim()]
  );
  res.json({ ok: true });
});

app.delete('/api/nickname/:userId', requireAuth, async (req, res) => {
  const targetId = parseInt(req.params.userId);
  await pool.query('DELETE FROM nicknames WHERE user_id = $1 AND target_id = $2', [req.userId, targetId]);
  res.json({ ok: true });
});

// --- ADMIN ROUTES ---

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const [r1, r2, r3, r4] = await Promise.all([
    pool.query('SELECT COUNT(*) as c FROM users'),
    pool.query('SELECT COUNT(*) as c FROM users WHERE is_banned = 1'),
    pool.query('SELECT COUNT(*) as c FROM messages'),
    pool.query("SELECT COUNT(*) as c FROM messages WHERE created_at::date = CURRENT_DATE")
  ]);
  res.json({
    totalUsers: parseInt(r1.rows[0].c),
    bannedUsers: parseInt(r2.rows[0].c),
    totalMessages: parseInt(r3.rows[0].c),
    todayMessages: parseInt(r4.rows[0].c)
  });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.display_name, u.role, u.is_banned, u.created_at,
      (SELECT COUNT(*) FROM messages WHERE sender_id = u.id) as message_count
    FROM users u ORDER BY u.created_at DESC
  `);
  rows.forEach(r => { r.message_count = parseInt(r.message_count); });
  res.json(rows);
});

app.post('/api/admin/ban/:userId', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.userId);
  if (targetId === req.userId) return res.status(400).json({ error: 'Không thể tự ban mình' });
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [targetId]);
  if (rows[0]?.role === 'admin') return res.status(400).json({ error: 'Không thể ban admin khác' });
  await pool.query('UPDATE users SET is_banned = 1 WHERE id = $1', [targetId]);

  const sockets = onlineUsers.get(targetId);
  if (sockets) { sockets.forEach(sid => io.sockets.sockets.get(sid)?.disconnect()); onlineUsers.delete(targetId); }
  res.json({ ok: true });
});

app.post('/api/admin/unban/:userId', requireAdmin, async (req, res) => {
  await pool.query('UPDATE users SET is_banned = 0 WHERE id = $1', [parseInt(req.params.userId)]);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:userId', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.userId);
  if (targetId === req.userId) return res.status(400).json({ error: 'Không thể xoá chính mình' });
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [targetId]);
  if (rows[0]?.role === 'admin') return res.status(400).json({ error: 'Không thể xoá admin khác' });

  await pool.query('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE sender_id = $1 OR receiver_id = $1)', [targetId]);
  await pool.query('DELETE FROM messages WHERE sender_id = $1 OR receiver_id = $1', [targetId]);
  await pool.query('DELETE FROM blocked_users WHERE user_id = $1 OR blocked_id = $1', [targetId]);
  await pool.query('DELETE FROM nicknames WHERE user_id = $1 OR target_id = $1', [targetId]);
  await pool.query('DELETE FROM users WHERE id = $1', [targetId]);

  const sockets = onlineUsers.get(targetId);
  if (sockets) { sockets.forEach(sid => io.sockets.sockets.get(sid)?.disconnect()); onlineUsers.delete(targetId); }
  res.json({ ok: true });
});

app.post('/api/admin/role/:userId', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.userId);
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Role không hợp lệ' });
  if (targetId === req.userId) return res.status(400).json({ error: 'Không thể đổi role của chính mình' });
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, targetId]);
  res.json({ ok: true });
});

// --- SOCKET.IO ---

const onlineUsers = new Map();

io.on('connection', async (socket) => {
  const userId = socket.userId;
  const username = socket.username;
  if (!userId) { socket.disconnect(); return; }

  const { rows } = await pool.query('SELECT is_banned FROM users WHERE id = $1', [userId]);
  if (!rows[0] || rows[0].is_banned) { socket.disconnect(); return; }

  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);

  function broadcastOnline() {
    io.emit('online_users', Array.from(onlineUsers.keys()));
  }
  broadcastOnline();

  socket.on('send_message', async (data, callback) => {
    const { receiverId, content, tempId } = data;
    if (!content || !content.trim() || !receiverId) return;

    const { rows: blocked } = await pool.query(
      'SELECT 1 FROM blocked_users WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)',
      [userId, receiverId]
    );
    if (blocked.length > 0) {
      socket.emit('error_message', { error: 'Không thể gửi tin nhắn cho người này' });
      if (callback) callback({ success: false, error: 'blocked' });
      return;
    }

    const sanitized = content.trim().slice(0, 2000);
    const { rows: inserted } = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING id',
      [userId, receiverId, sanitized]
    );

    // Fetch sender's display_name
    const { rows: senderRows } = await pool.query('SELECT display_name FROM users WHERE id = $1', [userId]);
    const senderDisplayName = senderRows[0]?.display_name || null;

    const message = {
      id: inserted[0].id,
      sender_id: userId,
      receiver_id: receiverId,
      sender_name: username,
      sender_display_name: senderDisplayName,
      content: sanitized,
      created_at: new Date().toISOString()
    };

    if (callback) callback({ success: true, messageId: inserted[0].id, tempId });
    socket.emit('new_message', message);

    if (receiverId === BOT_ID) {
      getBotReply(sanitized).then(async (reply) => {
        const { rows: botInserted } = await pool.query(
          'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING id',
          [BOT_ID, userId, reply]
        );
        const botMessage = {
          id: botInserted[0].id,
          sender_id: BOT_ID,
          receiver_id: userId,
          sender_name: BOT_USERNAME,
          sender_display_name: 'AI Bot',
          content: reply,
          created_at: new Date().toISOString()
        };
        const userSockets = onlineUsers.get(userId);
        if (userSockets) userSockets.forEach(sid => io.to(sid).emit('new_message', botMessage));
      });
    } else {
      const receiverSockets = onlineUsers.get(receiverId);
      if (receiverSockets) receiverSockets.forEach(sid => io.to(sid).emit('new_message', message));
    }
  });

  socket.on('add_reaction', async (data) => {
    const { messageId, emoji } = data;
    if (!messageId || !emoji) return;

    const { rows: msgs } = await pool.query('SELECT sender_id, receiver_id FROM messages WHERE id = $1', [messageId]);
    if (!msgs[0]) return;
    if (msgs[0].sender_id !== userId && msgs[0].receiver_id !== userId) return;

    await pool.query(
      'INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = $3',
      [messageId, userId, emoji]
    );

    const reaction = { messageId, userId, emoji, username };
    const otherId = msgs[0].sender_id === userId ? msgs[0].receiver_id : msgs[0].sender_id;
    socket.emit('reaction_updated', reaction);
    const otherSockets = onlineUsers.get(otherId);
    if (otherSockets) otherSockets.forEach(sid => io.to(sid).emit('reaction_updated', reaction));
  });

  socket.on('remove_reaction', async (data) => {
    const { messageId } = data;
    if (!messageId) return;

    await pool.query('DELETE FROM reactions WHERE message_id = $1 AND user_id = $2', [messageId, userId]);

    const { rows: msgs } = await pool.query('SELECT sender_id, receiver_id FROM messages WHERE id = $1', [messageId]);
    if (!msgs[0]) return;

    const removal = { messageId, userId, emoji: null };
    const otherId = msgs[0].sender_id === userId ? msgs[0].receiver_id : msgs[0].sender_id;
    socket.emit('reaction_updated', removal);
    const otherSockets = onlineUsers.get(otherId);
    if (otherSockets) otherSockets.forEach(sid => io.to(sid).emit('reaction_updated', removal));
  });

  socket.on('typing', (receiverId) => {
    const receiverSockets = onlineUsers.get(receiverId);
    if (receiverSockets) receiverSockets.forEach(sid => io.to(sid).emit('user_typing', { userId, username }));
  });

  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) onlineUsers.delete(userId);
    }
    broadcastOnline();
  });
});

// --- START ---
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

initDB().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Server chạy tại http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});
