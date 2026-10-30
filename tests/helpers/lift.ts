import { writeFileSync } from "node:fs";
import { SKETCH_JSON, runSketchModel } from "./sketch.ts";

writeFileSync(SKETCH_JSON, runSketchModel() + "\n");
