import { OpenAiCompatibleProvider } from "@perfectman/server";
import { ScenarioRunner } from "@perfectman/eval";
import { buildNovelaScenario } from "./dist/cli/evidence.js";
const scenario = buildNovelaScenario();
const t0 = Date.now();
let firstCallAt = null;
const a = await ScenarioRunner.run(scenario, {
  llmMode: "local",
  pulseLimit: 12,
  providerFactory: (cfg, agentId) => new (class extends OpenAiCompatibleProvider {
    async generateIntent(input, ctx, prompt) {
      const start = Date.now();
      const res = await super.generateIntent(input, ctx, prompt);
      if (!firstCallAt) firstCallAt = Date.now() - t0;
      console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${agentId} p${ctx.pulseIndex} ${Date.now() - start}ms promptChars=${prompt.system.length + prompt.user.length}`);
      return res;
    }
  })(cfg),
});
console.log("first call at:", firstCallAt, "ms | done, fallbacks:", a.fallbackCount);
