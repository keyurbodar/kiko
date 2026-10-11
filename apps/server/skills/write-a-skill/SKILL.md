---
name: write-a-skill
description: save a repeatable procedure as a skill when the human asks you to remember how to do something, or to make a skill.
---
a skill is a file in the chat's files: /skills/<name>/SKILL.md. it loads in every later run of this chat, so only write one when the human asked for it. say in a line what it will make you do before you write it.

format
---
name: <name>
description: one line saying when to use it. this is all you see until you load it, so make it specific.
---
the instructions, in plain steps.

rules
- <name> is lowercase words joined by dashes, at most 64 characters, and the same as the folder name.
- the description is required. a skill without one, or with a broken header, is skipped.
- other files in the folder (like /skills/<name>/references/notes.md) are read with read_skill(name, path).
- to change a skill, edit its file. to remove it, rm its folder.
