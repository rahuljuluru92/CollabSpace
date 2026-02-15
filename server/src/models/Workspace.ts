import mongoose, { Schema, Document, Types } from "mongoose";

export interface WorkspaceDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  members: Types.ObjectId[];
  content: string;
  version: number;
  updatedAt: Date;
}

const workspaceSchema = new Schema<WorkspaceDocument>(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    members: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    content: { type: String, default: "" },
    version: { type: Number, default: 1 }
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const Workspace = mongoose.model<WorkspaceDocument>("Workspace", workspaceSchema);
