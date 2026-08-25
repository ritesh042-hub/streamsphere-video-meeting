# StreamSphere Task 1 Final

Included: unique meeting codes/links, scheduling UI, 1:1 and group WebRTC calls, mic/camera controls, front/rear switching, device switching, screen sharing, leave/end meeting, participant list, raise hand, chat/emojis/files, speaking indicators, mic/camera status, connection quality, call duration, host mute/remove/lock/co-host, chat/screen permissions, reconnection, refresh/rejoin, permission handling, browser noise suppression, low-bandwidth adaptation, participant limits, WebRTC DTLS-SRTP transport encryption, and optional host-only local recording.

Run backend:
cd backend
npm install
npm start

Run frontend:
cd frontend
npm install
npm run dev

Open http://localhost:5173

Notes:
- Files are limited to 2 MB in this demo.
- Scheduled meetings are stored in localStorage.
- Rooms are in backend memory and expire 30 minutes after becoming empty.
- For production deployment, add HTTPS and a TURN server.
- Recording is local and optional.
- WebRTC provides encrypted media transport; this project does not claim custom E2EE.
