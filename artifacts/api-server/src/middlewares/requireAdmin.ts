import type { NextFunction, Request, Response } from "express";

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!configuredEmail) {
    req.log.error("ADMIN_EMAIL is not configured");
    res.status(503).json({ error: "Administrator access is not configured." });
    return;
  }

  if (req.user.email?.trim().toLowerCase() !== configuredEmail) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }

  next();
}
