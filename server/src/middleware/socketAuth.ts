import jwt from "jsonwebtoken";
import { UserPayload } from "../types/UserPayload";

export function socketAuth(socket: any, next: any) {
  const token = socket.handshake.auth?.token;

  if (!token) return next(new Error("NO_TOKEN"));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as UserPayload;
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("INVALID_TOKEN"));
  }
}
