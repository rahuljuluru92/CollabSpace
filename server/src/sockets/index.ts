import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { socketAuth } from "../middleware/socketAuth";
import workspaceSocket from "./workspace";
import { setIo } from "./registry";

export default function setupSockets(httpServer: HttpServer, corsOrigins: string[]) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins },
    // Largest accepted message. Workspace content is capped (in characters) so
    // that even fully escaped JSON fits; anything bigger is dropped by Socket.IO.
    maxHttpBufferSize: 2e6
  });

  io.use(socketAuth);

  io.on("connection", (socket: Socket) => {
    workspaceSocket(io, socket);
  });

  setIo(io);
  return io;
}
