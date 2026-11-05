import { Request, Response, NextFunction } from "express";

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

// Express 5 forwards rejected promises from async handlers here.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const status = (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;

  // body-parser errors (malformed JSON, payload too large) carry a 4xx status.
  if (typeof status === "number" && status >= 400 && status < 500) {
    return res.status(status).json({ error: (err as Error).message || "Bad request" });
  }

  console.error("Unhandled request error:", err);
  return res.status(500).json({ error: "Internal server error" });
}
