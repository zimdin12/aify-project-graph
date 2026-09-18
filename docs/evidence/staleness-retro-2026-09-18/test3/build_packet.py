"""Test 3, step after labelling: keep flags on notes both labels call current, sample per PROTOCOL-3, write the
blind grading packet. The packet carries each flag's location and the detector's claim, never an expected
answer or the decision rules.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
SEED = 20260918
CAP = 60


def load_labels() -> dict[str, str]:
    labels = {}
    for name in ("labels-1.json", "labels-2.json"):
        for note_id, row in json.loads((ROOT / "label-input" / name).read_text(encoding="utf-8")).items():
            labels[note_id] = row["status"]
    return labels


def stratified_sample(flags: list[dict]) -> list[dict]:
    if len(flags) <= CAP:
        return flags
    rng = random.Random(SEED)
    by_class = {c: [f for f in flags if f["cls"] == c] for c in sorted({f["cls"] for f in flags})}
    quota = {c: round(CAP * len(v) / len(flags)) for c, v in by_class.items()}
    return [f for c, v in by_class.items() for f in rng.sample(v, min(quota[c], len(v)))]


def claim(f: dict) -> str:
    rule = f["rule"]
    if rule == "S1d":
        return f"the file {f['then']} existed when this line was written and is gone at HEAD (not renamed)"
    if rule == "S1r":
        return f"the file {f['then']} existed when this line was written and was renamed to {f['now']}"
    if rule == "S2f":
        return (f"`{f['anchor']}` was defined in {', '.join(f['defined_then'])} when this line was written and is no "
                f"longer defined in that file (or its renamed successor); definitions elsewhere now: "
                f"{', '.join(f['defined_now_elsewhere']) or 'none found'}")
    if rule == "S3a":
        return (f"`{f['anchor']}` is still defined ({', '.join(f['defined_now'])}) but no code outside its own file "
                f"uses it any more; it was used by {', '.join(f['code_referrers_then'])} when this line was written")
    if rule == "S4a":
        return (f"the file {f['then']} still exists but no code file references it any more; it was referenced by "
                f"{', '.join(f['code_referrers_then'])} when this line was written")
    raise ValueError(rule)


def main() -> None:
    flags = [json.loads(l) for l in (RAW / "flags.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    notes = json.loads((RAW / "notes.json").read_text(encoding="utf-8"))
    labels = load_labels()
    assert set(labels) == {n["note_id"] for n in notes}, "labels do not cover exactly the note set"
    current = [f for f in flags if labels[f["note_id"]] == "current"]
    graded = stratified_sample(current)
    packet = [{"id": i + 1, "doc": f["doc"], "line": f["line"], "anchor": f["anchor"], "class": f["cls"],
               "written_in": f["written_in"], "detector_claim": claim(f)} for i, f in enumerate(graded)]
    (RAW / "packet.json").write_text(json.dumps(packet, indent=1), encoding="utf-8")
    (RAW / "graded-flags.json").write_text(json.dumps(graded, indent=1), encoding="utf-8")
    counts = {s: sum(v == s for v in labels.values()) for s in ("current", "history", "unclear")}
    summary = {"labels": counts, "flags": len(flags), "flags_on_current": len(current),
               "current_by_class": {c: sum(f["cls"] == c for f in current) for c in ("GONE", "DEAD_NAME")},
               "current_notes_flagged": len({f["note_id"] for f in current}),
               "current_notes_flagged_gone": len({f["note_id"] for f in current if f["cls"] == "GONE"}),
               "graded": len(graded)}
    (RAW / "filter-summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
