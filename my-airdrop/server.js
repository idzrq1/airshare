// server.js — مع تتبع IP وتسجيله في ملف لوق
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

// ================= مجلدات التخزين =================

// مجلد الملفات المرفوعة
const UPLOADS = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

// مجلد اللوقات
const LOGS_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);

// ملف اللوق الخاص بالـ IPs
const IP_LOG_FILE = path.join(LOGS_DIR, "ip-log.txt");

// ستريم للكتابة في ملف اللوق (append)
const ipLogStream = fs.createWriteStream(IP_LOG_FILE, { flags: "a" });

// دالة مساعدة: كتابة سطر في ملف اللوق
function logIpEvent(type, info = {}) {
  const time = new Date().toISOString();
  const line =
    `[${time}] [${type}] ` +
    Object.entries(info)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ") +
    "\n";

  ipLogStream.write(line);
  console.log(line.trim());
}

// ================= التخزين (multer) =================

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) =>
    cb(null, nanoid() + path.extname(file.originalname)),
});

const upload = multer({ storage });

// ================= دوال جلب الـ IP =================

function getIpFromRequest(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    return xff.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function getIpFromSocket(socket) {
  const xff = socket.handshake.headers["x-forwarded-for"];
  if (xff) {
    return xff.split(",")[0].trim();
  }
  return socket.handshake.address || "unknown";
}

// ================= السيرفر و Socket.IO =================

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

// تخزين معلومات الـ peers والـ IPs
const peers = {};  // للأسماء و IDs
const ipMap = {};  // للسجل الحالي للمتصلين

io.on("connection", (socket) => {
  const ip = getIpFromSocket(socket);

  logIpEvent("SOCKET_CONNECT", {
    socketId: socket.id,
    ip,
  });

  socket.on("announce", (data) => {
    const name = data?.name ?? "Unknown";

    peers[socket.id] = { id: socket.id, name };

    ipMap[socket.id] = {
      id: socket.id,
      name,
      ip,
      connectedAt: new Date().toISOString(),
    };

    // أرسل له كل الأجهزة
    socket.emit("peers", Object.values(peers));
    // بلغ الباقين إنه دخل
    socket.broadcast.emit("peer-joined", peers[socket.id]);

    logIpEvent("ANNOUNCE", {
      socketId: socket.id,
      ip,
      name,
    });
  });

  socket.on("disconnect", () => {
    logIpEvent("SOCKET_DISCONNECT", {
      socketId: socket.id,
      ip,
      name: peers[socket.id]?.name ?? "Unknown",
    });

    if (peers[socket.id]) {
      socket.broadcast.emit("peer-left", peers[socket.id]);
      delete peers[socket.id];
    }
    if (ipMap[socket.id]) {
      delete ipMap[socket.id];
    }
  });
});

// ================= رفع الملفات بين الأجهزة =================

app.post("/upload-peer", upload.single("file"), (req, res) => {
  const { fromPeerId, targetPeerId } = req.body;
  const reqIp = getIpFromRequest(req);

  logIpEvent("UPLOAD_PEER", {
    httpIp: reqIp,
    fromPeerId,
    targetPeerId,
    file: req.file?.originalname || "none",
    size: req.file?.size || 0,
  });

  if (!req.file) {
    return res.json({ ok: false, message: "No file" });
  }
  if (!peers[targetPeerId]) {
    return res.json({ ok: false, message: "Target not found" });
  }

  const stored = req.file.filename;

  io.to(targetPeerId).emit("file-received", {
    fromName: peers[fromPeerId]?.name ?? "Unknown",
    url: `/download/${stored}`,
    originalName: req.file.originalname,
    size: req.file.size,
  });

  res.json({
    ok: true,
    downloadUrl: `/download/${stored}`,
  });
});

// ================= تحميل الملفات =================

app.get("/download/:file", (req, res) => {
  const p = path.join(UPLOADS, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).send("Not found");
  res.download(p);
});

// ================= مسار عرض الـ IPs الحاليين (اختياري) =================

app.get("/admin/ips", (req, res) => {
  res.json({
    count: Object.keys(ipMap).length,
    clients: Object.values(ipMap),
  });
});

// ================= تشغيل السيرفر =================

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log("Server running on", PORT);
  logIpEvent("SERVER_START", { port: PORT });
});

// لو حاب تتأكد من إغلاق الستريم عند إيقاف السيرفر
process.on("SIGINT", () => {
  ipLogStream.end(() => {
    console.log("IP log stream closed.");
    process.exit(0);
  });
});
