"""Regression tests for DFA/regex validation, classification and dispatch behavior."""
import os
import tempfile
import unittest
from pathlib import Path

import app as portal
from validators import inspector_dfa, violation_dfa, validate_inspector_id, validate_violation_code
from routing import classify_matches


class PortalTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        portal.DB_PATH = Path(self.tmp.name) / "test.db"
        portal.init_db()
        self.client = portal.app.test_client()

    def tearDown(self):
        self.tmp.cleanup()

    def payload(self, **updates):
        data = {
            "inspector_id": "INSAB1234",
            "violation_code": "V03-HYGIENE",
            "establishment": "Green Fork Cafe",
            "inspector_name": "Ananya Rao",
            "pin_code": "560001",
            "description": "Serious sanitation issue observed in kitchen.",
            "urgency": "Normal",
        }
        data.update(updates)
        return data

    def submit(self, **updates):
        return self.client.post("/api/reports", json=self.payload(**updates))

    # DFA and regex agreement tests (1-8)
    def test_01_valid_inspector_dfa(self):
        self.assertTrue(inspector_dfa("INSAB1234"))

    def test_02_invalid_inspector_prefix(self):
        self.assertFalse(inspector_dfa("INXAB1234"))

    def test_03_invalid_inspector_short_digits(self):
        self.assertFalse(inspector_dfa("INSAB123"))

    def test_04_valid_inspector_validator_agrees(self):
        result = validate_inspector_id("INSXY9876")
        self.assertTrue(result.accepted)
        self.assertTrue(result.as_dict()["agreement"])

    def test_05_lowercase_inspector_rejected(self):
        self.assertFalse(validate_inspector_id("insab1234").accepted)

    def test_06_valid_violation_dfa(self):
        self.assertTrue(violation_dfa("V01-PEST"))

    def test_07_invalid_violation_separator(self):
        self.assertFalse(violation_dfa("V01_PEST"))

    def test_08_violation_validator_agrees(self):
        result = validate_violation_code("V10-PASSED")
        self.assertTrue(result.accepted)
        self.assertTrue(result.as_dict()["agreement"])

    def test_09_violation_category_maximum_length_agrees(self):
        valid = validate_violation_code("V01-ABCDEFGHIJKLMNOPQRST")
        invalid = validate_violation_code("V01-ABCDEFGHIJKLMNOPQRSTU")
        self.assertTrue(valid.accepted)
        self.assertFalse(invalid.accepted)
        self.assertTrue(valid.as_dict()["agreement"])
        self.assertTrue(invalid.as_dict()["agreement"])

    # API validation and five-category classification tests (9-15)
    def test_10_valid_report_is_accepted(self):
        response = self.submit()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["report"]["validation_status"], "Accepted")

    def test_11_malformed_inspector_is_rejected_and_saved(self):
        response = self.submit(inspector_id="BAD123")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["report"]["validation_status"], "Rejected")
        self.assertEqual(len(self.client.get("/api/reports").json), 1)

    def test_12_unknown_well_formed_violation_code_is_rejected(self):
        response = self.submit(violation_code="V88-UNKNOWN")
        self.assertEqual(response.json["report"]["validation_status"], "Rejected")
        self.assertIn("not present", response.json["report"]["validation_reason"])

    def test_13_critical_code_maps_to_critical(self):
        response = self.submit(violation_code="V01-CONTAMINATION")
        self.assertEqual(response.json["report"]["category"], "Critical")

    def test_14_minor_code_maps_to_minor(self):
        response = self.submit(violation_code="V06-LABEL")
        self.assertEqual(response.json["report"]["category"], "Minor")

    def test_15_advisory_code_maps_to_advisory(self):
        response = self.submit(violation_code="V08-CLEANLINESS")
        self.assertEqual(response.json["report"]["category"], "Advisory")

    def test_16_passed_code_maps_to_passed(self):
        response = self.submit(violation_code="V10-PASSED")
        self.assertEqual(response.json["report"]["category"], "Passed")

    def test_17_overlapping_patterns_choose_highest_severity(self):
        self.assertEqual(classify_matches(["Advisory", "Major", "Critical"]), "Critical")

    # Routing, capacity, fallback, statuses and persistence (16-23)
    def test_18_pin_maps_to_south_central_zone(self):
        response = self.submit(pin_code="560001")
        self.assertEqual(response.json["report"]["zone_id"], "Z3")

    def test_19_critical_gets_emergency_priority(self):
        response = self.submit(violation_code="V01-CONTAMINATION")
        self.assertEqual(response.json["report"]["priority_rank"], 0)
        self.assertIn("CRITICAL PRIORITY OVERRIDE", response.json["report"]["route_reason"])

    def test_20_emergency_overrides_advisory_priority(self):
        response = self.submit(violation_code="V08-CLEANLINESS", urgency="Emergency")
        self.assertEqual(response.json["report"]["priority_rank"], 0)

    def test_21_unknown_pin_goes_to_correction_queue(self):
        response = self.submit(pin_code="000000")
        self.assertEqual(response.json["report"]["zone_id"], "CENTRAL_QUEUE")
        self.assertEqual(response.json["report"]["assignment_status"], "Queued")

    def test_22_handler_capacity_is_never_over_ten(self):
        response = self.client.patch("/api/handlers/OFF-Z4-A", json={"max_open_cases": 11})
        self.assertEqual(response.status_code, 400)

    def test_23_report_is_assigned_to_handler(self):
        response = self.submit()
        self.assertTrue(response.json["report"]["assigned_handler"])
        self.assertEqual(response.json["report"]["status"], "Assigned")

    def test_24_duplicate_dispatch_does_not_reassign(self):
        response = self.submit()
        report_id = response.json["report"]["report_id"]
        result = self.client.post("/api/dispatch/run").json
        self.assertFalse(any(x["report_id"] == report_id and x.get("assigned") for x in result["results"]))

    def test_25_resolve_updates_status_and_persists(self):
        response = self.submit()
        report_id = response.json["report"]["report_id"]
        update = self.client.patch(f"/api/reports/{report_id}/status", json={"status": "Resolved"})
        self.assertEqual(update.json["report"]["status"], "Resolved")
        persisted = self.client.get(f"/api/reports/{report_id}")
        self.assertEqual(persisted.json["status"], "Resolved")

    def test_26_zone_capacity_overflow_uses_deputy_pool(self):
        for handler_id in ("OFF-Z3-A", "OFF-Z3-B"):
            self.client.patch(f"/api/handlers/{handler_id}", json={"available": True, "max_open_cases": 1})
        self.submit(description="First South-Central case")
        self.submit(description="Second South-Central case")
        third = self.submit(description="Overflow case").json["report"]
        self.assertEqual(third["assigned_handler"], "DEP-01")
        self.assertEqual(third["assignment_status"], "Assigned")

    def test_27_no_available_handler_keeps_report_queued_then_dispatches(self):
        for handler_id in ("OFF-Z3-A", "OFF-Z3-B", "DEP-01", "DEP-02"):
            self.client.patch(f"/api/handlers/{handler_id}", json={"available": False})
        queued = self.submit().json["report"]
        self.assertIsNone(queued["assigned_handler"])
        self.assertEqual(queued["assignment_status"], "Queued")
        self.client.patch("/api/handlers/DEP-01", json={"available": True})
        self.client.post("/api/dispatch/run")
        assigned = self.client.get(f"/api/reports/{queued['report_id']}").json
        self.assertEqual(assigned["assigned_handler"], "DEP-01")


if __name__ == "__main__":
    unittest.main(verbosity=2)
