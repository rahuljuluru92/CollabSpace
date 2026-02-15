import { Request, Response } from "express";
import { Workspace, WorkspaceDocument } from "../models/Workspace";
import { User } from "../models/User";
import { ActivityLog, ActivityLogDocument } from "../models/ActivityLog";
import { logActivity } from "../services/activity";

export async function listWorkspaces(req: Request, res: Response) {
  const userId = req.user!.id;
  const workspaces = await Workspace.find({
    $or: [{ ownerId: userId }, { members: userId }]
  })
    .sort({ updatedAt: -1 })
    .lean<WorkspaceDocument[]>();

  return res.json({
    workspaces: workspaces.map((ws: WorkspaceDocument) => ({
      id: ws._id.toString(),
      name: ws.name,
      ownerId: ws.ownerId.toString(),
      members: ws.members.map((m: WorkspaceDocument["members"][number]) => m.toString()),
      content: ws.content,
      version: ws.version,
      updatedAt: ws.updatedAt
    }))
  });
}

export async function createWorkspace(req: Request, res: Response) {
  const userId = req.user!.id;
  const { name, content } = req.body as { name?: string; content?: string };

  if (!name) {
    return res.status(400).json({ error: "Missing name" });
  }

  const workspace = await Workspace.create({
    name,
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

  return res.status(201).json({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId.toString(),
      members: workspace.members.map((m: WorkspaceDocument["members"][number]) => m.toString()),
      content: workspace.content,
      version: workspace.version,
      updatedAt: workspace.updatedAt
    }
  });
}

export async function getWorkspace(req: Request, res: Response) {
  const userId = req.user!.id;
  const workspaceId = req.params.id;

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  const isMember =
    workspace.ownerId.toString() === userId ||
    workspace.members
      .map((m: WorkspaceDocument["members"][number]) => m.toString())
      .includes(userId);

  if (!isMember) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const activity = await ActivityLog.find({ workspaceId })
    .sort({ createdAt: -1 })
    .limit(25)
    .lean<ActivityLogDocument[]>();

  return res.json({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId.toString(),
      members: workspace.members.map((m: WorkspaceDocument["members"][number]) => m.toString()),
      content: workspace.content,
      version: workspace.version,
      updatedAt: workspace.updatedAt
    },
    activity: activity.map((log: ActivityLogDocument) => ({
      id: log._id.toString(),
      action: log.action,
      userId: log.userId.toString(),
      metadata: log.metadata ?? {},
      createdAt: log.createdAt
    }))
  });
}

export async function inviteMember(req: Request, res: Response) {
  const userId = req.user!.id;
  const workspaceId = req.params.id;
  const { email } = req.body as { email?: string };

  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  if (workspace.ownerId.toString() !== userId) {
    return res.status(403).json({ error: "Only the owner can invite" });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const memberIds = workspace.members.map((m: WorkspaceDocument["members"][number]) => m.toString());
  let added = false;
  if (!memberIds.includes(user.id)) {
    workspace.members.push(user._id);
    await workspace.save();
    added = true;
  }

  await logActivity({
    workspaceId: workspace._id,
    userId,
    action: "member:invited",
    metadata: { invitedUserId: user.id, invitedEmail: user.email }
  });

  return res.json({
    added,
    member: { id: user.id, name: user.name, email: user.email }
  });
}

export async function deleteWorkspace(req: Request, res: Response) {
  console.log("DELETE request received for id:", req.params.id);
  const userId = req.user!.id;
  const workspaceId = req.params.id;

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  // Owner deletes strictly
  if (workspace.ownerId.toString() === userId) {
    await Workspace.findByIdAndDelete(workspaceId);
    // Also clean up activity logs? Optional but good practice.
    await ActivityLog.deleteMany({ workspaceId: workspace._id });
    return res.json({ success: true, message: "Workspace deleted" });
  }

  // Member leaves
  const memberIndex = workspace.members.findIndex(
    (m: WorkspaceDocument["members"][number]) => m.toString() === userId
  );

  if (memberIndex !== -1) {
    workspace.members.splice(memberIndex, 1);
    await workspace.save();

    await logActivity({
      workspaceId: workspace._id,
      userId,
      action: "member:left"
    });

    return res.json({ success: true, message: "Left workspace" });
  }

  return res.status(403).json({ error: "Not authorized to delete or leave this workspace" });
}
