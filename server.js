require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");

const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_env";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");
const ATTENDANCE_OPEN_TIME = process.env.ATTENDANCE_OPEN_TIME || "08:00";
const ATTENDANCE_CLOSE_TIME = process.env.ATTENDANCE_CLOSE_TIME || "11:40";
const AUTO_FINALIZE = String(process.env.AUTO_FINALIZE || "true").toLowerCase() === "true";

function initialDb() {
  return {
    counters: { user: 1, student: 1, attendance: 1, settings: 1 },
    users: [],
    students: [],
    attendance: [],
    attendance_settings: []
  };
}

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialDb(), null, 2));
  }
}

function readDb() {
  ensureDb();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { ...initialDb(), ...parsed };
  } catch (err) {
    throw new Error(`Unable to read JSON database: ${err.message}`);
  }
}

function writeDb(db) {
  ensureDb();
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

function nextId(db, type) {
  const id = Number(db.counters[type] || 1);
  db.counters[type] = id + 1;
  return id;
}

function todayIndia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function nowIso() {
  return new Date().toISOString();
}

function istNowParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short"
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")), weekday: get("weekday") };
}
function minutes(hhmm) { const [h,m] = hhmm.split(":").map(Number); return h * 60 + m; }
function isWeekend(date) { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 || d === 6; }
function todayMinutes() { const x = istNowParts(); return x.hour * 60 + x.minute; }
function defaultControlMode(setting) { return setting.control_mode || "auto"; }

function applyAutomaticSchedule(db, date = todayIndia()) {
  const st = db.attendance_settings.find(x => x.attendance_date === date);
  if (!st) return;
  if (isWeekend(date)) {
    st.is_holiday = 1;
    st.holiday_reason = st.holiday_reason || "Weekend (Saturday/Sunday)";
    st.is_open = 0;
    return;
  }
  if (st.is_holiday || st.is_finalized || defaultControlMode(st) !== "auto") return;
  if (date !== todayIndia()) return;
  const now = todayMinutes(), openAt = minutes(ATTENDANCE_OPEN_TIME), closeAt = minutes(ATTENDANCE_CLOSE_TIME);
  if (now >= openAt && now < closeAt) {
    st.is_open = 1;
    if (!st.opened_at) st.opened_at = nowIso();
  } else if (now >= closeAt) {
    st.is_open = 0;
    if (!st.closed_at) st.closed_at = nowIso();
    if (AUTO_FINALIZE) {
      st.is_finalized = 1;
      if (!st.finalized_at) st.finalized_at = nowIso();
      db.attendance.filter(a => a.attendance_date === date).forEach(a => {
        a.finalized = 1;
        a.finalized_at = st.finalized_at;
      });
    }
  } else {
    st.is_open = 0;
  }
}

function saveAndSchedule(db, date) {
  applyAutomaticSchedule(db, date);
  writeDb(db);
}

function getSetting(db, date = todayIndia()) {
  let setting = db.attendance_settings.find(x => x.attendance_date === date);
  if (!setting) {
    setting = {
      id: nextId(db, "settings"),
      attendance_date: date,
      is_open: 0,
      is_finalized: 0,
      opened_at: null,
      closed_at: null,
      finalized_at: null,
      opened_by: null,
      closed_by: null,
      finalized_by: null,
      is_holiday: 0,
      holiday_reason: null,
      holiday_announced_at: null,
      holiday_announced_by: null,
      control_mode: "auto"
    };
    db.attendance_settings.push(setting);
    writeDb(db);
  }
  applyAutomaticSchedule(db, date);
  return setting;
}

function auth(req, res, next) {
  const token = req.cookies.token || (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Authentication required." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired session." });
  }
}

function role(name) {
  return (req, res, next) => req.user?.role === name
    ? next()
    : res.status(403).json({ message: `${name} access required.` });
}

function issue(res, user) {
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: "8h" });
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  });
}

function publicStudent(student, user) {
  return {
    id: student.id,
    student_id: student.student_id,
    name: student.name,
    email: student.email,
    phone: student.phone,
    roll_number: student.roll_number,
    class_name: student.class_name,
    status: student.status,
    username: user?.username || null
  };
}

function findStudentByUser(db, userId) {
  return db.students.find(s => Number(s.user_id) === Number(userId));
}

function findUser(db, id) {
  return db.users.find(u => Number(u.id) === Number(id));
}

function attendanceFor(db, studentId, date) {
  return db.attendance.find(a => Number(a.student_id) === Number(studentId) && a.attendance_date === date);
}

function upsertAttendance(db, studentId, date, status, markedBy) {
  let record = attendanceFor(db, studentId, date);
  const stamp = nowIso();
  if (record) {
    record.status = status;
    record.marked_at = stamp;
    record.marked_by = markedBy;
    record.finalized = 0;
    record.finalized_at = null;
    record.finalized_by = null;
  } else {
    record = {
      id: nextId(db, "attendance"),
      student_id: studentId,
      attendance_date: date,
      status,
      marked_at: stamp,
      marked_by: markedBy,
      finalized: 0,
      finalized_at: null,
      finalized_by: null
    };
    db.attendance.push(record);
  }
  return record;
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { message: "Too many login attempts. Try again later." }
});
app.use("/api/auth", loginLimit);

app.post("/api/auth/:role/login", async (req, res, next) => {
  try {
    const roleName = req.params.role;
    if (!["admin", "student"].includes(roleName)) return res.status(404).json({ message: "Invalid login type." });
    const { username, password } = req.body;
    const db = readDb();
    const user = db.users.find(u => u.username === (username || "").trim() && u.role === roleName);
    if (!user || user.status !== "active" || !(await bcrypt.compare(password || "", user.password_hash))) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    issue(res, { id: user.id, username: user.username, role: user.role });
    res.json({ message: "Login successful.", user: { id: user.id, username: user.username, role: user.role } });
  } catch (e) { next(e); }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out." });
});

app.get("/api/auth/me", auth, async (req, res, next) => {
  try {
    const db = readDb();
    if (req.user.role === "student") {
      const student = findStudentByUser(db, req.user.id);
      if (!student) return res.status(404).json({ message: "Student profile not found." });
      return res.json({ user: publicStudent(student, findUser(db, req.user.id)) });
    }
    res.json({ user: req.user });
  } catch (e) { next(e); }
});

app.get("/api/attendance/settings", auth, async (req, res, next) => {
  try {
    const db = readDb();
    const date = req.query.date || todayIndia();
    const settings = getSetting(db, date);
    res.json({ settings, schedule: { open: ATTENDANCE_OPEN_TIME, close: ATTENDANCE_CLOSE_TIME, autoFinalize: AUTO_FINALIZE, weekendHoliday: true } });
  } catch (e) { next(e); }
});

app.get("/api/attendance/today", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const date = todayIndia();
    const st = getSetting(db, date);
    writeDb(db);
    const students = db.students
      .filter(s => s.status === "active")
      .map(s => {
        const a = attendanceFor(db, s.id, date);
        return {
          id: s.id,
          student_id: s.student_id,
          name: s.name,
          roll_number: s.roll_number,
          class_name: s.class_name,
          status: a?.status || "Not Marked",
          marked_at: a?.marked_at || null
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const total = students.length;
    const present = students.filter(s => s.status === "Present").length;
    const absent = students.filter(s => s.status === "Absent").length;
    res.json({ date, settings: st, students, stats: { total, present, absent } });
  } catch (e) { next(e); }
});

app.post("/api/attendance/mark", auth, async (req, res, next) => {
  try {
    const db = readDb();
    const date = todayIndia();
    const st = getSetting(db, date);
    const status = req.body.status;
    if (!["Present", "Absent"].includes(status)) return res.status(400).json({ message: "Invalid status." });
    if (isWeekend(date)) return res.status(409).json({ message: "Saturday and Sunday are holidays. Attendance cannot be marked." });
    if (st.is_holiday) return res.status(409).json({ message: st.holiday_reason ? `Today is a holiday: ${st.holiday_reason}` : "Today has been declared a holiday." });
    if (st.is_finalized) return res.status(409).json({ message: "Attendance is finalized and locked." });
    if (req.user.role === "student" && status !== "Present") return res.status(403).json({ message: "Students can only mark Present." });
    if (req.user.role === "student" && !st.is_open) return res.status(409).json({ message: "Student attendance is currently closed." });

    let studentDbId = Number(req.body.studentId);
    if (req.user.role === "student") {
      const student = findStudentByUser(db, req.user.id);
      if (!student || student.status !== "active") return res.status(404).json({ message: "Student profile not found." });
      studentDbId = student.id;
    } else if (!studentDbId) return res.status(400).json({ message: "Student ID is required." });

    const student = db.students.find(s => Number(s.id) === studentDbId && s.status === "active");
    if (!student) return res.status(404).json({ message: "Student not found." });
    if (req.user.role === "student" && attendanceFor(db, studentDbId, date)) {
      return res.status(409).json({ message: "Your attendance is already marked and cannot be changed." });
    }
    upsertAttendance(db, studentDbId, date, status, req.user.id);
    writeDb(db);
    res.json({ message: "Attendance saved.", date, status });
  } catch (e) { next(e); }
});

app.post("/api/attendance/mark-all", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const date = todayIndia();
    const st = getSetting(db, date);
    const status = req.body.status;
    if (!["Present", "Absent"].includes(status)) return res.status(400).json({ message: "Invalid status." });
    if (isWeekend(date)) return res.status(409).json({ message: "Saturday and Sunday are holidays. Attendance cannot be marked." });
    if (st.is_holiday) return res.status(409).json({ message: "Today is declared a holiday. Attendance cannot be marked." });
    if (st.is_finalized) return res.status(409).json({ message: "Attendance is finalized and locked." });
    const students = db.students.filter(s => s.status === "active");
    for (const s of students) upsertAttendance(db, s.id, date, status, req.user.id);
    writeDb(db);
    res.json({ message: `All students marked ${status}.`, count: students.length });
  } catch (e) { next(e); }
});

app.post("/api/attendance/holiday", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const date = String(req.body.date || todayIndia());
    const reason = String(req.body.reason || "Holiday").trim().slice(0, 200) || "Holiday";
    const today = todayIndia();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "Invalid holiday date." });
    if (date < today) return res.status(400).json({ message: "Holiday date cannot be in the past." });
    const st = getSetting(db, date);
    if (st.is_finalized && date === today) return res.status(409).json({ message: "Today's attendance is finalized and locked." });
    st.is_holiday = 1;
    st.holiday_reason = isWeekend(date) ? "Weekend (Saturday/Sunday)" : reason;
    st.holiday_announced_at = nowIso();
    st.holiday_announced_by = req.user.id;
    st.is_open = 0;
    st.control_mode = "manual_closed";
    if (date === today) { st.closed_at = nowIso(); st.closed_by = req.user.id; }
    writeDb(db);
    res.json({ message: date === today ? "Today has been declared a holiday." : `Holiday scheduled for ${date}.`, settings: st });
  } catch (e) { next(e); }
});

app.get("/api/attendance/holidays", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const from = String(req.query.from || todayIndia());
    const holidays = db.attendance_settings
      .filter(s => s.is_holiday && s.attendance_date >= from)
      .sort((a,b) => a.attendance_date.localeCompare(b.attendance_date))
      .map(s => ({ date: s.attendance_date, reason: s.holiday_reason || "Holiday", weekend: isWeekend(s.attendance_date) }));
    res.json({ holidays });
  } catch (e) { next(e); }
});

app.post("/api/attendance/remove-holiday", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const date = String(req.body.date || todayIndia());
    const st = getSetting(db, date);
    if (isWeekend(date)) return res.status(409).json({ message: "Saturday and Sunday are permanent holidays and cannot be removed." });
    st.is_holiday = 0;
    st.holiday_reason = null;
    st.holiday_announced_at = null;
    st.holiday_announced_by = null;
    st.control_mode = "auto";
    if (date === todayIndia()) applyAutomaticSchedule(db, date);
    writeDb(db);
    res.json({ message: "Holiday declaration removed.", settings: st });
  } catch (e) { next(e); }
});

app.post("/api/attendance/reset", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const date = todayIndia();
    const st = getSetting(db, date);
    db.attendance = db.attendance.filter(a => a.attendance_date !== date);
    st.is_open = 1;
    st.control_mode = "manual_open";
    st.is_finalized = 0;
    st.opened_at = nowIso();
    st.opened_by = req.user.id;
    st.closed_at = null;
    st.closed_by = null;
    st.finalized_at = null;
    st.finalized_by = null;
    st.is_holiday = 0;
    st.holiday_reason = null;
    st.holiday_announced_at = null;
    st.holiday_announced_by = null;
    writeDb(db);
    res.json({ message: "Today's attendance has been reset and the student portal is open again.", settings: st });
  } catch (e) { next(e); }
});

async function settingAction(req, res, action) {
  const db = readDb();
  const date = todayIndia();
  const st = getSetting(db, date);
  const stamp = nowIso();
  if (action === "open") {
    if (st.is_holiday) return res.status(409).json({ message: "Today is a holiday. Remove the holiday declaration before opening attendance." });
    st.is_open = 1; st.control_mode = "manual_open"; st.opened_at = stamp; st.opened_by = req.user.id;
  }
  if (action === "close") {
    st.is_open = 0; st.control_mode = "manual_closed"; st.closed_at = stamp; st.closed_by = req.user.id;
  }
  if (action === "finalize") {
    st.is_open = 0; st.control_mode = "manual_closed"; st.is_finalized = 1; st.finalized_at = stamp; st.finalized_by = req.user.id;
    db.attendance.filter(a => a.attendance_date === date).forEach(a => {
      a.finalized = 1; a.finalized_at = stamp; a.finalized_by = req.user.id;
    });
  }
  if (action === "reopen") {
    if (st.is_holiday) return res.status(409).json({ message: "Today is a holiday. Remove the holiday declaration before reopening attendance." });
    st.is_open = 1; st.control_mode = "manual_open"; st.is_finalized = 0; st.finalized_at = null; st.finalized_by = null;
    db.attendance.filter(a => a.attendance_date === date).forEach(a => {
      a.finalized = 0; a.finalized_at = null; a.finalized_by = null;
    });
  }
  writeDb(db);
  res.json({ message: `Attendance ${action} completed.`, settings: st });
}
for (const action of ["open", "close", "finalize", "reopen"]) {
  app.post(`/api/attendance/${action}`, auth, role("admin"), (req, res, next) => settingAction(req, res, action).catch(next));
}

app.get("/api/attendance/my-history", auth, role("student"), async (req, res, next) => {
  try {
    const db = readDb();
    const student = findStudentByUser(db, req.user.id);
    if (!student) return res.status(404).json({ message: "Student profile not found." });
    const history = db.attendance
      .filter(a => Number(a.student_id) === Number(student.id))
      .sort((a, b) => b.attendance_date.localeCompare(a.attendance_date))
      .slice(0, 366)
      .map(a => ({ attendance_date: a.attendance_date, status: a.status, marked_at: a.marked_at }));
    const total = history.length;
    const present = history.filter(a => a.status === "Present").length;
    const absent = history.filter(a => a.status === "Absent").length;
    res.json({ history, stats: { total, present, absent } });
  } catch (e) { next(e); }
});

app.get("/api/students", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const students = db.students.map(s => publicStudent(s, findUser(db, s.user_id))).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ students });
  } catch (e) { next(e); }
});

app.post("/api/students", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const { studentId, name, email, phone, rollNumber, className, username, password } = req.body;
    if (!studentId || !name || !username || !password) return res.status(400).json({ message: "Student ID, name, username and password are required." });
    const sid = String(studentId).trim();
    const uname = String(username).trim();
    if (db.students.some(s => s.student_id.toLowerCase() === sid.toLowerCase())) return res.status(409).json({ message: "Student ID already exists." });
    if (db.users.some(u => u.username.toLowerCase() === uname.toLowerCase())) return res.status(409).json({ message: "Username already exists." });
    const hash = await bcrypt.hash(password, 12);
    const user = { id: nextId(db, "user"), username: uname, password_hash: hash, role: "student", status: "active", created_at: nowIso(), updated_at: nowIso() };
    const student = {
      id: nextId(db, "student"), user_id: user.id, student_id: sid, name: String(name).trim(),
      email: email || null, phone: phone || null, roll_number: rollNumber || null,
      class_name: className || null, status: "active", created_at: nowIso(), updated_at: nowIso()
    };
    db.users.push(user); db.students.push(student); writeDb(db);
    res.status(201).json({ message: "Student created." });
  } catch (e) { next(e); }
});

app.delete("/api/students/:id", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const student = db.students.find(s => Number(s.id) === Number(req.params.id));
    if (!student) return res.status(404).json({ message: "Student not found." });
    student.status = "inactive"; student.updated_at = nowIso();
    const user = findUser(db, student.user_id);
    if (user) { user.status = "inactive"; user.updated_at = nowIso(); }
    writeDb(db);
    res.json({ message: "Student deactivated." });
  } catch (e) { next(e); }
});

function dailyRows(db, date) {
  return db.students.filter(s => s.status === "active").map(s => {
    const a = attendanceFor(db, s.id, date);
    return {
      student_id: s.student_id, name: s.name, roll_number: s.roll_number, class_name: s.class_name,
      attendance_date: date, attendance_status: a?.status || "Not Marked", marked_at: a?.marked_at || null
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

app.get("/api/reports/daily", auth, role("admin"), async (req, res, next) => {
  try { const db = readDb(); const date = req.query.date || todayIndia(); res.json({ date, rows: dailyRows(db, date) }); }
  catch (e) { next(e); }
});

app.get("/api/reports/monthly", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const month = String(req.query.month || todayIndia().slice(0, 7));
    const rows = db.students.filter(s => s.status === "active").flatMap(s =>
      db.attendance.filter(a => a.student_id === s.id && a.attendance_date.startsWith(`${month}-`)).map(a => ({
        student_id: s.student_id, name: s.name, roll_number: s.roll_number, class_name: s.class_name,
        attendance_date: a.attendance_date, status: a.status
      }))
    ).sort((a, b) => a.name.localeCompare(b.name) || a.attendance_date.localeCompare(b.attendance_date));
    res.json({ month, rows });
  } catch (e) { next(e); }
});

app.get("/api/reports/daily/excel", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const date = req.query.date || todayIndia();
    const rows = dailyRows(db, date);
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Daily Attendance");
    ws.columns = [
      { header: "Student ID", key: "student_id", width: 16 }, { header: "Student Name", key: "name", width: 28 },
      { header: "Roll Number", key: "roll_number", width: 16 }, { header: "Class", key: "class_name", width: 18 },
      { header: "Date", key: "attendance_date", width: 15 }, { header: "Status", key: "attendance_status", width: 18 },
      { header: "Marked At", key: "marked_at", width: 24 }
    ];
    ws.addRows(rows); ws.getRow(1).font = { bold: true }; ws.autoFilter = "A1:G1";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="attendance_${date}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  } catch (e) { next(e); }
});

app.get("/api/reports/monthly/excel", auth, role("admin"), async (req, res, next) => {
  try {
    const db = readDb();
    const month = String(req.query.month || todayIndia().slice(0, 7));
    const year = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)), totalDays = new Date(year, m, 0).getDate();
    const students = db.students.filter(s => s.status === "active").sort((a, b) => a.name.localeCompare(b.name));
    const map = new Map();
    db.attendance.filter(a => a.attendance_date.startsWith(`${month}-`)).forEach(a => {
      const dayNum = Number(a.attendance_date.slice(8, 10)); map.set(`${a.student_id}-${dayNum}`, a.status);
    });
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Monthly Attendance");
    const cols = [
      { header: "Student ID", key: "student_id", width: 15 }, { header: "Student Name", key: "name", width: 28 },
      { header: "Roll No", key: "roll_number", width: 14 }
    ];
    for (let d = 1; d <= totalDays; d++) cols.push({ header: String(d).padStart(2, "0"), key: `d${d}`, width: 6 });
    cols.push({ header: "Present", key: "present", width: 10 }, { header: "Absent", key: "absent", width: 10 }, { header: "Percentage", key: "percentage", width: 13 });
    ws.columns = cols;
    for (const s of students) {
      const row = { student_id: s.student_id, name: s.name, roll_number: s.roll_number }; let p = 0, a = 0;
      for (let d = 1; d <= totalDays; d++) {
        const v = map.get(`${s.id}-${d}`) || "-"; row[`d${d}`] = v === "Present" ? "P" : v === "Absent" ? "A" : "-";
        if (v === "Present") p++; if (v === "Absent") a++;
      }
      row.present = p; row.absent = a; row.percentage = (p + a ? ((p / (p + a)) * 100).toFixed(2) : "0.00") + "%";
      ws.addRow(row);
    }
    ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="attendance_${month}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  } catch (e) { next(e); }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ message: "Server error." });
});

ensureDb();
if (require.main === module) app.listen(PORT, () => console.log(`Attendance Portal: http://localhost:${PORT}`));
module.exports = { app, DATA_FILE };
