import sys, pathlib; sys.path.insert(0, '.')
import detect_v3 as d
# Re-point the v3 instrument at the aify-comms corpus where v2 fired S3a/S4a.
d.CORPUS = pathlib.Path(d.ROOT).parent / "corpus"
d.HEAD = d.git("rev-parse", "HEAD").strip()
print("HEAD", d.HEAD[:10])
cases = [("_default_console_command","b5ec83e372"),("extractTerminalSessionHandle","11e8af1733"),("pickSessionForKey","7477fbb7c7"),
         ("TURN_BUSY_STALE_SECONDS","44b3da61bc"),("terminalChildEnv","057538865a"),
         ("mcp/stdio/reap-managed-claude.js","d9915051ad"),("hermes-single-shot-controller.js","941bf0acef"),
         ("zzqNotASymbol","b5ec83e372")]
for tok, w in cases:
    w = d.git("rev-parse", w).strip()
    print(tok, d.evaluate(tok, w))
