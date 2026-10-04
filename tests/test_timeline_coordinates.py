import unittest
import pandas as pd
from backend.ingestion.demo_parser import _finite_coordinate_rows


class TimelineCoordinateTests(unittest.TestCase):
    def test_missing_and_nonfinite_player_samples_are_dropped_not_zeroed(self):
        frame = pd.DataFrame({"tick": range(7), "X": [0, 12, float("nan"), 4, float("inf"), -float("inf"), None],
                              "Y": [0, 34, 2, float("nan"), 5, 6, 7]})
        self.assertEqual(_finite_coordinate_rows(frame)["tick"].tolist(), [0, 1])

    def test_projectile_coordinates_keep_valid_zero_and_reject_bad_strings(self):
        frame = pd.DataFrame({"x": [0, "12", "bad", 3], "y": [0, "34", 4, float("inf")]})
        self.assertEqual(_finite_coordinate_rows(frame, "x", "y").index.tolist(), [0, 1])

    def test_absent_coordinate_columns_do_not_fabricate_samples(self):
        self.assertTrue(_finite_coordinate_rows(pd.DataFrame({"tick": [1]})).empty)
