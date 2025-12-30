import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import authRoute from "./routes/auth.route.js";
import companyRoute from "./routes/company.route.js";
import invitationRoute from "./routes/invitation.route.js";
import interviewerRoute from "./routes/interviewer.route.js";
import technologyRoute from "./routes/technology.route.js";

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
app.use("/technologies", technologyRoute);


/* 404 */
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

/* error handler */
app.use(errorHandler);

export default app;
