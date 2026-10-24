// Text grid that fills the 576x288 glasses canvas. 28 fullwidth columns fit
// the width (proven by other G2 text-grid games); 9 rows leaves a centre row.
export const COLS = 28
export const ROWS = 9                // playable rows
export const SCREEN_ROWS = 10        // rows the display fits; the tenth carries the frame's floor

export const SHOOTER_X = 0
export const SHOOTER_Y = Math.floor(ROWS / 2) // 4

// Any bubble that settles left of this column ends the game.
export const DEAD_COL = 2

// The wall is drawn one column right of the last playable column, so the
// playable width stops this many columns short of the edge to keep it visible.
export const WALL_INSET = 2
export const SHOTS_PER_WALL_ADVANCE = 8   // at normal difficulty; see WALL_EVERY

// Difficulty: how often the wall moves, whether it hurries you, and puzzle slack.
export const WALL_EVERY = { easy: 10, normal: 8, hard: 6 } as const
export const HURRY_SCALE = { easy: 0, normal: 1, hard: 0.75 } as const   // 0 = never hurries
export const PUZZLE_EXTRA = { easy: 8, normal: 5, hard: 3 } as const

// Endless escalation: waves arrive this often to start, one shot sooner every
// PUSH_TIGHTEN_WAVES waves, never faster than PUSH_EVERY_MIN.
export const PUSH_EVERY_START = { easy: 7, normal: 6, hard: 5 } as const
export const PUSH_TIGHTEN_WAVES = 8
export const PUSH_EVERY_MIN = 3

// Levels beyond the 100 Frozen Bubble layouts are generated; this is the ceiling.
export const MAX_LEVEL = 999

export const MAX_ANGLE_DEG = 70      // aim limit above/below the horizontal
export const SWIPE_AIM_DEG = 8       // most a swipe turns the aim; less when the next landing cell is nearer
export const SUBSTEP = 0.2           // collision sub-step in cells
export const AIM_MAX_STEPS = 400     // aim-line trace length in sub-steps (80 cells)

export const TICK_MS = 100           // one game tick of motion; the loop scales each tick by real elapsed time
export const MAX_TICK_DT = 3         // a stall longer than this many ticks slows the game instead of teleporting the shot

export const MAX_TYPES = 8           // Frozen Bubble has eight colours

// Scoring. Pops pay per bubble; drops pay exponentially (Puzzle Bobble style)
// so that aiming at the bubble holding a cluster up is worth the harder shot.
export const POP_POINTS = 10
export const DROP_BASE_POINTS = 20   // 1 drop = 20, 2 = 60, 3 = 140, ... 20 * (2^n - 1)
export const DROP_CAP = 8            // drops beyond this many pay no more
export const LEVEL_POINTS = 100

// A clear this big (popped + dropped) gets the blast effect: an extra frame
// and a shockwave ring; twice this big, a second ring.
export const BLAST_SIZE = 5
export const EFFECT_FRAMES = 3
export const BLAST_FRAMES = 4

// Native text updates provide the fastest full-width rendering path.
export const TEXT_SPEED = 2.2        // cells per tick
export const BUBBLE_SPEED = TEXT_SPEED

// Special bubbles (Bust-A-Move style). Values sit above the eight colours.
export const STAR = 9                // a shot landing next to it clears every bubble of that shot's colour
export const RAINBOW = 10            // joins any colour; as a shot, takes the colour that pops most
export const STONE = 11              // never pops; falls only when nothing holds it
export const BOMB = 12               // a shot landing next to it blows away everything around it, chaining into other bombs
export const FROZEN = 13             // ice: a pop beside it cracks it, a second pop frees it
export const CRACKED = 14
export const MYSTERY_BASE = 20       // MYSTERY_BASE + colour: hidden until a shot lands or a pop happens beside it
export const SPECIALS_FROM_LEVEL = 3
export const RAINBOW_SHOT_CHANCE = 0.08

export const COMBO_MAX = 5           // consecutive scoring shots multiply the score, up to this

// Endless mode: a fresh column pushes in from the wall every PUSH_EVERY shots.
export const PUSH_EVERY = 6
export const ENDLESS_START_DEPTH = 5

// Puzzle mode: shots allowed per level = half the bubbles plus this.
export const PUZZLE_EXTRA_SHOTS = 5

// Pickups (Bricks and Balls style): a ＋ in the open field; a shot passing
// through it loads a special as the next bubble.
export const PICKUP_CHANCE = 0.35     // chance one appears after a shot, when none is out
export const PICKUP_FROM_LEVEL = 2
export const PICKUP_MARGIN = 4        // columns kept clear between a pickup and the nearest wall

// One continue per game: the columns nearest the shooter are cleared.
export const CONTINUES = 1
export const CONTINUE_CLEAR = 3

// Pulley mode: the group with more bubbles hangs this many columns closer
// per PULLEY_WEIGHT bubbles of difference, up to PULLEY_MAX_SHIFT.
export const PULLEY_WEIGHT = 4
export const PULLEY_MAX_SHIFT = 4

// Hurry-up: with no shot for this long the wall blinks, then advances.
export const HURRY_WARN_TICKS = 140  // ~11 s at TICK_MS
export const HURRY_TICKS = 190       // ~15 s
export const BLINK_TICKS = 4         // half-period of the warning blink, in ticks

// Level clear bonus and the harder path.
export const BONUS_PER_SHOT = 20     // per shot under par (par = half the level's bubbles)
export const SKIP_POINTS = 200       // for skipping a level after a clear
