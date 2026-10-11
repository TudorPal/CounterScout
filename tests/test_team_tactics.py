import copy
import json
import unittest
from unittest.mock import patch

from backend.analysis import team_tactics as tactics


def fixture():
    roster = {'team1': {'name': 'Scouted', 'players': ['A', 'B', 'C', 'D', 'E'],
                       'players_detailed': [{'steamid': str(i), 'name': chr(65+i)} for i in range(5)]},
              'team2': {'name': 'Enemy', 'players': ['Opponent']}}
    rounds = [{'num': n, 'start_tick': (n-1)*1000, 'freeze_end_tick': (n-1)*1000+100,
               'end_tick': n*1000-1, 'winner': 'T'} for n in range(1, 15)]
    positions = {}
    for sid in range(5):
        samples=[]
        for r in rounds:
            tn=2 if r['num']<=12 else 3
            for offset in range(0, 800, 10):
                samples.append({'t': r['freeze_end_tick']+offset, 'x': 2000 if sid==4 else sid*20,
                                'y': 0, 'alive': True, 'tn': tn, 'eq': 5000, 'ar': 100,
                                'inv': ['ak47', 'smokegrenade'], 'cash': 200, 'cs': 4000})
        positions[str(sid)]=samples
    return {'map_name': 'de_mirage', 'tick_rate': 10, 'players': [{'steamid':str(i), 'name':chr(65+i), 'team_num':2} for i in range(5)] + [{'steamid':'enemy','name':'Opponent','team_num':3}],
            'positions': positions, 'rounds': rounds, 'events': [{'type':'bomb_plant','tick':750,'data':{'site':'B'}}],
            'grenades': [{'type':'smokegrenade','thrower':'0','points':[[220,0,0],[250,200,0]]},
                         {'type':'flashbang','thrower':'1','points':[[230,0,0],[260,210,0]]},
                         {'type':'smokegrenade','thrower':'enemy','points':[[240,0,0],[265,210,0]]}]}, roster


class TeamTacticsTests(unittest.TestCase):
    def test_sides_pistols_utility_and_sustained_lurk(self):
        bundle,roster=fixture()
        evidence=tactics.build_evidence([('demo.dem',bundle,roster)],'Scouted','de_mirage')
        self.assertEqual(len(evidence['rounds']),14)
        self.assertEqual([r['buy'] for r in evidence['rounds'] if r['round'] in (1,13)],['pistol','pistol'])
        self.assertEqual(evidence['rounds'][11]['side'],'T')
        self.assertEqual(evidence['rounds'][12]['side'],'CT')
        first=evidence['rounds'][0]
        self.assertEqual(first['planted_site'],'B')
        self.assertEqual(len(first['utility']),2)
        self.assertEqual(first['possible_lurks'][0]['player'],'E')
        self.assertEqual(evidence['rounds'][12]['possible_lurks'],[],'CT splits are not lurks')
        self.assertNotIn('Opponent',json.dumps(evidence))
        self.assertNotIn('enemy',json.dumps(evidence))

    def test_disconnected_slot_cannot_change_side_or_economy(self):
        bundle,roster=fixture()
        # E's last sample is old T; other four are now CT.
        bundle['positions']['4']=[s for s in bundle['positions']['4'] if s['t']<12000]
        evidence=tactics.build_evidence([('demo.dem',bundle,roster)],'Scouted','de_mirage')
        r=evidence['rounds'][12]
        self.assertEqual((r['side'],r['active_players'],r['equipment']),('CT',4,20000))
        self.assertNotIn('E',[p['player'] for p in r['routes']])

    def test_classification_uses_loadout_presence_and_depleted_cash(self):
        full={'eq':5000,'inv':['ak47'],'ar':100,'cash':200,'cs':4000}
        self.assertEqual(tactics.buy_type([full]*4,14),'full-buy')
        self.assertEqual(tactics.buy_type([{**full,'inv':['AK-47']}]*4,14),'full-buy')
        self.assertEqual(tactics.buy_type([{**full,'inv':['Galil AR']}]*4,14),'full-buy')
        self.assertEqual(tactics.buy_type([full]*4,25),'full-buy','OT is not a pistol')
        eco={**full,'eq':600,'inv':['glock'],'ar':0,'cash':3000,'cs':0}
        self.assertEqual(tactics.buy_type([eco]*4,2),'eco')
        force={**full,'eq':2300,'inv':['mac10'],'cash':200,'cs':1500}
        self.assertEqual(tactics.buy_type([force]*4,2),'force-buy')
        self.assertEqual(tactics.buy_type([{**force,'cash':3000}]*4,2),'mixed/unknown')
        self.assertEqual(tactics.buy_type([{'eq':0}],2),'mixed/unknown')

    def test_unknown_locations_do_not_invent_named_callouts(self):
        with patch.dict(tactics.callouts._CALLOUTS,{},clear=True),patch.dict(tactics.RADARS,{'de_test':{'pos_x':0,'pos_y':1024,'scale':1}},clear=True):
            self.assertEqual(tactics.location('de_test',200,824),'radar grid B2')
            self.assertEqual(tactics.location('missing',50,25),'world (50, 25)')

    def test_common_locations_count_rounds_not_only_throws(self):
        bundle,roster=fixture()
        bundle['grenades'].append(copy.deepcopy(bundle['grenades'][0]))
        evidence=tactics.build_evidence([('demo.dem',bundle,roster)],'Scouted','de_mirage')
        smoke=next(u for u in evidence['groups'][0]['common_utility'] if u['type']=='smoke')
        self.assertEqual((smoke['throws'],smoke['rounds']),(2,1))

    def test_wrong_team_map_and_ambiguous_roster_are_rejected(self):
        bundle,roster=fixture()
        for team,map_name in [('No team','de_mirage'),('Scouted','de_cache')]:
            with self.assertRaises(ValueError):tactics.build_evidence([('demo.dem',bundle,roster)],team,map_name)
        roster['team2']['name']='Scouted'
        with self.assertRaises(ValueError):tactics.roster_ids(bundle,roster,'Scouted')

    def test_prompt_is_bounded_and_totals_survive_example_selection(self):
        bundle,roster=fixture()
        evidence=tactics.build_evidence([(f'demo{i}.dem',bundle,roster) for i in range(12)],'Scouted','de_mirage')
        digest,refs=tactics.prompt_evidence(evidence)
        self.assertLess(len(json.dumps(digest,ensure_ascii=False,separators=(',',':'))),16000)
        self.assertEqual(sum(g['rounds'] for g in digest['groups']),168)
        self.assertTrue(set(refs)<={r['id'] for r in evidence['rounds']})
        self.assertEqual(len(digest['groups']),len(evidence['groups']))


if __name__=='__main__':unittest.main()
