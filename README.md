# StreamSphere Video Meeting

StreamSphere Video Meeting is a real-time video conferencing application built using React, Node.js, Socket.IO, and WebRTC. It allows users to create or join secure meeting rooms, communicate through audio/video, share screens, chat, manage participants, and use host moderation controls.

## Features

- Create unique meeting rooms and shareable meeting links
- Join meetings using a room code or meeting URL
- One-to-one and group WebRTC video calls
- Microphone mute/unmute
- Camera on/off
- Front/rear camera switching on supported devices
- Camera and microphone device selection
- Screen sharing
- Raise/lower hand
- Real-time participant list
- Participant mic and camera status
- Active speaker indication
- Real-time meeting chat
- Emoji reactions in chat
- File sharing up to 2 MB
- Meeting duration timer
- Connection quality indicator
- Low-bandwidth video adaptation
- Automatic reconnection and refresh/rejoin support

## Host Controls

Hosts and authorized co-hosts can:

- Mute participants
- Remove participants
- Assign or remove co-host access
- Lock or unlock the meeting
- Enable or disable participant chat
- Enable or disable screen sharing
- End the meeting for everyone

## Recording

The meeting host can optionally create a local recording using the browser MediaRecorder API.

The current recording feature records the host's local media stream and downloads the recording as a `.webm` file.

## Security

- WebRTC media is encrypted in transit using DTLS-SRTP.
- Meeting host actions are protected using a generated host key.
- The application does not claim to implement a custom end-to-end encryption protocol.
- For a production deployment, HTTPS, stronger user authentication, persistent storage, and a TURN server should be added.

## Technology Stack

### Frontend
- React
- Vite
- JavaScript
- Custom CSS
- Socket.IO Client
- WebRTC APIs

### Backend
- Node.js
- Express.js
- Socket.IO

## How to Run

### Backend

```bash
cd backend
npm install
npm start
