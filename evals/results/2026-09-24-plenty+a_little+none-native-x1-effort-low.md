# Brain Dump evals — 2026-09-24

Model `claude-sonnet-5` · prompt sort@v4 · effort low · 1 runs per cell

## Violation rate per rule, per level

| Level | Runs | Hard fails | Cap | Banned phrasing | Routing | Schema | Strategy | Let go unique | Why given | Carried placed | Cost per plan (mean, USD) | Cost, all runs (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plenty | 20 | 0 | 0% | 0% | 20% | 0% | 0% | 0% | 0% | 0% | 0.0044 | 0.0875 |
| plenty + anxious | 20 | 0 | 0% | 30% | 15% | 0% | 0% | 0% | 0% | 0% | 0.0049 | 0.0976 |
| a little | 20 | 0 | 0% | 0% | 25% | 0% | 0% | 0% | 0% | 0% | 0.0041 | 0.0815 |
| a little + anxious | 20 | 0 | 0% | 10% | 20% | 0% | 0% | 0% | 0% | 0% | 0.0042 | 0.0832 |
| none | 20 | 0 | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0.0030 | 0.0599 |
| none + anxious | 20 | 0 | 0% | 10% | 0% | 0% | 0% | 0% | 0% | 0% | 0.0036 | 0.0727 |

## Parse outcome per contract

| Contract | Runs | Native | Recovered | Failed | Cap violations | Cost per plan (mean, USD) |
| --- | --- | --- | --- | --- | --- | --- |
| native | 120 | 120 | 0 | 0 | 0% | 0.0040 |

Hard fail on the native path (valid_json failing): **0** · cut off at max_tokens (16000): 0 of 120 · cache reads on 99.2% of runs · mean latency 4631 ms · errors 0

## Follow-ups: revision preserves

| Conversation | Parsed | Items lost | Cost, both calls (USD) |
| --- | --- | --- | --- |
| F01_twenty_minutes | yes | write three slide bullets. | 0.0106 |
| F02_move_first_to_tomorrow | yes | none | 0.0091 |
| F03_done_with_top_two | yes | none | 0.0125 |
| F04_energy_change | yes | none | 0.0083 |
| F05_add_one | yes | none | 0.0036 |

## Cost

Prices for `claude-sonnet-5`: $2.00 in, $10.00 out, $2.50 cache write, $0.20 cache read, per million tokens, read 2026-09-23 into `worker/contracts.js` as an assumption to re-check against the pricing page before quoting. Output tokens include the model's thinking tokens.

| Measure | USD |
| --- | --- |
| Per plan, one case one pass: cheapest / median / dearest (120 of 120 plans priced) | 0.0015 / 0.0038 / 0.0123 |
| Per plan, mean | 0.0040 |
| The grid, 120 plans | 0.4824 |
| Follow-ups, 5 conversations, two calls each | 0.0440 |
| Whole run, everything above that was priced | 0.5264 |
