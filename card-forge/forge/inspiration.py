"""Fictional writing exercises, never presented as reported events."""
from __future__ import annotations

import random

from .feeds import FeedItem

EVERYDAY = (
    'A wedding guest mistakes a deeply personal confession for an invitation to give advice.',
    'Roommates negotiate which embarrassing possessions must be hidden from the landlord.',
    'A funeral organizer must explain an expense that absolutely cannot go on the invoice.',
    'Someone names an emergency contact who is spectacularly unqualified for the responsibility.',
    'A family reunion introduces a new rule without admitting which relative made it necessary.',
    'An amateur club awards authority to the person least qualified to exercise it.',
    'A first date reveals an alarming definition of being financially responsible.',
    'A neighborhood dispute escalates into a ceremony nobody can gracefully leave.',
)
SETTINGS = ('a lost-and-found desk', 'a royal coronation', 'a motel breakfast buffet',
            'a confessional booth', 'a community pool', 'an amateur talent show',
            'a couples retreat', 'a museum gift shop', 'a pet custody hearing')
COMPLICATIONS = ('has introduced a loyalty program for its worst offenders',
                 'requires a character reference from the least credible person present',
                 'has to conceal an appalling mistake during a routine inspection',
                 'is treating an intimate personal embarrassment as a competitive sport',
                 'has given ceremonial authority to an ordinary household object',
                 'must issue a sincere apology for an extremely petty abuse of power',
                 'has mistaken a private confession for a legally binding promise')


def fictional_inspiration(count: int = 3, rng: random.Random | None = None) -> list[FeedItem]:
    """Sample both grounded and absurd seeds; injectable RNG for reproducible tests."""
    rng = rng or random.Random()
    everyday = rng.sample(EVERYDAY, min(count, len(EVERYDAY)))
    combinations = [(place, problem) for place in SETTINGS for problem in COMPLICATIONS]
    silly = rng.sample(combinations, min(count, len(combinations)))
    return [FeedItem(title=idea, source='fictional:everyday') for idea in everyday] + [
        FeedItem(title=f'Imagine {place} that {problem}.', source='fictional:off-the-cuff')
        for place, problem in silly
    ]
