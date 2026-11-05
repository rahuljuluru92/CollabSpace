import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

// Express 5 forwards rejected promises from async handlers here.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const status =
    (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;

  // body-parser errors (malformed JSON, payload too large) carry a 4xx status.
  if (typeof status === "number" && status >= 400 && status < 500) {
    return res.status(status).json({ error: (err as Error).message || "Bad request" });
  }

  (req.log ?? logger).error({ err }, "Unhandled request error");
  return res.status(500).json({ error: "Internal server error" });
}
