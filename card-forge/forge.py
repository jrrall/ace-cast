#!/usr/bin/env python3
"""Card Forge entrypoint.

Cron-friendly wrapper around ``forge.cli:main``. Exits non-zero on any stage
failure and submits nothing partial.

    uv run python forge.py            # generate + submit pending cards
    uv run python forge.py --dry-run  # print the assembled batch, POST nothing
"""

import sys

from forge.cli import main

if __name__ == "__main__":
    sys.exit(main())
