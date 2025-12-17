import app from "./src/app.js";
import { ENV } from "./src/config/env.js";
import { connectDB } from "./src/config/db.js";

async function startServer() {
  try {
    await connectDB();

    app.listen(ENV.PORT, () => {
      console.log(`Server running on port ${ENV.PORT} (${ENV.NODE_ENV})`);
    });
  } catch (err) {
    console.error("Failed to start server due to DB error");
    process.exit(1);
  }
}

startServer();
