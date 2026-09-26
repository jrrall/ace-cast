"""Neutral fictional source seeds; personas supply the interpretation."""
from __future__ import annotations

import random

from .feeds import FeedItem

EVERYDAY = (
    'A wedding reception and its guest list.',
    'Roommates making an inventory before moving house.',
    'Arrangements for a funeral service.',
    'An emergency-contact form.',
    'A family reunion and its seating chart.',
    'An amateur club electing a committee.',
    'Two adults meeting for a first date.',
    'A neighborhood association meeting.',
)
SETTINGS = ('a lost-and-found desk', 'a royal coronation', 'a motel breakfast buffet',
            'a confessional booth', 'a community pool', 'an amateur talent show',
            'a couples retreat', 'a museum gift shop', 'a pet custody hearing')
DETAILS = ('a sign at the entrance', 'an item left behind', 'a booking form',
           'a visitor list', 'a printed schedule', 'a storage cupboard', 'a receipt')


def fictional_inspiration(count: int = 3, rng: random.Random | None = None) -> list[FeedItem]:
    """Sample situations and setting/detail pairs without prescribing jokes."""
    rng = rng or random.Random()
    everyday = rng.sample(EVERYDAY, min(count, len(EVERYDAY)))
    combinations = [(place, detail) for place in SETTINGS for detail in DETAILS]
    settings = rng.sample(combinations, min(count, len(combinations)))
    return [FeedItem(title=idea, source='fictional:everyday') for idea in everyday] + [
        FeedItem(title=f'Fictional setting: {place}; detail: {detail}.', source='fictional:off-the-cuff')
        for place, detail in settings
    ]
