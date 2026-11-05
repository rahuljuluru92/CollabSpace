import mongoose, { Schema, Document, Types } from "mongoose";

export interface RecentEdit {
  editId: string;
  version: number;
}

export interface WorkspaceDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  members: Types.ObjectId[];
  content: string;
  version: number;
  /** Ids of the last few applied edits, so a client whose ack was lost can find out if its edit landed. */
  recentEdits: RecentEdit[];
  updatedAt: Date;
}

const recentEditSchema = new Schema<RecentEdit>(
  {
    editId: { type: String, required: true },
    version: { type: Number, required: true }
  },
  { _id: false }
);

const workspaceSchema = new Schema<WorkspaceDocument>(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    members: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    content: { type: String, default: "" },
    version: { type: Number, default: 1 },
    recentEdits: { type: [recentEditSchema], default: [] }
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

// Serves the "my workspaces" listing ($or on owner/members).
workspaceSchema.index({ ownerId: 1 });
workspaceSchema.index({ members: 1 });

export const Workspace = mongoose.model<WorkspaceDocument>("Workspace", workspaceSchema);
