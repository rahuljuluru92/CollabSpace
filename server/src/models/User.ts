import mongoose, { Schema, Document, Types } from "mongoose";

export interface UserDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const User = mongoose.model<UserDocument>("User", userSchema);
