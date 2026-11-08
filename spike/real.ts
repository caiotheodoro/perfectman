// Real-time validation: same harness on a real clock (setTimeout), real event-loop-delay histogram.
import { runExperiment, DEFAULT, type Cfg } from "./harness.js";
const which = process.argv[2]!;
const presets: Record<string, Partial<Cfg>> = {
  seq: { variant: "seq" },
  adr: { variant: "split", concurrency: 3, debounceMs: 1500 },
  rec: { variant: "split_stream", concurrency: 3, debounceMs: 0 },
};
const r = await runExperiment({ ...DEFAULT, real: true, nLines: 24, meanGapMs: 9000, seed: 11, ...presets[which]! });
const { rawLat, rawAnswers, ...rest } = r;
console.log(JSON.stringify({ which, lat: rawLat.map((x) => Math.round(x)), p50: r.latency?.p50, p95: r.latency?.p95, p99: r.latency?.p99, el: r.eventLoop, busyAtArrivalPct: r.busyAtArrivalPct, perMin: r.consults.perMin, wall: r.wallSeconds }));
void rest; void rawAnswers;
