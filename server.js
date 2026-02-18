import app from "./src/app.js";
import { ENV } from "./src/config/env.js";
import { connectDB } from "./src/config/db.js";
import { updateInterviewStatuses } from "./src/services/interviewScheduler.js";

async function startServer() {
  try {
    await connectDB();

    app.listen(ENV.PORT, () => {
      console.log(`Server running on port ${ENV.PORT} (${ENV.NODE_ENV})`);
    });

    // Start interview status scheduler - run every 1 minute
    setInterval(async () => {
      await updateInterviewStatuses();
    }, 1 * 60 * 1000); // 1 minute in milliseconds

    // Run once immediately on server start
    setTimeout(async () => {
      await updateInterviewStatuses();
    }, 5000); // Wait 5 seconds after server starts

  } catch (err) {
    console.error("Failed to start server due to DB error");
    process.exit(1);
  }
}

startServer();
