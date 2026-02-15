import { Server, Socket } from "socket.io";
import { socketAuth } from "../middleware/socketAuth";
import workspaceSocket from "./workspace";

export default function setupSockets(httpServer: any) {
  const io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_ORIGIN ?? "*" }
  });

  io.use(socketAuth);

  io.on("connection", (socket: Socket) => {
    console.log("User connected:", socket.user);

    workspaceSocket(io, socket);
  });

  return io;
}
