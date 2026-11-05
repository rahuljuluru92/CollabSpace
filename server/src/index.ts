import "dotenv/config";
import { connectDb } from "./config/db";
import { loadConfig } from "./config/env";
import { createServer } from "./app";

const config = loadConfig();
const { server } = createServer(config);

// Last line of defence: log instead of crashing on a stray rejected promise.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

connectDb(config.mongoUri)
  .then(() => {
    server.listen(config.port, () => console.log("Server running on port", config.port));
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  });
