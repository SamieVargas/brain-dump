# Brain Dump evals — 2026-09-22

Model `claude-sonnet-5` · prompt sort@v2 · 1 runs per cell

## Violation rate per rule, per state

| State | Runs | Hard fails | Cap | Banned phrasing | Routing | Schema | Strategy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| anxious | 20 | 6 | 0% | 5% | 0% | 0% | 0% |

## Parse outcome per contract

| Contract | Runs | Native | Recovered | Failed | Cap violations |
| --- | --- | --- | --- | --- | --- |
| native | 20 | 14 | 0 | 6 | 0% |

Hard fail on the native path (valid_json failing): **6** · cut off at max_tokens (2048): 6 of 20 · cache reads on 95% of runs · mean latency 17453 ms · errors 0

## Follow-ups: revision preserves

| Conversation | Parsed | Items lost |
| --- | --- | --- |
| F01_twenty_minutes | yes | none |
| F02_move_first_to_tomorrow | yes | water the tomatoes before it gets dark |
| F03_done_with_top_two | first plan did not parse | — |
| F04_energy_change | yes | move the laundry from washer to dryer |
| F05_add_one | yes | none |
