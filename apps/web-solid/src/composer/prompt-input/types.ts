type FilePartSource = {
  start: number
  end: number
  value: string
  text?: {
    start: number
    end: number
    value: string
  }
}

type PromptInputV2PartBase = {
  content: string
  start: number
  end: number
}

export type PromptInputV2TextPart = PromptInputV2PartBase & {
  type: "text"
}

export type PromptInputV2FilePart = PromptInputV2PartBase & {
  type: "file"
  path: string
  selection?: PromptInputV2Selection
  mime?: string
  filename?: string
  url?: string
  source?: FilePartSource
}

export type PromptInputV2AgentPart = PromptInputV2PartBase & {
  type: "agent"
  name: string
}

export type PromptInputV2Attachment = {
  type: "image"
  id: string
  filename: string
  mime: string
  size: number
  blob: { id: string; url: string }
}

export type PromptInputV2Prompt = (
  | PromptInputV2TextPart
  | PromptInputV2FilePart
  | PromptInputV2AgentPart
  | PromptInputV2Attachment
)[]

export type PromptInputV2Selection = {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

export type PromptInputV2PersistedState = {
  prompt: PromptInputV2Prompt
  cursor?: number
}
