import os
import tempfile
import unittest
from unittest.mock import patch

from src.api import storage


class StorageTests(unittest.TestCase):
    def test_scenario_and_feedback_round_trip(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, 'cityflow-test.db')
            with patch.object(storage, 'DB_PATH', db_path):
                storage.init_db()
                scenario = storage.create_scenario({
                    'cause': 'Festival', 'latitude': 12.97, 'longitude': 77.59,
                    'event_type': 'planned', 'start_time': '2026-06-22T10:00',
                    'expected_attendance': 5000, 'expected_duration_hours': 4,
                    'closure_severity': 'full', 'requires_closure': True,
                    'roads_affected': 'Central approaches',
                })
                self.assertEqual(storage.get_scenario(scenario['id'])['cause'], 'Festival')

                storage.create_feedback({
                    'event_id': scenario['id'], 'actual_resolution_minutes': 180,
                    'predicted_resolution_minutes': 200, 'actual_officers': 12,
                    'recommended_officers': 14, 'actual_barricades': 3,
                    'recommended_barricades': 3, 'observed_severity': 'Amber',
                    'diversion_effective': True, 'notes': 'Cleared early',
                })
                summary = storage.feedback_summary()
                self.assertEqual(summary['total_outcomes'], 1)
                self.assertEqual(summary['mean_resolution_error_minutes'], 20.0)
                self.assertEqual(summary['diversion_success_rate'], 100.0)


if __name__ == '__main__':
    unittest.main()
