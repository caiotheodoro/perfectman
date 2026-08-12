import { OpenAiCompatibleProvider } from "@perfectman/server";
import { ScenarioRunner } from "@perfectman/eval";
import { agent, msg, scene } from "@perfectman/shared";

const scenario = scene({
  id: "novela_dbg",
  category: "edge_chaos",
  name: "novela dbg",
  description: "dbg",
  agents: [
    agent("goulart", "goulart", { presence: "active", social: { desireForStatus: 1.2 } }),
    agent("bruno", "bruno", { presence: "active", social: { fearOfExclusion: 0.6, resentment: 0.3 } }),
    agent("caio", "caio", { presence: "active", social: { affection: 0.5 } }),
    agent("mariana", "mariana", { presence: "active", social: { desireForStatus: 1.0, suspicion: 0.5 } }),
    agent("leo", "leo", { presence: "active", social: { affection: 0.6 } }),
  ],
  priorEvents: [msg("message_sent", "caio", "ch_geral", "bom dia galera", 0)],
  expectedSignals: [],
  pulseCount: 20,
  seedVariants: 1,
});

const t0 = Date.now();
const a = await ScenarioRunner.run(scenario, {
  llmMode: "local",
  providerFactory: (cfg, agentId) => new (class extends OpenAiCompatibleProvider {
    async generateIntent(input, ctx, prompt) {
      const start = Date.now();
      try {
        const res = await super.generateIntent(input, ctx, prompt);
        console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${agentId} p${ctx.pulseIndex} OK ${Date.now() - start}ms ${JSON.stringify(res.content).slice(0, 50)}`);
        return res;
      } catch (err) {
        console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${agentId} p${ctx.pulseIndex} FAIL ${Date.now() - start}ms ${String(err).slice(0, 80)}`);
        throw err;
      }
    }
  })(cfg),
});
console.log("done. fallbacks:", a.fallbackCount, "events:", a.events.length);
