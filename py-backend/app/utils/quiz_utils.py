# app/utils/quiz_utils.py
from typing import Dict, Any, List, Optional
import logging

logger = logging.getLogger(__name__)


def is_string_array(arr: Any, length: int) -> bool:
    """Check if arr is a list of strings with the specified length."""
    if not isinstance(arr, list) or len(arr) != length:
        return False
    return all(isinstance(x, str) for x in arr)


def coerce_quiz_shape(obj: Any) -> Dict[str, Any]:
    """Light repair for minor issues; returns a new object."""
    if not obj or not isinstance(obj, dict):
        return obj
    if not isinstance(obj.get("items"), list):
        return obj

    fixed = {**obj, "items": [dict(item) for item in obj["items"]]}

    for idx, it in enumerate(fixed["items"]):
        # Ensure id as string
        if it.get("id") is None:
            it["id"] = str(idx + 1)
        else:
            it["id"] = str(it["id"])

        # Ensure question as string
        if not isinstance(it.get("question"), str):
            it["question"] = str(it.get("question", ""))

        # Ensure options array of 4 strings
        opts: List[str] = []
        if isinstance(it.get("options"), list):
            opts = [str(o) for o in it["options"][:4]]
        while len(opts) < 4:
            opts.append(f"Option {len(opts) + 1}")

        # Deduplicate options naively if duplicates present
        seen = set()
        deduped = []
        for o in opts:
            if o in seen:
                deduped.append(f"{o} *")
            else:
                seen.add(o)
                deduped.append(o)
        it["options"] = deduped[:4]

        # Ensure correctIndex is 0..3
        correct_idx = it.get("correctIndex")
        if not isinstance(correct_idx, int) or correct_idx < 0 or correct_idx > 3:
            # Attempt recovery if model returned an 'answer' string:
            if isinstance(it.get("answer"), str):
                answer_str = it["answer"].strip().lower()
                idx_ans = next(
                    (i for i, opt in enumerate(opts) if opt.strip().lower() == answer_str),
                    -1
                )
                it["correctIndex"] = idx_ans if idx_ans >= 0 else 0
            else:
                it["correctIndex"] = 0
        else:
            it["correctIndex"] = correct_idx % 4

    # Trim to exactly 5 items
    if len(fixed["items"]) > 5:
        fixed["items"] = fixed["items"][:5]
    while len(fixed["items"]) < 5:
        i = len(fixed["items"])
        fixed["items"].append({
            "id": str(i + 1),
            "question": f"Placeholder question {i + 1}?",
            "options": ["A", "B", "C", "D"],
            "correctIndex": 0,
        })

    return fixed


def is_valid_quiz_shape(obj: Any) -> bool:
    """Strict validation: exactly 5 items, 4 options each, correctIndex in [0,3]."""
    if not obj or not isinstance(obj, dict):
        return False
    if not isinstance(obj.get("topic"), str) or not isinstance(obj.get("level"), str):
        return False
    items = obj.get("items")
    if not isinstance(items, list) or len(items) != 5:
        return False
    for it in items:
        if not isinstance(it, dict):
            return False
        if not isinstance(it.get("id"), str):
            return False
        if not isinstance(it.get("question"), str):
            return False
        if not is_string_array(it.get("options"), 4):
            return False
        correct_idx = it.get("correctIndex")
        if not isinstance(correct_idx, int):
            return False
        if correct_idx < 0 or correct_idx > 3:
            return False
    return True

