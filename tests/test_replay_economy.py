import unittest

from backend.models.schemas import TimelinePosition


class ReplayEconomySchemaTests(unittest.TestCase):
    def test_cash_survives_api_response_serialization(self):
        position = TimelinePosition(t=100, x=0, y=0, yaw=0, alive=True, hp=100,
                                    cash=1350, eq=4750, cs=4050)
        payload = position.model_dump()
        self.assertEqual(payload["cash"], 1350)
        self.assertEqual(payload["eq"], 4750)
        self.assertEqual(payload["cs"], 4050)

    def test_old_samples_do_not_fabricate_cash(self):
        position = TimelinePosition(t=100, x=0, y=0, yaw=0, alive=True, hp=100)
        self.assertIsNone(position.cash)


if __name__ == "__main__":
    unittest.main()
