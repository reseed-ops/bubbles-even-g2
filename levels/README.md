# Level data

`frozen-bubble-levels.txt` is the unmodified `share/data/levels` file from
Frozen Bubble 2.2.1-beta (Games-FrozenBubble-2.212 on CPAN), copyright
Guillaume Cottenceau and contributors, licensed under the GNU GPL version 2
(see `../LICENSE`). 100 levels; each is 10 rows of a hex grid, alternating
8 and 7 bubbles, colours `0`–`7`, `-` for empty.

`scripts/convert-levels.mjs` turns it into `src/levels.ts`: the board is
rotated so the ceiling becomes the right-hand wall, and the half-cell hex
offset is snapped onto the square text grid. The game uses 8-neighbour
adjacency, so every contact in the original layouts is preserved.
