import { randomUUID } from "crypto";
import { Consumer, Kafka, logLevel, Producer } from "kafkajs";

const BROKERS = (process.env.KAFKA_BROKERS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const GROUP_ID = process.env.KAFKA_GROUP_ANALYTICS || "adwise-analytics";

let kafka: Kafka | null = null;
let producer: Producer | null = null;

export const Topics = {
  UserRegistered: "user.registered",
  UserLoggedIn: "user.logged-in",
  ChatMessageSent: "chat.message-sent",
  ChatMessageRequested: "chat.message-requested",
} as const;

export async function initKafka() {
  if (!BROKERS.length) {
    console.warn("[KAFKA] No brokers configured (KAFKA_BROKERS empty). Kafka is disabled.");
    return;
  }

  const useSSL = process.env.KAFKA_SSL === "true";
  const mechanism = process.env.KAFKA_SASL_MECHANISM || "";
  const username = process.env.KAFKA_SASL_USERNAME;
  const password = process.env.KAFKA_SASL_PASSWORD;

  const sasl =
    mechanism && username && password
      ? { mechanism: mechanism as any, username, password }
      : undefined;

  kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || "adwise-backend",
    brokers: BROKERS,
    ssl: useSSL,
    sasl,
    logLevel: logLevel.ERROR,
  });

  producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  console.log("[KAFKA] Producer connected");
}

export async function shutdownKafka() {
  try {
    await producer?.disconnect();
  } catch (e) {
    console.warn("[KAFKA] producer disconnect error:", e);
  }
}

export async function publish(topic: string, payload: Record<string, any>, key?: string) {
  if (!producer) return;
  try {
    const res = await producer.send({
      topic,
      messages: [{ key, value: JSON.stringify(payload) }],
    });

    console.log("[KAFKA] publish OK", {
      topic,
      key,
      count: res.length,
      partitions: res.map(r => r.partition),
      offsets: res.map(r => r.baseOffset),
    });
  } catch (e) {
    console.error("[KAFKA] publish error:", e);
  }
}

export async function createConsumer(groupId: string): Promise<Consumer | null> {
  if (!kafka) {
    console.warn("[KAFKA] createConsumer called but kafka is disabled");
    return null;
  }

  const consumer = kafka.consumer({ groupId, allowAutoTopicCreation: true });
  await consumer.connect();
  return consumer;
}

export function newRequestId() {
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}
