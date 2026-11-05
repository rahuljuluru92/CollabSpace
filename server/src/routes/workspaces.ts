import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  inviteMember,
  listActivity,
  listWorkspaces
} from "../controllers/workspaceController";
import { isObjectId } from "../utils/validation";

const router = Router();

function validateId(req: Request, res: Response, next: NextFunction) {
  if (!isObjectId(req.params.id)) {
    return res.status(404).json({ error: "Workspace not found" });
  }
  return next();
}

router.use(requireAuth);

router.get("/", listWorkspaces);
router.post("/", createWorkspace);
router.get("/:id", validateId, getWorkspace);
router.get("/:id/activity", validateId, listActivity);
router.post("/:id/invite", validateId, inviteMember);
router.delete("/:id", validateId, deleteWorkspace);

export default router;
