# Model switch

A person picks which model Kiko answers with, from the composer. The choice applies to the next message.

Target behavior lands in the rework; today's behavior differs.

## Sub-features

- Choose a model from the composer's model button.
- The model list shows the connected provider's models. The list comes from `pi-ai` at run time. For OpenCode Go the proof model is "Cat Jam Free".
- The button shows the chosen model name.
- The first-run model step sets Kiko's model when you finish setup.
- Thinking levels, where the model supports them ("Reasoning" button).

## How to get to it (user POV)

1. Connect a provider first (see `../SKILL.md`, Model setup). Without a provider the list is empty.
2. Click the model button in the composer ("Choose model", or the current model name).
3. Pick a model in the list. The button now shows that model.
4. Send a message to confirm the reply comes from it.

## Driving it with agent-browser

```bash
S=kiko-<run-id>
agent-browser --session $S snapshot -i                  # find button "Choose model" (or the model name)
agent-browser --session $S click @eN                    # opens the model listbox
agent-browser --session $S snapshot -i                  # the listbox options now have refs
agent-browser --session $S click @eM                    # e.g. the option "Cat Jam Free"
agent-browser --session $S snapshot -i                  # the model button now shows the chosen model
agent-browser --session $S screenshot /tmp/kiko-verify/<run-id>/evidence/model.png
```

Proof: the composer's model button shows the chosen model, and the next reply comes from it. Check the button text in the snapshot. The label may differ from the display name, so read it once before you assert on it.

## Gotchas

- The button label may be a slug, not the display name. Read the label once and assert on what you see.
- Refs change when the listbox opens. Re-snapshot before choosing an option.
- A model is per agent. Changing Kiko's model does not change other agents.
- Use the model's listed name. Do not add model ids in code (AGENTS.md: model lists come from `pi-ai` at run time).
- Model suites need a real key in the shell. Use `bun kiko verify agent-models --url ...` for the backend side.
