"""Audit a real local demo offline; add --live only after configuring your key.

Example: python scripts/test_team_ai.py --demo match.dem --team Retake --map de_anubis --live
No credentials, raw timelines or provider errors are printed.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.main import TeamAnalysisRequest, get_team_evidence, get_team_tactical_report
from backend.analysis.team_tactics import prompt_evidence
from fastapi import HTTPException


async def run(args):
    request=TeamAnalysisRequest(team_name=args.team,map_name=args.map,demo_files=args.demo)
    evidence=await get_team_evidence(request)
    digest,refs=prompt_evidence(evidence)
    print(f"Local evidence: {len(evidence['rounds'])} rounds; {len(evidence['groups'])} side/buy groups; {len(refs)} prompt examples; {len(json.dumps(digest,ensure_ascii=False))} characters")
    for g in evidence['groups']:
        print(f"  {g['side']} {g['buy']}: {g['rounds']} rounds, plants={g['planted_sites']}, smoke/flash areas={len(g['common_utility'])}")
    if args.live:
        result=await get_team_tactical_report(request)
        print(f"Validated live report: {result['provider']} / {result['model']}; cached={result['cached']}; {len(result['report']['sections'])} cited sections")
        print(result['report']['overview'])
    else:
        print("Offline checks complete. No AI provider was contacted. Use --live for the key-dependent integration test.")


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo',action='append',required=True,help='Filename in configured demo directory; repeat for multiple demos')
    parser.add_argument('--team',required=True)
    parser.add_argument('--map',required=True)
    parser.add_argument('--live',action='store_true')
    try:asyncio.run(run(parser.parse_args()))
    except HTTPException as exc:
        print(f"AI test failed ({exc.status_code}): {exc.detail}",file=sys.stderr)
        sys.exit(1)
