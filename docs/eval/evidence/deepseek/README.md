# DeepSeek Evidence Suite — final (emoção corrigida)

Rodada completa com **deepseek-chat** e a dinâmica emocional corrigida
(mola do humor com semântica certa, amplificação aditiva, relógio simulado,
impulsos suavizados). Narrativas 100% pt-BR.

## Resultados

- Sinais **96.6%** (85/88) · sondas **92.7%** (470/507)
- **17 cenas** com conversa em canal privado · **408 mensagens privadas**
- Novela (90 pulsos): 6 canais privados, 290 mensagens privadas, estados
  diferenciados — Bruno o único negativo (fearOfExclusion 0.97, jealousy 0.56),
  Goulart +0.06/0.69, Caio +0.41 afetivo, Mariana +0.08/0.48, Léo +0.50/0.76
- Zero fallbacks, zero refusals/leaks

## Arquivos

| Artifact | O quê |
|---|---|
| `roleplay.html` (+ `../../roleplay.html`) | Página final — 41 capítulos, 219 painéis 🔒, seletor de persona, pt-BR |
| `scenarios/*.json` | Evidência por cena (transcripts com marca privada, estados finais, sinais, sondas) |
| `novela-run.json` | A tarde comprida (90 pulsos) |
| `narrations.json` | 40 recaps pt-BR |
| `evidence-report.md` / `evidence-index.json` | Agregados |

## Regenerar

```sh
PERFECTMAN_LLM_PROVIDER=deepseek PERFECTMAN_LLM_API_KEY=sk-... \
  pnpm --filter @perfectman/eval narrate --out docs/eval/evidence/deepseek
```
