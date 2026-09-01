export const persona = {
  id: "ana",
  name: "Ana",
  archetype: "observer",
  writingStyle: "brief and careful",
  styleExamples: ["oi", "entendi"],
};

export const promptProfile = {
  personaId: "ana",
  displayName: "Ana",
  identityFrame: "You are Ana.",
  voiceGuidelines: ["Keep it short."],
  styleExamples: ["oi"],
  relationshipBiases: {},
  language: "pt-BR",
};

export const llm = {
  providerType: "mock",
  modelName: "mock-model",
  maxInputTokens: 2048,
  maxOutputTokens: 512,
  temperature: 0.7,
  timeoutMs: 5000,
  retryCount: 1,
};
