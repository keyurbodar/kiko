import type { ToolSpec } from "../types"

export const KIKO_TOOLS: readonly ToolSpec[] = [
  {
    name: "computer_shell",
    description:
      "run one command line on the computer and return its exit code and the end of its output. the fastest way to look around, read logs, check a program, or run a tool. macOS and linux run /bin/sh -lc, windows runs powershell, so write the command for that system. cwd starts in the human's home folder. timeoutMs is how long to wait, default 60000.",
    parameters: {
      type: "object",
      required: ["command"],
      properties: {
        pc: {
          type: "string",
          description: "the computer's name or id. leave it out when the owner has one computer",
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
          description: "the computer's name or id. leave it out when the owner has one computer",
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
          description: "the computer's name or id. leave it out when the owner has one computer",
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
    name: "computer_windows",
    description:
      "list every window open on the computer, including windows behind another one and minimized windows, with an id for computer_see and computer_use. this works in the background without touching the owner's screen, mouse or keyboard.",
    parameters: {
      type: "object",
      properties: {
        pc: {
          type: "string",
          description: "the computer's name or id. leave it out when the owner has one computer",
        },
      },
    },
  },
  {
    name: "computer_see",
    description:
      "see one window's controls with [ref] ids and a picture, even when it is behind another window or the owner is using the computer. it does not bring the window forward or move the owner's mouse. window is an id from computer_windows; pass the refs it returns to computer_use. act by ref, not by pixels.",
    parameters: {
      type: "object",
      required: ["window"],
      properties: {
        pc: {
          type: "string",
          description: "the computer's name or id. leave it out when the owner has one computer",
        },
        window: {
          type: "string",
          description: "the window id from computer_windows",
        },
        image: {
          type: "boolean",
          description: "take a picture of the window too, default true when you can see images",
        },
      },
    },
  },
  {
    name: "computer_use",
    description:
      "act on a window in the background without moving the owner's mouse or bringing the window forward, with up to 10 steps in one call. ref comes from computer_see. actions: press, focus, set_value, type, key, scroll, show_menu, select, toggle, expand, collapse, raise. stops at the first step that fails, then returns a fresh view of the window to check before you say what happened. set on_screen true only when the owner asked you to work on their screen: it then uses their real mouse and keyboard and brings the window forward.",
    parameters: {
      type: "object",
      required: ["window", "steps"],
      properties: {
        pc: {
          type: "string",
          description: "the computer's name or id. leave it out when the owner has one computer",
        },
        window: {
          type: "string",
          description: "the window id from computer_windows",
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["action"],
            properties: {
              action: {
                anyOf: [
                  {
                    type: "string",
                    const: "press",
                  },
                  {
                    type: "string",
                    const: "focus",
                  },
                  {
                    type: "string",
                    const: "set_value",
                  },
                  {
                    type: "string",
                    const: "type",
                  },
                  {
                    type: "string",
                    const: "key",
                  },
                  {
                    type: "string",
                    const: "scroll",
                  },
                  {
                    type: "string",
                    const: "show_menu",
                  },
                  {
                    type: "string",
                    const: "select",
                  },
                  {
                    type: "string",
                    const: "toggle",
                  },
                  {
                    type: "string",
                    const: "expand",
                  },
                  {
                    type: "string",
                    const: "collapse",
                  },
                  {
                    type: "string",
                    const: "raise",
                  },
                ],
              },
              ref: {
                type: "number",
                description: "the [ref] id from computer_see",
              },
              x: {
                type: "number",
                description: "a window-local x, with y, for an action without a ref",
              },
              y: {
                type: "number",
                description: "a window-local y, with x",
              },
              text: {
                type: "string",
                description: "for set_value and type: the text to put there",
              },
              keys: {
                type: "string",
                description:
                  'for key: chords such as "enter" or "cmd+l". use cmd on macOS and ctrl on Windows and Linux',
              },
              dx: {
                type: "number",
                description: "for scroll: horizontal pixels, positive is right",
              },
              dy: {
                type: "number",
                description: "for scroll: vertical pixels, positive is down",
              },
            },
          },
          minItems: 1,
          maxItems: 10,
        },
        on_screen: {
          type: "boolean",
          description: "use the owner's real screen, mouse and keyboard instead of working in the background",
        },
        image: {
          type: "boolean",
          description: "return a picture of the fresh view, default true when you can see images",
        },
      },
    },
  },
]
