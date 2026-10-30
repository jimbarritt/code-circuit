# Layout rules

This document defines how `cc render` places chips and routes traces. The rules come from the `route()` function of the hand-drawn sketch (`src/html/sketch/mastodon-circuit-board.html`) and from the constraints of the mission. `src/layout.ts` implements them. `tests/layout.test.ts` checks them.

## Terms

| Term | Meaning |
|---|---|
| Column | A vertical stack of chips. Columns are numbered from 0 on the left. |
| Row | A horizontal position in a column. All columns share one row pitch. |
| Gutter | The vertical strip between two columns. Gutter `k` lies to the right of column `k`. Gutter `-1` lies to the left of column 0. |
| Channel | The horizontal strip between two rows. Channel `r` lies above row `r`. Channel `R` lies below the last row. |
| Lane | A horizontal line below all rows. Each queue name has one lane. |
| Pad | A round contact on the board edge. Endpoints sit on the left edge. Externals sit on the right edge. |

## The board holds no trace over a chip

A chip occupies a rectangle in a column and a row. A trace runs only in gutters, channels, lanes and the pad zones. A trace touches a chip only at its edge, where it starts or ends. Because of this, no trace crosses a chip, whatever the graph.

`findCrossings()` in `src/layout.ts` checks every segment of every trace against every chip. A crossing is a defect. The test suite asserts that the list is empty.

## Placement rules

1. **Column is depth.** The column of a chip is the length of the shortest path from an entry node to the chip. A chip that no entry node reaches starts its own search at depth 0.
2. **Entry nodes sit in column 0.** An endpoint pad sits to the left of column 0 at the height of its entry chip. An edge into an entry chip is drawn as a call that loops back, by routing rule 2.
3. **Row is the barycentre.** Chips in a column are ordered by the mean row of the chips they connect to in other columns. Four sweeps alternate left to right and right to left. Ties keep the order of the data map.
4. **Overflow column.** The board has at most 8 ordinary columns. A chip of depth 8 or more goes to one overflow column on the right. The renderer logs each such chip. The overflow column is the only place a chip is placed out of rule 1.
5. **Externals.** External pads sit on the right edge. They are ordered by the mean row of the chips that call them and spread over the rows.

## Routing rules

Every trace leaves the right edge of its source chip and enters the left edge of its target chip. Each trace takes its own track inside a gutter or channel. Traces that do not overlap in extent share a track.

1. **Forward calls go right.** A sync call to the next column goes out into the gutter on the right of the source, runs along the gutter to the height of the target, and enters the target on its left edge.
2. **Same-column and backward calls loop back through the gutter.** A sync call to the same column or to an earlier column leaves into the gutter on the right of the source, runs to the channel next to the target row, runs along the channel to the gutter on the left of the target, and runs along that gutter to the height of the target.
3. **Queue hops drop to a lane and climb into the target.** An async edge leaves into the gutter on the right of the source, runs down to the lane of its queue, runs along the lane to the gutter on the left of the target, and runs up that gutter to the height of the target.
4. **I/O runs to the right edge.** An io edge leaves into the gutter on the right of the source, runs to the channel below the source row, runs along it to the last gutter, runs along the last gutter to the height of the external pad, and ends on the pad.
5. **Endpoint traces are straight.** An endpoint pad connects to its entry chip with a horizontal line.

## Record of the rule

Every edge in a data map may carry `rule`, the name of the extraction rule that made it. The renderer shows the rule in the inspector so that a wrong trace leads back to its heuristic.
