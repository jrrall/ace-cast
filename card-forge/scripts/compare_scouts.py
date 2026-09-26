#!/usr/bin/env python3
"""Compare both scout routes on saved input, with fresh calls and local artifacts only."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from forge.config import load_settings
from forge.scout_comparison import compare


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-run', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path, help='New local directory; existing directories are refused')
    parser.add_argument('--personas', type=int, default=2, help='First N saved personas, retaining full-roster card budgets')
    parser.add_argument('--max-calls', type=int, default=24, help='Maximum logical model calls, including schema repairs and writing')
    parser.add_argument('--max-seconds', type=float, default=900)
    parser.add_argument('--timeout', type=float, default=90)
    parser.add_argument('--base-url', help='Connection override shared by both routes, e.g. localhost instead of a Docker hostname')
    args = parser.parse_args()
    report = compare(args.source_run, args.output, load_settings(), persona_count=args.personas,
                     max_calls=args.max_calls, max_seconds=args.max_seconds, timeout=args.timeout, base_url=args.base_url)
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
