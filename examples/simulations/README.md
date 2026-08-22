# Simulation Examples

Copy one of these files to `config/index.json` and edit locally.

- `mock.inline-personas.example.json` — in-memory simulation with personas embedded directly in the config.
- `mock.persona-file.example.json` — in-memory simulation loading a compiled persona file from `config/personas/`.
- `freellmapi.example.json` — example for a FreeLLMAPI-compatible provider.
- `deepseek.example.json` — example for DeepSeek's OpenAI-compatible API; requires `DEEPSEEK_API_KEY`.
- `qwen3-local.example.json` — recommended local Qwen/Ollama config using the smaller default Docker model.
- `qwen3-8b.example.json` — example for a Qwen/Ollama-compatible provider.

Recommended local command:

```bash
mkdir -p config/personas
cp examples/simulations/mock.persona-file.example.json config/index.json
cp examples/personas/compiled/example-friend.persona.example.json config/personas/example-friend.persona.json
```
