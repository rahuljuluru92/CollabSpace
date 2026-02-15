import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:3001";

export function createSocket(token: string): Socket {
  return io(SOCKET_URL, {
    auth: { token },
    autoConnect: false,
    reconnection: true
  });
}
