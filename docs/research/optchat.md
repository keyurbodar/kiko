# OptChat, read against kiko's memory

Read on 2026-10-05 from [OptChat: how to replicate my setup](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449), the OptMem author's spec of an endless chat whose history is its memory. Kiko's memory follows OptMem (architecture section 13). This note lists what OptChat changed and what kiko took.

## 1. What OptChat is

- One endless chat. Every message is logged verbatim. A cheap model builds a binary tree of one-line summaries over the log.
- Every user message starts a fresh model call whose input is the system prompt, a view of about 64k tokens of the whole chat, and the message. The agent zooms a line into its two halves, down to a message.
- The view holds only summaries, never a whole message. It changes by appending one line per message and merging the most due adjacent pair while it is over budget, so its start stays cached.

## 2. Taken by kiko

| OptChat | Why | Kiko |
| --- | --- | --- |
| no ids in the summarizer's input | measured: ids were copied into the output in 6 of 16 tries, 0 of 32 without | ids removed |
| models cannot count bytes | they overshoot, and spend thinking trying | kiko asks for 40 words and cuts the line at 280 bytes |
| the summarizer reads its input whole | a cut input loses its end for good | items up to 8,000 characters |
| a short stretch is its own summary with no model call | free and lossless | `Tree.free` |
| never show cut text as if whole | the agent acts on half a message | a cut line says so and how to zoom |
| tool results described, not copied; failures kept | what failed and why matters later | failed calls join a run's trace |
| a subagent can read the memory | it knows what the user wants and decided | helpers get `recall` and `zoom`, not `note` |

## 3. Not taken

- **A fresh call per message.** Kiko measured a reset on every run at about 1.8 times the tokens of keeping the transcript (section 13.4). Kiko wakes from memory only when the transcript passes 60,000 characters.
- **Waiting for summaries before a turn.** Kiko never makes a reply wait on a model. The newest turns stay verbatim instead.
- **The fold and one-message summaries.** Measured on `verify memory-hard`, section 13.1: no better than pages, and less of the view stays cached.
- **Retrying a failed summary forever.** Users bring their own keys. A key can be revoked, so kiko writes a model-free line after three failures.
- **The view as context for the summarizer.** Measured on `verify memory-hard`: no fact gained, and summary input grew from about 4,000 to about 179,000 tokens. The owner asked that memory use no more than before.
- **Asking again for a shorter line.** Each retry is a call. A line up to 128 bytes over is kept, and a longer one is cut.
- **"Zoom before you act, guess or ask."** With it, the agent's spend in `verify token-cost` ran 9 to 30% above the old design over four paired runs; without it, even. UNVERIFIED: that the agent looked things up more often is why.
- **The ranked COMPACT prompt.** On real pages it cost about 20% more thinking per call than memo's short prompt and kept no more facts.
- **A scale line of exactly the limit.** A limit in words works without one.
- **512 byte lines.** They made the `<memory>` block every fresh run reads about 60% bigger. Kiko keeps memo's 280.
- **The whole view as a subagent's first message.** A block of tokens on every helper. Kiko gives helpers the read tools instead.
- **Cache breakpoints inside the view.** pi-ai places breakpoints, and kiko adds no provider adapter.
- **Medium thinking for the summarizer.** Kiko asks for the least. On deepseek-v4.1-flash, thinking cannot be turned off: unset, minimal, and low spent alike. What cut it was the word limit.
