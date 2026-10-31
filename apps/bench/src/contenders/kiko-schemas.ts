import type { ToolSpec } from "../types"

export const KIKO_TOOLS: readonly ToolSpec[] = [
  {
    name: "computer_shell",
    description:
      "run one command line on the computer and return its exit code and the end of its output. the fastest way to look around, read logs, check a program, or run a tool. macOS and linux run /bin/sh -lc, so write the command for that system. cwd starts in the human's home folder. timeoutMs is how long to wait, default 60000.",
    parameters: {
      type: "object",
      required: ["command"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        command: {
          type: "string",
          description: "the whole command line",
        },
        cwd: {
          type: "string",
          description: "the folder to run it in",
        },
        timeoutMs: {
          type: "number",
          description: "how long to wait, default 60000, at most 590000",
        },
      },
    },
  },
  {
    name: "computer_read",
    description:
      "read one file on the computer as text, with its size. maxBytes caps how much is fetched, default 64000. a binary file comes back as a size and a note: use computer_shell for it.",
    parameters: {
      type: "object",
      required: ["path"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        path: {
          type: "string",
          description: "the file's path on that machine",
        },
        maxBytes: {
          type: "number",
          description: "at most this many bytes, default 64000",
        },
      },
    },
  },
  {
    name: "computer_write",
    description:
      "write text to one file on the computer, making the file and its folders if they are missing. this replaces the whole file unless append is true. it says how many bytes it wrote.",
    parameters: {
      type: "object",
      required: ["path", "text"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        path: {
          type: "string",
          description: "the file's path on that machine",
        },
        text: {
          type: "string",
          description: "the whole text to write",
        },
        append: {
          type: "boolean",
          description: "add to the end instead of replacing the file",
        },
      },
    },
  },
  {
    name: "terminal_open",
    description:
      "open a terminal on the computer: a real shell that stays alive between your turns, so you can start a long job, a REPL, or a full-screen app and come back to it. returns an id. cwd is where it starts, default the owner's home folder. cols and rows are the text size, default 120x30. shell is the program to run, default the owner's login shell. open a second terminal for a second job. for one command that finishes, computer_shell is simpler.",
    parameters: {
      type: "object",
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        cwd: {
          type: "string",
          description: "the folder to start in, default the owner's home folder",
        },
        shell: {
          type: "string",
          description: "the shell program, default the owner's login shell",
        },
        cols: {
          type: "number",
          description: "text columns, default 120, at most 500",
        },
        rows: {
          type: "number",
          description: "text rows, default 30, at most 200",
        },
        name: {
          type: "string",
          description: "a short name to tell terminals apart",
        },
      },
    },
  },
  {
    name: "terminal_send",
    description:
      'type into a terminal from terminal_open. text is typed exactly as written and does not press enter. keys presses named keys in order, such as ["enter"], ["ctrl+c"], ["up"], ["tab"], ["esc"], ["ctrl+d"]; use ctrl. give both to type a command and run it in one call. add until to send and wait in one call: the reply comes back as soon as that output appears, with the output up to it, or says it timed out. until is text, or a regular expression with regex true; timeoutMs defaults 30000 and is at most 120000. without until it does not return the screen: call terminal_wait to wait, or terminal_read to look.',
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        id: {
          type: "string",
          description: "the terminal id from terminal_open or terminal_list",
        },
        text: {
          type: "string",
          description: "the text to type, without pressing enter",
        },
        keys: {
          type: "array",
          items: {
            type: "string",
          },
          minItems: 1,
          maxItems: 20,
          description: 'named keys to press in order, such as ["enter"], ["ctrl+c"], ["up"]',
        },
        until: {
          type: "string",
          description: "wait in the same call until this output appears, then return it",
        },
        regex: {
          type: "boolean",
          description: "treat until as a regular expression, default false",
        },
        timeoutMs: {
          type: "number",
          description: "how long to wait for until, default 30000, at most 120000",
        },
      },
    },
  },
  {
    name: "terminal_read",
    description:
      "read a terminal as text. mode screen is the current visible screen, which is what a full-screen app such as vim, less or top shows. mode tail is the end of the output history, which is what a plain command printed; escape codes are removed. lines is how many lines of the tail to return, default 200, at most 2000. the reply says when older output was cut.",
    parameters: {
      type: "object",
      required: ["id", "mode"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        id: {
          type: "string",
          description: "the terminal id from terminal_open or terminal_list",
        },
        mode: {
          anyOf: [
            {
              type: "string",
              const: "screen",
            },
            {
              type: "string",
              const: "tail",
            },
          ],
        },
        lines: {
          type: "number",
          description: "for mode tail: how many lines, default 200, at most 2000",
        },
      },
    },
  },
  {
    name: "terminal_wait",
    description:
      "wait until a terminal prints something, without polling. until is the text to look for or, with regex true, a regular expression. it returns as soon as that appears, or says it timed out, or that the terminal exited. timeoutMs defaults 30000 and is at most 120000. use it after terminal_send to wait for a prompt or a command to finish instead of reading in a loop. the reply includes the end of the output, with escape codes removed.",
    parameters: {
      type: "object",
      required: ["id", "until"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        id: {
          type: "string",
          description: "the terminal id from terminal_open or terminal_list",
        },
        until: {
          type: "string",
          description: "the text to look for",
        },
        regex: {
          type: "boolean",
          description: "treat until as a regular expression, default false",
        },
        timeoutMs: {
          type: "number",
          description: "how long to wait, default 30000, at most 120000",
        },
      },
    },
  },
  {
    name: "terminal_list",
    description:
      "list the terminal sessions open on the computer with their ids, names, folders, sizes and whether they are still running. use it when you do not remember an id, or to see what is still open before you finish.",
    parameters: {
      type: "object",
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
      },
    },
  },
  {
    name: "terminal_close",
    description:
      "close a terminal and stop whatever runs in it. use it when a job is finished so it stops using the owner's machine. a terminal nobody touches closes itself after 30 minutes idle.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        id: {
          type: "string",
          description: "the terminal id from terminal_open or terminal_list",
        },
      },
    },
  },
]
