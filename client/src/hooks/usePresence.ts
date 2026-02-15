import { useEffect, useRef, useCallback } from "react";
import { throttle } from "lodash";
import type { Socket } from "socket.io-client";

type Cursor = { x: number; y: number };

export function usePresence(
    socket: Socket | null,
    workspaceId: string,
    containerRef: React.RefObject<HTMLElement>
) {
    const onMouseMove = useCallback(
        throttle((event: MouseEvent) => {
            if (!socket || !containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const cursor: Cursor = { x, y };
            socket.emit("cursor:update", { workspaceId, cursor });
        }, 50),
        [socket, workspaceId]
    );

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        container.addEventListener("mousemove", onMouseMove);
        container.addEventListener("mouseleave", () => {
            socket?.emit("cursor:update", { workspaceId, cursor: null });
        });

        return () => {
            container.removeEventListener("mousemove", onMouseMove);
            onMouseMove.cancel();
        };
    }, [onMouseMove]);
}
