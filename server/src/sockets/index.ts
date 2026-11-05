import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { socketAuth } from "../middleware/socketAuth";
import workspaceSocket from "./workspace";
import { setIo } from "./registry";

export default function setupSockets(httpServer: HttpServer, corsOrigins: string[]) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins },
    // Matches the REST body limit; workspace content is capped well below it.
    maxHttpBufferSize: 1e6
  });

  io.use(socketAuth);

  io.on("connection", (socket: Socket) => {
    workspaceSocket(io, socket);
  });

  setIo(io);
  return io;
}
