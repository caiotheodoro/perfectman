# Web Runner Presets

What the run flow offers when you'd rather not write markdown from scratch.
Everything here is ordinary authoring input — the server reads these files and
hands them to the same compiler an upload goes through, so a preset and a file
you wrote behave identically.

```
casts/<id>/    preset.json + one *.persona.md per character
scenes/<id>/   preset.json + one *.scenario.md
```

`preset.json` carries `title` and `blurb`. A scene adds `cast`, naming the cast
it was written for: a scene names its people in `cast:` and assigns hidden
objectives by agent id, so it cannot be run against a cast that does not contain
them. The picker pairs the two rather than letting the compiler reject the
combination afterwards.

To add one, drop a folder in and reload — nothing is bundled into the web build.
