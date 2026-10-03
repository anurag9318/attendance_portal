# Student Attendance Portal — JSON v2.2

Node.js + Express attendance portal using a local JSON file (`data/db.json`). No MySQL/SQL database is required.

## Features
- Separate Admin and Student login
- JSON file storage
- Student can mark **Present only**, once per day
- Student attendance is available only after the portal opens
- Student cannot edit/change submitted attendance
- Admin can mark individual students Present/Absent
- Admin can mark all Present/Absent
- Daily attendance management
- Current-day Reset Attendance
- Admin can open, close, reopen and finalize attendance
- Admin can declare today or upcoming holidays
- Saturday and Sunday are always holidays
- Automatic daily opening at 08:00 IST
- Automatic daily closing at 11:40 IST
- Automatic finalization at 11:40 by default (configurable)
- Admin can manually open/close/reopen/finalize when needed
- Daily and monthly Excel exports

## Install
```bash
npm install
npm run seed
npm start
```
Open `http://localhost:5000`.

## Demo credentials
- Admin: `admin` / `Admin@123`
- Student: `st001` / `Student@123`

## Automatic schedule
Default `.env` values:
```env
PORT=5000
JWT_SECRET=change_this_secret
NODE_ENV=development
ATTENDANCE_OPEN_TIME=08:00
ATTENDANCE_CLOSE_TIME=11:40
AUTO_FINALIZE=true
```
Times use **Asia/Kolkata (IST)**. On weekdays, the portal automatically opens at 08:00 and closes at 11:40. If `AUTO_FINALIZE=true`, it also finalizes at 11:40. Admin can manually override the automatic state using Open, Close, Reopen, or Finalize.

## Holidays
Admin can use **Holidays** to declare today's or any future date as a holiday. Students cannot submit attendance on declared holidays. Saturday and Sunday are permanent holidays.

## Reset Today
Reset Today deletes only today's attendance, clears today's finalization/holiday state, and manually reopens today's student portal. It is intended for correcting accidental attendance entries.

## Data
All application data is stored in:
```text
data/db.json
```
Do not commit real student data to a public repository.
