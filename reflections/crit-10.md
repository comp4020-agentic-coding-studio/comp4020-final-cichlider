# Crit 10 reflection

## What was the breakthrough that moved the work forward?

The game could already put two rollers on one floor, but I could not have
narrated their actions from the server. The useful shift was to treat the log
as part of the interaction, not as a dump of every request. A held key sends
regular input to keep a roller present; logging each request would make the
important moments disappear. The server now records arrivals, departures,
renames and changes in movement with a stable player ID and the tag people
see above the roller. Running two-player checks made the authority rule
concrete too: a request body can claim another player ID, but the server acts
only for the browser secret that authenticated the request. That rule is
written down and tested, not just assumed from the interface.

## What did this work change about who I want to be as a software developer?

Crit 9 taught me to play the game and correct what felt wrong. This week adds
another habit: I want to be able to explain what the deployed system is doing
from evidence it produces while people use it. A successful local interaction
does not show whether two independent visitors remain distinct, or whether
the server accepted an action for the wrong person. The new check and the
structured log make those questions answerable. I still need the live pod
rehearsal to judge whether the events tell a clear story to someone who has
only the URL; if they do not, the log needs a better vocabulary rather than
more volume.
