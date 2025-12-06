// public/app.js
document.addEventListener('DOMContentLoaded', () => {
  // ================= إعداد رابط السيرفر =================
  // غيّر هذا للرابط اللي يعطيك هو Render
  // مثال: const SERVER_URL = "https://airshare-api.onrender.com";
  const SERVER_URL = "https://YOUR-RENDER-APP.onrender.com";

  // ================= عناصر الواجهة =================
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const fileStatus = document.getElementById('fileStatus');
  const fileNameSpan = document.getElementById('fileName');
  const fileSizeSpan = document.getElementById('fileSize');
  const messageArea = document.getElementById('messageArea');
  const connectionStatus = document.getElementById('connectionStatus');
  const deviceNameInput = document.getElementById('deviceNameInput');
  const peerList = document.getElementById('peerList');
  const inbox = document.getElementById('inbox');

  let selectedFile = null;
  let currentPeers = {};
  let socket = null;

  // ================= اسم الجهاز =================
  let deviceName = localStorage.getItem('deviceName');
  if (!deviceName) {
    deviceName = `جهازي - ${navigator.platform}`;
    localStorage.setItem('deviceName', deviceName);
  }
  deviceNameInput.value = deviceName;

  function showMessage(text, type = 'info') {
    messageArea.textContent = text;
    messageArea.className = 'message ' + type;
  }

  // ================= الاتصال بـ Socket.IO =================
  // نستخدم سيرفر خارجي بدل localhost
  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    connectionStatus.textContent = '• متصل بالسيرفر';
    connectionStatus.classList.remove('disconnected');
    connectionStatus.classList.add('connected');

    socket.emit('announce', { name: deviceNameInput.value.trim() || deviceName });
  });

  socket.on('disconnect', () => {
    connectionStatus.textContent = '• غير متصل';
    connectionStatus.classList.remove('connected');
    connectionStatus.classList.add('disconnected');
    currentPeers = {};
    updatePeerList([]);
  });

  socket.on('peers', (peersArray) => {
    currentPeers = {};
    peersArray.forEach((p) => {
      currentPeers[p.id] = p;
    });
    updatePeerList(Object.values(currentPeers));
  });

  socket.on('peer-joined', (peer) => {
    currentPeers[peer.id] = peer;
    updatePeerList(Object.values(currentPeers));
  });

  socket.on('peer-left', (peer) => {
    delete currentPeers[peer.id];
    updatePeerList(Object.values(currentPeers));
  });

  // استلام ملف من السيرفر
  socket.on('file-received', (payload) => {
    addIncomingFile(payload);
  });

  // ================= تعديل اسم الجهاز =================
  function handleNameUpdate() {
    const newName = deviceNameInput.value.trim();
    if (newName && newName !== deviceName) {
      deviceName = newName;
      localStorage.setItem('deviceName', deviceName);
      if (socket && socket.connected) {
        socket.emit('announce', { name: deviceName });
      }
    }
  }

  deviceNameInput.addEventListener('blur', handleNameUpdate);
  deviceNameInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      handleNameUpdate();
      deviceNameInput.blur();
    }
  });

  // ================= اختيار / سحب الملف =================
  browseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelection(e.target.files[0]);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  dropzone.addEventListener('click', (e) => {
    if (e.target !== browseBtn && !e.target.closest('#browseBtn')) {
      fileInput.click();
    }
  });

  function handleFileSelection(file) {
    selectedFile = file;
    fileNameSpan.textContent = `الملف: ${file.name}`;
    fileSizeSpan.textContent = `الحجم: ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    fileStatus.style.display = 'block';
    showMessage('الملف جاهز، اختر جهاز من القائمة لإرساله.', 'info');
  }

  // ================= قائمة الأجهزة =================
  function updatePeerList(peersArray) {
    peerList.innerHTML = '';

    if (!peersArray.length) {
      const li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = 'لا توجد أجهزة قريبة حالياً.';
      peerList.appendChild(li);
      return;
    }

    peersArray.forEach((peer) => {
      if (peer.id === socket.id) return; // لا نعرض نفسنا

      const li = document.createElement('li');
      li.className = 'peer-item';

      const nameSpan = document.createElement('span');
      nameSpan.innerHTML = `💻 ${peer.name}`;

      const btn = document.createElement('button');
      btn.className = 'primary-btn small';
      btn.textContent = 'إرسال إليه';
      btn.addEventListener('click', () => {
        sendFileToPeer(peer.id, peer.name);
      });

      li.appendChild(nameSpan);
      li.appendChild(btn);
      peerList.appendChild(li);
    });
  }

  // ================= إرسال الملف لجهاز معيّن =================
  async function sendFileToPeer(peerId, peerName) {
    if (!socket || !socket.connected) {
      showMessage('غير متصل بالسيرفر.', 'error');
      return;
    }

    if (!selectedFile) {
      showMessage('اختر ملف أولاً قبل الإرسال.', 'error');
      return;
    }

    showMessage(`جاري إرسال الملف إلى ${peerName}...`, 'info');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('targetPeerId', peerId);
    formData.append('fromPeerId', socket.id);

    try {
      const res = await fetch(`${SERVER_URL}/upload-peer`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        showMessage(`تم إرسال الملف إلى ${peerName} بنجاح ✅`, 'success');
      } else {
        showMessage(data.message || 'فشل إرسال الملف.', 'error');
      }
    } catch (err) {
      console.error(err);
      showMessage('حدث خطأ أثناء إرسال الملف.', 'error');
    }
  }

  // ================= إضافة ملف وارد للصندوق =================
  function addIncomingFile(payload) {
    const empty = inbox.querySelector('.empty-inbox');
    if (empty) empty.remove();

    const card = document.createElement('div');
    card.className = 'file-card';

    const title = document.createElement('div');
    title.className = 'file-title';
    title.textContent = payload.originalName || 'ملف بدون اسم';

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    const sizeMB = (payload.size / 1024 / 1024).toFixed(2);
    meta.textContent = `من: ${payload.fromName} • الحجم: ${sizeMB} MB`;

    const link = document.createElement('a');
    // السيرفر يرسل url نسبي مثل /download/xxx → نضيف عليه SERVER_URL
    const href = payload.downloadUrl
      ? `${SERVER_URL}${payload.downloadUrl}`
      : `${SERVER_URL}${payload.url}`;

    link.href = href;
    link.className = 'secondary-btn small';
    link.textContent = 'تحميل الملف';
    link.setAttribute('download', payload.originalName || 'file');

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(link);

    inbox.appendChild(card);
  }
});
