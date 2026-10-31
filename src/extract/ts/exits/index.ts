import type { Detector } from "../types.ts";
import { cacheDetector } from "./cache.ts";
import { cloudDetector } from "./cloud.ts";
import { databaseDetector } from "./database.ts";
import { grpcDetector } from "./grpc.ts";
import { httpDetector } from "./http.ts";
import { messagingDetector } from "./messaging.ts";
import { queueDetector } from "./queue.ts";
import { smtpDetector } from "./smtp.ts";

export const EXIT_DETECTORS: Detector[] = [databaseDetector, cacheDetector, httpDetector, grpcDetector, messagingDetector, queueDetector, smtpDetector, cloudDetector];
