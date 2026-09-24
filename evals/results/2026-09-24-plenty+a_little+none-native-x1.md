# Brain Dump evals — 2026-09-24

Model `claude-sonnet-5` · prompt sort@v4 · effort medium · 1 runs per cell

## Violation rate per rule, per level

| Level | Runs | Hard fails | Cap | Banned phrasing | Routing | Schema | Strategy | Let go unique | Why given | Carried placed | Cost per plan (mean, USD) | Cost, all runs (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plenty | 20 | 0 | 0% | 0% | 10% | 0% | 0% | 0% | 0% | 0% | 0.0068 | 0.1370 |
| plenty + anxious | 20 | 0 | 0% | 15% | 0% | 0% | 0% | 0% | 0% | 0% | 0.0089 | 0.1772 |
| a little | 20 | 0 | 0% | 0% | 15% | 0% | 0% | 0% | 0% | 0% | 0.0070 | 0.1406 |
| a little + anxious | 20 | 0 | 0% | 20% | 10% | 0% | 0% | 0% | 0% | 0% | 0.0091 | 0.1820 |
| none | 20 | 0 | 0% | 5% | 0% | 0% | 0% | 0% | 0% | 0% | 0.0049 | 0.0974 |
| none + anxious | 20 | 0 | 0% | 20% | 0% | 0% | 0% | 0% | 0% | 0% | 0.0061 | 0.1226 |

## Parse outcome per contract

| Contract | Runs | Native | Recovered | Failed | Cap violations | Cost per plan (mean, USD) |
| --- | --- | --- | --- | --- | --- | --- |
| native | 120 | 120 | 0 | 0 | 0% | 0.0071 |

Hard fail on the native path (valid_json failing): **0** · cut off at max_tokens (16000): 0 of 120 · cache reads on 99.2% of runs · mean latency 8103 ms · errors 0

## Follow-ups: revision preserves

| Conversation | Parsed | Items lost | Cost, both calls (USD) |
| --- | --- | --- | --- |
| F01_twenty_minutes | yes | none | 0.0151 |
| F02_move_first_to_tomorrow | yes | pick up the parcel. | 0.0133 |
| F03_done_with_top_two | yes | none | 0.0230 |
| F04_energy_change | yes | move laundry along. | 0.0116 |
| F05_add_one | yes | none | 0.0037 |

## Cost

Prices for `claude-sonnet-5`: $2.00 in, $10.00 out, $2.50 cache write, $0.20 cache read, per million tokens, read 2026-09-23 into `worker/contracts.js` as an assumption to re-check against the pricing page before quoting. Output tokens include the model's thinking tokens.

| Measure | USD |
| --- | --- |
| Per plan, one case one pass: cheapest / median / dearest (120 of 120 plans priced) | 0.0015 / 0.0064 / 0.0178 |
| Per plan, mean | 0.0071 |
| The grid, 120 plans | 0.8567 |
| Follow-ups, 5 conversations, two calls each | 0.0666 |
| Whole run, everything above that was priced | 0.9234 |
