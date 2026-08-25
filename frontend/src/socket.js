import { io } from "socket.io-client";

export const API_URL = "http://localhost:5000";

export const socket = io(API_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
});
