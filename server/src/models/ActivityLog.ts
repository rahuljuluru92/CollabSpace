import mongoose, { Schema, Document, Types } from "mongoose";

export interface ActivityLogDocument extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  /** Name of the user at the time, so the log reads "Alice joined" without a lookup. */
  userName?: string;
  action: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const activityLogSchema = new Schema<ActivityLogDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String },
    action: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Serves paginated "newest first" activity for a workspace, and deleteMany by workspace.
activityLogSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 });

export const ActivityLog = mongoose.model<ActivityLogDocument>("ActivityLog", activityLogSchema);
