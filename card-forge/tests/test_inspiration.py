import random
from forge.inspiration import fictional_inspiration


def test_random_seeds_are_bounded_distinct_and_reproducible():
    seeds = fictional_inspiration(3, random.Random(7))
    assert len(seeds) == 6
    assert len({s.title for s in seeds}) == 6
    assert all(s.source.startswith("fictional:") and not s.url for s in seeds)
    assert seeds == fictional_inspiration(3, random.Random(7))
    assert seeds != fictional_inspiration(3, random.Random(8))
    assert fictional_inspiration(0) == []
