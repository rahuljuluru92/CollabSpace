import type { Socket } from "socket.io";
import { verifyUserToken } from "../utils/jwt";

export function socketAuth(socket: Socket, next: (err?: Error) => void) {
  const token: unknown = socket.handshake.auth?.token;

  if (typeof token !== "string" || !token) return next(new Error("NO_TOKEN"));

  const user = verifyUserToken(token);
  if (!user) return next(new Error("INVALID_TOKEN"));

  socket.user = user;
  next();
}
