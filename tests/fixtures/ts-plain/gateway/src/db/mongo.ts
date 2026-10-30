import mongoose, { Schema } from 'mongoose';

const userSchema = new Schema({ email: String, name: String, active: Boolean });

export const User = mongoose.model('User', userSchema);
