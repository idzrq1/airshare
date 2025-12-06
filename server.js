// server.js (Vercel-compatible)
const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const { nanoid } = require('nanoid');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();

// نجهز سيرفر HTTP عادي + Socket.IO لكن **بدون listen**
const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io'
});

// مسارات المجلدات
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

// تأكد أن public موجود
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR);
}

// تأكد أن uploads موجود داخل public
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// تقديم ملفات الواجهة (index.html, app.js, style.css ...)
app.use(express.static(PUBLIC_DIR));

// نسمح للـ Express بقراءة body من الفورم
app.use(express.urlencoded({ extended: true }));

// ===== إعداد multer لرفع الملفات إلى public/uploads =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, nanoid() + ext); // اسم عشوائي للملف
  }
});

const upload = multer({ storage });

// ===== Socket.IO: إدارة الأجهزة المتصلة =====
/**
 * peers: { socketId: { id, name } }
 */
const peers = {};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // أول ما يتصل، ينتظر "announce" من العميل
  socket.on('announce', (payload) => {
    const name = (payload && payload.name)
      ? payload.name
      : `جهاز - ${socket.id.slice(0, 5)}`;

    peers[socket.id] = { id: socket.id, name };

    console.log('Peer announced:', peers[socket.id]);

    // نرسل له قائمة الأجهزة الحالية (بدون نفسه)
    const others = Object.values(peers).filter(p => p.id !== socket.id);
    socket.emit('peers', others);

    // نبلغ باقي الأجهزة عن انضمام جهاز جديد
    socket.broadcast.emit('peer-joined', peers[socket.id]);
  });

  // لما يقطع الاتصال
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (peers[socket.id]) {
      socket.broadcast.emit('peer-left', peers[socket.id]);
      delete peers[socket.id];
    }
  });
});

// ===== مسار رفع ملف "موجّه" لجهاز معيّن =====
app.post('/upload-peer', upload.single('file'), (req, res) => {
  const targetPeerId = req.body.targetPeerId;
  const fromPeerId = req.body.fromPeerId;

  if (!req.file) {
    return res.status(400).json({ ok: false, message: 'لم يتم رفع أي ملف' });
  }

  if (!targetPeerId || !io.sockets.sockets.get(targetPeerId)) {
    return res.status(400).json({ ok: false, message: 'الجهاز المستهدف غير متصل' });
  }

  const storedName = req.file.filename;
  const fileUrl = `/uploads/${storedName}`;      // مسار عرض مباشر
  const downloadUrl = `/download/${storedName}`; // مسار تحميل إجباري
  const fromPeer = peers[fromPeerId] || null;

  // نرسل إشعار للـ client المستهدف
  io.to(targetPeerId).emit('file-received', {
    fromName: (fromPeer && fromPeer.name) || 'جهاز مجهول',
    url: fileUrl,
    downloadUrl,
    originalName: req.file.originalname,
    size: req.file.size
  });

  // نرجع رد للمرسل
  return res.json({
    ok: true,
    url: fileUrl,
    downloadUrl,
    originalName: req.file.originalname,
    size: req.file.size
  });
});

// مسار تحميل إجباري
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('الملف غير موجود');
  }
  res.download(filePath);
});

// 👈 أهم شيء في Vercel: **ما فيه server.listen**
// بداله نصدّر handler يتعامل مع كل request
module.exports = (req, res) => {
  server.emit('request', req, res);
};
