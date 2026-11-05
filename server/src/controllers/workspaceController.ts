import { Request, Response } from "express";
import { Types } from "mongoose";
import { Workspace } from "../models/Workspace";
import { User } from "../models/User";
import { ActivityLog } from "../models/ActivityLog";
import { activityPage, logActivity } from "../services/activity";
import {
  PREVIEW_LENGTH,
  isWorkspaceMember,
  serializeWorkspace,
  serializeWorkspaceSummary
} from "../services/workspaceSerializer";
import { evictFromWorkspace } from "../sockets/registry";
import {
  LIMITS,
  isEmail,
  isNonEmptyString,
  isValidContent,
  normalizeEmail
} from "../utils/validation";
import { afterCursor, decodeCursor, encodeCursor, parseLimit } from "../utils/pagination";

/** GET /api/workspaces?limit=&cursor= : newest first, with a cursor for the next page. */
export async function listWorkspaces(req: Request, res: Response) {
  const userId = req.user!.id;
  const limit = parseLimit(req.query.limit, 30, 100);
  const cursor = req.query.cursor === undefined ? null : decodeCursor(req.query.cursor);
  if (req.query.cursor !== undefined && !cursor) {
    return res.status(400).json({ error: "Invalid cursor" });
  }

  // The owner is always in `members`, so this covers owned and shared workspaces.
  const match: Record<string, unknown> = { members: new Types.ObjectId(userId) };
  if (cursor) {
    // Aggregation does not cast types, so the _id must be an ObjectId here.
    match.$or = [
      { updatedAt: { $lt: cursor.at } },
      { updatedAt: cursor.at, _id: { $lt: new Types.ObjectId(cursor.id) } }
    ];
  }

  const rows = await Workspace.aggregate<{
    _id: Types.ObjectId;
    name: string;
    ownerId: Types.ObjectId;
    members: Types.ObjectId[];
    version: number;
    updatedAt: Date;
    preview: string;
  }>([
    { $match: match },
    { $sort: { updatedAt: -1, _id: -1 } },
    { $limit: limit + 1 },
    {
      $project: {
        name: 1,
        ownerId: 1,
        members: 1,
        version: 1,
        updatedAt: 1,
        // Only a preview: a page of 200k-character documents would be megabytes.
        preview: { $substrCP: ["$content", 0, PREVIEW_LENGTH] }
      }
    }
  ]);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return res.json({
    workspaces: page.map(serializeWorkspaceSummary),
    nextCursor:
      rows.length > limit && last ? encodeCursor(last.updatedAt, last._id.toString()) : null
  });
}

export async function createWorkspace(req: Request, res: Response) {
  const { id: userId, name: userName } = req.user!;
  const { name, content } = (req.body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(name, LIMITS.workspaceNameMax)) {
    return res
      .status(400)
      .json({ error: `Name is required (max ${LIMITS.workspaceNameMax} characters)` });
  }
  if (content !== undefined && !isValidContent(content)) {
    return res.status(400).json({ error: "Invalid content" });
  }

  const workspace = await Workspace.create({
    name: name.trim(),
    ownerId: userId,
    members: [userId],
    content: content ?? "",
    version: 1
  });

  await logActivity({
    workspaceId: workspace._id,
    userId,
    userName,
    action: "workspace:created"
  });

  return res.status(201).json({ workspace: serializeWorkspaceSummary(workspace) });
}

/** GET /api/workspaces/:id : the full workspace (content included). */
export async function getWorkspace(req: Request, res: Response) {
  const userId = req.user!.id;

  const workspace = await Workspace.findById(req.params.id).select("-recentEdits");
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }
  if (!isWorkspaceMember(userId, workspace)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return res.json({ workspace: serializeWorkspace(workspace) });
}

/** GET /api/workspaces/:id/activity?before=&limit= : older activity, newest first. */
export async function listActivity(req: Request, res: Response) {
  const userId = req.user!.id;

  const workspace = await Workspace.findById(req.params.id).select("ownerId members");
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }
  if (!isWorkspaceMember(userId, workspace)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const limit = parseLimit(req.query.limit, 25, 100);
  const before = req.query.before === undefined ? null : decodeCursor(req.query.before);
  if (req.query.before !== undefined && !before) {
    return res.status(400).json({ error: "Invalid cursor" });
  }

  const filter = {
    workspaceId: workspace._id,
    ...(before ? afterCursor("createdAt", before) : {})
  };
  return res.json(await activityPage(filter, limit));
}

export async function inviteMember(req: Request, res: Response) {
  const { id: userId, name: userName } = req.user!;
  const { email } = (req.body ?? {}) as Record<string, unknown>;

  if (!isEmail(email)) {
    return res.status(400).json({ error: "A valid email is required" });
  }

  const workspace = await Workspace.findById(req.params.id).select("ownerId members");
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  if (workspace.ownerId.toString() !== userId) {
    return res.status(403).json({ error: "Only the owner can invite" });
  }

  const user = await User.findOne({ email: normalizeEmail(email) });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Atomic: the filter only matches if the user is not a member yet, so
  // concurrent invites cannot add duplicates. (modifiedCount can't be used:
  // timestamps make every matched update bump updatedAt.)
  const result = await Workspace.updateOne(
    { _id: workspace._id, members: { $ne: user._id } },
    { $push: { members: user._id } }
  );
  const added = result.matchedCount > 0;

  if (added) {
    await logActivity({
      workspaceId: workspace._id,
      userId,
      userName,
      action: "member:invited",
      metadata: { invitedUserId: user.id, invitedName: user.name, invitedEmail: user.email }
    });
  }

  return res.json({
    added,
    member: { id: user.id, name: user.name, email: user.email }
  });
}

export async function deleteWorkspace(req: Request, res: Response) {
  const { id: userId, name: userName } = req.user!;
  const workspaceId = req.params.id as string;

  const workspace = await Workspace.findById(workspaceId).select("ownerId members");
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  // Owner deletes the workspace entirely.
  if (workspace.ownerId.toString() === userId) {
    await Workspace.deleteOne({ _id: workspace._id });
    await ActivityLog.deleteMany({ workspaceId: workspace._id });
    await evictFromWorkspace(workspaceId);
    return res.json({ success: true, message: "Workspace deleted" });
  }

  // A member leaves. The filter only matches while they are still a member.
  const result = await Workspace.updateOne(
    { _id: workspace._id, members: userId },
    { $pull: { members: userId } }
  );

  if (result.matchedCount > 0) {
    await logActivity({
      workspaceId: workspace._id,
      userId,
      userName,
      action: "member:left"
    });
    await evictFromWorkspace(workspaceId, userId);
    return res.json({ success: true, message: "Left workspace" });
  }

  return res.status(403).json({ error: "Not authorized to delete or leave this workspace" });
}
