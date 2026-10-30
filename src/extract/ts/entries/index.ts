import type { Detector } from "../types.ts";
import { amqp } from "./amqp.ts";
import { cron } from "./cron.ts";
import { graphql } from "./graphql.ts";
import { grpc } from "./grpc.ts";
import { kafka } from "./kafka.ts";
import { nestHttp } from "./nest-http.ts";
import { nestMessage } from "./nest-message.ts";
import { pubsub } from "./pubsub.ts";
import { queue } from "./queue.ts";
import { express, fastify, hono, koa } from "./routers.ts";
import { sqs } from "./sqs.ts";
import { websocket } from "./websocket.ts";

export const ENTRY_DETECTORS: Detector[] = [nestHttp, express, fastify, koa, hono, grpc, graphql, websocket, nestMessage, kafka, amqp, sqs, pubsub, queue, cron];
