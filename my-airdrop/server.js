// server.js — نسخة تعمل على Render بدون مشاكل
const express = require("express");
const http = require("http");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { nanoid } = require("nanoid");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// مجلد الملفات
const UPLOADS = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

// التخزين
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => cb(null, nanoid() + path.extname(file.originalname))
});
const upload = multer({ storage });

// السيرفر
const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  cors: { origin: "*" }
});

const peers = {};

io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  socket.on("announce", data => {
    peers[socket.id] = { id: socket.id, name: data?.name ?? "Unknown" };
    socket.emit("peers", Object.values(peers));
    socket.broadcast.emit("peer-joined", peers[socket.id]);
  });

  socket.on("disconnect", () => {
    if (peers[socket.id]) {
      socket.broadcast.emit("peer-left", peers[socket.id]);
      delete peers[socket.id];
    }
  });
});

// upload
app.post("/upload-peer", upload.single("file"), (req, res) => {
  const { fromPeerId, targetPeerId } = req.body;

  if (!req.file) return res.json({ ok: false });
  if (!peers[targetPeerId]) return res.json({ ok: false });

  const stored = req.file.filename;

  io.to(targetPeerId).emit("file-received", {
    fromName: peers[fromPeerId]?.name ?? "Unknown",
    url: `/download/${stored}`,
    originalName: req.file.originalname,
    size: req.file.size
  });

  res.json({
    ok: true,
    downloadUrl: `/download/${stored}`
  });
});

// تحميل الملفات
app.get("/download/:file", (req, res) => {
  const p = path.join(UPLOADS, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).send("Not found");
  res.download(p);
});

// تشغيل السيرفر
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log("Server running on", PORT));
