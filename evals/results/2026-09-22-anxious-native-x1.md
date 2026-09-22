# Brain Dump evals — 2026-09-22

Model `claude-sonnet-5` · prompt sort@v2 · 1 runs per cell

## Violation rate per rule, per state

| State | Runs | Hard fails | Cap | Banned phrasing | Routing | Schema | Strategy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| anxious | 20 | 0 | 0% | 30% | 10% | 0% | 0% |

## Parse outcome per contract

| Contract | Runs | Native | Recovered | Failed | Cap violations |
| --- | --- | --- | --- | --- | --- |
| native | 20 | 20 | 0 | 0 | 0% |

Hard fail on the native path (valid_json failing): **0** · cut off at max_tokens (4096): 0 of 20 · cache reads on 95% of runs · mean latency 19332 ms · errors 0

## Follow-ups: revision preserves

| Conversation | Parsed | Items lost |
| --- | --- | --- |
| F01_twenty_minutes | yes | none |
| F02_move_first_to_tomorrow | yes | water the tomatoes before it gets dark |
| F03_done_with_top_two | yes | text mum back; pay the electric bill; cancel the trial subscription |
| F04_energy_change | yes | eat something — whatever's fastest, no cooking needed.; switch the laundry from the washer to the dryer. |
| F05_add_one | yes | none |
