# Test transcripts

Paste each transcript into `<ID>.txt` (e.g. `T01.txt`), one turn per line:

```
Agent: Hello, thank you for calling Aangan Studio. How can I help you today?
Caller: Hi, I've just bought a 3BHK in Kothrud...
```

Lines starting with `Agent:` or `Caller:` start a new turn; other lines continue the previous turn.
Expected outcomes live in `../expected.json`. The replay script fails if a listed transcript is missing.
