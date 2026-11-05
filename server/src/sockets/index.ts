import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { socketAuth } from "../middleware/socketAuth";
import workspaceSocket from "./workspace";
import { setIo } from "./registry";
import { logger } from "../logger";

export default function setupSockets(httpServer: HttpServer, corsOrigins: string[]) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins },
    // Largest accepted message. Workspace content is capped (in characters) so
    // that even fully escaped JSON fits; anything bigger is dropped by Socket.IO.
    maxHttpBufferSize: 2e6
  });

  io.use(socketAuth);

  io.on("connection", (socket: Socket) => {
    logger.debug({ socketId: socket.id, userId: socket.user.id }, "Socket connected");
    socket.on("disconnect", (reason) => {
      logger.debug({ socketId: socket.id, userId: socket.user.id, reason }, "Socket disconnected");
    });
    workspaceSocket(io, socket);
  });

  setIo(io);
  return io;
}
