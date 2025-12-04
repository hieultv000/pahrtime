const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/public'));
app.use(express.static(path.join(__dirname, 'src/public')));

const methodOverride = require('method-override');
app.use(methodOverride('_method'));

app.use(session({
  secret: "lssd_secret_2025",
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000,
    secure: false,              
    httpOnly: true,
    sameSite: 'lax'
  }
}));

const DB_FILE = "./database.json";

const multer = require("multer");
const { v4: uuidv4 } = require("uuid"); // npm install uuid
// ĐẶT LÊN ĐẦU FILE app.js LUÔN NHÉ!
process.env.TZ = 'Asia/Ho_Chi_Minh';

// ====================== ĐỊNH DẠNG LƯƠNG KIỂU $  ======================
function formatSalary(amount) {
  const rounded = Math.floor(Number(amount) / 1000) * 1000;   // làm tròn xuống chục nghìn
  // Nếu muốn tròn xuống trăm nghìn thì dùng dòng dưới:
  // const rounded = Math.floor(Number(amount) / 100000) * 100000;

  return rounded.toLocaleString('en-US') + '$';
}

function getVietnamTimeString() {
  return new Date().toLocaleTimeString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
// Cấu hình multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "src/public/storage/avatars"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = uuidv4() + ext;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mimetype = allowed.test(file.mimetype);
    if (mimetype && allowed.test(ext)) {
      return cb(null, true);
    }
    cb(new Error("Chỉ chấp nhận file ảnh JPEG, PNG, GIF"));
  }
});

// ====================== BẢNG LƯƠNG THEO CHỨC VỤ ======================
const SALARY_RATES = {
  "Giám đốc": 50000,
  "Phó Giám đốc": 50000,
  "Trợ lý": 25000,
  "Thư ký": 21500,
  "Trưởng phòng": 18000,
  "Phó phòng": 14500,
  "Cảnh sát viên": 10714,
  "Sĩ quan dự bị": 10714
};

const AVAILABLE_RANKS = [
  "Hạ sĩ", "Trung sĩ", "Thượng sĩ", "Thiếu úy", "Trung úy", "Thượng úy", "Đại úy", "Thiếu tá", "Trung tá", "Thượng tá", "Đại tá"
];

function getSalaryRate(position) {
  return SALARY_RATES[position?.trim()] || 10714;
}

// ====================== DATABASE HELPER ======================
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { users: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

// ====================== MIDDLEWARE ======================
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect("/index.html");
}

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).send("Forbidden");
}

// ====================== ROUTES ======================

// ====================== ADMIN PANEL QUẢN LÝ ON/OFF DUTY (dùng JSON) ======================
app.get("/admin-panel", requireAdmin, (req, res) => {
  const db = loadDB();

  // Thống kê
  const stats = {
    onDuty: 0,
    offDuty: 0,
    notStarted: 0
  };

  db.users.forEach(u => {
    const today = new Date().toLocaleDateString('vi-VN');
    const todayRecords = u.attendance?.filter(a => a.date === today) || [];
    const hasOn = todayRecords.some(r => r.onTime && !r.offTime);
    const hasOff = todayRecords.some(r => r.offTime);

    if (hasOn) stats.onDuty++;
    else if (hasOff) stats.offDuty++;
    else stats.notStarted++;
  });

  res.render('admin-panel', {  // ← tạo file views/admin-panel.ejs (mình gửi dưới)
    users: db.users,
    stats,
    currentUser: req.session.user,
    success: req.query.success,
    error: req.query.error
  });
});

// Admin bật On Duty thủ công
app.post("/admin/toggle-on/:id", requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === parseInt(req.params.id));
  if (!user) return res.redirect("/admin-panel?error=user_not_found");

  const today = new Date(getVietnamTime()).toLocaleDateString('vi-VN');
  const time = new Date(getVietnamTime()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const dayMonth = today.split('/').slice(0, 2).join('/');

  // Nếu đã có ca đang mở → không cho bật lại
  const hasActive = user.attendance?.some(a => a.date === today && !a.offTime);
  if (hasActive) {
    return res.redirect("/admin-panel?error=already_on");
  }

  user.attendance = user.attendance || [];
  user.attendance.push({
    date: today,
    onTime: `${time} - ${dayMonth}`,
    offTime: null,
    hours: 0,
    salary: 0,
    status: "Đang làm việc (Admin bật)"
  });

  saveDB(db);
  res.redirect("/admin-panel?success=on_duty_" + user.displayName);
});

// Admin tắt Off Duty thủ công
app.post("/admin/toggle-off/:id", requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === parseInt(req.params.id));
  if (!user) return res.redirect("/admin-panel");

  const today = new Date().toLocaleDateString('vi-VN');
  const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const dayMonth = today.split('/').slice(0, 2).join('/');

  const activeSession = user.attendance?.find(a => a.date === today && !a.offTime);
  if (!activeSession) {
    return res.redirect("/admin-panel?error=no_active_session");
  }

  // Tính giờ làm (tối thiểu 1 tiếng mới tính lương)
  const onTimeStr = activeSession.onTime.split(' - ')[0];
  const [d, m, y] = today.split('/');
  const onDateTime = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')} ${onTimeStr}`);
  const elapsedHours = (new Date() - onDateTime) / (1000 * 60 * 60);

  activeSession.offTime = `${time} - ${dayMonth}`;

  if (elapsedHours >= 1) {
    const hoursToAdd = Math.min(elapsedHours, 4); // max 4h/ngày
    const salaryEarned = Math.round(hoursToAdd * user.salaryRate * 100) / 100;

    activeSession.hours = Math.round(hoursToAdd * 100) / 100;
    activeSession.salary = salaryEarned;
    activeSession.status = "Hoàn thành ca (Cảnh Báo Được Tắt Bởi Quản Lý)";

    user.careerTotal = Math.round((user.careerTotal + salaryEarned) * 100) / 100;
  } else {
    activeSession.hours = 0;
    activeSession.salary = 0;
    activeSession.status = "Ca dưới 1 tiếng – không tính lương (Cảnh Báo Được Tắt Bởi Quản Lý)";
  }

  saveDB(db);
  res.redirect("/admin-panel?success=off_duty_" + user.displayName);
});

// Admin reset chấm công của 1 người trong ngày
app.post("/admin/reset-duty/:id", requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === parseInt(req.params.id));
  if (user) {
    const today = new Date().toLocaleDateString('vi-VN');
    user.attendance = (user.attendance || []).filter(a => a.date !== today);
    saveDB(db);
  }
  res.redirect("/admin-panel?success=reset_ok");
});
// Trang chủ
app.get("/home", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/index.html");

  const page = parseInt(req.query.page) || 1;
  const perPage = 10;
  const totalUsers = db.users.length;
  const totalPages = Math.ceil(totalUsers / perPage);
  const start = (page - 1) * perPage;
  const usersPage = db.users.slice(start, start + perPage);

  res.render('home', {
    displayName: user.displayName,
    position: user.position,
    rank: user.rank,
    avatar: user.avatar,
    role: user.role,
    users: usersPage,
    currentPage: page,
    totalPages: totalPages,
    totalMembers: totalUsers,
    highLevelMembers: db.users.filter(u => u.role === 'admin').length
  });
});

app.get("/attendance", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/index.html");

  const now = new Date();
  const today = now.toLocaleDateString('vi-VN'); // 19/11/2025
  const currentMonthStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`; // 11/2025

  // Khởi tạo nếu chưa có
  user.attendance = user.attendance || [];
  user.monthlyHistory = user.monthlyHistory || [];
  user.careerTotal = Number(user.careerTotal) || 0;
  user.salaryRate = Number(user.salaryRate) || 10714;

  // Tính tổng giờ đã hoàn thành hôm nay (chỉ tính ca đã off)
  const todayRecords = user.attendance.filter(a => a.date === today);
  const completedHoursToday = todayRecords
    .filter(r => r.offTime && r.hours !== null)
    .reduce((sum, r) => sum + Number(r.hours || 0), 0);

  const isOnDuty = todayRecords.some(r => !r.offTime);
  const remainingHoursToday = Math.max(0, 4 - completedHoursToday);

  // Tính lương tháng hiện tại từ monthlyHistory (chuẩn nhất)
  const monthEntry = user.monthlyHistory.find(h => h.month === currentMonthStr);
  const monthlySalary = monthEntry ? (Number(monthEntry.salary) || 0) : 0;

  // Gom nhóm theo ngày
  const groupedAttendance = {};
  user.attendance.forEach(record => {
    if (!groupedAttendance[record.date]) groupedAttendance[record.date] = [];
    groupedAttendance[record.date].push(record);
  });

  // Sắp xếp ngày mới nhất lên đầu
  const sortedDates = Object.keys(groupedAttendance).sort((a, b) => {
    const da = a.split('/').reverse().join('/');
    const db = b.split('/').reverse().join('/');
    return db.localeCompare(da);
  });

  const sortedGrouped = {};
  sortedDates.forEach(date => sortedGrouped[date] = groupedAttendance[date]);

  res.render('attendance', {
    displayName: user.displayName,
    position: user.position,
    rank: user.rank,
    avatar: user.avatar,
    role: user.role,

    currentMonth: currentMonthStr,
    monthlySalary: monthlySalary.toLocaleString(),
    salaryRate: user.salaryRate.toLocaleString(),
    careerTotal: user.careerTotal.toLocaleString(),

    isOnDuty,
    todayHours: completedHoursToday.toFixed(2),
    maxDailyHours: 4,
    canCheckIn: remainingHoursToday > 0 && !isOnDuty,

    groupedAttendance: sortedGrouped,
    monthlyHistory: user.monthlyHistory,

    error: req.query.error === 'max_hours' ? 'Bạn đã đủ 4 giờ làm việc hôm nay!' : null
  });
});

// ON / OFF DUTY - ĐÃ SỬA LỖI KHÔNG TÍNH GIỜ KHI ≥1 TIẾNG (2025)
app.post("/attendance/check", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(403).send("Unauthorized");

  const now = new Date();
  const today = now.toLocaleDateString('vi-VN'); // 29/11/2025
  const time = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dayMonth = today.split('/').slice(0, 2).join('/'); // 29/11

  // Chuẩn hóa dữ liệu
  user.attendance = user.attendance || [];
  user.monthlyHistory = user.monthlyHistory || [];
  user.careerTotal = Number(user.careerTotal) || 0;
  user.salaryRate = Number(user.salaryRate) || 10714;

  // Tìm ca đang mở (chưa off)
  let activeSession = user.attendance.find(a => a.date === today && !a.offTime);

  if (activeSession) {
    // ====================== OFF DUTY ======================
    const onTimeStr = activeSession.onTime.split(' - ')[0].trim();
    const [d, m, y] = today.split('/');
    const onDateTime = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')} ${onTimeStr}`);

    if (isNaN(onDateTime.getTime())) {
      return res.redirect("/attendance");
    }

    const elapsedHours = (now - onDateTime) / (1000 * 60 * 60);

    // Cập nhật thời gian off trước (luôn luôn)
    activeSession.offTime = `${time} - ${dayMonth}`;

    // CHỈ TÍNH LƯƠNG NẾU LÀM ≥ 1 TIẾNG
    if (elapsedHours < 1) {
      activeSession.hours = 0;
      activeSession.salary = 0;
      activeSession.status = "Ca dưới 1 tiếng – không tính lương";
    } else {
      // Tính lại completedHoursToday SAU KHI đã có ca hiện tại (rất quan trọng!)
      const completedHoursToday = user.attendance
        .filter(a => a.date === today && a.offTime && a.hours > 0)
        .reduce((sum, a) => sum + a.hours, 0);

      const remainingToday = Math.max(0, 4 - completedHoursToday);
      const hoursToAdd = Math.min(elapsedHours, remainingToday);

      const finalHours = Math.round(hoursToAdd * 100) / 100;
      const salaryEarned = Math.round(finalHours * user.salaryRate * 100) / 100;

      // Cập nhật ca hiện tại
      activeSession.hours = finalHours;
      activeSession.salary = salaryEarned;
      activeSession.status = remainingToday <= 0 ? "Đủ 4 giờ hôm nay" : "Hoàn thành ca";

      // Cộng vào tổng thu nhập sự nghiệp
      user.careerTotal = Math.round((user.careerTotal + salaryEarned) * 100) / 100;

      // Cập nhật lịch sử tháng
      const monthKey = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
      let monthData = user.monthlyHistory.find(h => h.month === monthKey);
      if (!monthData) {
        monthData = { month: monthKey, hours: 0, salary: 0 };
        user.monthlyHistory.unshift(monthData);
      }
      monthData.hours = Math.round((monthData.hours + finalHours) * 100) / 100;
      monthData.salary = Math.round((monthData.salary + salaryEarned) * 100) / 100;
    }

  } else {
    // ====================== ON DUTY ======================
    // Tính lại giờ đã hoàn thành hôm nay (trước khi mở ca mới)
    const completedHoursToday = user.attendance
      .filter(a => a.date === today && a.offTime && a.hours > 0)
      .reduce((sum, a) => sum + a.hours, 0);

    if (completedHoursToday >= 4) {
      return res.redirect("/attendance?error=max_hours");
    }

    // Tạo ca mới
    user.attendance.push({
      date: today,
      onTime: `${time} - ${dayMonth}`,
      offTime: null,
      hours: 0,
      salary: 0,
      status: "Đang làm việc"
    });
  }

  saveDB(db);
  res.redirect("/attendance");
});

// Đăng ký người dùng (Admin)
app.post("/register", requireAdmin, (req, res) => {
  const { username, password, displayName, position, rank } = req.body;

  if (!username || !password || !displayName || !position) {
    return res.redirect("/admin?error=missing");
  }

  const db = loadDB();
  if (db.users.some(u => u.username === username)) {
    return res.redirect("/admin?error=exists");
  }

  const salaryRate = getSalaryRate(position);

  const newUser = {
    id: db.users.length + 1,
    username,
    password,
    role: "user",
    displayName,
    position: position.trim(),
    rank: rank?.trim(),
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random`,
    salaryRate,
    careerTotal: 0,
    attendance: [],
    monthlyHistory: []
  };

  db.users.push(newUser);
  saveDB(db);
  res.redirect("/admin?success=created");
});

// Admin panel (truyền danh sách chức vụ + quân hàm)
app.get("/admin", requireAdmin, (req, res) => {
  const db = loadDB(); // ← THÊM DÒNG NÀY
  res.render('admin', {
    db: db, // ← THÊM DÒNG NÀY
    error: req.query.error,
    success: req.query.success,
    positions: Object.keys(SALARY_RATES),
    ranks: AVAILABLE_RANKS
  });
});

// Đăng nhập
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect("/index.html?error=missing");

  const db = loadDB();
  const user = db.users.find(u => u.username === username && u.password === password);
  if (!user) return res.redirect("/index.html?error=invalid");

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.redirect("/home");
});

// Cài đặt (đổi mật khẩu)
app.get("/settings", requireAuth, (req, res) => {
  res.render('settings', { error: req.query.error, success: req.query.success });
});

app.post("/settings", requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) return res.redirect("/settings?error=missing");

  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (user) {
    user.password = newPassword;
    saveDB(db);
  }
  res.redirect("/settings?success=updated");
});


app.post("/profile/avatar", requireAuth, upload.single("avatar"), (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/");

  if (!req.file) {
    return res.redirect("/profile?error=upload_failed");
  }

  // Xóa ảnh cũ nếu tồn tại và không phải ui-avatars
  if (user.avatar && user.avatar.includes("/storage/avatars/")) {
    const oldPath = path.join(__dirname, "src/public", user.avatar);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  user.avatar = `/storage/avatars/${req.file.filename}`;
  saveDB(db);

  res.redirect("/profile?success=avatar_updated");
});

// === XÓA AVATAR – VỀ MẶC ĐỊNH THEO TÊN HIỆN TẠI (HOÀN HẢO) ===
app.delete("/profile/avatar", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/profile");

  // XÓA FILE ẢNH CŨ TRONG THƯ MỤC
  if (req.file) {
  if (user.avatar && user.avatar.startsWith("/storage/avatars/")) {
    const oldPath = path.join(__dirname, "src/public", user.avatar.split('?')[0]); // bỏ query string nếu có
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  user.avatar = `/storage/avatars/${req.file.filename}?v=${Date.now()}`; // ← Thêm ?v= để reload ảnh ngay
}

  // TẠO LẠI AVATAR MẶC ĐỊNH THEO TÊN HIỆN TẠI + THÊM TIMESTAMP ĐỂ TRÁNH CACHE
  const nameEncoded = encodeURIComponent(user.displayName.trim());
  const timestamp = Date.now(); // ← Quan trọng! Tránh cache trình duyệt
  user.avatar = `https://ui-avatars.com/api/?name=${nameEncoded}&background=random&bold=true&size=256&format=png&cache=${timestamp}`;

  saveDB(db);
  res.redirect("/profile?success=avatar_deleted");
});

app.post("/profile/update", requireAuth, upload.single("avatar"), (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/");

  const { name_ingame } = req.body;

  // Cập nhật tên trong game (displayName)
  if (name_ingame && name_ingame.trim() !== "" && name_ingame.trim() !== user.displayName) {
    const newName = name_ingame.trim();

    // Kiểm tra trùng tên (khuyến khích, tránh 2 người cùng tên)
    if (db.users.some(u => u.displayName.toLowerCase() === newName.toLowerCase() && u.id !== user.id)) {
      return res.redirect("/profile?error=name_exists");
    }

    user.displayName = newName;

    // Cập nhật lại avatar mặc định nếu đang dùng ui-avatars (tự động theo tên mới)
    if (user.avatar && user.avatar.includes("ui-avatars.com")) {
      user.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(newName)}&background=random&bold=true`;
    }
  }

  // Nếu có upload ảnh mới → cập nhật avatar
  if (req.file) {
  if (user.avatar && user.avatar.startsWith("/storage/avatars/")) {
    const oldPath = path.join(__dirname, "src/public", user.avatar.split('?')[0]); // bỏ query string nếu có
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  user.avatar = `/storage/avatars/${req.file.filename}?v=${Date.now()}`; // ← Thêm ?v= để reload ảnh ngay
}

  saveDB(db);
  res.redirect("/profile?success=updated");
});

// LỊCH SỬ CHẤM CÔNG TOÀN BẢN (DÙNG CHO PROFILE USER)
app.get("/profile/history", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.json({ history: [], userTotal: 0, serverTotal: 0 });
  // Tổng lương của user này
  const userTotal = (user.attendance || [])
    .filter(r => r.salary)
    .reduce((sum, r) => sum + r.salary, 0);

  // TỔNG LƯƠNG TOÀN SERVER
  const serverTotal = db.users.reduce((total, u) => {
    return total + (u.attendance || [])
      .filter(r => r.salary)
      .reduce((sum, r) => sum + r.salary, 0);
  }, 0);

res.json({
  history: history,
  userTotal: formatSalary(userTotal),
  serverTotal: formatSalary(serverTotal)
});
  });
app.get("/profile", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/index.html");

  // Tính tổng lương tháng hiện tại (tháng 12/2025 trở đi)
  const now = new Date();
  const currentMonthKey = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const currentMonthData = user.monthlyHistory?.find(h => h.month === currentMonthKey);
  const currentMonthSalary = currentMonthData ? Math.round(currentMonthData.salary).toLocaleString() : "0";

  res.render('profile', {
    displayName: user.displayName,
    username: user.username,
    position: user.position || "Cảnh sát viên",
    rank: user.rank || "Hạ sĩ",
    avatar: user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=random&bold=true`,
    salaryRate: Number(user.salaryRate || 10714).toLocaleString(),
    careerTotal: Number(user.careerTotal || 0).toLocaleString(),

    // Dữ liệu lương tháng
    monthlyHistory: user.monthlyHistory || [],

    // Thông báo
    success: req.query.success,
    error: req.query.error
  });
  
});
// ====================== LỊCH SỬ CHẤM CÔNG – ĐÃ FIX 100% KHÔNG LỖI 500 ======================
app.get("/admin/history/:id", requireAdmin, (req, res) => {
  try {
    const db = loadDB();
    const userId = parseInt(req.params.id);
    const user = db.users.find(u => u.id === userId);

    if (!user) {
      return res.json({ history: [], userTotal: 0, serverTotal: 0 });
    }

    // Gom nhóm theo ngày
    const grouped = {};
    (user.attendance || []).forEach(r => {
      if (!grouped[r.date]) grouped[r.date] = [];
      grouped[r.date].push(r);
    });

    const history = Object.keys(grouped)
      .map(date => {
        const recs = grouped[date];
        const completed = recs.filter(r => r.offTime);
        const hours = completed.reduce((s, r) => s + (r.hours || 0), 0);
        const salary = completed.reduce((s, r) => s + (r.salary || 0), 0);

        return {
          date,
          onTime: recs[0]?.onTime?.split(' - ')[0] || '',
          offTime: recs[recs.length - 1]?.offTime?.split(' - ')[0] || null,
          hours: Number(hours.toFixed(2)),
          salary: Number(salary)
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const userTotal = (user.attendance || [])
      .filter(r => r.salary > 0)
      .reduce((s, r) => s + Number(r.salary), 0);

    const serverTotal = db.users.reduce((acc, u) => {
      return acc + (u.attendance || [])
        .filter(r => r.salary > 0)
        .reduce((s, r) => s + Number(r.salary), 0);
    }, 0);

    res.json({
      history,
      userTotal: Math.round(userTotal),
      serverTotal: Math.round(serverTotal)
    });

  } catch (err) {
    console.error("Lỗi /admin/history/:id:", err);
    res.status(500).json({ history: [], userTotal: 0, serverTotal: 0 });
  }
});
// API realtime cho admin panel
app.get("/admin-panel-data", requireAdmin, (req, res) => {
  const db = loadDB();
  const today = new Date().toLocaleDateString('vi-VN');

  const stats = { onDuty: 0, offDuty: 0, notStarted: 0 };

  db.users.forEach(u => {
    const todayRecords = (u.attendance || []).filter(a => a.date === today);
    const hasOn = todayRecords.some(r => !r.offTime);
    const hasOff = todayRecords.some(r => r.offTime);
    if (hasOn) stats.onDuty++;
    else if (hasOff) stats.offDuty++;
    else stats.notStarted++;
  });

  res.json({ users: db.users, stats });
});
const XLSX = require('xlsx');   // ← THÊM DÒNG NÀY (nếu chưa có)
// ====================== XUẤT EXCEL LƯƠNG TOÀN SERVER ======================
app.get("/admin/export-excel", requireAdmin, (req, res) => {
  try {
    const db = loadDB();
    const today = new Date().toLocaleDateString('vi-VN');

    const data = db.users.map(user => {
      const all = user.attendance || [];
      const todayRec = all.filter(r => r.date === today);

      const totalHours = all.reduce((s, r) => s + (r.hours || 0), 0);
      const totalSalary = all.reduce((s, r) => s + (r.salary || 0), 0);
      const todayHours = todayRec.reduce((s, r) => s + (r.hours || 0), 0);
      const todaySalary = todayRec.reduce((s, r) => s + (r.salary || 0), 0);

      return {
        "ID": user.id,
        "Họ tên": user.displayName || "Chưa đặt tên",
        "Chức vụ": (user.position || "Cảnh sát viên") + " " + (user.rank || ""),
        "Tổng giờ làm": totalHours.toFixed(2),
        "Tổng lương sự nghiệp": formatSalary(totalSalary),
        "Giờ hôm nay": todayHours.toFixed(2),
        "Lương hôm nay": formatSalary(todaySalary),
        "Trạng thái hôm nay": todayRec.some(r => !r.offTime) ? "Đang On Duty" :
                              todayRec.some(r => r.offTime) ? "Đã Off Duty" : "Chưa vào ca"
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lương Nhân Viên");

    // Tự động điều chỉnh độ rộng cột
    ws['!cols'] = [
      { wch: 6 }, { wch: 25 }, { wch: 22 }, { wch: 15 },
      { wch: 22 }, { wch: 15 }, { wch: 18 }, { wch: 20 }
    ];

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Disposition', `attachment; filename="Luong_Nhan_Vien_${today.replace(/\//g, '-')}.xlsx"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error("Lỗi xuất Excel:", err);
    res.status(500).send("Lỗi server khi xuất file Excel");
  }
});
// Đăng xuất
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/index.html"));
});
// FIX MÚI GIỜ VIỆT NAM MÃI MÃI
process.env.TZ = 'Asia/Ho_Chi_Minh';
// Khởi động server
// ====================== TỰ ĐỘNG OFF DUTY QUA NGÀY (CHỐNG TREO CA) ======================
app.use((req, res, next) => {
  if (!req.session.user) return next(); // chỉ chạy khi đã đăng nhập

  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user || !user.attendance || user.attendance.length === 0) return next();

  const today = new Date().toLocaleDateString('vi-VN'); // ví dụ: 20/10/2025
  const now = new Date();

  // Tìm ca đang mở (không có offTime) và ngày của ca KHÔNG PHẢI hôm nay → treo qua ngày
  const hangingSession = user.attendance.find(a => 
    !a.offTime && a.date !== today
  );

  if (hangingSession) {
    // Tự động chốt ca lúc 00:00:00 của ngày hôm sau
    const [d, m, y] = hangingSession.date.split('/');
    const forcedOffDate = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00+07:00`);
    
    // Nếu hiện tại đã qua 00:05 ngày mới → chốt luôn
    if (now.getTime() >= forcedOffDate.getTime() + 5 * 60 * 1000) {
      const onTimeStr = hangingSession.onTime.split(' - ')[0];
      const onDateTime = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')} ${onTimeStr}+07:00`);

      let elapsedHours = (forcedOffDate - onDateTime) / (1000 * 60 * 60);
      elapsedHours = Math.max(0, elapsedHours); // tránh âm

      // Chỉ tính tối đa 4 tiếng
      const hoursToAdd = Math.min(elapsedHours, 4);
      const salaryEarned = Math.round(hoursToAdd * user.salaryRate * 100) / 100;

      // Cập nhật ca bị treo
     hangingSession.offTime = `23:59 - ${hangingSession.date.split('/').slice(0,2).join('/')}`;
      hangingSession.hours = Math.round(hoursToAdd * 100) / 100;
      hangingSession.salary = salaryEarned;
      hangingSession.status = "Đã Đạt Giới Hạn (Hệ Thống Tự Động)";

      // Cộng lương sự nghiệp + tháng
      user.careerTotal = Math.round((user.careerTotal + salaryEarned) * 100) / 100;

      const monthKey = today.split('/').slice(1).join('/'); // 10/2025
      let monthData = user.monthlyHistory.find(h => h.month === monthKey);
      if (!monthData) {
        monthData = { month: monthKey, hours: 0, salary: 0 };
        user.monthlyHistory.unshift(monthData);
      }
      monthData.hours = Math.round((monthData.hours + hoursToAdd) * 100) / 100;
      monthData.salary = Math.round((monthData.salary + salaryEarned) * 100) / 100;

      saveDB(db);
      console.log(`[AUTO OFF] ${user.displayName} bị treo ca → tự động chốt lúc 00:00`);
    }
  }

  next();
});
// ADMIN: Đổi role
app.post("/admin/role/:id", requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === parseInt(req.params.id));
  if (user && ['admin', 'user'].includes(req.body.role)) {
    user.role = req.body.role;
    saveDB(db);
  }
  res.redirect("/admin?success=updated");
});

// ADMIN: Xóa tài khoản
app.post("/admin/delete/:id", requireAdmin, (req, res) => {
  const db = loadDB();
  const index = db.users.findIndex(u => u.id === parseInt(req.params.id));
  if (index !== -1) {
    db.users.splice(index, 1);
    // Reset lại ID cho đẹp (tùy chọn)
    db.users.forEach((u, i) => u.id = i + 1);
    saveDB(db);
  }
  res.redirect("/admin?success=deleted");
});
// RESET LƯƠNG TOÀN SERVER (chỉ 1 nút + confirm đơn giản)
app.post("/admin/reset-all-salary", requireAdmin, (req, res) => {
  const db = loadDB();
  db.users.forEach(u => {
    u.attendance = [];
    u.monthlyHistory = [];
    u.careerTotal = 0;
  });
  saveDB(db);
  res.redirect("/admin-panel");
});
// Reset lương cá nhân (bấm 1 phát là sạch)
app.post("/admin/reset-salary/:id", requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id == req.params.id);
  if (user) {
    user.attendance = [];
    user.monthlyHistory = [];
    user.careerTotal = 0;
    saveDB(db);
  }
  res.redirect("/admin-panel");
});

// Reset toàn server (1 nút đỏ nhỏ xíu)
app.post("/admin/reset-all-salary", requireAdmin, (req, res) => {
  const db = loadDB();
  db.users.forEach(u => {
    u.attendance = [];
    u.monthlyHistory = [];
    u.careerTotal = 0;
  });
  saveDB(db);
  res.redirect("/admin-panel");
});
// RESET CHẤM CÔNG CỦA 1 NGƯỜI TRONG 1 NGÀY CỤ THỂ (dd/mm/yyyy)
app.post("/admin/reset-day/:id", requireAdmin, (req, res) => {
  const db = loadDB();
  const userId = parseInt(req.params.id);
  const dateToDelete = req.body.date?.trim(); // ví dụ: 03/12/2025

  const user = db.users.find(u => u.id === userId);
  if (!user || !dateToDelete) return res.redirect("/admin-panel");

  const oldLength = user.attendance.length;

  // Xóa sạch bản ghi của ngày đó
  user.attendance = user.attendance.filter(r => r.date !== dateToDelete);

  // Nếu có xóa được thì cập nhật lại tổng lương sự nghiệp
  if (user.attendance.length < oldLength) {
    user.careerTotal = user.attendance.reduce((s, r) => s + (r.salary || 0), 0);
  }
  
  saveDB(db);
  res.redirect("/admin-panel");
});
app.listen(PORT, () => {
  console.log(`PA Timekeeping System chạy tại http://localhost:${PORT}`);
  
});