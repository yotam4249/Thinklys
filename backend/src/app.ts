import dotenv from "dotenv";
import http from "http";
import { connectMongo, createApp, disconnectMongo } from "./server";
import { initSocket } from "./services/socket.service";
import { initKafka, shutdownKafka } from "./services/kafka.service";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGO_URI as string;

async function start() {
  await connectMongo(MONGO_URI, process.env.MONGO_DBNAME || "adwise");
  const app = createApp();

  const server = http.createServer(app);

  await initKafka();
  initSocket(server); // ← all socket logic is encapsulated

  server.listen(PORT, () => console.log(`Listening on 0.0.0.0:${PORT}`));

  const bye = (sig: string) => {
    console.log(`${sig} shutting down...`);
    server.close(async () => {
       await shutdownKafka();
       await disconnectMongo(); process.exit(0); 
      });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => bye("SIGINT"));
  process.on("SIGTERM", () => bye("SIGTERM"));
}

start();
