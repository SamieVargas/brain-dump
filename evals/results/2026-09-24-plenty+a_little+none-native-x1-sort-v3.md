# Brain Dump evals — 2026-09-24

Model `claude-sonnet-5` · prompt sort@v3 · 1 runs per cell

## Violation rate per rule, per level

| Level | Runs | Hard fails | Cap | Banned phrasing | Routing | Schema | Strategy | Let go unique | Why given | Carried placed | Cost per plan (mean, USD) | Cost, all runs (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plenty | 20 | 0 | 0% | 5% | 10% | 0% | 0% | 0% | 0% | 0% | 0.0149 | 0.2980 |
| plenty + anxious | 20 | 0 | 0% | 15% | 10% | 0% | 0% | 0% | 0% | 0% | 0.0183 | 0.3670 |
| a little | 20 | 0 | 0% | 0% | 10% | 0% | 0% | 5% | 0% | 0% | 0.0133 | 0.2652 |
| a little + anxious | 20 | 0 | 0% | 15% | 10% | 0% | 0% | 0% | 0% | 0% | 0.0138 | 0.2763 |
| none | 20 | 0 | 0% | 5% | 0% | 0% | 0% | 0% | 0% | 0% | 0.0089 | 0.1779 |
| none + anxious | 20 | 0 | 0% | 10% | 0% | 0% | 0% | 5% | 0% | 0% | 0.0110 | 0.2206 |

## Parse outcome per contract

| Contract | Runs | Native | Recovered | Failed | Cap violations | Cost per plan (mean, USD) |
| --- | --- | --- | --- | --- | --- | --- |
| native | 120 | 120 | 0 | 0 | 0% | 0.0134 |

Hard fail on the native path (valid_json failing): **0** · cut off at max_tokens (16000): 0 of 120 · cache reads on 99.2% of runs · mean latency 15055 ms · errors 0

## Follow-ups: revision preserves

| Conversation | Parsed | Items lost | Cost, both calls (USD) |
| --- | --- | --- | --- |
| F01_twenty_minutes | yes | none | 0.0295 |
| F02_move_first_to_tomorrow | yes | pick up the parcel. | 0.0227 |
| F03_done_with_top_two | yes | pay electric bill. | 0.0454 |
| F04_energy_change | yes | move laundry. | 0.0146 |
| F05_add_one | yes | none | 0.0036 |

## Cost

Prices for `claude-sonnet-5`: $2.00 in, $10.00 out, $2.50 cache write, $0.20 cache read, per million tokens, read 2026-09-23 into `worker/contracts.js` as an assumption to re-check against the pricing page before quoting. Output tokens include the model's thinking tokens.

| Measure | USD |
| --- | --- |
| Per plan, one case one pass: cheapest / median / dearest (120 of 120 plans priced) | 0.0015 / 0.0123 / 0.0389 |
| Per plan, mean | 0.0134 |
| The grid, 120 plans | 1.6049 |
| Follow-ups, 5 conversations, two calls each | 0.1157 |
| Whole run, everything above that was priced | 1.7207 |
