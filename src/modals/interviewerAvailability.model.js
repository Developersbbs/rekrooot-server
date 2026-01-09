import mongoose from "mongoose";

const { Schema } = mongoose;

const interviewerAvailabilitySchema = new Schema(
  {
    interviewer: {
      type: Schema.Types.ObjectId,
      ref: "Interviewer",
      required: true,
      index: true,
    },
    start_time: {
      type: Date,
      required: true,
    },
    end_time: {
      type: Date,
      required: true,
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

// Ensure start_time is always before end_time
interviewerAvailabilitySchema.pre("save", function (next) {
  if (this.start_time >= this.end_time) {
    const err = new Error("start_time must be before end_time");
    // @ts-ignore
    err.statusCode = 400;
    return next(err);
  }
  next();
});

// Basic index to speed up range queries per interviewer
interviewerAvailabilitySchema.index({ interviewer: 1, start_time: 1 });

const InterviewerAvailability =
  mongoose.models.InterviewerAvailability ||
  mongoose.model("InterviewerAvailability", interviewerAvailabilitySchema);

export default InterviewerAvailability;
