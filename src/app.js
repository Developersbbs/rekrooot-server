import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import authRoute from "./routes/auth.route.js";
import companyRoute from "./routes/company.route.js";
import invitationRoute from "./routes/invitation.route.js";
import interviewerRoute from "./routes/interviewer.route.js";
import interviewerAvailabilityRoute from "./routes/interviewerAvailability.route.js";
import technologyRoute from "./routes/technology.route.js";
import dashboardRoute from "./routes/dashboard.route.js";
import clientRoute from "./routes/client.route.js";
import userRoute from "./routes/user.route.js";
import vendorRoute from "./routes/vendor.route.js";

import healthRoute from "./routes/health.route.js";
import { errorHandler } from "./middlewares/error.middleware.js";

const app = express();

/* core middleware */
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

/* routes */
app.use("/health", healthRoute);
app.use("/auth", authRoute);
app.use("/companies", companyRoute);
app.use("/invitations", invitationRoute);
app.use("/interviewers", interviewerRoute);
app.use("/interviewers", interviewerAvailabilityRoute);
app.use("/technologies", technologyRoute);
app.use("/dashboard", dashboardRoute);
app.use("/clients", clientRoute);
app.use("/users", userRoute);
app.use("/vendors", vendorRoute);


/* 404 */
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

/* error handler */
app.use(errorHandler);

export default app;
