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
]
