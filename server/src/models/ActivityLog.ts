import mongoose, { Schema, Document, Types } from "mongoose";

export interface ActivityLogDocument extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  action: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const activityLogSchema = new Schema<ActivityLogDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Serves "latest N entries for a workspace" and deleteMany by workspace.
activityLogSchema.index({ workspaceId: 1, createdAt: -1 });

export const ActivityLog = mongoose.model<ActivityLogDocument>("ActivityLog", activityLogSchema);
