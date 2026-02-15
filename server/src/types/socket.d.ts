import "socket.io";
import type { UserPayload } from "./UserPayload";

declare module "socket.io" {
  interface Socket {
    user: UserPayload;
  }
}
