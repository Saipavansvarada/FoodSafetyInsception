"""DFA and regular-expression validators for Food Safety Inspection identifiers."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, Tuple


INSPECTOR_RE = re.compile(r"^INS[A-Z]{2}[0-9]{4}$")
VIOLATION_RE = re.compile(r"^V[0-9]{2}-[A-Z]{3,20}$")


@dataclass
class ValidationResult:
    accepted: bool
    reason: str
    dfa_accepted: bool
    regex_accepted: bool

    def as_dict(self) -> dict:
        return {
            "accepted": self.accepted,
            "reason": self.reason,
            "dfa_accepted": self.dfa_accepted,
            "regex_accepted": self.regex_accepted,
            "agreement": self.dfa_accepted == self.regex_accepted,
        }


def inspector_dfa(value: str) -> bool:
    """DFA for INS + two uppercase letters + four digits."""
    transitions: Dict[Tuple[int, str], int] = {
        (0, "I"): 1,
        (1, "N"): 2,
        (2, "S"): 3,
    }
    state = 0
    for ch in value:
        if (state, ch) in transitions:
            state = transitions[(state, ch)]
        elif state in (3, 4) and "A" <= ch <= "Z":
            state += 1
        elif state in (5, 6, 7, 8) and "0" <= ch <= "9":
            state += 1
        else:
            return False
    return state == 9


def violation_dfa(value: str) -> bool:
    """DFA for V + two digits + '-' + an uppercase category token."""
    state = 0
    for ch in value:
        if state == 0 and ch == "V":
            state = 1
        elif state in (1, 2) and ch.isdigit() and ch.isascii():
            state += 1
        elif state == 3 and ch == "-":
            state = 4
        elif 4 <= state < 24 and "A" <= ch <= "Z":
            state += 1
        else:
            return False
    return 7 <= state <= 24  # Between three and twenty category letters.


def validate_inspector_id(value: str) -> ValidationResult:
    value = (value or "").strip()
    dfa_ok = inspector_dfa(value)
    regex_ok = bool(INSPECTOR_RE.fullmatch(value))
    reason = "Inspector ID accepted." if dfa_ok and regex_ok else (
        "Expected INS followed by exactly 2 uppercase letters and 4 digits (example: INSAB1234)."
    )
    return ValidationResult(dfa_ok and regex_ok, reason, dfa_ok, regex_ok)


def validate_violation_code(value: str) -> ValidationResult:
    value = (value or "").strip()
    dfa_ok = violation_dfa(value)
    regex_ok = bool(VIOLATION_RE.fullmatch(value))
    reason = "Violation code format accepted." if dfa_ok and regex_ok else (
        "Expected V, 2 digits, a hyphen, and an uppercase category (example: V01-HYGIENE)."
    )
    return ValidationResult(dfa_ok and regex_ok, reason, dfa_ok, regex_ok)
