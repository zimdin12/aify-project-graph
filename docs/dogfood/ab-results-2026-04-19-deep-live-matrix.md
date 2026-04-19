# Bench A1 Live Analysis

Artifacts: `bench-a1-live-1776540379589.json`, `bench-a1-live-1776540394542.json`, `bench-a1-live-1776540534285.json`, `bench-a1-live-1776540870950.json`, `bench-a1-live-1776541246110.json`, `bench-a1-live-1776541786120.json`, `bench-a1-live-1776542391078.json`, `bench-a1-live-1776543168193.json`, `bench-a1-live-1776549091410.json`, `bench-a1-live-1776550803199.json`, `bench-a1-live-1776553093427.json`, `bench-a1-live-1776553922471.json`, `bench-a1-live-1776554830711.json`, `bench-a1-live-1776560596559.json`, `bench-a1-live-1776561159330.json`, `bench-a1-live-1776561559061.json`, `bench-a1-live-1776562177753.json`, `bench-a1-live-1776562852289.json`, `bench-a1-live-1776562852413.json`, `bench-a1-live-1776562852466.json`, `bench-a1-live-1776562852518.json`, `bench-a1-live-1776563570565.json`, `bench-a1-live-1776564372760.json`, `bench-a1-live-1776565246161.json`

## Per-arm summary

| Repo | Task | Arm | Runs | Usable | Median eff tok | Median dur | Pass rate | Median cmds | Median MCP |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| aify-project-graph | plan | brief-only | 3 | 3 | 78,184 | 88,757 ms | 33% | 11 | 0 |
| aify-project-graph | plan | lean-mcp | 3 | 3 | 96,088 | 123,902 ms | 33% | 17 | 0 |
| aify-project-graph | unknown | brief-only | 24 | 21 | 58,579 | 40,756 ms | 67% | 1 | 0 |
| aify-project-graph | unknown | lean-mcp | 21 | 17 | 79,107 | 80,578 ms | 94% | 12 | 0 |
| echoes | orient | brief-only | 3 | 3 | 61,584 | 37,478 ms | 100% | 1 | 0 |
| echoes | orient | lean-mcp | 3 | 3 | 94,917 | 91,577 ms | 100% | 15 | 0 |
| echoes | plan | brief-only | 3 | 3 | 112,290 | 134,064 ms | 0% | 19 | 2 |
| echoes | plan | lean-mcp | 3 | 3 | 107,816 | 138,295 ms | 0% | 24 | 0 |
| echoes | unknown | brief-only | 3 | 3 | 63,389 | 40,183 ms | 100% | 1 | 0 |
| echoes | unknown | lean-mcp | 3 | 3 | 93,219 | 117,739 ms | 0% | 16 | 0 |
| lc-api | orient | brief-only | 3 | 3 | 66,613 | 74,712 ms | 0% | 6 | 0 |
| lc-api | orient | lean-mcp | 3 | 3 | 85,036 | 108,306 ms | 100% | 23 | 0 |
| lc-api | plan | brief-only | 3 | 3 | 74,564 | 94,906 ms | 0% | 13 | 0 |
| lc-api | plan | lean-mcp | 3 | 3 | 71,664 | 123,922 ms | 0% | 18 | 0 |
| lc-api | unknown | brief-only | 6 | 6 | 71,471 | 92,226 ms | 0% | 15 | 0 |
| lc-api | unknown | lean-mcp | 3 | 3 | 91,083 | 141,546 ms | 0% | 24 | 0 |
| mem0-fork | orient | brief-only | 3 | 3 | 72,240 | 56,984 ms | 0% | 4 | 0 |
| mem0-fork | orient | lean-mcp | 3 | 3 | 87,354 | 161,079 ms | 0% | 23 | 0 |
| mem0-fork | plan | brief-only | 3 | 3 | 103,014 | 161,229 ms | 0% | 29 | 0 |
| mem0-fork | plan | lean-mcp | 3 | 3 | 144,871 | 144,985 ms | 0% | 24 | 0 |
| mem0-fork | unknown | brief-only | 3 | 3 | 70,636 | 89,940 ms | 0% | 13 | 0 |
| mem0-fork | unknown | lean-mcp | 3 | 3 | 106,553 | 137,674 ms | 0% | 22 | 0 |

## Brief vs lean comparison

| Repo | Task | Brief tok | Lean tok | Token delta | Brief pass | Lean pass | Brief dur | Lean dur | Dur delta | Lean MCP |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| aify-project-graph | plan | 78,184 | 96,088 | -18.6% | 33% | 33% | 88,757 ms | 123,902 ms | -28.4% | 0 |
| aify-project-graph | unknown | 58,579 | 79,107 | -25.9% | 67% | 94% | 40,756 ms | 80,578 ms | -49.4% | 0 |
| echoes | orient | 61,584 | 94,917 | -35.1% | 100% | 100% | 37,478 ms | 91,577 ms | -59.1% | 0 |
| echoes | plan | 112,290 | 107,816 | +4.1% | 0% | 0% | 134,064 ms | 138,295 ms | -3.1% | 0 |
| echoes | unknown | 63,389 | 93,219 | -32.0% | 100% | 0% | 40,183 ms | 117,739 ms | -65.9% | 0 |
| lc-api | orient | 66,613 | 85,036 | -21.7% | 0% | 100% | 74,712 ms | 108,306 ms | -31.0% | 0 |
| lc-api | plan | 74,564 | 71,664 | +4.0% | 0% | 0% | 94,906 ms | 123,922 ms | -23.4% | 0 |
| lc-api | unknown | 71,471 | 91,083 | -21.5% | 0% | 0% | 92,226 ms | 141,546 ms | -34.8% | 0 |
| mem0-fork | orient | 72,240 | 87,354 | -17.3% | 0% | 0% | 56,984 ms | 161,079 ms | -64.6% | 0 |
| mem0-fork | plan | 103,014 | 144,871 | -28.9% | 0% | 0% | 161,229 ms | 144,985 ms | +11.2% | 0 |
| mem0-fork | unknown | 70,636 | 106,553 | -33.7% | 0% | 0% | 89,940 ms | 137,674 ms | -34.7% | 0 |

## Notes

- Effective tokens = `input_tokens - cached_input_tokens + output_tokens`.
- Negative token delta means brief-only is cheaper than lean-MCP.
- Lean MCP median MCP calls is a direct product-routing signal.
