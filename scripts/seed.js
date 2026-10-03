require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "db.json");
fs.mkdirSync(dataDir, { recursive: true });

const db = {
  counters: { user: 1, student: 1, attendance: 1, settings: 1 },
  users: [], students: [], attendance: [], attendance_settings: []
};

function next(type) { return db.counters[type]++; }
function now() { return new Date().toISOString(); }

(async () => {
  const adminHash = await bcrypt.hash("Admin@123", 12);
  db.users.push({ id: next("user"), username: "admin", password_hash: adminHash, role: "admin", status: "active", created_at: now(), updated_at: now() });

  const sample = [
    ["ST001","Rahul Kumar","rahul@example.com","9000000001","1","BCA"],
    ["ST002","Amit Singh","amit@example.com","9000000002","2","BCA"],
    ["ST003","Ravi Sharma","ravi@example.com","9000000003","3","BCA"],
    ["ST004","Priya Verma","priya@example.com","9000000004","4","BCA"],
    ["ST005","Neha Gupta","neha@example.com","9000000005","5","BCA"],
    ["ST006","Anjali Yadav","anjali@example.com","9000000006","6","BCA"],
    ["ST007","Vikas Kumar","vikas@example.com","9000000007","7","BCA"],
    ["ST008","Pooja Singh","pooja@example.com","9000000008","8","BCA"],
    ["ST009","Mohit Raj","mohit@example.com","9000000009","9","BCA"],
    ["ST010","Sneha Sharma","sneha@example.com","9000000010","10","BCA"]
  ];
  const studentHash = await bcrypt.hash("Student@123", 12);
  for (const [sid, name, email, phone, roll, cls] of sample) {
    const user = { id: next("user"), username: sid.toLowerCase(), password_hash: studentHash, role: "student", status: "active", created_at: now(), updated_at: now() };
    const student = { id: next("student"), user_id: user.id, student_id: sid, name, email, phone, roll_number: roll, class_name: cls, status: "active", created_at: now(), updated_at: now() };
    db.users.push(user); db.students.push(student);
  }
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
  console.log("JSON seed complete.");
  console.log("Admin: admin / Admin@123");
  console.log("Student: st001 / Student@123");
  console.log(`Data file: ${dataFile}`);
})();
