# Brain Dump evals — 2026-09-22

Model `claude-sonnet-5` · prompt sort@v2 · 1 runs per cell

## Violation rate per rule, per state

| State | Runs | Hard fails | Cap | Banned phrasing | Routing | Schema | Strategy | Cost per plan (mean, USD) | Cost, all runs (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anxious | 20 | 0 | 0% | 30% | 10% | 0% | 0% | 0.0191 | 0.3826 |

## Parse outcome per contract

| Contract | Runs | Native | Recovered | Failed | Cap violations | Cost per plan (mean, USD) |
| --- | --- | --- | --- | --- | --- | --- |
| native | 20 | 20 | 0 | 0 | 0% | 0.0191 |

Hard fail on the native path (valid_json failing): **0** · cut off at max_tokens (4096): 0 of 20 · cache reads on 95% of runs · mean latency 19332 ms · errors 0

## Follow-ups: revision preserves

| Conversation | Parsed | Items lost | Cost, both calls (USD) |
| --- | --- | --- | --- |
| F01_twenty_minutes | yes | none | not recorded before 2026-09-23 |
| F02_move_first_to_tomorrow | yes | water the tomatoes before it gets dark | not recorded before 2026-09-23 |
| F03_done_with_top_two | yes | text mum back; pay the electric bill; cancel the trial subscription | not recorded before 2026-09-23 |
| F04_energy_change | yes | eat something — whatever's fastest, no cooking needed.; switch the laundry from the washer to the dryer. | not recorded before 2026-09-23 |
| F05_add_one | yes | none | not recorded before 2026-09-23 |

## Cost

Prices for `claude-sonnet-5`: $2.00 in, $10.00 out, $2.50 cache write, $0.20 cache read, per million tokens, read 2026-09-23 into `worker/contracts.js` as an assumption to re-check against the pricing page before quoting. Output tokens include the model's thinking tokens.

| Measure | USD |
| --- | --- |
| Per plan, one case one pass: cheapest / median / dearest (20 of 20 plans priced) | 0.0101 / 0.0178 / 0.0363 |
| Per plan, mean | 0.0191 |
| The grid, 20 plans | 0.3826 |
| Follow-ups, 5 conversations, two calls each | not recorded before 2026-09-23 |
| Whole run, everything above that was priced | 0.3826 |
