import { useEffect, useMemo } from "react";
import throttle from "lodash/throttle";
import type { Socket } from "socket.io-client";

/** Broadcasts this user's mouse position (relative to `containerRef`) to the workspace. */
export function usePresence(
  socket: Socket | null,
  workspaceId: string,
  containerRef: React.RefObject<HTMLElement>
) {
  const emitCursor = useMemo(
    () =>
      throttle((cursor: { x: number; y: number } | null) => {
        socket?.emit("cursor:update", { workspaceId, cursor });
      }, 50),
    [socket, workspaceId]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !socket) return;

    const onMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      emitCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    const onMouseLeave = () => {
      emitCursor.cancel();
      socket.emit("cursor:update", { workspaceId, cursor: null });
    };

    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseleave", onMouseLeave);

    return () => {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseleave", onMouseLeave);
      emitCursor.cancel();
    };
  }, [socket, workspaceId, containerRef, emitCursor]);
}
