# SmartRide Monorepo

SmartRide được tách thành 2 phần:

- `frontend/`: React + Vite
- `backend/`: Node.js + Express

Tai lieu nay la huong dan tu chay tu A den Z, khong can chat them.

## 1) Yeu cau truoc khi chay

- Node.js 18+ (khuyen nghi ban LTS moi)
- npm (di kem Node.js)
- He dieu hanh: Windows/macOS/Linux deu chay duoc

## 2) Cai dat lan dau

Chay tai thu muc goc du an:

```bash
npm install
```

## 3) Cau hinh bien moi truong

### Backend

Sao chep file mau `backend/.env.example` thanh `backend/.env`.

Bien co ban:

- `PORT=4000`
- `CORS_ORIGIN=http://localhost:5173`
- `GOOGLE_MAPS_SERVER_API_KEY=...` (khuyen nghi dat key rieng cho server)
- `GOOGLE_AUTH_CLIENT_ID=...` (Google OAuth Web Client ID de verify Google Sign-In token)
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_TLS_REJECT_UNAUTHORIZED=true` (dat `false` neu may dev nam sau proxy SSL inspection)
- `SMTP_USER=your-gmail@gmail.com`
- `SMTP_PASSWORD=...` (App Password cua Gmail)
- `SMTP_FROM_EMAIL=your-gmail@gmail.com`
- `SIGNUP_OTP_EXPIRES_MINUTES=10`
- `SIGNUP_OTP_RESEND_COOLDOWN_SECONDS=60`

### Frontend

Sao chep file mau `frontend/.env.example` thanh `frontend/.env`.

Bien co ban:

- `VITE_API_BASE_URL=http://localhost:4000/api`
- `VITE_GOOGLE_MAPS_API_KEY=...` (key cho trinh duyet)
- `VITE_GOOGLE_AUTH_CLIENT_ID=...` (Google OAuth Web Client ID dung cho popup dang nhap Google)

Luu y:

- Neu chua co Google key, app van chay nho fallback geocoding.
- De so lieu quang duong sat thuc te hon, nen bat Billing + Directions API cho key backend.
- De gui ma xac nhan dang ky qua Gmail, can bat 2FA va tao App Password cho `SMTP_PASSWORD`.

## 4) Chay app (cach nhanh nhat)

Tu thu muc goc du an, chay:

```bash
npm run dev
```

Sau khi chay thanh cong:

- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- Script se tu dong mo Chrome vao trang frontend.

Neu muon tat tinh nang tu mo Chrome:

PowerShell:

```powershell
$env:SMARTRIDE_AUTO_OPEN_CHROME='false'; npm run dev
```

## 5) Kiem tra backend da len

Mo trinh duyet hoac terminal va truy cap:

```text
http://localhost:4000/api/health
```

Ket qua mong doi:

```json
{
	"success": true,
	"message": "SmartRide API is running"
}
```

## 6) Dung app

Tai terminal dang chay `npm run dev`, nhan:

```text
Ctrl + C
```

## 7) Neu muon chay rieng tung phan

### Cach A: dung script workspace

Terminal 1:

```bash
npm run dev --workspace backend
```

Terminal 2:

```bash
npm run dev --workspace frontend
```

### Cach B: script rut gon trong root

Terminal 1:

```bash
npm run dev:backend
```

Terminal 2:

```bash
npm run dev:frontend
```

## 8) Build ban production

```bash
npm run build
```

## 9) Loi thuong gap

### Port bi chiem (5173 hoac 4000)

- Thu dung app bang `Ctrl + C` roi chay lai `npm run dev`.
- Script `scripts/dev.mjs` da co co che don port truoc khi start.

### Google API thong bao Billing hoac Request Denied

- Frontend va backend van fallback de app tiep tuc hoat dong.
- Neu can quang duong chinh xac cao hon, bat Billing + Directions API cho key backend.

## 10) Lenh nhanh cho nguoi moi

Chi can nho 3 lenh sau:

```bash
npm install
npm run dev
# mo http://localhost:5173
```
