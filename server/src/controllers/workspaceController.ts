import { Request, Response } from "express";
import { Workspace, WorkspaceDocument } from "../models/Workspace";
import { User } from "../models/User";
import { ActivityLog, ActivityLogDocument } from "../models/ActivityLog";
import { logActivity } from "../services/activity";
import {
  isWorkspaceMember,
  serializeActivity,
  serializeWorkspace
} from "../services/workspaceSerializer";
import { evictFromWorkspace } from "../sockets/registry";
import { LIMITS, isEmail, isNonEmptyString, isValidContent, normalizeEmail } from "../utils/validation";

export async function listWorkspaces(req: Request, res: Response) {
  const userId = req.user!.id;
  const workspaces = await Workspace.find({
    $or: [{ ownerId: userId }, { members: userId }]
  })
    .select("-recentEdits")
    .sort({ updatedAt: -1 })
    .lean<WorkspaceDocument[]>();

  return res.json({ workspaces: workspaces.map(serializeWorkspace) });
}

export async function createWorkspace(req: Request, res: Response) {
  const userId = req.user!.id;
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
    action: "workspace:created"
  });

  return res.status(201).json({ workspace: serializeWorkspace(workspace) });
}

export async function getWorkspace(req: Request, res: Response) {
  const userId = req.user!.id;
  const workspaceId = req.params.id;

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  if (!isWorkspaceMember(userId, workspace)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const activity = await ActivityLog.find({ workspaceId })
    .sort({ createdAt: -1 })
    .limit(25)
    .lean<ActivityLogDocument[]>();

  return res.json({
    workspace: serializeWorkspace(workspace),
    activity: activity.map(serializeActivity)
  });
}

export async function inviteMember(req: Request, res: Response) {
  const userId = req.user!.id;
  const workspaceId = req.params.id;
  const { email } = (req.body ?? {}) as Record<string, unknown>;

  if (!isEmail(email)) {
    return res.status(400).json({ error: "A valid email is required" });
  }

  const workspace = await Workspace.findById(workspaceId);
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
      action: "member:invited",
      metadata: { invitedUserId: user.id, invitedEmail: user.email }
    });
  }

  return res.json({
    added,
    member: { id: user.id, name: user.name, email: user.email }
  });
}

export async function deleteWorkspace(req: Request, res: Response) {
  const userId = req.user!.id;
  const workspaceId = req.params.id as string;

  const workspace = await Workspace.findById(workspaceId);
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
      action: "member:left"
    });
    await evictFromWorkspace(workspaceId, userId);
    return res.json({ success: true, message: "Left workspace" });
  }

  return res.status(403).json({ error: "Not authorized to delete or leave this workspace" });
}
