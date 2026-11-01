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
    name: "browser_tabs",
    description:
      "list every tab in every browser kiko can drive, including tabs in the background, with an id for browser_read and browser_act, and say what each browser is doing. use the tab the owner already has open for a site instead of opening another.",
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
    name: "browser_read",
    description:
      "read one browser tab's controls with [ref] ids and a picture, including a tab in the background that the owner is not looking at. tab is an id from browser_tabs or browser_open; pass the refs it returns to browser_act.",
    parameters: {
      type: "object",
      required: ["tab"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        tab: {
          type: "string",
          description: "the tab id from browser_tabs or browser_open",
        },
        image: {
          type: "boolean",
          description: "take a picture of the tab too, default true when you can see images",
        },
      },
    },
  },
  {
    name: "browser_act",
    description:
      "click and type in one browser tab by ref, with up to 20 steps in one call, without bringing the tab forward. pass several steps in one call when you already know every ref from browser_read and do not need to see the page between them, such as filling a form and submitting it. ref comes from browser_read. actions: click, type, set_value, select, press_key, scroll, focus. it stops at the first step that fails and then reads the tab again to check before you say what happened. a ref from a page the steps have left fails as stale: read the page again. set on_screen true only when the owner asked you to work on their screen: it then brings the tab forward and uses their real mouse and keyboard.",
    parameters: {
      type: "object",
      required: ["tab", "steps"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        tab: {
          type: "string",
          description: "the tab id from browser_tabs or browser_read",
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["action", "ref"],
            properties: {
              action: {
                anyOf: [
                  {
                    type: "string",
                    const: "click",
                  },
                  {
                    type: "string",
                    const: "type",
                  },
                  {
                    type: "string",
                    const: "set_value",
                  },
                  {
                    type: "string",
                    const: "select",
                  },
                  {
                    type: "string",
                    const: "press_key",
                  },
                  {
                    type: "string",
                    const: "scroll",
                  },
                  {
                    type: "string",
                    const: "focus",
                  },
                ],
              },
              ref: {
                type: "number",
                description: "the [ref] id from browser_read",
              },
              text: {
                type: "string",
                description: "for type, set_value and select: the text to put there",
              },
            },
          },
          minItems: 1,
          maxItems: 20,
        },
        on_screen: {
          type: "boolean",
          description: "use the owner's real screen instead of working in the background",
        },
        image: {
          type: "boolean",
          description: "return a picture of the fresh view, default true when you can see images",
        },
      },
    },
  },
  {
    name: "browser_open",
    description:
      "open a URL in a new tab in the background, in the browser the owner already uses, without bringing it to the front. use the tab the owner already has open for that site instead when there is one.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        url: {
          type: "string",
          description: "the full URL to open, such as https://example.com",
        },
      },
    },
  },
  {
    name: "browser_close",
    description: "close one browser tab by id, in the background.",
    parameters: {
      type: "object",
      required: ["tab"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        tab: {
          type: "string",
          description: "the tab id from browser_tabs",
        },
      },
    },
  },
  {
    name: "browser_show",
    description:
      "bring one browser tab to the front so the owner can see it. this takes over their screen: use it only when the owner asks you to show them something.",
    parameters: {
      type: "object",
      required: ["tab"],
      properties: {
        pc: {
          type: "string",
          description:
            "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
        },
        tab: {
          type: "string",
          description: "the tab id from browser_tabs",
        },
      },
    },
  },
]
