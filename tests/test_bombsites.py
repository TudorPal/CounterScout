import unittest

from backend.ingestion.demo_parser import _bombsite_label, _bombsite_mapping, TIMELINE_CACHE_VERSION


class BombsiteTests(unittest.TestCase):
    def test_cache_entity_order_is_not_site_order(self):
        rows = [dict(site=436, user_last_place_name="BombsiteA"), dict(site=435, user_last_place_name="BombsiteB")]
        self.assertEqual(_bombsite_mapping(rows), {"436": "A", "435": "B"})
        self.assertEqual(_bombsite_mapping(rows[::-1]), {"436": "A", "435": "B"})

    def test_one_site_and_unknown_do_not_guess_from_first_plant(self):
        self.assertEqual(_bombsite_mapping([dict(site=504, user_last_place_name="BombsiteB")]), {"504": "B"})
        self.assertEqual(_bombsite_mapping([dict(site=504)]), {})
        self.assertEqual(_bombsite_label(dict(site=0)), "?")

    def test_text_labels_and_player_zone_fallback(self):
        self.assertEqual(_bombsite_label(dict(site="b")), "B")
        self.assertEqual(_bombsite_label(dict(site=436, user_which_bomb_zone=1)), "A")
        self.assertEqual(_bombsite_label(dict(site=435, user_which_bomb_zone=2)), "B")
        self.assertEqual(_bombsite_label(dict(site=435, user_which_bomb_zone=float("nan"))), "?")

    def test_conflicting_evidence_is_unknown_and_old_caches_expire(self):
        self.assertEqual(_bombsite_mapping([dict(site=10, user_last_place_name="BombsiteA"),
                                            dict(site=10, user_last_place_name="BombsiteB")]), {"10": "?"})
        self.assertGreaterEqual(TIMELINE_CACHE_VERSION, 8)
