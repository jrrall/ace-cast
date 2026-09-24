"""The research, writing, and review personas of the Card Forge agent chain."""

from .trendscout import Trendscout
from .writer import Writer, DeadpanWriter, UnhingedWriter, PRSpinDoctorWriter, PettyVillainWriter, BannedFromTheThreadWriter, HatemongerWriter, writing_team
from .editor import Editor
from .moderator import Moderator
from .curator import Curator

__all__ = ["Trendscout", "Writer", "DeadpanWriter", "UnhingedWriter", "PRSpinDoctorWriter", "PettyVillainWriter", "BannedFromTheThreadWriter", "HatemongerWriter", "writing_team", "Editor", "Moderator", "Curator"]
