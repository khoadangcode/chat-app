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

  // --- Read Receipts columns ---
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`);

  // --- Group Chat tables ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_messages (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_group_messages ON group_messages(group_id);
  `);

  // --- NEW: Edit/Delete support ---
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS is_deleted INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS is_edited INTEGER DEFAULT 0`);

  // --- NEW: Reply support ---
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_to INTEGER REFERENCES group_messages(id) ON DELETE SET NULL`);

  // --- NEW: Avatar support ---
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`);

  // --- NEW: File upload support ---
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name TEXT`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_type TEXT`);
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS file_name TEXT`);
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS file_type TEXT`);

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
const BOT_SYSTEM_PROMPT = `Bạn là "AI Bot", một chatbot thân thiện và thông minh trong app nhắn tin. Quy tắc:
- Trả lời bằng tiếng Việt, ngắn gọn nhưng đầy đủ
- Vui vẻ, dùng emoji phù hợp
- Bạn CÓ KHẢ NĂNG nhìn và phân tích hình ảnh. Khi người dùng gửi ảnh, hãy phân tích chi tiết.
- Nếu người dùng hỏi về hình ảnh đã gửi trước đó, hãy dựa vào ngữ cảnh cuộc hội thoại để trả lời.
- Khi được yêu cầu giải bài toán, hãy giải CHI TIẾT từng bước.
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

// --- BOT CONVERSATION HISTORY ---
const botConversations = new Map(); // userId -> { history: [{role, parts}], lastActivity: timestamp }
const BOT_MAX_HISTORY = 20;
const BOT_HISTORY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Clean up stale conversations every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [uid, conv] of botConversations) {
    if (now - conv.lastActivity > BOT_HISTORY_TIMEOUT) {
      botConversations.delete(uid);
    }
  }
}, 10 * 60 * 1000);

// --- BOT MESSAGE QUEUE (prevent race conditions) ---
const botQueues = new Map(); // userId -> Promise

function queueBotReply(userId, prompt, imageData) {
  const prev = botQueues.get(userId) || Promise.resolve();
  const next = prev.then(() => getBotReply(prompt, imageData, userId)).catch(() => 'Ối, lỗi rồi 😵');
  botQueues.set(userId, next);
  return next;
}

function stripImagesFromHistory(history) {
  return history.map(entry => ({
    role: entry.role,
    parts: entry.parts.map(part => {
      if (part.inlineData) {
        return { text: '[Hình ảnh đã gửi trước đó]' };
      }
      return part;
    })
  }));
}

async function getBotReply(userMessage, imageData, userId) {
  if (!geminiModel) return 'Xin lỗi, AI Bot chưa được kích hoạt 🔑';
  try {
    // Get or create conversation for this user
    if (!botConversations.has(userId)) {
      botConversations.set(userId, { history: [], lastActivity: Date.now() });
    }
    const conv = botConversations.get(userId);

    // Check timeout - reset if stale
    if (Date.now() - conv.lastActivity > BOT_HISTORY_TIMEOUT) {
      conv.history = [];
    }
    conv.lastActivity = Date.now();

    // Build current message parts
    const currentParts = [];
    if (imageData) {
      currentParts.push({ text: userMessage || 'Hãy mô tả hình ảnh này.' });
      currentParts.push({ inlineData: { mimeType: imageData.mimeType, data: imageData.base64 } });
    } else {
      currentParts.push({ text: userMessage });
    }

    // Strip images from old history to save memory, keep text descriptions
    const sanitizedHistory = stripImagesFromHistory(conv.history);

    // Use Gemini chat API with history
    const chat = geminiModel.startChat({ history: sanitizedHistory });
    const result = await chat.sendMessage(currentParts);
    const reply = result.response.text().slice(0, 4000);

    // Store current user message and bot response in history
    conv.history.push({ role: 'user', parts: currentParts });
    conv.history.push({ role: 'model', parts: [{ text: reply }] });

    // Trim history to max entries (keep most recent)
    while (conv.history.length > BOT_MAX_HISTORY) {
      conv.history.shift();
    }

    return reply;
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
app.use(express.json({ limit: '5mb' }));
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
  res.json({ id: user.id, username: user.username, role: user.role, display_name: user.display_name, avatar: user.avatar, token });
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

  const { rows } = await pool.query('SELECT id, username, role, is_banned, display_name, avatar FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user || user.is_banned) {
    if (req.session) req.session.destroy();
    return res.status(401).json({ error: 'Tài khoản đã bị khóa' });
  }
  const token = createAuthToken(user.id, user.username);
  res.json({ id: user.id, username: user.username, role: user.role, display_name: user.display_name, avatar: user.avatar, token });
});

// --- PROFILE ROUTES ---

app.put('/api/profile', requireAuth, async (req, res) => {
  const { displayName, avatar } = req.body;
  if (displayName !== undefined) {
    await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [displayName.trim() || null, req.userId]);
  }
  if (avatar !== undefined) {
    // avatar is base64 data URL or null to remove
    if (avatar && avatar.length > 200000) return res.status(400).json({ error: 'Avatar quá lớn (tối đa ~150KB)' });
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar || null, req.userId]);
  }
  const { rows } = await pool.query('SELECT id, username, role, display_name, avatar FROM users WHERE id = $1', [req.userId]);
  res.json(rows[0]);
});

// --- Pool error handler ---
pool.on('error', (err) => {
  console.error('Unexpected idle client error:', err);
});

// --- USER & MESSAGE ROUTES ---

// Message Search (MUST be before /api/messages/:userId)
app.get('/api/messages/search/:userId', requireAuth, async (req, res) => {
  const otherId = parseInt(req.params.userId);
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);

  const { rows: messages } = await pool.query(`
    SELECT m.id, m.sender_id, m.receiver_id, m.content, m.created_at, m.is_deleted,
      u1.username as sender_name, u1.display_name as sender_display_name
    FROM messages m
    JOIN users u1 ON m.sender_id = u1.id
    WHERE ((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1))
      AND m.is_deleted = 0
      AND LOWER(m.content) LIKE $3
    ORDER BY m.created_at DESC
    LIMIT 50
  `, [req.userId, otherId, `%${q.toLowerCase()}%`]);

  res.json(messages);
});

app.get('/api/users', requireAuth, async (req, res) => {
  const { rows: users } = await pool.query(`
    SELECT u.id, u.username, u.display_name, u.role, u.last_seen, u.avatar,
      n.nickname
    FROM users u
    LEFT JOIN nicknames n ON n.target_id = u.id AND n.user_id = $1
    WHERE u.id != $1 AND u.is_banned = 0 AND u.role != 'bot'
      AND u.id NOT IN (SELECT blocked_id FROM blocked_users WHERE user_id = $1)
  `, [req.userId]);
  users.unshift({ id: BOT_ID, username: BOT_USERNAME, display_name: 'AI Bot', role: 'bot', nickname: null, last_seen: null, avatar: null });
  res.json(users);
});

app.get('/api/messages/:userId', requireAuth, async (req, res) => {
  const otherId = parseInt(req.params.userId);
  const before = req.query.before ? parseInt(req.query.before) : null;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  let query, params;
  if (before) {
    query = `
      SELECT m.*, u1.username as sender_name, u1.display_name as sender_display_name,
        u2.username as receiver_name,
        rm.content as reply_content, rm.sender_id as reply_sender_id,
        ru.username as reply_sender_name
      FROM messages m
      JOIN users u1 ON m.sender_id = u1.id
      JOIN users u2 ON m.receiver_id = u2.id
      LEFT JOIN messages rm ON m.reply_to = rm.id
      LEFT JOIN users ru ON rm.sender_id = ru.id
      WHERE ((m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1))
        AND m.id < $3
      ORDER BY m.created_at DESC
      LIMIT $4
    `;
    params = [req.userId, otherId, before, limit];
  } else {
    query = `
      SELECT m.*, u1.username as sender_name, u1.display_name as sender_display_name,
        u2.username as receiver_name,
        rm.content as reply_content, rm.sender_id as reply_sender_id,
        ru.username as reply_sender_name
      FROM messages m
      JOIN users u1 ON m.sender_id = u1.id
      JOIN users u2 ON m.receiver_id = u2.id
      LEFT JOIN messages rm ON m.reply_to = rm.id
      LEFT JOIN users ru ON rm.sender_id = ru.id
      WHERE (m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at DESC
      LIMIT $3
    `;
    params = [req.userId, otherId, limit];
  }

  const { rows: messagesDesc } = await pool.query(query, params);
  const messages = messagesDesc.reverse();

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

app.get('/api/groups/:groupId/messages/search', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);

  const { rows: membership } = await pool.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, req.userId]
  );
  if (membership.length === 0) return res.status(403).json({ error: 'Không phải thành viên' });

  const { rows: messages } = await pool.query(`
    SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.created_at, gm.is_deleted,
      u.username as sender_name, u.display_name as sender_display_name
    FROM group_messages gm
    JOIN users u ON gm.sender_id = u.id
    WHERE gm.group_id = $1 AND gm.is_deleted = 0
      AND LOWER(gm.content) LIKE $2
    ORDER BY gm.created_at DESC
    LIMIT 50
  `, [groupId, `%${q.toLowerCase()}%`]);

  res.json(messages);
});

// --- Read Receipts Route ---

app.post('/api/messages/read/:userId', requireAuth, async (req, res) => {
  const senderId = parseInt(req.params.userId);
  await pool.query(
    'UPDATE messages SET is_read = 1 WHERE sender_id = $1 AND receiver_id = $2 AND is_read = 0',
    [senderId, req.userId]
  );
  res.json({ ok: true });
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

// --- GROUP CHAT ROUTES ---

app.post('/api/groups', requireAuth, async (req, res) => {
  const { name, memberIds } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Tên nhóm không được để trống' });

  const { rows } = await pool.query(
    'INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id, name, created_by, created_at',
    [name.trim(), req.userId]
  );
  const group = rows[0];

  await pool.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)', [group.id, req.userId]);

  if (memberIds && Array.isArray(memberIds)) {
    for (const memberId of memberIds) {
      if (memberId !== req.userId) {
        await pool.query(
          'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [group.id, memberId]
        );
      }
    }
  }

  res.json(group);
});

app.get('/api/groups', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT g.id, g.name, g.created_by, g.created_at
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = $1
    ORDER BY g.created_at DESC
  `, [req.userId]);
  res.json(rows);
});

app.get('/api/groups/:groupId/messages', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const before = req.query.before ? parseInt(req.query.before) : null;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const { rows: membership } = await pool.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, req.userId]
  );
  if (membership.length === 0) return res.status(403).json({ error: 'Bạn không phải thành viên nhóm này' });

  let query, params;
  if (before) {
    query = `
      SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.created_at,
        gm.is_deleted, gm.is_edited, gm.file_name, gm.file_type,
        u.username as sender_name, u.display_name as sender_display_name,
        rm.content as reply_content, rm.sender_id as reply_sender_id,
        ru.username as reply_sender_name
      FROM group_messages gm
      JOIN users u ON gm.sender_id = u.id
      LEFT JOIN group_messages rm ON gm.reply_to = rm.id
      LEFT JOIN users ru ON rm.sender_id = ru.id
      WHERE gm.group_id = $1 AND gm.id < $2
      ORDER BY gm.created_at DESC
      LIMIT $3
    `;
    params = [groupId, before, limit];
  } else {
    query = `
      SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.created_at,
        gm.is_deleted, gm.is_edited, gm.file_name, gm.file_type,
        u.username as sender_name, u.display_name as sender_display_name,
        rm.content as reply_content, rm.sender_id as reply_sender_id,
        ru.username as reply_sender_name
      FROM group_messages gm
      JOIN users u ON gm.sender_id = u.id
      LEFT JOIN group_messages rm ON gm.reply_to = rm.id
      LEFT JOIN users ru ON rm.sender_id = ru.id
      WHERE gm.group_id = $1
      ORDER BY gm.created_at DESC
      LIMIT $2
    `;
    params = [groupId, limit];
  }

  const { rows: messagesDesc } = await pool.query(query, params);
  const messages = messagesDesc.reverse();
  res.json(messages);
});

app.post('/api/groups/:groupId/members', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Thiếu userId' });

  const { rows: membership } = await pool.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, req.userId]
  );
  if (membership.length === 0) return res.status(403).json({ error: 'Bạn không phải thành viên nhóm này' });

  await pool.query(
    'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [groupId, userId]
  );
  res.json({ ok: true });
});

app.delete('/api/groups/:groupId/members/:userId', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const targetUserId = parseInt(req.params.userId);

  const { rows: membership } = await pool.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, req.userId]
  );
  if (membership.length === 0) return res.status(403).json({ error: 'Bạn không phải thành viên nhóm này' });

  await pool.query(
    'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, targetUserId]
  );
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
  await pool.query('DELETE FROM group_members WHERE user_id = $1', [targetId]);
  await pool.query('DELETE FROM group_messages WHERE sender_id = $1', [targetId]);
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

  try {
    const { rows } = await pool.query('SELECT is_banned FROM users WHERE id = $1', [userId]);
    if (!rows[0] || rows[0].is_banned) { socket.disconnect(); return; }
  } catch (err) {
    console.error('Connection check error:', err.message);
    socket.disconnect();
    return;
  }

  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);

  // Join socket rooms for all user's groups
  const { rows: myGroups } = await pool.query(
    'SELECT group_id FROM group_members WHERE user_id = $1',
    [userId]
  );
  for (const g of myGroups) {
    socket.join(`group_${g.group_id}`);
  }

  function broadcastOnline() {
    io.emit('online_users', Array.from(onlineUsers.keys()));
  }
  broadcastOnline();

  socket.on('send_message', async (data, callback) => {
    const { receiverId, content, tempId, replyTo, fileName, fileType } = data;
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

    const sanitized = content.trim().slice(0, 500000);
    const { rows: inserted } = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content, reply_to, file_name, file_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [userId, receiverId, sanitized, replyTo || null, fileName || null, fileType || null]
    );

    const { rows: senderRows } = await pool.query('SELECT display_name FROM users WHERE id = $1', [userId]);
    const senderDisplayName = senderRows[0]?.display_name || null;

    // Fetch reply info if exists
    let replyContent = null, replySenderId = null, replySenderName = null;
    if (replyTo) {
      const { rows: replyRows } = await pool.query(
        'SELECT m.content, m.sender_id, u.username as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = $1',
        [replyTo]
      );
      if (replyRows[0]) {
        replyContent = replyRows[0].content;
        replySenderId = replyRows[0].sender_id;
        replySenderName = replyRows[0].sender_name;
      }
    }

    const message = {
      id: inserted[0].id,
      sender_id: userId,
      receiver_id: receiverId,
      sender_name: username,
      sender_display_name: senderDisplayName,
      content: sanitized,
      created_at: new Date().toISOString(),
      reply_to: replyTo || null,
      reply_content: replyContent,
      reply_sender_id: replySenderId,
      reply_sender_name: replySenderName,
      file_name: fileName || null,
      file_type: fileType || null
    };

    if (callback) callback({ success: true, messageId: inserted[0].id, tempId });
    socket.emit('new_message', message);

    if (receiverId === BOT_ID) {
      // Detect image message: content starts with [image] followed by a data URL
      let botPrompt = sanitized;
      let botImageData = null;
      if (sanitized.startsWith('[image]')) {
        const dataUrl = sanitized.slice(7).trim(); // Remove [image] prefix
        const match = dataUrl.match(/^data:(.+?);base64,(.+)$/s);
        if (match) {
          botImageData = { mimeType: match[1], base64: match[2] };
          botPrompt = 'Hãy mô tả và phân tích hình ảnh này.';
        }
      }
      queueBotReply(userId, botPrompt, botImageData).then(async (reply) => {
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

  // --- Edit message ---
  socket.on('edit_message', async (data) => {
    const { messageId, content, isGroup } = data;
    if (!messageId || !content || !content.trim()) return;
    const sanitized = content.trim().slice(0, 2000);

    if (isGroup) {
      const { rows } = await pool.query('SELECT sender_id, group_id FROM group_messages WHERE id = $1', [messageId]);
      if (!rows[0] || rows[0].sender_id !== userId) return;
      await pool.query('UPDATE group_messages SET content = $1, is_edited = 1 WHERE id = $2', [sanitized, messageId]);
      io.to(`group_${rows[0].group_id}`).emit('message_edited', { messageId, content: sanitized, isGroup: true });
    } else {
      const { rows } = await pool.query('SELECT sender_id, receiver_id FROM messages WHERE id = $1', [messageId]);
      if (!rows[0] || rows[0].sender_id !== userId) return;
      await pool.query('UPDATE messages SET content = $1, is_edited = 1 WHERE id = $2', [sanitized, messageId]);
      const event = { messageId, content: sanitized, isGroup: false };
      socket.emit('message_edited', event);
      const otherSockets = onlineUsers.get(rows[0].receiver_id);
      if (otherSockets) otherSockets.forEach(sid => io.to(sid).emit('message_edited', event));
    }
  });

  // --- Delete message ---
  socket.on('delete_message', async (data) => {
    const { messageId, isGroup } = data;
    if (!messageId) return;

    if (isGroup) {
      const { rows } = await pool.query('SELECT sender_id, group_id FROM group_messages WHERE id = $1', [messageId]);
      if (!rows[0] || rows[0].sender_id !== userId) return;
      await pool.query("UPDATE group_messages SET is_deleted = 1, content = 'Tin nhắn đã bị xóa' WHERE id = $1", [messageId]);
      io.to(`group_${rows[0].group_id}`).emit('message_deleted', { messageId, isGroup: true });
    } else {
      const { rows } = await pool.query('SELECT sender_id, receiver_id FROM messages WHERE id = $1', [messageId]);
      if (!rows[0] || rows[0].sender_id !== userId) return;
      await pool.query("UPDATE messages SET is_deleted = 1, content = 'Tin nhắn đã bị xóa' WHERE id = $1", [messageId]);
      const event = { messageId, isGroup: false };
      socket.emit('message_deleted', event);
      const otherSockets = onlineUsers.get(rows[0].receiver_id);
      if (otherSockets) otherSockets.forEach(sid => io.to(sid).emit('message_deleted', event));
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

  socket.on('mark_read', async (data) => {
    const { senderId } = data;
    if (!senderId) return;

    await pool.query(
      'UPDATE messages SET is_read = 1 WHERE sender_id = $1 AND receiver_id = $2 AND is_read = 0',
      [senderId, userId]
    );

    const senderSockets = onlineUsers.get(senderId);
    if (senderSockets) {
      senderSockets.forEach(sid => io.to(sid).emit('messages_read', { readBy: userId }));
    }
  });

  socket.on('send_group_message', async (data, callback) => {
    const { groupId, content, replyTo, fileName, fileType } = data;
    if (!groupId || !content || !content.trim()) return;

    const { rows: membership } = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );
    if (membership.length === 0) return;

    const sanitized = content.trim().slice(0, 500000);
    const { rows: inserted } = await pool.query(
      'INSERT INTO group_messages (group_id, sender_id, content, reply_to, file_name, file_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at',
      [groupId, userId, sanitized, replyTo || null, fileName || null, fileType || null]
    );

    const { rows: senderRows } = await pool.query('SELECT display_name FROM users WHERE id = $1', [userId]);
    const senderDisplayName = senderRows[0]?.display_name || null;

    let replyContent = null, replySenderId = null, replySenderName = null;
    if (replyTo) {
      const { rows: replyRows } = await pool.query(
        'SELECT gm.content, gm.sender_id, u.username as sender_name FROM group_messages gm JOIN users u ON gm.sender_id = u.id WHERE gm.id = $1',
        [replyTo]
      );
      if (replyRows[0]) {
        replyContent = replyRows[0].content;
        replySenderId = replyRows[0].sender_id;
        replySenderName = replyRows[0].sender_name;
      }
    }

    const message = {
      id: inserted[0].id,
      group_id: groupId,
      sender_id: userId,
      sender_name: username,
      sender_display_name: senderDisplayName,
      content: sanitized,
      created_at: inserted[0].created_at,
      reply_to: replyTo || null,
      reply_content: replyContent,
      reply_sender_id: replySenderId,
      reply_sender_name: replySenderName,
      file_name: fileName || null,
      file_type: fileType || null
    };

    if (callback) callback({ success: true, messageId: inserted[0].id });

    io.to(`group_${groupId}`).emit('new_group_message', message);
  });

  socket.on('disconnect', async () => {
    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        await pool.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [userId]);
      }
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
