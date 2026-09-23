import { io } from "socket.io-client";

export const API_URL = "https://streamsphere-backend-ubio.onrender.com";

export const socket = io(API_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
});
