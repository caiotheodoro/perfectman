import { it } from "vitest";
import { runDramaSim } from "../embodiment/drama-sim.js";
import { presetSimConfig } from "../embodiment/drama-sim-preset.js";

for (const id of ["tapa-na-cara", "confronto-da-traicao", "assassinato-na-festa", "reencontro-abraco", "anuncio-do-desmaio"]) {
  it(id, async () => {
    const r = runDramaSim(await presetSimConfig(id));
    console.log("=====", id);
    console.log(r.proposals.map((p) => `${Math.round(p.atMs / 1000)}s ${p.actor} ${p.verb} ${p.with ?? ""} ${p.decision} ${p.reason ?? ""} ${p.detail ?? ""}`).join("\n"));
    console.log(r.events.filter((e) => ["act_started", "act_done", "actor_death", "scene_cut", "actor_revive"].includes(e.kind)).map((e) => `${Math.round(e.atMs / 1000)}s ${e.kind} ${(e as { verb?: string }).verb ?? ""} ${(e as { actor?: string }).actor ?? ""}->${(e as { with?: string }).with ?? ""} ${(e as { outcome?: string }).outcome ?? ""}`).join("\n"));
    console.log(r.probes.filter((p) => !p.passed).map((p) => `${p.probe}=${p.measured}`), r.stats, r.offDeviations);
  });
}
