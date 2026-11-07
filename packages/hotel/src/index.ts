// @perfectman/hotel: the Tilehouse sidecar (ADR-0026, docs/plans/hotel-package.md).
// The process entrypoint is `main.ts`; this barrel is for tests and tooling.
export * from "./director/index.js";
export * from "./embodiment/types.js";
export * from "./config.js";
export * from "./sidecar.js";
export { RunManager } from "./run/run-manager.js";
export { HotelGateway } from "./gateway/hotel-gateway.js";
export { plan } from "./embodiment/plan.js";
