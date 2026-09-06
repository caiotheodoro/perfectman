# Web Runner Example

Drop these four files into the run form at `http://localhost:4317` and press Run.
Nothing else to configure — the default provider is `mock`, so the run needs no
API key and finishes in seconds.

```bash
pnpm build
pnpm web
```

- `dinner.scenario.md` — three partners, one public channel, one private one, and
  a hidden objective per agent. The frontmatter carries the seed, `maxPulses`,
  the familiarity matrix, and the prior event the room starts from.
- `iris.persona.md` — the connector: deflects, redirects, keeps the temperature down.
- `bruno.persona.md` — the performer: fills silence, reframes criticism as his own idea.
- `marcela.persona.md` — the skeptic: short, exact, asks the question the room was avoiding.

`iris` and `marcela` share a private channel that `bruno` cannot see. That is the
setup for inferred exclusion: bruno reads the public channel going quiet and
draws his own conclusion, without ever being told a private channel exists.

Personas reach only the five fields `ConfigPersona` accepts; the engine's
calibration numbers are inherited from a canonical persona, which the compiled
panel names per agent.
