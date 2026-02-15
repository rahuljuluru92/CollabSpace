import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createWorkspace, deleteWorkspace, getWorkspace, inviteMember, listWorkspaces } from "../controllers/workspaceController";

const router = Router();

router.get("/", requireAuth, listWorkspaces);
router.post("/", requireAuth, createWorkspace);
router.get("/:id", requireAuth, getWorkspace);
router.post("/:id/invite", requireAuth, inviteMember);
router.delete("/:id", requireAuth, deleteWorkspace);

export default router;
