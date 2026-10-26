import type { ComputerCaps } from "@kiko/protocol"
import { getSetting, setSetting } from "../lib/settings"

export type ComputerOs = "macos" | "linux" | "windows"

export type ComputerRow = {
  id: string
  name: string
  public_key: string
  os: ComputerOs
  arch: string
  host: string
  caps_json: string
  pair_nonce: string
  created_at: number
}

export type NewComputer = {
  id: string
  name: string
  publicKey: string
  os: ComputerOs
  arch: string
  host: string
  caps: ComputerCaps
  pairNonce: string
  at: number
}

const COLUMNS = "id, name, public_key, os, arch, host, caps_json, pair_nonce, created_at"

const PAIRED_BY = "computers_owner"

export class ComputerStore {
  constructor(private readonly sql: SqlStorage) {}

  list(): ComputerRow[] {
    return this.sql.exec<ComputerRow>(`SELECT ${COLUMNS} FROM computers ORDER BY created_at, id`).toArray()
  }

  get(id: string): ComputerRow | null {
    return this.sql.exec<ComputerRow>(`SELECT ${COLUMNS} FROM computers WHERE id = ?`, id).toArray()[0] ?? null
  }

  insert(input: NewComputer, replaces?: string): boolean {
    const inserted = this.sql.exec(
      `INSERT INTO computers (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(pair_nonce) DO NOTHING`,
      input.id,
      input.name,
      input.publicKey,
      input.os,
      input.arch,
      input.host,
      JSON.stringify(input.caps),
      input.pairNonce,
      input.at,
    )
    if (inserted.rowsWritten === 0) return false
    if (replaces) this.remove(replaces)
    return true
  }

  rename(id: string, name: string): boolean {
    return this.sql.exec("UPDATE computers SET name = ? WHERE id = ? AND name IS NOT ?", name, id, name).rowsWritten > 0
  }

  remove(id: string): boolean {
    return this.sql.exec("DELETE FROM computers WHERE id = ?", id).rowsWritten > 0
  }

  followOwner(ownerId: string): void {
    const known = getSetting(this.sql, PAIRED_BY)
    if (known === ownerId) return
    if (known !== null) this.sql.exec("DELETE FROM computers")
    setSetting(this.sql, PAIRED_BY, ownerId)
  }

  caps(row: ComputerRow): ComputerCaps {
    return JSON.parse(row.caps_json) as ComputerCaps
  }
}
